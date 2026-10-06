/**
 * Constant-product AMM quote (x·y=k) with an input-side fee, as used by
 * Raydium CPMM-style pools. Used for DeepSwap quote previews; execution
 * always happens in the AMM program, whose result is authoritative.
 */
export interface CpmmQuote {
    amountIn: bigint;
    fee: bigint;
    amountOut: bigint;
    /** price impact vs. spot, bps (rounded down) */
    priceImpactBps: bigint;
}
export declare function quoteCpmm(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): CpmmQuote;
