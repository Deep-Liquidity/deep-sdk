/** Rates are per 1e6 (deep-amm `FEE_RATE_DENOMINATOR_VALUE`). */
export declare const DEEPSWAP_FEE_RATE_DENOMINATOR = 1000000n;
/** THE cap: the total of one side, LP + DEEP + reward, is at most 10% (`MAX_TOTAL_FEE_RATE`). */
export declare const DEEPSWAP_MAX_TOTAL_FEE_RATE = 100000n;
/**
 * The hard ceiling of a pool's reward rate: 5% per side (`MAX_REWARD_RATE`). An AmmConfig's
 * own maximum for new pools (`max_reward_rate`) is at most this, and so is the room every V1
 * config leaves for it: its LP + DEEP rates are at most
 * `DEEPSWAP_MAX_TOTAL_FEE_RATE - DEEPSWAP_MAX_REWARD_RATE` per side.
 */
export declare const DEEPSWAP_MAX_REWARD_RATE = 50000n;
/** The most a V1 config's LP + DEEP rates of one side can add up to: 5%. */
export declare const DEEPSWAP_MAX_POOL_FEE_RATE: bigint;
/** A reward rate in bps (the curve's unit) times this is the same rate per 1e6 (the pool's). */
export declare const DEEPSWAP_RATE_PER_BPS = 100n;
/**
 * The four rates of a V1 AmmConfig, per 1e6, absolute (not shares of a trade fee). A pool's
 * reward rate is not a config value: it is the pool's own.
 */
export interface DeepSwapFeeSchedule {
    buyLpFeeRate: bigint;
    buyProtocolFeeRate: bigint;
    sellLpFeeRate: bigint;
    sellProtocolFeeRate: bigint;
}
/**
 * The owner's V1 schedule: LP 0.10% per side, DEEP 0.25% on buys and 0.65% on sells. A
 * Creator / Holder pool adds its own reward rate on both sides. Policy targets: the live
 * values are whatever the AmmConfig holds, so read the chain.
 */
export declare const DEEPSWAP_V1_SCHEDULE: Readonly<DeepSwapFeeSchedule>;
/** A curve reward rate in bps as a pool reward rate per 1e6 (what `graduate` passes on). */
export declare function deepSwapRewardRateFromBps(rewardBps: bigint): bigint;
/**
 * The reward terms a V1 pool can be created with (`initialize_v1`): Standard (0) with rate 0,
 * or Creator (1) / Holder (2) with a rate of 1..=DEEPSWAP_MAX_REWARD_RATE per 1e6. With
 * `maxRewardRate` (the AmmConfig's current maximum, `max_reward_rate`) a rate above it is
 * rejected too, as `initialize_v1` does (RewardRateAboveMax). Throws `InvalidParams` for an
 * unknown model, `InvalidFee` otherwise.
 */
export declare function validateDeepSwapPoolReward(rewardModel: number, rewardRate: bigint, maxRewardRate?: bigint): void;
/** The per-1e6 rates one V1 swap is charged at (`V1Rates` in states/pool.rs). */
export interface DeepSwapRates {
    lpRate: bigint;
    protocolRate: bigint;
    rewardRate: bigint;
}
/** One fee total and its three parts; `lp + protocol + reward === total`. */
export interface DeepSwapFeeParts {
    total: bigint;
    lp: bigint;
    protocol: bigint;
    reward: bigint;
}
/**
 * `lp + protocol + reward`; throws above the hard cap (`total_rate`): the one check of the
 * 10% total per side in the swap math.
 */
export declare function deepSwapTotalRate(rates: DeepSwapRates): bigint;
/** `ceil(amount * totalRate / 1e6)`: the fee on a gross amount (`fee_on`). */
export declare function deepSwapFeeOn(amount: bigint, totalRate: bigint): bigint;
/**
 * `ceil(net * 1e6 / (1e6 - totalRate))`: the smallest gross amount that leaves at least `net`
 * after the fee (`gross_up`).
 */
export declare function deepSwapGrossUp(net: bigint, totalRate: bigint): bigint;
/** Splits a fee total: LP and reward floored pro rata, DEEP takes the remainder (`split_fee`). */
export declare function deepSwapSplitFee(total: bigint, rates: DeepSwapRates): DeepSwapFeeParts;
/** `PoolState::v1_rates` inputs: the pool's own fields and its AmmConfig's side rates. */
export interface DeepSwapPoolRatesArgs {
    /** True when the input is the pool's quote token. */
    isBuy: boolean;
    /** `PoolState.reward_model`: 0 Standard, 1 Creator, 2 Holder. */
    rewardModel: number;
    /** `PoolState.reward_rate_snapshot`: the pool's own reward rate, fixed at creation. */
    rewardRateSnapshot: bigint;
    buyLpFeeRate: bigint;
    buyProtocolFeeRate: bigint;
    sellLpFeeRate: bigint;
    sellProtocolFeeRate: bigint;
}
/**
 * The rates of one swap of a V1 pool (`PoolState::v1_rates`). LP and protocol rates are the
 * config's rates of that side (together at most DEEPSWAP_MAX_POOL_FEE_RATE); the reward rate
 * is the pool's own (0 for Standard, at most DEEPSWAP_MAX_REWARD_RATE), which no config
 * change can alter or clamp. So the total never exceeds the 10% cap. Throws when either part
 * is above its bound (neither can be stored on chain).
 */
export declare function deepSwapPoolRates(a: DeepSwapPoolRatesArgs): DeepSwapRates;
export interface DeepSwapQuote {
    /** What the trader pays, fee included on a buy. */
    amountIn: bigint;
    /** What the trader receives, already net of the fee on a sell. */
    amountOut: bigint;
    /** True when the input is the quote token (the fee came off the input). */
    isBuy: boolean;
    /** `lpFee + protocolFee + rewardFee`, in the quote token. */
    totalFee: bigint;
    /** Stays in the pool as reserve. */
    lpFee: bigint;
    /** DEEP's part. */
    protocolFee: bigint;
    /** The reward recipient's part (0 for a Standard pool). */
    rewardFee: bigint;
    /**
     * `SwapResult.new_input_vault_amount` / `new_output_vault_amount`: the reserves the
     * program's invariant check uses. They count no part of the fee.
     */
    newInputVault: bigint;
    newOutputVault: bigint;
    /**
     * The pool's tradable reserves after the swap: the vault balance minus the accrued
     * protocol and reward fees. The LP part stays in.
     */
    reserveInAfter: bigint;
    reserveOutAfter: bigint;
    /** Spot vs execution of the amount the curve priced, bps, rounded down. Presentation only. */
    priceImpactBps: bigint;
}
/**
 * Exact input (`swap_base_input_v1`). `reserveIn` / `reserveOut` are the pool's tradable
 * reserves (vault balances minus accrued fees) of the input and the output token.
 *
 *   - buy:  `total = ceil(in * T / 1e6)`, `net = in - total`,
 *           `out = floor(net * reserveOut / (reserveIn + net))`;
 *   - sell: `gross = floor(in * reserveOut / (reserveIn + in))`,
 *           `total = ceil(gross * T / 1e6)`, `out = gross - total`.
 */
export declare function quoteDeepSwapExactIn(a: {
    amountIn: bigint;
    reserveIn: bigint;
    reserveOut: bigint;
    rates: DeepSwapRates;
    isBuy: boolean;
}): DeepSwapQuote;
/**
 * Exact output (`swap_base_output_v1`): `amountOut` is what the trader receives.
 *
 *   - buy  (exact tokens out): `swapped = ceil(reserveIn * out / (reserveOut - out))`,
 *           `in = ceil(swapped * 1e6 / (1e6 - T))`, `total = in - swapped`;
 *   - sell (exact quote out):  `gross = ceil(out * 1e6 / (1e6 - T))`, `total = gross - out`,
 *           `in = ceil(reserveIn * gross / (reserveOut - gross))`; `gross` must be less than
 *           the output reserve.
 */
export declare function quoteDeepSwapExactOut(a: {
    amountOut: bigint;
    reserveIn: bigint;
    reserveOut: bigint;
    rates: DeepSwapRates;
    isBuy: boolean;
}): DeepSwapQuote;
