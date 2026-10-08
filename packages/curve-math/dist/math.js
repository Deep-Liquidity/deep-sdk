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
export const BPS_DENOMINATOR = 10000n;
/** Hard cap on combined fees of one side (protocol + reward). Mirrored on-chain. */
export const MAX_TOTAL_FEE_BPS = 1000n; // 10%
/**
 * Hard ceiling of the reward rate a token's creator can choose at launch (`creatorFeeBps` on
 * the curve). Mirrored on-chain. The admin's current maximum (`Config.max_reward_bps`) is at
 * most this, and the total of a side still has to fit MAX_TOTAL_FEE_BPS.
 */
export const MAX_REWARD_BPS = 500n; // 5%
export class CurveMathError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
        this.name = "CurveMathError";
    }
}
const U64_MAX = (1n << 64n) - 1n;
function assertU64(v, what) {
    if (v < 0n || v > U64_MAX)
        throw new CurveMathError("Overflow", `${what} out of u64 range`);
}
export function ceilDiv(a, b) {
    if (b === 0n)
        throw new CurveMathError("InvalidParams", "division by zero");
    return a === 0n ? 0n : (a + b - 1n) / b;
}
export function validateFees(fees) {
    const { protocolFeeBps: p, creatorFeeBps: c } = fees;
    if (p < 0n || c < 0n || p + c > MAX_TOTAL_FEE_BPS) {
        throw new CurveMathError("InvalidFee", `fees ${p}+${c} bps exceed ${MAX_TOTAL_FEE_BPS}`);
    }
}
/** Fee on `amount` lamports. Total rounds up; creator share rounds down; protocol gets the rest. */
export function computeFees(amount, fees) {
    validateFees(fees);
    const total = ceilDiv(amount * (fees.protocolFeeBps + fees.creatorFeeBps), BPS_DENOMINATOR);
    const creator = (amount * fees.creatorFeeBps) / BPS_DENOMINATOR;
    return { total, creator, protocol: total - creator };
}
/** Tokens received for `solNet` lamports entering the curve. Rounds down. */
export function tokensOutForSol(vSol, vToken, solNet) {
    return (vToken * solNet) / (vSol + solNet);
}
/** Lamports that must enter the curve to receive exactly `tokens`. Rounds up. */
export function solInForTokens(vSol, vToken, tokens) {
    if (tokens >= vToken)
        throw new CurveMathError("InsufficientReserves");
    return ceilDiv(vSol * tokens, vToken - tokens);
}
/** Lamports leaving the curve when `tokens` are sold into it. Rounds down. */
export function solOutForTokens(vSol, vToken, tokens) {
    return (vSol * tokens) / (vToken + tokens);
}
/**
 * Smallest gross amount g such that g − fee(g) ≥ net.
 * Used when a buy is capped and we only charge what is needed.
 */
export function grossForNet(net, fees) {
    const f = fees.protocolFeeBps + fees.creatorFeeBps;
    let g = ceilDiv(net * BPS_DENOMINATOR, BPS_DENOMINATOR - f);
    // ceil on the fee can leave us 1 short; bounded correction.
    while (g - computeFees(g, fees).total < net)
        g += 1n;
    return g;
}
/**
 * Quote a buy with an exact SOL budget. Fees are taken from the gross input.
 * If the budget would exceed remaining curve supply, the buy is capped at the
 * remaining tokens and only the required SOL is charged.
 */
export function quoteBuy(state, solIn, fees, minTokensOut = 0n) {
    assertU64(solIn, "solIn");
    if (state.complete || state.realTokenReserves === 0n)
        throw new CurveMathError("CurveComplete");
    if (solIn === 0n)
        throw new CurveMathError("ZeroAmount");
    let gross = solIn;
    let feeSplit = computeFees(gross, fees);
    let net = gross - feeSplit.total;
    if (net === 0n)
        throw new CurveMathError("ZeroAmount", "amount fully consumed by fees");
    let tokensOut = tokensOutForSol(state.virtualSolReserves, state.virtualTokenReserves, net);
    let capped = false;
    if (tokensOut >= state.realTokenReserves) {
        capped = tokensOut > state.realTokenReserves;
        tokensOut = state.realTokenReserves;
        const netNeeded = solInForTokens(state.virtualSolReserves, state.virtualTokenReserves, tokensOut);
        if (netNeeded < net) {
            gross = grossForNet(netNeeded, fees);
            feeSplit = computeFees(gross, fees);
            net = gross - feeSplit.total;
        }
    }
    if (tokensOut === 0n)
        throw new CurveMathError("ZeroAmount", "buy too small for one base unit");
    if (tokensOut < minTokensOut)
        throw new CurveMathError("SlippageExceeded");
    const realTokenReserves = state.realTokenReserves - tokensOut;
    const next = {
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
export function quoteSell(state, tokensIn, fees, minSolOut = 0n) {
    assertU64(tokensIn, "tokensIn");
    if (state.complete)
        throw new CurveMathError("CurveComplete");
    if (tokensIn === 0n)
        throw new CurveMathError("ZeroAmount");
    const sold = state.curveSupply - state.realTokenReserves;
    if (tokensIn > sold)
        throw new CurveMathError("InsufficientReserves", "more than curve has sold");
    const solFromCurve = solOutForTokens(state.virtualSolReserves, state.virtualTokenReserves, tokensIn);
    if (solFromCurve > state.realSolReserves)
        throw new CurveMathError("InsufficientReserves");
    const feeSplit = computeFees(solFromCurve, fees);
    const solOut = solFromCurve - feeSplit.total;
    if (solOut === 0n)
        throw new CurveMathError("ZeroAmount", "sell too small after fees");
    if (solOut < minSolOut)
        throw new CurveMathError("SlippageExceeded");
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
//# sourceMappingURL=math.js.map