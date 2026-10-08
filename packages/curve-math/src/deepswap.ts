/**
 * DEEP V1 DeepSwap (deep-amm) swap math: side-dependent fees taken in the pool's QUOTE token
 * (SOL on TOKEN/SOL).
 *
 *   - buy  (quote in):  the fee comes off the input before the curve;
 *   - sell (quote out): the fee comes off the curve's output before the trader is paid.
 *
 * The fee is one total at `lp + protocol + reward` (rates per 1e6), split into three parts: the
 * LP part stays in the pool as reserve, the protocol part is DEEP's, the reward part is the
 * pool's reward recipient's (0 for a Standard pool). LP and protocol rates are the AmmConfig's
 * rates of the side; the reward rate is the pool's own, chosen by whoever created the token or
 * the pool and fixed at creation.
 *
 * Rounding: the fee total rounds UP; the LP and reward parts are floored and DEEP takes the
 * remainder, so `lp + protocol + reward === total` to the unit; what the trader receives
 * rounds DOWN and what the trader must pay rounds UP.
 *
 * Must match programs/deep-amm/src/curve/v1.rs (`swap_base_input_v1`, `swap_base_output_v1`)
 * and `PoolState::v1_rates` (states/pool.rs) exactly, including where they give up: every
 * `None` / `Err` there is a `CurveMathError` here (the Rust is checked `u128`, so a product
 * beyond u128 is an error here too). Both sides run fixtures/deepswap-v1-vectors.json.
 */
import { BPS_DENOMINATOR, CurveMathError } from "./math.js";

/** Rates are per 1e6 (deep-amm `FEE_RATE_DENOMINATOR_VALUE`). */
export const DEEPSWAP_FEE_RATE_DENOMINATOR = 1_000_000n;
/** THE cap: the total of one side, LP + DEEP + reward, is at most 10% (`MAX_TOTAL_FEE_RATE`). */
export const DEEPSWAP_MAX_TOTAL_FEE_RATE = 100_000n;
/**
 * The hard ceiling of a pool's reward rate: 5% per side (`MAX_REWARD_RATE`). An AmmConfig's
 * own maximum for new pools (`max_reward_rate`) is at most this, and so is the room every V1
 * config leaves for it: its LP + DEEP rates are at most
 * `DEEPSWAP_MAX_TOTAL_FEE_RATE - DEEPSWAP_MAX_REWARD_RATE` per side.
 */
export const DEEPSWAP_MAX_REWARD_RATE = 50_000n;
/** The most a V1 config's LP + DEEP rates of one side can add up to: 5%. */
export const DEEPSWAP_MAX_POOL_FEE_RATE = DEEPSWAP_MAX_TOTAL_FEE_RATE - DEEPSWAP_MAX_REWARD_RATE;
/** A reward rate in bps (the curve's unit) times this is the same rate per 1e6 (the pool's). */
export const DEEPSWAP_RATE_PER_BPS = 100n;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

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
export const DEEPSWAP_V1_SCHEDULE: Readonly<DeepSwapFeeSchedule> = {
  buyLpFeeRate: 1_000n,
  buyProtocolFeeRate: 2_500n,
  sellLpFeeRate: 1_000n,
  sellProtocolFeeRate: 6_500n,
};

/** A curve reward rate in bps as a pool reward rate per 1e6 (what `graduate` passes on). */
export function deepSwapRewardRateFromBps(rewardBps: bigint): bigint {
  return rewardBps * DEEPSWAP_RATE_PER_BPS;
}

/**
 * The reward terms a V1 pool can be created with (`initialize_v1`): Standard (0) with rate 0,
 * or Creator (1) / Holder (2) with a rate of 1..=DEEPSWAP_MAX_REWARD_RATE per 1e6. With
 * `maxRewardRate` (the AmmConfig's current maximum, `max_reward_rate`) a rate above it is
 * rejected too, as `initialize_v1` does (RewardRateAboveMax). Throws `InvalidParams` for an
 * unknown model, `InvalidFee` otherwise.
 */
export function validateDeepSwapPoolReward(
  rewardModel: number,
  rewardRate: bigint,
  maxRewardRate?: bigint,
): void {
  if (rewardModel !== 0 && rewardModel !== 1 && rewardModel !== 2)
    throw new CurveMathError("InvalidParams", `reward model ${rewardModel} is not 0, 1 or 2`);
  const ok =
    rewardModel === 0
      ? rewardRate === 0n
      : rewardRate >= 1n && rewardRate <= DEEPSWAP_MAX_REWARD_RATE;
  if (!ok)
    throw new CurveMathError(
      "InvalidFee",
      rewardModel === 0
        ? "a Standard pool has no reward rate"
        : `a reward rate must be 1 to ${DEEPSWAP_MAX_REWARD_RATE} per 1e6`,
    );
  if (maxRewardRate !== undefined && rewardRate > maxRewardRate)
    throw new CurveMathError(
      "InvalidFee",
      `reward rate ${rewardRate} is above the current maximum of ${maxRewardRate} per 1e6`,
    );
}

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

function u64(v: bigint, what: string): bigint {
  if (v < 0n || v > U64_MAX) throw new CurveMathError("InvalidParams", `${what} is not a u64`);
  return v;
}

function u128(v: bigint, what: string): bigint {
  if (v < 0n || v > U128_MAX) throw new CurveMathError("InvalidParams", `${what} is not a u128`);
  return v;
}

/** `checked_mul` / `checked_add` on u128. */
function fits(v: bigint): bigint {
  if (v > U128_MAX) throw new CurveMathError("Overflow");
  return v;
}

/**
 * `lp + protocol + reward`; throws above the hard cap (`total_rate`): the one check of the
 * 10% total per side in the swap math.
 */
export function deepSwapTotalRate(rates: DeepSwapRates): bigint {
  const total =
    u64(rates.lpRate, "lpRate") +
    u64(rates.protocolRate, "protocolRate") +
    u64(rates.rewardRate, "rewardRate");
  if (total > DEEPSWAP_MAX_TOTAL_FEE_RATE)
    throw new CurveMathError("InvalidFee", "total fee rate above the 10% cap");
  return total;
}

/** `ceil(amount * totalRate / 1e6)`: the fee on a gross amount (`fee_on`). */
export function deepSwapFeeOn(amount: bigint, totalRate: bigint): bigint {
  const d = DEEPSWAP_FEE_RATE_DENOMINATOR;
  return fits(fits(u128(amount, "amount") * u64(totalRate, "totalRate")) + d - 1n) / d;
}

/**
 * `ceil(net * 1e6 / (1e6 - totalRate))`: the smallest gross amount that leaves at least `net`
 * after the fee (`gross_up`).
 */
export function deepSwapGrossUp(net: bigint, totalRate: bigint): bigint {
  u128(net, "net");
  if (u64(totalRate, "totalRate") === 0n) return net;
  const d = DEEPSWAP_FEE_RATE_DENOMINATOR;
  const keep = d - totalRate;
  if (keep <= 0n) throw new CurveMathError("InvalidFee", "total fee rate is 100% or more");
  return fits(fits(net * d) + keep - 1n) / keep;
}

/** Splits a fee total: LP and reward floored pro rata, DEEP takes the remainder (`split_fee`). */
export function deepSwapSplitFee(total: bigint, rates: DeepSwapRates): DeepSwapFeeParts {
  const rate = deepSwapTotalRate(rates);
  u128(total, "total");
  if (rate === 0n) {
    // no rate, no fee
    if (total !== 0n) throw new CurveMathError("InvalidFee", "a fee without a rate");
    return { total: 0n, lp: 0n, protocol: 0n, reward: 0n };
  }
  const lp = fits(total * rates.lpRate) / rate;
  const reward = fits(total * rates.rewardRate) / rate;
  return { total, lp, protocol: total - lp - reward, reward };
}

/** `floor(input * outReserve / (inReserve + input))`. */
function curveOut(input: bigint, inReserve: bigint, outReserve: bigint): bigint {
  const den = fits(inReserve + input);
  if (den === 0n) throw new CurveMathError("InsufficientReserves", "empty pool");
  return fits(input * outReserve) / den;
}

/** `ceil(inReserve * output / (outReserve - output))`; only for `output < outReserve`. */
function curveIn(output: bigint, inReserve: bigint, outReserve: bigint): bigint {
  const left = outReserve - output;
  if (left <= 0n)
    throw new CurveMathError("InsufficientReserves", "output is the whole reserve or more");
  return fits(fits(inReserve * output) + left - 1n) / left;
}

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
export function deepSwapPoolRates(a: DeepSwapPoolRatesArgs): DeepSwapRates {
  const lpRate = u64(a.isBuy ? a.buyLpFeeRate : a.sellLpFeeRate, "lp rate");
  const protocolRate = u64(a.isBuy ? a.buyProtocolFeeRate : a.sellProtocolFeeRate, "protocol rate");
  u64(a.rewardRateSnapshot, "rewardRateSnapshot");
  if (!Number.isInteger(a.rewardModel) || a.rewardModel < 0 || a.rewardModel > 255)
    throw new CurveMathError("InvalidParams", "rewardModel is not a u8");
  const base = lpRate + protocolRate;
  if (base > U64_MAX) throw new CurveMathError("Overflow");
  if (base > DEEPSWAP_MAX_POOL_FEE_RATE)
    throw new CurveMathError("InvalidFee", "lp + protocol rate above 5% (the room left for it)");
  const rewardRate = a.rewardModel === 0 ? 0n : a.rewardRateSnapshot;
  if (rewardRate > DEEPSWAP_MAX_REWARD_RATE)
    throw new CurveMathError("InvalidFee", "reward rate above the 5% ceiling");
  return { lpRate, protocolRate, rewardRate };
}

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

function build(
  isBuy: boolean,
  amountIn: bigint,
  amountOut: bigint,
  fee: DeepSwapFeeParts,
  newInputVault: bigint,
  newOutputVault: bigint,
  impact: { priced: bigint; got: bigint; reserveIn: bigint; reserveOut: bigint },
): DeepSwapQuote {
  if (newOutputVault < 0n) throw new CurveMathError("InsufficientReserves");
  fits(newInputVault);
  // the fee is in the quote token: the input side of a buy, the output side of a sell
  const reserveInAfter = isBuy ? newInputVault + fee.lp : newInputVault;
  const reserveOutAfter = isBuy ? newOutputVault : newOutputVault + fee.lp;
  const spot =
    impact.reserveIn === 0n ? 0n : (impact.priced * impact.reserveOut) / impact.reserveIn;
  const priceImpactBps =
    spot === 0n || impact.got >= spot ? 0n : ((spot - impact.got) * BPS_DENOMINATOR) / spot;
  return {
    amountIn,
    amountOut,
    isBuy,
    totalFee: fee.total,
    lpFee: fee.lp,
    protocolFee: fee.protocol,
    rewardFee: fee.reward,
    newInputVault,
    newOutputVault,
    reserveInAfter,
    reserveOutAfter,
    priceImpactBps,
  };
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
export function quoteDeepSwapExactIn(a: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  rates: DeepSwapRates;
  isBuy: boolean;
}): DeepSwapQuote {
  const { amountIn, reserveIn, reserveOut, rates, isBuy } = a;
  u128(amountIn, "amountIn");
  u128(reserveIn, "reserveIn");
  u128(reserveOut, "reserveOut");
  const rate = deepSwapTotalRate(rates);
  if (isBuy) {
    const fee = deepSwapSplitFee(deepSwapFeeOn(amountIn, rate), rates);
    const net = amountIn - fee.total;
    const out = curveOut(net, reserveIn, reserveOut);
    return build(true, amountIn, out, fee, fits(reserveIn + net), reserveOut - out, {
      priced: net,
      got: out,
      reserveIn,
      reserveOut,
    });
  }
  const gross = curveOut(amountIn, reserveIn, reserveOut);
  const fee = deepSwapSplitFee(deepSwapFeeOn(gross, rate), rates);
  return build(
    false,
    amountIn,
    gross - fee.total,
    fee,
    fits(reserveIn + amountIn),
    reserveOut - gross,
    { priced: amountIn, got: gross, reserveIn, reserveOut },
  );
}

/**
 * Exact output (`swap_base_output_v1`): `amountOut` is what the trader receives.
 *
 *   - buy  (exact tokens out): `swapped = ceil(reserveIn * out / (reserveOut - out))`,
 *           `in = ceil(swapped * 1e6 / (1e6 - T))`, `total = in - swapped`;
 *   - sell (exact quote out):  `gross = ceil(out * 1e6 / (1e6 - T))`, `total = gross - out`,
 *           `in = ceil(reserveIn * gross / (reserveOut - gross))`; `gross` must be less than
 *           the output reserve.
 */
export function quoteDeepSwapExactOut(a: {
  amountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  rates: DeepSwapRates;
  isBuy: boolean;
}): DeepSwapQuote {
  const { amountOut, reserveIn, reserveOut, rates, isBuy } = a;
  u128(amountOut, "amountOut");
  u128(reserveIn, "reserveIn");
  u128(reserveOut, "reserveOut");
  const rate = deepSwapTotalRate(rates);
  if (isBuy) {
    const swapped = curveIn(amountOut, reserveIn, reserveOut);
    const input = deepSwapGrossUp(swapped, rate);
    const fee = deepSwapSplitFee(input - swapped, rates);
    return build(true, input, amountOut, fee, fits(reserveIn + swapped), reserveOut - amountOut, {
      priced: swapped,
      got: amountOut,
      reserveIn,
      reserveOut,
    });
  }
  const gross = deepSwapGrossUp(amountOut, rate);
  const fee = deepSwapSplitFee(gross - amountOut, rates);
  const input = curveIn(gross, reserveIn, reserveOut);
  return build(false, input, amountOut, fee, fits(reserveIn + input), reserveOut - gross, {
    priced: input,
    got: gross,
    reserveIn,
    reserveOut,
  });
}
