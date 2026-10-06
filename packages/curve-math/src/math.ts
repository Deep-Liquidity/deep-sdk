/**
 * Deep Curve — integer bonding-curve math.
 *
 * Constant-product curve over *virtual* reserves (x · y = k). All values are
 * integers: SOL in lamports, tokens in base units. No floating point.
 *
 * Rounding policy (must match programs/deep-curve/src/math.rs exactly):
 *   - amounts paid OUT to the user round DOWN
 *   - fees round UP (in the protocol's favor)
 *   - amounts the user must pay IN round UP
 * Consequence: the curve invariant k never decreases across a trade.
 */

export const BPS_DENOMINATOR = 10_000n;
/** Hard cap on combined fees. Mirrored on-chain. */
export const MAX_TOTAL_FEE_BPS = 1_000n; // 10%

export class CurveMathError extends Error {
  constructor(
    public readonly code: CurveErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CurveMathError";
  }
}

export type CurveErrorCode =
  | "ZeroAmount"
  | "CurveComplete"
  | "InsufficientReserves"
  | "SlippageExceeded"
  | "InvalidFee"
  | "InvalidParams"
  | "Overflow";

const U64_MAX = (1n << 64n) - 1n;

export interface FeeConfig {
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}

export interface CurveState {
  /** Virtual SOL reserves, lamports. Includes the initial virtual offset. */
  virtualSolReserves: bigint;
  /** Virtual token reserves, base units. */
  virtualTokenReserves: bigint;
  /** Real SOL held by the curve vault (lamports), excluding fees. */
  realSolReserves: bigint;
  /** Real tokens remaining for sale on the curve. */
  realTokenReserves: bigint;
  /** Tokens allocated to the curve at launch (for depth). */
  curveSupply: bigint;
  /** Total mint supply. */
  tokenTotalSupply: bigint;
  /** True once realTokenReserves hits 0. No further trading on the curve. */
  complete: boolean;
}

export interface FeeSplit {
  total: bigint;
  protocol: bigint;
  creator: bigint;
}

export interface BuyQuote {
  /** Lamports actually charged to the user (≤ requested solIn). */
  solIn: bigint;
  /** Lamports added to curve reserves. */
  solToCurve: bigint;
  fees: FeeSplit;
  tokensOut: bigint;
  /** True if this buy was capped by remaining curve supply. */
  capped: boolean;
  completesCurve: boolean;
  next: CurveState;
}

export interface SellQuote {
  tokensIn: bigint;
  /** Lamports removed from curve reserves (before fees). */
  solFromCurve: bigint;
  fees: FeeSplit;
  /** Lamports paid to the user. */
  solOut: bigint;
  next: CurveState;
}

function assertU64(v: bigint, what: string): void {
  if (v < 0n || v > U64_MAX) throw new CurveMathError("Overflow", `${what} out of u64 range`);
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new CurveMathError("InvalidParams", "division by zero");
  return a === 0n ? 0n : (a + b - 1n) / b;
}

export function validateFees(fees: FeeConfig): void {
  const { protocolFeeBps: p, creatorFeeBps: c } = fees;
  if (p < 0n || c < 0n || p + c > MAX_TOTAL_FEE_BPS) {
    throw new CurveMathError("InvalidFee", `fees ${p}+${c} bps exceed ${MAX_TOTAL_FEE_BPS}`);
  }
}

/** Fee on `amount` lamports. Total rounds up; creator share rounds down; protocol gets the rest. */
export function computeFees(amount: bigint, fees: FeeConfig): FeeSplit {
  validateFees(fees);
  const total = ceilDiv(amount * (fees.protocolFeeBps + fees.creatorFeeBps), BPS_DENOMINATOR);
  const creator = (amount * fees.creatorFeeBps) / BPS_DENOMINATOR;
  return { total, creator, protocol: total - creator };
}

/** Tokens received for `solNet` lamports entering the curve. Rounds down. */
export function tokensOutForSol(vSol: bigint, vToken: bigint, solNet: bigint): bigint {
  return (vToken * solNet) / (vSol + solNet);
}

/** Lamports that must enter the curve to receive exactly `tokens`. Rounds up. */
export function solInForTokens(vSol: bigint, vToken: bigint, tokens: bigint): bigint {
  if (tokens >= vToken) throw new CurveMathError("InsufficientReserves");
  return ceilDiv(vSol * tokens, vToken - tokens);
}

/** Lamports leaving the curve when `tokens` are sold into it. Rounds down. */
export function solOutForTokens(vSol: bigint, vToken: bigint, tokens: bigint): bigint {
  return (vSol * tokens) / (vToken + tokens);
}

/**
 * Smallest gross amount g such that g − fee(g) ≥ net.
 * Used when a buy is capped and we only charge what is needed.
 */
export function grossForNet(net: bigint, fees: FeeConfig): bigint {
  const f = fees.protocolFeeBps + fees.creatorFeeBps;
  let g = ceilDiv(net * BPS_DENOMINATOR, BPS_DENOMINATOR - f);
  // ceil on the fee can leave us 1 short; bounded correction.
  while (g - computeFees(g, fees).total < net) g += 1n;
  return g;
}

/**
 * Quote a buy with an exact SOL budget. Fees are taken from the gross input.
 * If the budget would exceed remaining curve supply, the buy is capped at the
 * remaining tokens and only the required SOL is charged.
 */
export function quoteBuy(
  state: CurveState,
  solIn: bigint,
  fees: FeeConfig,
  minTokensOut = 0n,
): BuyQuote {
  assertU64(solIn, "solIn");
  if (state.complete || state.realTokenReserves === 0n) throw new CurveMathError("CurveComplete");
  if (solIn === 0n) throw new CurveMathError("ZeroAmount");

  let gross = solIn;
  let feeSplit = computeFees(gross, fees);
  let net = gross - feeSplit.total;
  if (net === 0n) throw new CurveMathError("ZeroAmount", "amount fully consumed by fees");

  let tokensOut = tokensOutForSol(state.virtualSolReserves, state.virtualTokenReserves, net);
  let capped = false;

  if (tokensOut >= state.realTokenReserves) {
    capped = tokensOut > state.realTokenReserves;
    tokensOut = state.realTokenReserves;
    const netNeeded = solInForTokens(
      state.virtualSolReserves,
      state.virtualTokenReserves,
      tokensOut,
    );
    if (netNeeded < net) {
      gross = grossForNet(netNeeded, fees);
      feeSplit = computeFees(gross, fees);
      net = gross - feeSplit.total;
    }
  }

  if (tokensOut === 0n) throw new CurveMathError("ZeroAmount", "buy too small for one base unit");
  if (tokensOut < minTokensOut) throw new CurveMathError("SlippageExceeded");

  const realTokenReserves = state.realTokenReserves - tokensOut;
  const next: CurveState = {
    ...state,
    virtualSolReserves: state.virtualSolReserves + net,
    virtualTokenReserves: state.virtualTokenReserves - tokensOut,
    realSolReserves: state.realSolReserves + net,
    realTokenReserves,
    complete: realTokenReserves === 0n,
  };
  assertU64(next.virtualSolReserves, "virtualSolReserves");

  return {
    solIn: gross,
    solToCurve: net,
    fees: feeSplit,
    tokensOut,
    capped,
    completesCurve: next.complete,
    next,
  };
}

/** Quote a sell of an exact token amount. Fees are taken from the SOL output. */
export function quoteSell(
  state: CurveState,
  tokensIn: bigint,
  fees: FeeConfig,
  minSolOut = 0n,
): SellQuote {
  assertU64(tokensIn, "tokensIn");
  if (state.complete) throw new CurveMathError("CurveComplete");
  if (tokensIn === 0n) throw new CurveMathError("ZeroAmount");
  const sold = state.curveSupply - state.realTokenReserves;
  if (tokensIn > sold) throw new CurveMathError("InsufficientReserves", "more than curve has sold");

  const solFromCurve = solOutForTokens(
    state.virtualSolReserves,
    state.virtualTokenReserves,
    tokensIn,
  );
  if (solFromCurve > state.realSolReserves) throw new CurveMathError("InsufficientReserves");
  const feeSplit = computeFees(solFromCurve, fees);
  const solOut = solFromCurve - feeSplit.total;
  if (solOut === 0n) throw new CurveMathError("ZeroAmount", "sell too small after fees");
  if (solOut < minSolOut) throw new CurveMathError("SlippageExceeded");

  return {
    tokensIn,
    solFromCurve,
    fees: feeSplit,
    solOut,
    next: {
      ...state,
      virtualSolReserves: state.virtualSolReserves - solFromCurve,
      virtualTokenReserves: state.virtualTokenReserves + tokensIn,
      realSolReserves: state.realSolReserves - solFromCurve,
      realTokenReserves: state.realTokenReserves + tokensIn,
    },
  };
}
