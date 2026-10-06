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
export declare function toPoolSwap(e: AmmSwapEventRaw, ctx: {
    trader: string;
    timestamp: bigint;
}, rates?: PoolSwapRates): PoolSwapEvent | null;
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
export declare function parseAmmSwapEventsWithSource(logs: readonly string[], programId?: PublicKey): {
    event: AmmSwapEventRaw;
    source: AmmEventSource;
}[];
/** SwapEvents emitted by `programId` itself, in log order (see parseAmmSwapEventsWithSource). */
export declare function parseAmmSwapEvents(logs: readonly string[], programId?: PublicKey): AmmSwapEventRaw[];
