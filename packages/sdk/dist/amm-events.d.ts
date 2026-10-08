/**
 * deep-amm (DeepSwap) `SwapEvent` decoding for the indexer. Layout matches
 * programs/deep-amm/src/states/events.rs (unchanged from upstream cp-swap).
 *
 * Only swaps in deep-curve's own graduation pools are DEEP markets: anyone can open
 * other pools for the same pair at any price (docs/KNOWN_ISSUES.md DA-4), so callers
 * filter with `isGraduationPool` before storing anything.
 */
import { PublicKey } from "@solana/web3.js";
import type { PoolSwapEvent } from "./events.js";
/** Raw deep-amm SwapEvent fields. */
export interface AmmSwapEventRaw {
    poolId: PublicKey;
    /** input vault minus accrued protocol/fund/creator fees, before the swap */
    inputVaultBefore: bigint;
    outputVaultBefore: bigint;
    /** amounts without token-2022 transfer fees */
    inputAmount: bigint;
    outputAmount: bigint;
    inputTransferFee: bigint;
    outputTransferFee: bigint;
    baseInput: boolean;
    inputMint: PublicKey;
    outputMint: PublicKey;
    tradeFee: bigint;
    creatorFee: bigint;
    creatorFeeOnInput: boolean;
}
export declare function decodeAmmSwapEvent(data: Uint8Array): AmmSwapEventRaw | null;
/**
 * Raw deep-amm `SwapFeesV1` fields (DEEP V1). Emitted right after the `SwapEvent` of every
 * swap of a V1 pool (fee model 1), with the exact fee parts of that swap. All three amounts
 * are in `quoteMint`: the input token of a buy, the output token of a sell.
 */
export interface AmmSwapFeesV1Raw {
    poolId: PublicKey;
    /** True: quote token in, the fee came off the input. False: quote token out, the fee came
     * off the output and `SwapEvent.outputAmount` is already net of it. */
    isBuy: boolean;
    quoteMint: PublicKey;
    /** Stays in the pool as reserve. */
    lpFee: bigint;
    /** DEEP's part, accrued as protocol fee on the quote side. */
    protocolFee: bigint;
    /** The reward recipient's part, accrued as creator fee on the quote side (0 for Standard). */
    rewardFee: bigint;
    /** 0 Standard, 1 Creator, 2 Holder. */
    rewardModel: number;
}
/** Null when `data` is not a SwapFeesV1 event; throws RangeError on an invalid bool. */
export declare function decodeAmmSwapFeesV1(data: Uint8Array): AmmSwapFeesV1Raw | null;
/**
 * True when `fees` is the SwapFeesV1 of the swap `e`: same pool, same side, the quote mint on
 * the fee side, and the same amounts as the SwapEvent reports (for a V1 swap its `tradeFee`
 * is LP + protocol and its `creatorFee` the reward).
 */
export declare function swapFeesV1Match(e: AmmSwapEventRaw, fees: AmmSwapFeesV1Raw): boolean;
/** [input side, output side] reserves after `e`; null when the payload is inconsistent. */
export declare function swapReservesAfter(e: AmmSwapEventRaw, rates: PoolSwapRates, feesV1?: AmmSwapFeesV1Raw | null): [bigint, bigint] | null;
export interface PoolSwapRates {
    /** AmmConfig.protocol_fee_rate (share of the trade fee, per 1e6). */
    protocolFeeRate: bigint;
    /** AmmConfig.fund_fee_rate (share of the trade fee, per 1e6). */
    fundFeeRate: bigint;
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
export declare function toPoolSwap(e: AmmSwapEventRaw, ctx: {
    trader: string;
    timestamp: bigint;
}, rates?: PoolSwapRates, feesV1?: AmmSwapFeesV1Raw | null): PoolSwapEvent | null;
/** Where a SwapEvent came from, to find the swap instruction's accounts. */
export interface AmmEventSource {
    /** Index of the top-level instruction the event happened under. */
    topLevel: number;
    /** null when deep-amm is that top-level instruction; otherwise the 0-based position of
     * this deep-amm invocation among deep-amm CPIs within that top-level instruction (the
     * order they appear in `meta.innerInstructions`). */
    cpi: number | null;
}
/** One swap found in a transaction's logs. */
export interface ParsedAmmSwap {
    event: AmmSwapEventRaw;
    source: AmmEventSource;
    /**
     * DEEP V1: the `SwapFeesV1` the same deep-amm invocation emitted right after `event`.
     * Present only for a swap of a V1 pool; pass it to `toPoolSwap` / `toPairSwap`.
     */
    feesV1?: AmmSwapFeesV1Raw;
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
export declare function parseAmmSwapEventsWithSource(logs: readonly string[], programId?: PublicKey): ParsedAmmSwap[];
/** SwapEvents emitted by `programId` itself, in log order (see parseAmmSwapEventsWithSource). */
export declare function parseAmmSwapEvents(logs: readonly string[], programId?: PublicKey): AmmSwapEventRaw[];
