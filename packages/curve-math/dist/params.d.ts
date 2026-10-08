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
/**
 * deep-amm locks the first 100 LP units of a new pool: the initial liquidity
 * `floor(sqrt(amount0 * amount1))` must be above it.
 */
export declare const MIN_POOL_LIQUIDITY = 100n;
/**
 * Launch parameters under which EVERY curve can graduate. Mirrors deep-curve
 * `math::validate_graduation_params` exactly (shared vectors: `graduationParams` in
 * fixtures/curve-vectors.json); the program applies it to every Config.
 *
 * - `0 < curveSupply < tokenTotalSupply`: tokens are left for the pool;
 * - `initialVirtualToken > curveSupply`, `initialVirtualSol > 0`;
 * - the graduation allocation of a completed curve has SOL and tokens for the pool, and enough
 *   of both for deep-amm's minimum liquidity, whatever path the curve took.
 *
 * The check is made on the completed curve that raised the LEAST SOL. Trades only ever round
 * against the trader, so `virtualSol * virtualToken` never decreases and a completed curve holds
 * at least `solInForTokens(initialVirtualSol, initialVirtualToken, curveSupply)`. `lpSol` does
 * not decrease when more is raised. `lpTokens` can, by rounding only, by less than
 * `virtualToken / virtualSol + 1`, so that much is taken off before checking.
 */
export declare function validateGraduationParams(initialVirtualSol: bigint, initialVirtualToken: bigint, curveSupply: bigint, tokenTotalSupply: bigint, migrationFeeBps: bigint): void;
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
