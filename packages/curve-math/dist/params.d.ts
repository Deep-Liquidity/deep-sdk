import { type CurveState, type FeeConfig } from "./math.js";
export declare const LAMPORTS_PER_SOL = 1000000000n;
export interface LaunchParams {
    decimals: number;
    /** Total mint supply, base units. */
    tokenTotalSupply: bigint;
    /** Portion sold on the curve, base units. Remainder is reserved for graduation LP. */
    curveSupply: bigint;
    /** Initial virtual SOL reserves, lamports. Sets the starting price. */
    initialVirtualSol: bigint;
    /** Initial virtual token reserves, base units. Must exceed curveSupply. */
    initialVirtualToken: bigint;
    fees: FeeConfig;
    /** Fee taken from raised SOL at graduation, bps. */
    migrationFeeBps: bigint;
}
/**
 * Default "Deep" parameters (devnet).
 * 1B supply, 800M on the curve, 200M reserved for DeepSwap LP.
 * Virtual 45 SOL / 1,000M tokens. Completing the curve raises 180 SOL and ends at a
 * fully diluted market cap of 1,125 SOL — ≈ $169K at a $150 reference SOL price,
 * inside the spec's $150K–$200K target band. Threshold is SOL-denominated on-chain;
 * USD figures are estimates only.
 */
export declare const DEFAULT_LAUNCH_PARAMS: LaunchParams;
export declare function validateLaunchParams(p: LaunchParams): void;
export declare function initialState(p: LaunchParams): CurveState;
/** Fully diluted market cap in lamports at the current spot price. Rounds down. */
export declare function marketCapLamports(s: CurveState): bigint;
/** Tokens sold from the curve so far (base units). */
export declare function tokensSold(s: CurveState): bigint;
/** Depth progress in bps (0–10000). Rounds down. */
export declare function depthBps(s: CurveState): bigint;
/** State the curve will be in at completion (every curve token sold). */
export declare function completionState(p: LaunchParams): CurveState;
export interface GraduationAllocation {
    /** Real SOL in the curve at graduation. */
    raisedSol: bigint;
    migrationFee: bigint;
    /** SOL deposited into the DeepSwap pool. */
    lpSol: bigint;
    /** Tokens deposited into the pool, priced to match the final curve price. */
    lpTokens: bigint;
    /** Reserved tokens not needed for LP; burned so the pool opens at the curve's final price. */
    burnTokens: bigint;
}
/**
 * Liquidity allocation at graduation. The pool is seeded at the curve's final
 * spot price (vSol/vToken) so there is no price discontinuity at migration.
 */
export declare function graduationAllocation(s: CurveState, migrationFeeBps: bigint): GraduationAllocation;
