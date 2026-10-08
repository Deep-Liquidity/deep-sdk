/**
 * deep-amm (DeepSwap) `SwapEvent` decoding for the indexer. Layout matches
 * programs/deep-amm/src/states/events.rs (unchanged from upstream cp-swap).
 *
 * Only swaps in deep-curve's own graduation pools are DEEP markets: anyone can open
 * other pools for the same pair at any price (docs/KNOWN_ISSUES.md DA-4), so callers
 * filter with `isGraduationPool` before storing anything.
 */
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { DEEP_AMM_FEES } from "./deep-amm.js";
import { CPMM_FEE_DENOMINATOR, DEEP_AMM_PROGRAM_ID, NATIVE_MINT } from "./raydium-cpmm.js";
const SWAP_EVENT_DISC = discriminator("event", "SwapEvent");
const SWAP_EVENT_SIZE = 32 + 8 * 6 + 1 + 32 + 32 + 8 + 8 + 1;
export function decodeAmmSwapEvent(data) {
    if (data.length < 8 + SWAP_EVENT_SIZE)
        return null;
    for (let i = 0; i < 8; i++)
        if (data[i] !== SWAP_EVENT_DISC[i])
            return null;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 8;
    const pk = () => {
        const k = new PublicKey(data.slice(o, o + 32));
        o += 32;
        return k;
    };
    const u64 = () => {
        const x = v.getBigUint64(o, true);
        o += 8;
        return x;
    };
    const bool = () => {
        const b = data[o++];
        if (b !== 0 && b !== 1)
            throw new RangeError("invalid bool");
        return b === 1;
    };
    return {
        poolId: pk(),
        inputVaultBefore: u64(),
        outputVaultBefore: u64(),
        inputAmount: u64(),
        outputAmount: u64(),
        inputTransferFee: u64(),
        outputTransferFee: u64(),
        baseInput: bool(),
        inputMint: pk(),
        outputMint: pk(),
        tradeFee: u64(),
        creatorFee: u64(),
        creatorFeeOnInput: bool(),
    };
}
const SWAP_FEES_V1_DISC = discriminator("event", "SwapFeesV1");
const SWAP_FEES_V1_SIZE = 32 + 1 + 32 + 8 * 3 + 1;
/** Null when `data` is not a SwapFeesV1 event; throws RangeError on an invalid bool. */
export function decodeAmmSwapFeesV1(data) {
    if (data.length < 8 + SWAP_FEES_V1_SIZE)
        return null;
    for (let i = 0; i < 8; i++)
        if (data[i] !== SWAP_FEES_V1_DISC[i])
            return null;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const isBuy = data[40];
    if (isBuy !== 0 && isBuy !== 1)
        throw new RangeError("invalid bool");
    return {
        poolId: new PublicKey(data.slice(8, 40)),
        isBuy: isBuy === 1,
        quoteMint: new PublicKey(data.slice(41, 73)),
        lpFee: v.getBigUint64(73, true),
        protocolFee: v.getBigUint64(81, true),
        rewardFee: v.getBigUint64(89, true),
        rewardModel: data[97],
    };
}
/**
 * True when `fees` is the SwapFeesV1 of the swap `e`: same pool, same side, the quote mint on
 * the fee side, and the same amounts as the SwapEvent reports (for a V1 swap its `tradeFee`
 * is LP + protocol and its `creatorFee` the reward).
 */
export function swapFeesV1Match(e, fees) {
    return (fees.poolId.equals(e.poolId) &&
        fees.isBuy === e.creatorFeeOnInput &&
        fees.quoteMint.equals(fees.isBuy ? e.inputMint : e.outputMint) &&
        fees.lpFee + fees.protocolFee === e.tradeFee &&
        fees.rewardFee === e.creatorFee);
}
/**
 * The reserves right after a V1 swap, [input side, output side]: the DEEP and reward parts
 * leave the reserves on the QUOTE side (the input of a buy, the output of a sell), the LP
 * part stays. `SwapEvent.outputAmount` of a sell is already net of the whole fee.
 */
function reservesAfterV1(e, fees) {
    const accrued = fees.protocolFee + fees.rewardFee;
    return fees.isBuy
        ? [e.inputVaultBefore + e.inputAmount - accrued, e.outputVaultBefore - e.outputAmount]
        : [e.inputVaultBefore + e.inputAmount, e.outputVaultBefore - e.outputAmount - accrued];
}
/** [input side, output side] reserves after `e`; null when the payload is inconsistent. */
export function swapReservesAfter(e, rates, feesV1) {
    let after;
    if (feesV1) {
        if (!swapFeesV1Match(e, feesV1))
            return null;
        after = reservesAfterV1(e, feesV1);
    }
    else {
        const cut = (rate) => (e.tradeFee * rate) / CPMM_FEE_DENOMINATOR;
        after = [
            e.inputVaultBefore +
                e.inputAmount -
                cut(rates.protocolFeeRate) -
                cut(rates.fundFeeRate) -
                (e.creatorFeeOnInput ? e.creatorFee : 0n),
            e.outputVaultBefore - e.outputAmount - (e.creatorFeeOnInput ? 0n : e.creatorFee),
        ];
    }
    return after[0] < 0n || after[1] <= 0n ? null : after;
}
/**
 * Turns a SOL-pair SwapEvent into a trade: side, amounts, and the pool's reserves right
 * after the swap. The protocol and fund slices of the trade fee leave the pool's
 * reserves (same floor rounding as the program), so they're subtracted from the input
 * side; the LP share stays. The creator fee (charged on top of the trade fee, on the input
 * or the output side) leaves the reserves too and is reported separately. For a sell with
 * the creator fee on the SOL output, `solAmount` is what the trader received, i.e. already
 * net of that fee. Returns null for pairs without WSOL.
 *
 * DEEP V1 pools: pass the swap's `SwapFeesV1` as `feesV1` (`parseAmmSwapEventsWithSource`
 * pairs them). Then `rates` is not used: every fee of a V1 swap is in SOL, on a sell
 * `solAmount` is net of the whole fee, `tradeFee` is the LP + DEEP parts, `protocolFee` is
 * DEEP's exact part, `fundFee` is 0, `creatorFee` is the reward part, and the DEEP and reward
 * parts leave the SOL reserves in both directions. Returns null when `feesV1` does not belong
 * to `e`. Without `feesV1` the legacy arithmetic applies unchanged, which is WRONG for a V1
 * swap: always pass it when the transaction has one.
 */
export function toPoolSwap(e, ctx, rates = DEEP_AMM_FEES, feesV1) {
    const solIn = e.inputMint.equals(NATIVE_MINT);
    const solOut = e.outputMint.equals(NATIVE_MINT);
    if (solIn === solOut)
        return null;
    const after = swapReservesAfter(e, rates, feesV1);
    if (!after)
        return null; // inconsistent payload: skip
    const [inputAfter, outputAfter] = after;
    if (feesV1)
        return {
            name: "PoolSwap",
            pool: e.poolId.toBase58(),
            mint: (solIn ? e.outputMint : e.inputMint).toBase58(),
            trader: ctx.trader,
            isBuy: solIn,
            solAmount: solIn ? e.inputAmount : e.outputAmount,
            tokenAmount: solIn ? e.outputAmount : e.inputAmount,
            tradeFee: e.tradeFee,
            protocolFee: feesV1.protocolFee,
            fundFee: 0n,
            creatorFee: feesV1.rewardFee,
            // a V1 pool with WSOL always has WSOL as its quote, so every part is in lamports
            creatorFeeInSol: feesV1.quoteMint.equals(NATIVE_MINT),
            feeModel: 1,
            tradeFeeInSol: feesV1.quoteMint.equals(NATIVE_MINT),
            lpFee: feesV1.lpFee,
            rewardModel: feesV1.rewardModel,
            solReservesAfter: solIn ? inputAfter : outputAfter,
            tokenReservesAfter: solIn ? outputAfter : inputAfter,
            timestamp: ctx.timestamp,
        };
    const cut = (rate) => (e.tradeFee * rate) / CPMM_FEE_DENOMINATOR;
    return {
        name: "PoolSwap",
        pool: e.poolId.toBase58(),
        mint: (solIn ? e.outputMint : e.inputMint).toBase58(),
        trader: ctx.trader,
        isBuy: solIn,
        solAmount: solIn ? e.inputAmount : e.outputAmount,
        tokenAmount: solIn ? e.outputAmount : e.inputAmount,
        tradeFee: e.tradeFee,
        protocolFee: cut(rates.protocolFeeRate) + cut(rates.fundFeeRate),
        fundFee: cut(rates.fundFeeRate),
        creatorFee: e.creatorFee,
        creatorFeeInSol: e.creatorFeeOnInput ? solIn : solOut,
        solReservesAfter: solIn ? inputAfter : outputAfter,
        tokenReservesAfter: solIn ? outputAfter : inputAfter,
        timestamp: ctx.timestamp,
    };
}
function base64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/**
 * SwapEvents emitted by `programId` itself, in log order, with the instruction that
 * emitted each. Tracks the invoke stack so `Program data:` lines from any other program
 * (spoofing) are ignored.
 *
 * DEEP V1: a swap of a V1 pool emits a `SwapFeesV1` right after its SwapEvent. It is attached
 * to that swap as `feesV1` only when it is the very next event of the SAME invocation and
 * belongs to it (`swapFeesV1Match`); a stray or mismatching one is dropped.
 */
export function parseAmmSwapEventsWithSource(logs, programId = DEEP_AMM_PROGRAM_ID) {
    const pid = programId.toBase58();
    /** `last`: the swap this invocation just emitted, still waiting for its SwapFeesV1. */
    const stack = [];
    const out = [];
    let topLevel = -1;
    let cpiCount = 0;
    for (const line of logs) {
        const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
        if (invoke) {
            const depth = Number(invoke[2]);
            if (depth === 1) {
                topLevel++;
                cpiCount = 0;
            }
            const isAmm = invoke[1] === pid;
            // the two events of a V1 swap are emitted back to back, before any CPI
            const parent = stack[stack.length - 1];
            if (parent)
                parent.last = null;
            stack.push({
                program: invoke[1],
                source: { topLevel, cpi: isAmm && depth > 1 ? cpiCount++ : null },
                last: null,
            });
            continue;
        }
        if (/^Program \w+ (success|failed)/.test(line)) {
            stack.pop();
            continue;
        }
        const top = stack[stack.length - 1];
        if (line.startsWith("Program data: ") && top?.program === pid) {
            const waiting = top.last;
            top.last = null;
            try {
                const bytes = base64ToBytes(line.slice("Program data: ".length).trim());
                const ev = decodeAmmSwapEvent(bytes);
                if (ev) {
                    const swap = { event: ev, source: top.source };
                    out.push(swap);
                    top.last = swap;
                    continue;
                }
                const fees = waiting ? decodeAmmSwapFeesV1(bytes) : null;
                if (waiting && fees && swapFeesV1Match(waiting.event, fees))
                    waiting.feesV1 = fees;
            }
            catch {
                // malformed payload: skip, never crash the indexer
            }
        }
    }
    return out;
}
/** SwapEvents emitted by `programId` itself, in log order (see parseAmmSwapEventsWithSource). */
export function parseAmmSwapEvents(logs, programId = DEEP_AMM_PROGRAM_ID) {
    return parseAmmSwapEventsWithSource(logs, programId).map((e) => e.event);
}
//# sourceMappingURL=amm-events.js.map