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
export declare const BPS_DENOMINATOR = 10000n;
/** Hard cap on combined fees of one side (protocol + reward). Mirrored on-chain. */
export declare const MAX_TOTAL_FEE_BPS = 1000n;
/**
 * Hard ceiling of the reward rate a token's creator can choose at launch (`creatorFeeBps` on
 * the curve). Mirrored on-chain. The admin's current maximum (`Config.max_reward_bps`) is at
 * most this, and the total of a side still has to fit MAX_TOTAL_FEE_BPS.
 */
export declare const MAX_REWARD_BPS = 500n;
export declare class CurveMathError extends Error {
    readonly code: CurveErrorCode;
    constructor(code: CurveErrorCode, message?: string);
}
export type CurveErrorCode = "ZeroAmount" | "CurveComplete" | "InsufficientReserves" | "SlippageExceeded" | "InvalidFee" | "InvalidParams" | "Overflow";
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
export declare function ceilDiv(a: bigint, b: bigint): bigint;
export declare function validateFees(fees: FeeConfig): void;
/** Fee on `amount` lamports. Total rounds up; creator share rounds down; protocol gets the rest. */
export declare function computeFees(amount: bigint, fees: FeeConfig): FeeSplit;
/** Tokens received for `solNet` lamports entering the curve. Rounds down. */
export declare function tokensOutForSol(vSol: bigint, vToken: bigint, solNet: bigint): bigint;
/** Lamports that must enter the curve to receive exactly `tokens`. Rounds up. */
export declare function solInForTokens(vSol: bigint, vToken: bigint, tokens: bigint): bigint;
/** Lamports leaving the curve when `tokens` are sold into it. Rounds down. */
export declare function solOutForTokens(vSol: bigint, vToken: bigint, tokens: bigint): bigint;
/**
 * Smallest gross amount g such that g − fee(g) ≥ net.
 * Used when a buy is capped and we only charge what is needed.
 */
export declare function grossForNet(net: bigint, fees: FeeConfig): bigint;
/**
 * Quote a buy with an exact SOL budget. Fees are taken from the gross input.
 * If the budget would exceed remaining curve supply, the buy is capped at the
 * remaining tokens and only the required SOL is charged.
 */
export declare function quoteBuy(state: CurveState, solIn: bigint, fees: FeeConfig, minTokensOut?: bigint): BuyQuote;
/** Quote a sell of an exact token amount. Fees are taken from the SOL output. */
export declare function quoteSell(state: CurveState, tokensIn: bigint, fees: FeeConfig, minSolOut?: bigint): SellQuote;
