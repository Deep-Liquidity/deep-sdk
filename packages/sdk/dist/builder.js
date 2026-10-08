/**
 * The DEEP builder share, DEEP V1 (owner decision 2026-10-06; docs/V1_FEES.md section 10):
 * the builder wallet receives exactly 10% of ALL DEEP revenue (curve trade + launch fees, the
 * migration-fee remainder, DEEP's DeepSwap protocol fees and the DeepSwap create-pool fee).
 * Everything lands in the deep-curve fee vault and the permissionless `distribute`
 * (splitter.ts) pays the builder floor(10% of everything ever received) minus what it was
 * already paid: exact over time, never more, never delayed by an admin.
 *
 * Both programs fix the wallet at BUILD time (env `DEEP_BUILDER_WALLET`); the 10% is a
 * compile-time constant. Only a program upgrade (signed through the Squads vault on mainnet)
 * can change either.
 *
 * Replaced (V1 Phase 1): the deep-curve 5/70 sweep share (`BuilderFeePaid`) and the deep-amm
 * fund-fee builder lock. deep-amm's `fund_fee_rate` is now locked to 0; `fund_owner` stays the
 * builder so fund fees accrued before V1 remain collectable by the builder only.
 */
import { PublicKey } from "@solana/web3.js";
/**
 * The builder wallet compiled into each cluster's deep-curve and deep-amm
 * (release/{devnet,mainnet}.cargo-config.toml `DEEP_BUILDER_WALLET`). Devnet: a test wallet.
 * Mainnet: the DEEP Builder Squads v4 vault provided by the owner (docs/MAINNET.md). It only
 * receives SOL from `distribute`; it signs nothing except legacy `collect_fund_fee`.
 */
export const DEEP_BUILDER_WALLET = {
    devnet: new PublicKey("5aAGC72doS9xML4omM4jVHCQU864T4oWXV839fR8hKyp"),
    mainnet: new PublicKey("7S9b5c2vEYhiVzqijW2SehGzJ5DAio1X2KdN2fEXgykX"),
};
/**
 * deep-amm: the only `fund_fee_rate` an AmmConfig can hold (share OF the trade fee, per 1e6).
 * DEEP V1: 0, the builder is paid by the splitter instead.
 */
export const DEEP_AMM_BUILDER_FUND_FEE_RATE = 0n;
/**
 * The fund rate of the retired 5/70 build (166_667 / 1e6 of the trade fee). Kept to decode
 * and explain pre-V1 devnet history; no V1 AmmConfig can hold it.
 */
export const DEEP_AMM_LEGACY_BUILDER_FUND_FEE_RATE = 166667n;
/**
 * DEEP's protocol share of the trade fee (per 1e6) under V1: 333_333, one third of the 0.30%
 * trade fee, as before the builder share. The builder's 10% now comes out of it in the vault.
 */
export const DEEP_AMM_PROTOCOL_FEE_RATE_V1 = 333333n;
/** @deprecated the 5/70 build's protocol rate (166_666 next to the 166_667 fund fee). */
export const DEEP_AMM_PROTOCOL_FEE_RATE_WITH_BUILDER = 166666n;
/** deep-amm ErrorCode::BuilderFeeLocked (6016): a fund rate/owner other than the compiled one. */
export const DEEP_AMM_ERR_BUILDER_FEE_LOCKED = 6016;
/** deep-amm ErrorCode::ProtocolOwnerLocked (6017): a protocol owner other than the fee vault. */
export const DEEP_AMM_ERR_PROTOCOL_OWNER_LOCKED = 6017;
/** deep-amm ErrorCode::InvalidProtocolFeeRecipient (6018). */
export const DEEP_AMM_ERR_INVALID_PROTOCOL_FEE_RECIPIENT = 6018;
/** deep-curve DeepError::InvalidBuilder / BuilderNotRentExempt (now raised by `distribute`). */
export const DEEP_CURVE_ERR_INVALID_BUILDER = 6027;
export const DEEP_CURVE_ERR_BUILDER_NOT_RENT_EXEMPT = 6028;
/** deep-curve DeepError::InvalidFee (6009): at launch, a side's protocol fee + reward rate above 10%. */
export const DEEP_CURVE_ERR_INVALID_FEE = 6009;
/**
 * deep-curve DeepError::InvalidRewardRate (6039): a reward rate that does not fit the model
 * (Standard takes 0, Creator / Holder 1..=500 bps), or a Config `max_reward_bps` above 500.
 */
export const DEEP_CURVE_ERR_INVALID_REWARD_RATE = 6039;
/** deep-curve DeepError::RewardRateAboveMax (6040): a launch above the Config's current `max_reward_bps`. */
export const DEEP_CURVE_ERR_REWARD_RATE_ABOVE_MAX = 6040;
/**
 * deep-curve DeepError::LaunchFeeAboveMax (6041): the launch fee, converted at the Pyth price
 * inside `create_token`, is above the creator's `max_launch_fee_lamports`. Nothing was charged;
 * quote again and retry.
 */
export const DEEP_CURVE_ERR_LAUNCH_FEE_ABOVE_MAX = 6041;
/**
 * deep-curve DeepError::GraduationImpossible (6042): Config params under which a completed
 * curve would have no SOL or no tokens left for its pool (`validateLaunchParams`).
 */
export const DEEP_CURVE_ERR_GRADUATION_IMPOSSIBLE = 6042;
/** The builder wallet for `cluster` (from the SDK table), or null when not known. */
export function builderWalletFor(cluster) {
    if (/mainnet/i.test(cluster))
        return DEEP_BUILDER_WALLET.mainnet;
    if (/devnet/i.test(cluster))
        return DEEP_BUILDER_WALLET.devnet;
    return null;
}
//# sourceMappingURL=builder.js.map