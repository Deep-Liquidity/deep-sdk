import { BPS_DENOMINATOR, CurveMathError } from "./math.js";
export function quoteCpmm(reserveIn, reserveOut, amountIn, feeBps) {
    if (amountIn <= 0n)
        throw new CurveMathError("ZeroAmount");
    if (reserveIn <= 0n || reserveOut <= 0n)
        throw new CurveMathError("InsufficientReserves");
    if (feeBps < 0n || feeBps >= BPS_DENOMINATOR)
        throw new CurveMathError("InvalidFee");
    const fee = (amountIn * feeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
    const net = amountIn - fee;
    const amountOut = (reserveOut * net) / (reserveIn + net);
    if (amountOut === 0n)
        throw new CurveMathError("ZeroAmount");
    // spot out for `net` would be net * reserveOut / reserveIn
    const spotOut = (net * reserveOut) / reserveIn;
    const priceImpactBps = spotOut === 0n ? 0n : ((spotOut - amountOut) * BPS_DENOMINATOR) / spotOut;
    return { amountIn, fee, amountOut, priceImpactBps };
}
//# sourceMappingURL=cpmm.js.map