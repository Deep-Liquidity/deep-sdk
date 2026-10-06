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
import type { PoolSwapEvent } from "./events.js";
import { CPMM_FEE_DENOMINATOR, DEEP_AMM_PROGRAM_ID, NATIVE_MINT } from "./raydium-cpmm.js";

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

const SWAP_EVENT_DISC = discriminator("event", "SwapEvent");
const SWAP_EVENT_SIZE = 32 + 8 * 6 + 1 + 32 + 32 + 8 + 8 + 1;

export function decodeAmmSwapEvent(data: Uint8Array): AmmSwapEventRaw | null {
  if (data.length < 8 + SWAP_EVENT_SIZE) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== SWAP_EVENT_DISC[i]) return null;
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
    if (b !== 0 && b !== 1) throw new RangeError("invalid bool");
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
 */
export function toPoolSwap(
  e: AmmSwapEventRaw,
  ctx: { trader: string; timestamp: bigint },
  rates: PoolSwapRates = DEEP_AMM_FEES,
): PoolSwapEvent | null {
  const solIn = e.inputMint.equals(NATIVE_MINT);
  const solOut = e.outputMint.equals(NATIVE_MINT);
  if (solIn === solOut) return null;
  const cut = (rate: bigint) => (e.tradeFee * rate) / CPMM_FEE_DENOMINATOR;
  const inputAfter =
    e.inputVaultBefore +
    e.inputAmount -
    cut(rates.protocolFeeRate) -
    cut(rates.fundFeeRate) -
    (e.creatorFeeOnInput ? e.creatorFee : 0n);
  const outputAfter =
    e.outputVaultBefore - e.outputAmount - (e.creatorFeeOnInput ? 0n : e.creatorFee);
  if (inputAfter < 0n || outputAfter <= 0n) return null; // inconsistent payload: skip
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
    creatorFee: e.creatorFee,
    creatorFeeInSol: e.creatorFeeOnInput ? solIn : solOut,
    solReservesAfter: solIn ? inputAfter : outputAfter,
    tokenReservesAfter: solIn ? outputAfter : inputAfter,
    timestamp: ctx.timestamp,
  };
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Where a SwapEvent came from, to find the swap instruction's accounts. */
export interface AmmEventSource {
  /** Index of the top-level instruction the event happened under. */
  topLevel: number;
  /** null when deep-amm is that top-level instruction; otherwise the 0-based position of
   * this deep-amm invocation among deep-amm CPIs within that top-level instruction (the
   * order they appear in `meta.innerInstructions`). */
  cpi: number | null;
}

/**
 * SwapEvents emitted by `programId` itself, in log order, with the instruction that
 * emitted each. Tracks the invoke stack so `Program data:` lines from any other program
 * (spoofing) are ignored.
 */
export function parseAmmSwapEventsWithSource(
  logs: readonly string[],
  programId: PublicKey = DEEP_AMM_PROGRAM_ID,
): { event: AmmSwapEventRaw; source: AmmEventSource }[] {
  const pid = programId.toBase58();
  const stack: { program: string; source: AmmEventSource }[] = [];
  const out: { event: AmmSwapEventRaw; source: AmmEventSource }[] = [];
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
      stack.push({
        program: invoke[1]!,
        source: { topLevel, cpi: isAmm && depth > 1 ? cpiCount++ : null },
      });
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    if (line.startsWith("Program data: ") && top?.program === pid) {
      try {
        const ev = decodeAmmSwapEvent(base64ToBytes(line.slice("Program data: ".length).trim()));
        if (ev) out.push({ event: ev, source: top.source });
      } catch {
        // malformed payload: skip, never crash the indexer
      }
    }
  }
  return out;
}

/** SwapEvents emitted by `programId` itself, in log order (see parseAmmSwapEventsWithSource). */
export function parseAmmSwapEvents(
  logs: readonly string[],
  programId: PublicKey = DEEP_AMM_PROGRAM_ID,
): AmmSwapEventRaw[] {
  return parseAmmSwapEventsWithSource(logs, programId).map((e) => e.event);
}
