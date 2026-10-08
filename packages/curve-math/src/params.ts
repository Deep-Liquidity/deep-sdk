import {
  BPS_DENOMINATOR,
  ceilDiv,
  CurveMathError,
  type CurveState,
  type FeeConfig,
  solInForTokens,
  validateFees,
} from "./math.js";

export const LAMPORTS_PER_SOL = 1_000_000_000n;

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

const UNIT = 10n ** 6n; // 6 decimals

/**
 * Default "Deep" parameters (devnet).
 * 1B supply, 800M on the curve, 200M reserved for DeepSwap LP.
 * Virtual 45 SOL / 1,000M tokens. Completing the curve raises 180 SOL and ends at a
 * fully diluted market cap of 1,125 SOL — ≈ $169K at a $150 reference SOL price,
 * inside the spec's $150K–$200K target band. Threshold is SOL-denominated on-chain;
 * USD figures are estimates only.
 */
export const DEFAULT_LAUNCH_PARAMS: LaunchParams = {
  decimals: 6,
  tokenTotalSupply: 1_000_000_000n * UNIT,
  curveSupply: 800_000_000n * UNIT,
  initialVirtualSol: 45n * LAMPORTS_PER_SOL,
  initialVirtualToken: 1_000_000_000n * UNIT,
  fees: { protocolFeeBps: 70n, creatorFeeBps: 30n },
  migrationFeeBps: 100n,
};

export function validateLaunchParams(p: LaunchParams): void {
  validateFees(p.fees);
  if (p.decimals < 0 || p.decimals > 9) throw new CurveMathError("InvalidParams", "decimals 0–9");
  if (p.curveSupply <= 0n || p.curveSupply >= p.tokenTotalSupply)
    throw new CurveMathError(
      "InvalidParams",
      "curveSupply must be in (0, totalSupply): tokens must be left for the pool",
    );
  if (p.initialVirtualToken <= p.curveSupply)
    throw new CurveMathError("InvalidParams", "initialVirtualToken must exceed curveSupply");
  if (p.initialVirtualSol <= 0n) throw new CurveMathError("InvalidParams", "initialVirtualSol > 0");
  if (p.migrationFeeBps < 0n || p.migrationFeeBps > 500n)
    throw new CurveMathError("InvalidParams", "migrationFeeBps 0–500");
  validateGraduationParams(
    p.initialVirtualSol,
    p.initialVirtualToken,
    p.curveSupply,
    p.tokenTotalSupply,
    p.migrationFeeBps,
  );
}

/**
 * deep-amm locks the first 100 LP units of a new pool: the initial liquidity
 * `floor(sqrt(amount0 * amount1))` must be above it.
 */
export const MIN_POOL_LIQUIDITY = 100n;

const U64_MAX = (1n << 64n) - 1n;

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
export function validateGraduationParams(
  initialVirtualSol: bigint,
  initialVirtualToken: bigint,
  curveSupply: bigint,
  tokenTotalSupply: bigint,
  migrationFeeBps: bigint,
): void {
  const fail = (why: string) => new CurveMathError("InvalidParams", why);
  for (const v of [initialVirtualSol, initialVirtualToken, curveSupply, tokenTotalSupply])
    if (v < 0n || v > U64_MAX)
      throw new CurveMathError("Overflow", "launch param out of u64 range");
  if (
    initialVirtualSol === 0n ||
    curveSupply === 0n ||
    curveSupply >= tokenTotalSupply ||
    initialVirtualToken <= curveSupply ||
    migrationFeeBps < 0n ||
    migrationFeeBps > BPS_DENOMINATOR
  )
    throw fail("launch parameters out of range");
  const raised = solInForTokens(initialVirtualSol, initialVirtualToken, curveSupply);
  if (raised > U64_MAX) throw new CurveMathError("Overflow", "raised SOL out of u64 range");
  const vSol = initialVirtualSol + raised;
  const vToken = initialVirtualToken - curveSupply;
  const lpSol = raised - ceilDiv(raised * migrationFeeBps, BPS_DENOMINATOR);
  const uncapped = (lpSol * vToken) / vSol;
  const slack = ceilDiv(vToken, vSol) + 1n;
  const reserve = tokenTotalSupply - curveSupply;
  const afterSlack = uncapped > slack ? uncapped - slack : 0n;
  const lpTokens = afterSlack < reserve ? afterSlack : reserve;
  const minProduct = (MIN_POOL_LIQUIDITY + 1n) * (MIN_POOL_LIQUIDITY + 1n);
  if (lpSol === 0n || lpTokens === 0n || lpSol * lpTokens < minProduct)
    throw fail("a completed curve would have no SOL or no tokens left for its pool");
}

export function initialState(p: LaunchParams): CurveState {
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
export function marketCapLamports(s: CurveState): bigint {
  return (s.virtualSolReserves * s.tokenTotalSupply) / s.virtualTokenReserves;
}

/** Tokens sold from the curve so far (base units). */
export function tokensSold(s: CurveState): bigint {
  return s.curveSupply - s.realTokenReserves;
}

/** Depth progress in bps (0–10000). Rounds down. */
export function depthBps(s: CurveState): bigint {
  return (tokensSold(s) * BPS_DENOMINATOR) / s.curveSupply;
}

/** State the curve will be in at completion (every curve token sold). */
export function completionState(p: LaunchParams): CurveState {
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
export function graduationAllocation(s: CurveState, migrationFeeBps: bigint): GraduationAllocation {
  if (!s.complete) throw new CurveMathError("InvalidParams", "curve not complete");
  const reserve = s.tokenTotalSupply - s.curveSupply;
  const migrationFee = ceilDiv(s.realSolReserves * migrationFeeBps, BPS_DENOMINATOR);
  const lpSol = s.realSolReserves - migrationFee;
  let lpTokens = (lpSol * s.virtualTokenReserves) / s.virtualSolReserves;
  if (lpTokens > reserve) lpTokens = reserve;
  // A pool needs both sides. `validateGraduationParams` rules this out for every curve
  // launched under validated parameters (the program refuses any other Config).
  if (lpSol === 0n || lpTokens === 0n)
    throw new CurveMathError("InvalidParams", "nothing to deposit on one side of the pool");
  return {
    raisedSol: s.realSolReserves,
    migrationFee,
    lpSol,
    lpTokens,
    burnTokens: reserve - lpTokens,
  };
}
