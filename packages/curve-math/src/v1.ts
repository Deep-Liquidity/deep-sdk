/**
 * DEEP V1 curve fees: a protocol fee per side (buy / sell) and a reward model per token.
 *
 * The curve math (math.ts) is unchanged. V1 only selects which `FeeConfig` a trade uses (the
 * buy or the sell protocol rate, plus the token's reward rate) and where the reward part of the
 * fee goes. Must match `quote_buy_v1` / `quote_sell_v1` / `route_fees` / `validate_fee_schedule`
 * in programs/deep-curve/src/math.rs exactly; both sides run the `v1` section of
 * fixtures/curve-vectors.json.
 *
 * Owner decisions (docs/V1_FEES.md section 10, sixth and eighth round): the reward rate is
 * chosen by the token's creator at launch, together with the reward model, and both are
 * immutable. Standard has no reward (0 bps); Creator and Holder take 1..=MAX_REWARD_BPS (5%)
 * on both sides, on top of DEEP's protocol fee, never above the admin's current maximum
 * (`Config.max_reward_bps`) and never pushing a side above MAX_TOTAL_FEE_BPS (10%). The curve
 * charges it and graduation carries the same rate into the token's DeepSwap pool.
 */
import {
  CurveMathError,
  MAX_REWARD_BPS,
  quoteBuy,
  quoteSell,
  validateFees,
  type BuyQuote,
  type CurveState,
  type FeeConfig,
  type FeeSplit,
  type SellQuote,
} from "./math.js";

/** `BondingCurve.reward_model` (u8). Chosen at `create_token`, never changed afterwards. */
export const REWARD_MODEL = { Standard: 0, Creator: 1, Holder: 2 } as const;
export type RewardModel = (typeof REWARD_MODEL)[keyof typeof REWARD_MODEL];
export type RewardModelName = keyof typeof REWARD_MODEL;

export const REWARD_MODEL_NAMES: readonly RewardModelName[] = ["Standard", "Creator", "Holder"];

export function rewardModelName(model: number): RewardModelName {
  const name = REWARD_MODEL_NAMES[model];
  if (!Number.isInteger(model) || name === undefined)
    throw new CurveMathError("InvalidParams", `reward model ${model} is not 0, 1 or 2`);
  return name;
}

export function validateRewardModel(model: number): asserts model is RewardModel {
  rewardModelName(model);
}

/** The fee terms a token snapshots at launch (BondingCurve v3). */
export interface FeeConfigV1 {
  /** Protocol (DEEP) fee on buys, bps. `BondingCurve.protocol_fee_bps`. */
  buyProtocolFeeBps: bigint;
  /** Protocol (DEEP) fee on sells, bps. `BondingCurve.sell_protocol_fee_bps`. */
  sellProtocolFeeBps: bigint;
  /**
   * The token's reward rate, chosen by its creator at launch: charged on both sides on top of
   * the protocol fee, bps (`BondingCurve.creator_fee_bps`). 0 for Standard. (On a Standard
   * curve from before V1 a non-zero value is the legacy creator fee and goes to the creator.)
   */
  rewardBps: bigint;
  rewardModel: RewardModel;
}

/** The V1 target for the curve: 1.25% to DEEP on each side. */
export const V1_CURVE_PROTOCOL_FEE_BPS = 125n;
/** The reward rate of a Standard token: none. */
export const V1_CURVE_REWARD_BPS = 0n;

/**
 * What a creator may choose at launch (`validate_launch_reward`): Standard with no reward
 * rate, or Creator / Holder with a rate of 1..=MAX_REWARD_BPS (the hard ceiling). Both are
 * immutable afterwards. With `maxRewardBps` (the admin's current maximum,
 * `Config.max_reward_bps`) a rate above it is rejected too, as `create_token` does
 * (RewardRateAboveMax). Throws `InvalidParams` for an unknown model, `InvalidFee` otherwise.
 * The total cap per side is a separate check (`validateFeesV1`, `snapshotFees`).
 */
export function validateLaunchReward(
  rewardModel: number,
  rewardBps: bigint,
  maxRewardBps?: bigint,
): void {
  validateRewardModel(rewardModel);
  const ok =
    rewardModel === REWARD_MODEL.Standard
      ? rewardBps === 0n
      : rewardBps >= 1n && rewardBps <= MAX_REWARD_BPS;
  if (!ok)
    throw new CurveMathError(
      "InvalidFee",
      rewardModel === REWARD_MODEL.Standard
        ? "a Standard token has no reward rate"
        : `a ${rewardModelName(rewardModel)} token needs a reward rate of 1 to ${MAX_REWARD_BPS} bps`,
    );
  if (maxRewardBps !== undefined && rewardBps > maxRewardBps)
    throw new CurveMathError(
      "InvalidFee",
      `reward rate ${rewardBps} bps is above the current maximum of ${maxRewardBps} bps`,
    );
}

/**
 * The V1 target terms of a token: 1.25% to DEEP on each side plus the creator's own reward
 * rate (`rewardBps`, 0 for Standard). Not validated: see `validateLaunchReward`.
 */
export function v1CurveFees(
  rewardModel: RewardModel = REWARD_MODEL.Standard,
  rewardBps: bigint = V1_CURVE_REWARD_BPS,
): FeeConfigV1 {
  return {
    buyProtocolFeeBps: V1_CURVE_PROTOCOL_FEE_BPS,
    sellProtocolFeeBps: V1_CURVE_PROTOCOL_FEE_BPS,
    rewardBps,
    rewardModel,
  };
}

/** A token's total fee per side, bps: DEEP's protocol fee of that side plus the reward rate. */
export function totalFeeBps(f: FeeConfigV1): { buy: bigint; sell: bigint } {
  return {
    buy: f.buyProtocolFeeBps + f.rewardBps,
    sell: f.sellProtocolFeeBps + f.rewardBps,
  };
}

/** Where one trade's fee goes. `protocol + creator + holder === FeeSplit.total`. */
export interface FeeRouting {
  /** To DEEP (the fee vault, through `sweep_protocol_fees`). */
  protocol: bigint;
  /** To the token's creator (`claim_creator_fees`). 0 for a Holder token. */
  creator: bigint;
  /** To the token's holder vault (`sweep_holder_fees`). 0 unless the model is Holder. */
  holder: bigint;
}

/** The `FeeConfig` of one side of a V1 token. */
export function sideFees(f: FeeConfigV1, isBuy: boolean): FeeConfig {
  return {
    protocolFeeBps: isBuy ? f.buyProtocolFeeBps : f.sellProtocolFeeBps,
    creatorFeeBps: f.rewardBps,
  };
}

export function validateFeesV1(f: FeeConfigV1): void {
  validateRewardModel(f.rewardModel);
  validateFees(sideFees(f, true));
  validateFees(sideFees(f, false));
}

/** The fee rates of the deep-curve Config (v3). */
export interface FeeSchedule {
  /** `Config.protocol_fee_bps`: the buy side. */
  buyProtocolFeeBps: bigint;
  sellProtocolFeeBps: bigint;
  /** `Config.creator_fee_bps`: the pre-V1 creator fee. No token snapshots it any more. */
  creatorFeeBps: bigint;
  /**
   * `Config.max_reward_bps`: the admin's CURRENT maximum reward rate for new launches (at
   * most MAX_REWARD_BPS). Never a token's rate by itself: the creator chooses one up to it.
   */
  maxRewardBps: bigint;
  /** `Config.reserved_bps`: stored, read by no instruction. */
  reservedBps: bigint;
}

/**
 * The on-chain total cap for a whole schedule (`validate_fee_schedule`): on each side, the
 * protocol rate plus the largest of the three reward fields must stay within
 * MAX_TOTAL_FEE_BPS (10%). (That `maxRewardBps` is at most MAX_REWARD_BPS is a separate
 * check of the Config, see `validateMaxRewardBps`.)
 */
export function validateFeeSchedule(s: FeeSchedule): void {
  const rewards = [s.creatorFeeBps, s.maxRewardBps, s.reservedBps];
  const reward = rewards.reduce((a, b) => (b > a ? b : a));
  for (const protocol of [s.buyProtocolFeeBps, s.sellProtocolFeeBps])
    validateFees({ protocolFeeBps: protocol, creatorFeeBps: reward });
  if (rewards.some((r) => r < 0n)) throw new CurveMathError("InvalidFee", "negative reward rate");
}

/** `Config.max_reward_bps` must be within the hard ceiling (InvalidRewardRate on chain). */
export function validateMaxRewardBps(maxRewardBps: bigint): void {
  if (maxRewardBps < 0n || maxRewardBps > MAX_REWARD_BPS)
    throw new CurveMathError("InvalidFee", `max reward rate above ${MAX_REWARD_BPS} bps`);
}

/**
 * The fee terms a token launched now gets (`create_token`): the Config's protocol rate of each
 * side, and the reward model and rate its creator chose. Throws `InvalidFee` where
 * `create_token` rejects: a rate the model cannot have or above MAX_REWARD_BPS, a rate above
 * the Config's current maximum (when `s.maxRewardBps` is given), or a side whose protocol fee
 * plus the rate exceeds MAX_TOTAL_FEE_BPS.
 */
export function snapshotFees(
  s: Pick<FeeSchedule, "buyProtocolFeeBps" | "sellProtocolFeeBps"> &
    Partial<Pick<FeeSchedule, "maxRewardBps">>,
  rewardModel: RewardModel,
  rewardBps: bigint = V1_CURVE_REWARD_BPS,
): FeeConfigV1 {
  validateLaunchReward(rewardModel, rewardBps, s.maxRewardBps);
  const f: FeeConfigV1 = {
    buyProtocolFeeBps: s.buyProtocolFeeBps,
    sellProtocolFeeBps: s.sellProtocolFeeBps,
    rewardBps,
    rewardModel,
  };
  validateFeesV1(f);
  return f;
}

/** Routes the reward part of a fee (`FeeSplit.creator`) by reward model. */
export function routeFees(rewardModel: RewardModel, fees: FeeSplit): FeeRouting {
  validateRewardModel(rewardModel);
  const holder = rewardModel === REWARD_MODEL.Holder;
  return {
    protocol: fees.protocol,
    creator: holder ? 0n : fees.creator,
    holder: holder ? fees.creator : 0n,
  };
}

export interface BuyQuoteV1 extends BuyQuote {
  routing: FeeRouting;
}

export interface SellQuoteV1 extends SellQuote {
  routing: FeeRouting;
}

/** `quoteBuy` at the token's buy-side fees, with the fee routed by its reward model. */
export function quoteBuyV1(
  state: CurveState,
  solIn: bigint,
  fees: FeeConfigV1,
  minTokensOut = 0n,
): BuyQuoteV1 {
  validateFeesV1(fees);
  const q = quoteBuy(state, solIn, sideFees(fees, true), minTokensOut);
  return { ...q, routing: routeFees(fees.rewardModel, q.fees) };
}

/** `quoteSell` at the token's sell-side fees, with the fee routed by its reward model. */
export function quoteSellV1(
  state: CurveState,
  tokensIn: bigint,
  fees: FeeConfigV1,
  minSolOut = 0n,
): SellQuoteV1 {
  validateFeesV1(fees);
  const q = quoteSell(state, tokensIn, sideFees(fees, false), minSolOut);
  return { ...q, routing: routeFees(fees.rewardModel, q.fees) };
}
