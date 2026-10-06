import { BPS_DENOMINATOR, ceilDiv, CurveMathError, validateFees, } from "./math.js";
export const LAMPORTS_PER_SOL = 1000000000n;
const UNIT = 10n ** 6n; // 6 decimals
/**
 * Default "Deep" parameters (devnet).
 * 1B supply, 800M on the curve, 200M reserved for DeepSwap LP.
 * Virtual 45 SOL / 1,000M tokens. Completing the curve raises 180 SOL and ends at a
 * fully diluted market cap of 1,125 SOL — ≈ $169K at a $150 reference SOL price,
 * inside the spec's $150K–$200K target band. Threshold is SOL-denominated on-chain;
 * USD figures are estimates only.
 */
export const DEFAULT_LAUNCH_PARAMS = {
    decimals: 6,
    tokenTotalSupply: 1000000000n * UNIT,
    curveSupply: 800000000n * UNIT,
    initialVirtualSol: 45n * LAMPORTS_PER_SOL,
    initialVirtualToken: 1000000000n * UNIT,
    fees: { protocolFeeBps: 70n, creatorFeeBps: 30n },
    migrationFeeBps: 100n,
};
export function validateLaunchParams(p) {
    validateFees(p.fees);
    if (p.decimals < 0 || p.decimals > 9)
        throw new CurveMathError("InvalidParams", "decimals 0–9");
    if (p.curveSupply <= 0n || p.curveSupply > p.tokenTotalSupply)
        throw new CurveMathError("InvalidParams", "curveSupply must be in (0, totalSupply]");
    if (p.initialVirtualToken <= p.curveSupply)
        throw new CurveMathError("InvalidParams", "initialVirtualToken must exceed curveSupply");
    if (p.initialVirtualSol <= 0n)
        throw new CurveMathError("InvalidParams", "initialVirtualSol > 0");
    if (p.migrationFeeBps < 0n || p.migrationFeeBps > 500n)
        throw new CurveMathError("InvalidParams", "migrationFeeBps 0–500");
}
export function initialState(p) {
    validateLaunchParams(p);
    return {
        virtualSolReserves: p.initialVirtualSol,
        virtualTokenReserves: p.initialVirtualToken,
        realSolReserves: 0n,
        realTokenReserves: p.curveSupply,
        curveSupply: p.curveSupply,
        tokenTotalSupply: p.tokenTotalSupply,
        complete: false,
    };
}
/** Fully diluted market cap in lamports at the current spot price. Rounds down. */
export function marketCapLamports(s) {
    return (s.virtualSolReserves * s.tokenTotalSupply) / s.virtualTokenReserves;
}
/** Tokens sold from the curve so far (base units). */
export function tokensSold(s) {
    return s.curveSupply - s.realTokenReserves;
}
/** Depth progress in bps (0–10000). Rounds down. */
export function depthBps(s) {
    return (tokensSold(s) * BPS_DENOMINATOR) / s.curveSupply;
}
/** State the curve will be in at completion (every curve token sold). */
export function completionState(p) {
    const s = initialState(p);
    const k = s.virtualSolReserves * s.virtualTokenReserves;
    const vToken = s.virtualTokenReserves - s.curveSupply;
    const vSol = ceilDiv(k, vToken);
    return {
        ...s,
        virtualSolReserves: vSol,
        virtualTokenReserves: vToken,
        realSolReserves: vSol - s.virtualSolReserves,
        realTokenReserves: 0n,
        complete: true,
    };
}
/**
 * Liquidity allocation at graduation. The pool is seeded at the curve's final
 * spot price (vSol/vToken) so there is no price discontinuity at migration.
 */
export function graduationAllocation(s, migrationFeeBps) {
    if (!s.complete)
        throw new CurveMathError("InvalidParams", "curve not complete");
    const reserve = s.tokenTotalSupply - s.curveSupply;
    const migrationFee = ceilDiv(s.realSolReserves * migrationFeeBps, BPS_DENOMINATOR);
    const lpSol = s.realSolReserves - migrationFee;
    let lpTokens = (lpSol * s.virtualTokenReserves) / s.virtualSolReserves;
    if (lpTokens > reserve)
        lpTokens = reserve;
    return {
        raisedSol: s.realSolReserves,
        migrationFee,
        lpSol,
        lpTokens,
        burnTokens: reserve - lpTokens,
    };
}
//# sourceMappingURL=params.js.map