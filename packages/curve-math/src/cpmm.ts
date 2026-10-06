import { BPS_DENOMINATOR, CurveMathError } from "./math.js";

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

export function quoteCpmm(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  feeBps: bigint,
): CpmmQuote {
  if (amountIn <= 0n) throw new CurveMathError("ZeroAmount");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new CurveMathError("InsufficientReserves");
  if (feeBps < 0n || feeBps >= BPS_DENOMINATOR) throw new CurveMathError("InvalidFee");
  const fee = (amountIn * feeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
  const net = amountIn - fee;
  const amountOut = (reserveOut * net) / (reserveIn + net);
  if (amountOut === 0n) throw new CurveMathError("ZeroAmount");
  // spot out for `net` would be net * reserveOut / reserveIn
  const spotOut = (net * reserveOut) / reserveIn;
  const priceImpactBps = spotOut === 0n ? 0n : ((spotOut - amountOut) * BPS_DENOMINATOR) / spotOut;
  return { amountIn, fee, amountOut, priceImpactBps };
}
