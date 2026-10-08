import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type DeepSwapFeeSchedule } from "@deepliquidity/curve-math";
import { type CpmmPoolState } from "./raydium-cpmm.js";
/**
 * DEEP's DeepSwap fee policy, DEEP V1 Phase 1 (docs/V1_FEES.md): a 0.30% pool trade fee of
 * which 1/3 (`protocolFeeRate` 333_333) is DEEP's protocol fee; the LPs keep 666_667 / 1e6.
 * The protocol fee is collected only into the DEEP fee vault (`protocol_owner` is locked to
 * it), where the splitter pays the builder 10% and the configured destinations 90%. The fund
 * fee is retired (`fundFeeRate` 0, the only value deep-amm accepts). On pools created by
 * graduation there is also a 0.30% creator fee of which half goes to the token's creator and
 * half to DEEP (booked as protocol fee, so it reaches the vault too). Rates are in millionths
 * (CPMM_FEE_DENOMINATOR), protocol and fund rates are shares OF the trade fee,
 * `creatorFeeShareRate` is the share OF the creator fee the protocol keeps. These are the
 * policy targets: the live values are whatever the AmmConfig holds, so read the chain.
 */
export declare const DEEP_AMM_FEES: {
    readonly tradeFeeRate: 3000n;
    readonly protocolFeeRate: 333333n;
    readonly fundFeeRate: 0n;
    readonly creatorFeeRate: 3000n;
    readonly creatorFeeShareRate: 500000n;
};
/**
 * DEEP V1 DeepSwap fee targets (docs/V1_FEES.md), for an AmmConfig of fee model 1: absolute
 * rates per 1e6 that depend on the side. "Buy" = the swap's input is the pool's quote token
 * (SOL on TOKEN/SOL), "sell" = its output is. LP 0.10% per side (stays in the pool), DEEP
 * 0.25% on a buy and 0.65% on a sell (to the fee vault). On top, a Creator or Holder pool
 * charges its OWN reward rate on both sides, 100% its reward recipient's: the rate the
 * token's creator chose at launch (or the pool's creator, `initializeV1Ix`), fixed for good,
 * at most 5%. Every fee is taken in the quote token and a side never costs more than 10%.
 * These are the policy targets: the live values are whatever the AmmConfig holds, so read
 * the chain (`decodeCpmmAmmConfig`). `DEEP_AMM_FEES` above stays the policy of legacy (fee
 * model 0) configs and their pools.
 */
export declare const DEEP_AMM_V1_FEES: Readonly<DeepSwapFeeSchedule>;
/**
 * The hard ceiling of a pool's reward rate, per 1e6 (5%; deep-amm `MAX_REWARD_RATE`). Also
 * what `create_amm_config_v1` sets as the config's current maximum (`maxRewardRate`), which
 * the admin can lower with `update_amm_config` param 14.
 */
export declare const DEEP_AMM_MAX_REWARD_RATE = 50000n;
/** deep-amm ErrorCode::FeeRateAboveCap (6019): a side's rates above the 10% hard cap. */
export declare const DEEP_AMM_ERR_FEE_RATE_ABOVE_CAP = 6019;
/**
 * deep-amm ErrorCode::FeeModelMismatch (6020): the pool and its AmmConfig are not of the same
 * fee model, or the instruction / `update_amm_config` param does not exist for that model.
 */
export declare const DEEP_AMM_ERR_FEE_MODEL_MISMATCH = 6020;
/** deep-amm ErrorCode::InvalidRewardModel (6021): not 0 (Standard), 1 (Creator) or 2 (Holder). */
export declare const DEEP_AMM_ERR_INVALID_REWARD_MODEL = 6021;
/** deep-amm ErrorCode::InvalidQuoteSide (6022): a V1 pool's quote must be WSOL when the pair has it. */
export declare const DEEP_AMM_ERR_INVALID_QUOTE_SIDE = 6022;
/**
 * deep-amm ErrorCode::InvalidRewardRate (6023): a pool's reward rate must be 0 for Standard
 * and 1..=50_000 otherwise; also a config `max_reward_rate` above 50_000.
 */
export declare const DEEP_AMM_ERR_INVALID_REWARD_RATE = 6023;
/** deep-amm ErrorCode::HolderRewardsNeedSolQuote (6024): `initialize_v1` opens a Holder pool only with a WSOL quote. */
export declare const DEEP_AMM_ERR_HOLDER_REWARDS_NEED_SOL_QUOTE = 6024;
/** deep-amm ErrorCode::RewardRateAboveMax (6025): `initialize_v1` with a rate above the config's current `max_reward_rate`. */
export declare const DEEP_AMM_ERR_REWARD_RATE_ABOVE_MAX = 6025;
/** deep-amm ErrorCode::CreatePoolFeeAboveCap (6026): a create-pool fee above `DEEP_AMM_MAX_CREATE_POOL_FEE`. */
export declare const DEEP_AMM_ERR_CREATE_POOL_FEE_ABOVE_CAP = 6026;
/** deep-amm ErrorCode::GraduationPermissionLocked (6027): the graduation payer's Permission cannot be closed. */
export declare const DEEP_AMM_ERR_GRADUATION_PERMISSION_LOCKED = 6027;
/** deep-amm ErrorCode::InvalidPoolStatus (6028): a pool status may stop deposits (1) and swaps (4) only; withdrawals cannot be disabled. */
export declare const DEEP_AMM_ERR_INVALID_POOL_STATUS = 6028;
/**
 * deep-amm ErrorCode::HolderRewardsNeedDistributor (6029): a Holder Rewards pool needs the
 * deep-rewards distributor of (the non-quote token, the quote token) to exist first
 * (`initialize_v1`: always; `initialize_with_permission_v1`: for a quote other than SOL).
 */
export declare const DEEP_AMM_ERR_HOLDER_REWARDS_NEED_DISTRIBUTOR = 6029;
/**
 * Hard cap of an AmmConfig's create-pool fee (deep-amm `deep_keys::MAX_CREATE_POOL_FEE`):
 * 0.15 SOL, the fee DeepSwap launches with. The admin can lower the fee, never raise it above
 * this, and the program never charges more whatever a config holds, so a pool creator's cost is
 * known in advance.
 */
export declare const DEEP_AMM_MAX_CREATE_POOL_FEE = 150000000n;
/** What a pool creation is charged for a config's `createPoolFee` (the cap applies when charging too). */
export declare const deepAmmCreatePoolFeeCharged: (configured: bigint) => bigint;
/**
 * The pool-status bits the admin can set with `update_pool_status`: 1 = deposits disabled,
 * 4 = swaps disabled. Bit 2 (withdrawals) is rejected and `withdraw` ignores it.
 */
export declare const DEEP_AMM_POOL_STATUS: {
    readonly depositDisabled: 1;
    readonly swapDisabled: 4;
};
export declare function deepAmmConfigPda(index?: number, programId?: PublicKey): PublicKey;
export interface CreateAmmConfigArgs {
    /** deep-amm's build-time admin (DEEP_AMM_ADMIN); signs and pays rent. */
    admin: PublicKey;
    index?: number;
    tradeFeeRate?: bigint;
    protocolFeeRate?: bigint;
    fundFeeRate?: bigint;
    /** Lamports charged to whoever creates a pool (paid into the create-pool fee account). */
    createPoolFee: bigint;
    creatorFeeRate?: bigint;
    programId?: PublicKey;
}
export declare function deepAmmCreateConfigIx(a: CreateAmmConfigArgs): TransactionInstruction;
export interface CreateAmmConfigV1Args extends Partial<DeepSwapFeeSchedule> {
    /** deep-amm's build-time admin (DEEP_AMM_ADMIN); signs and pays rent. */
    admin: PublicKey;
    /** The config's index (its PDA seed). A V1 config is a NEW config, next to the legacy one. */
    index: number;
    /** Lamports charged to whoever creates a pool (paid into the create-pool fee account). */
    createPoolFee: bigint;
    programId?: PublicKey;
}
/**
 * The check `create_amm_config_v1` / `update_amm_config` make on a V1 config
 * (`AmmConfig::validate_v1_rates`): on each side LP + protocol must stay within 5%
 * (50_000: the 10% total cap minus the 5% a pool's reward rate may take), and
 * `maxRewardRate`, when given, within 50_000. Throws otherwise.
 */
export declare function validateDeepAmmV1Rates(s: DeepSwapFeeSchedule & {
    maxRewardRate?: bigint;
}): void;
/**
 * deep-amm `create_amm_config_v1(index, create_pool_fee, buy_lp, buy_protocol, sell_lp,
 * sell_protocol)`: creates an AmmConfig of fee model 1 (DEEP V1, side-dependent rates). Same
 * accounts as `create_amm_config`. Rates default to `DEEP_AMM_V1_FEES`. The program sets the
 * config's `max_reward_rate` to the ceiling (50_000); lower it with `update_amm_config` param
 * 14. A config's fee model is fixed at creation; its protocol owner is the DEEP fee vault and
 * it has no fund fee, as every config. Signed by the build-time admin, so on mainnet it goes
 * through the Squads vault.
 */
export declare function createAmmConfigV1Ix(a: CreateAmmConfigV1Args): TransactionInstruction;
/**
 * update_amm_config `param` codes (programs/deep-amm/src/instructions/admin/update_config.rs).
 * Each fee model has its own rate params: on a V1 config (fee model 1) 0, 1, 7 and 8 are
 * rejected, on a legacy config 10..=14 are (FeeModelMismatch, 6020). There is no param 9: a
 * config's fee model cannot be changed.
 */
export declare const DEEP_AMM_CONFIG_PARAM: {
    readonly tradeFeeRate: 0;
    readonly protocolFeeRate: 1;
    /** Locked: only DEEP_AMM_BUILDER_FUND_FEE_RATE (V1: 0) is accepted (BuilderFeeLocked otherwise). */
    readonly fundFeeRate: 2;
    /** Locked (V1): only the DEEP fee vault, passed as `remaining` (ProtocolOwnerLocked). */
    readonly protocolOwner: 3;
    /** Locked: only the build-time builder wallet, passed as `remaining` (BuilderFeeLocked). */
    readonly fundOwner: 4;
    readonly createPoolFee: 5;
    readonly disableCreatePool: 6;
    /** Add-on to the trade fee on pools with the creator fee enabled; trade + creator < 1e6. */
    readonly creatorFeeRate: 7;
    /** Share of the creator fee the protocol keeps; 0..=1e6. */
    readonly creatorFeeShareRate: 8;
    /**
     * V1 configs only, absolute rates per 1e6. After any change each side's lp + protocol must
     * stay within 50_000 (5%; FeeRateAboveCap, 6019).
     */
    readonly buyLpFeeRate: 10;
    readonly buyProtocolFeeRate: 11;
    readonly sellLpFeeRate: 12;
    readonly sellProtocolFeeRate: 13;
    /**
     * V1 configs only: the current maximum reward rate (per 1e6) of pools opened with
     * `initialize_v1`, at most 50_000 (InvalidRewardRate, 6023). Existing pools keep theirs.
     */
    readonly maxRewardRate: 14;
};
/**
 * deep-amm `update_amm_config(param, value)`, signed by the build-time admin. Takes effect
 * at once (no timelock: KNOWN_ISSUES DA-1), so on mainnet it must go through the Squads vault.
 */
export declare function deepAmmUpdateConfigIx(a: {
    admin: PublicKey;
    param: number;
    value: bigint;
    index?: number;
    programId?: PublicKey;
    /** params 3 (protocol owner) and 4 (fund owner): the new owner, read from the first remaining account. */
    remaining?: PublicKey;
}): TransactionInstruction;
/**
 * The per-mint allow entry (`SupportMintAssociated`). deep-amm accepts SPL Token mints and
 * Token-2022 mints whose extensions are all in its built-in list; any other Token-2022 mint
 * (permanent delegate, pausable, transfer hook, default account state, …) can only be pooled
 * once the admin has created this account for it, and pool creation must pass it as a
 * remaining account.
 */
export declare function deepAmmSupportMintPda(mint: PublicKey, programId?: PublicKey): PublicKey;
/**
 * Enables a Token-2022 mint for pool creation (admin only; the mint must be owned by
 * Token-2022). Takes effect at once and exposes pools to whatever the mint's issuer can do
 * (freeze, pause, seize, hook), so on mainnet it must go through the Squads vault.
 */
export declare const deepAmmCreateSupportMintIx: (a: {
    admin: PublicKey;
    mint: PublicKey;
    programId?: PublicKey;
}) => TransactionInstruction;
/** Removes the allow entry: no NEW pools for the mint. Existing pools keep working. */
export declare const deepAmmCloseSupportMintIx: (a: {
    admin: PublicKey;
    mint: PublicKey;
    programId?: PublicKey;
}) => TransactionInstruction;
/** The pool fields `collect_protocol_fee` needs (a decoded PoolState has them all). */
export type CollectFeePool = Pick<CpmmPoolState, "ammConfig" | "token0Vault" | "token1Vault" | "token0Mint" | "token1Mint" | "token0Program" | "token1Program">;
/**
 * deep-amm `collect_protocol_fee(amount_0_requested, amount_1_requested)`. The signer must be
 * the pool's `AmmConfig.protocol_owner`. DEEP V1: the admin bypass is gone and the owner is
 * locked to the fee vault (a PDA without a key), so on a V1 config nobody can sign this; use
 * `deepAmmCollectProtocolFeeToVaultIx`. Kept for configs not yet moved to the vault. The
 * program pays out min(requested, accrued) per side (default u64::MAX: everything).
 */
export declare function deepAmmCollectProtocolFeeIx(a: {
    owner: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    /** Token accounts for token_0 / token_1 that receive the fees. */
    recipientToken0: PublicKey;
    recipientToken1: PublicKey;
    amount0?: bigint;
    amount1?: bigint;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_protocol_fee` into the owner's associated token accounts, creating them first if
 * missing (the owner pays their rent). The SOL side arrives as WSOL in the owner's WSOL ATA.
 */
export declare function deepAmmCollectProtocolFeeIxs(a: {
    owner: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    programId?: PublicKey;
}): TransactionInstruction[];
/**
 * deep-amm `collect_protocol_fee_to_vault` (DEEP V1, PERMISSIONLESS, no signer): moves ALL of a
 * pool's accrued protocol fees to the associated token accounts of the config's protocol owner,
 * which deep-amm locks to the DEEP fee vault. `protocolOwner` defaults to the vault
 * (`DEEP_FEE_VAULT`); the program rejects anything else. A side with accrued fees needs its
 * ATA to exist (see `deepAmmCollectProtocolFeeToVaultIxs`).
 */
export declare function deepAmmCollectProtocolFeeToVaultIx(a: {
    pool: PublicKey;
    poolState: CollectFeePool;
    protocolOwner: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_protocol_fee_to_vault`, creating the vault's ATA first for each side that has
 * accrued fees (idempotent; `payer` funds a missing ATA's rent, ~0.002 SOL, once). The WSOL
 * side normally exists already (`initialize_splitter` creates it).
 */
export declare function deepAmmCollectProtocolFeeToVaultIxs(a: {
    payer: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool & Pick<CpmmPoolState, "protocolFeesToken0" | "protocolFeesToken1">;
    protocolOwner: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction[];
/**
 * deep-amm `collect_fund_fee(amount_0_requested, amount_1_requested)`: pays the accrued fund
 * fee (the DEEP builder share, 166_667 / 1e6 of every trade fee) out of the pool. Only the
 * build-time builder wallet (`deep_keys::BUILDER`, the only possible `AmmConfig.fund_owner`)
 * can sign it; the deep-amm admin no longer can. Same accounts as `collect_protocol_fee`.
 * The recipients are token accounts the signer chooses; min(requested, accrued) per side.
 */
export declare function deepAmmCollectFundFeeIx(a: {
    builder: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    recipientToken0: PublicKey;
    recipientToken1: PublicKey;
    amount0?: bigint;
    amount1?: bigint;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_fund_fee` into the builder's associated token accounts, created first if missing
 * (the builder pays their rent, so the wallet needs SOL). The SOL side arrives as WSOL.
 *
 * The mainnet builder wallet is a Squads v4 VAULT (a PDA): it cannot sign a transaction
 * itself. These instructions go into a Squads vault-transaction proposal of the builder's own
 * multisig, whose members approve it and whose execution signs as the vault
 * (see `builderCollectFundFeeProposal`). Nothing here sends anything.
 */
export declare function deepAmmCollectFundFeeIxs(a: {
    builder: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    programId?: PublicKey;
}): TransactionInstruction[];
/**
 * PRINT-ONLY proposal content for the builder's Squads vault: one `collect_fund_fee` (with
 * idempotent ATA creation) per pool that has accrued fund fees. Returns the instructions and a
 * human-readable description; the caller prints them (e.g. as a Squads TX Builder import).
 * The vault (`builder`) is the only signer and the fee payer of the ATA rent.
 */
export declare function builderCollectFundFeeProposal(a: {
    builder: PublicKey;
    pools: {
        pool: PublicKey;
        poolState: CollectFeePool & Pick<CpmmPoolState, "fundFeesToken0" | "fundFeesToken1">;
    }[];
    programId?: PublicKey;
}): {
    instructions: TransactionInstruction[];
    description: string;
};
/**
 * deep-amm `Permission` PDA of `authority`: seeds ["permission", authority]. A payer needs
 * one to call `initialize_with_permission`, the only instruction that creates a pool with
 * the creator fee enabled. deep-curve's graduation payer (`graduationPayerPda`) is the one
 * DEEP authorizes.
 */
export declare function deepAmmPermissionPda(authority: PublicKey, programId?: PublicKey): PublicKey;
/**
 * deep-amm `create_permission_pda`: the build-time admin authorizes `authority` to create
 * creator-fee pools (admin signs and pays the rent). Takes effect at once and anything the
 * authority creates afterwards charges the AmmConfig's creator fee, so on mainnet it must
 * go through the Squads vault. `close_permission_pda` revokes it.
 */
export declare function deepAmmCreatePermissionIx(a: {
    admin: PublicKey;
    authority: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
/** deep-amm `CreatorFeeOn` (borsh enum tag): on a V1 pool, the side every fee is taken in. */
export declare const DEEP_AMM_QUOTE_SIDE: {
    readonly token0: 1;
    readonly token1: 2;
};
export interface InitializeWithPermissionV1Args {
    /** Defaults to deep-amm. */
    programId?: PublicKey;
    /**
     * Signs, pays rent and the create-pool fee, sends both tokens and receives the LP tokens.
     * Needs a deep-amm Permission (`deepAmmPermissionPda(payer)`, `deepAmmCreatePermissionIx`).
     */
    payer: PublicKey;
    /**
     * Recorded as the pool's `pool_creator`: the only address the pool's reward fees can go
     * to. The token's creator for a Creator pool, the token's deep-rewards holder vault for a
     * Holder pool (`rewardRecipientAddress`). Never signs. A Standard pool never accrues a reward.
     */
    creator: PublicKey;
    /** A V1 AmmConfig (fee model 1); a legacy one is rejected (FeeModelMismatch). */
    ammConfig: PublicKey;
    /** The pair in any order; the builder sorts it the way the program requires. */
    mintA: PublicKey;
    mintB: PublicKey;
    /** Owner program of each mint (SPL Token or Token-2022), read from chain. */
    tokenProgramA: PublicKey;
    tokenProgramB: PublicKey;
    /** Amount of each token the payer sends, base units. Together they set the price. */
    amountA: bigint;
    amountB: bigint;
    /** Unix seconds from which swaps are allowed; 0 (default) = right away. */
    openTime?: bigint;
    /**
     * The pool's QUOTE token, the one every fee is taken in: `mintA` or `mintB`. When the pair
     * has WSOL it must be WSOL (the program rejects the other side, InvalidQuoteSide).
     */
    quoteMint: PublicKey;
    /** 0 Standard, 1 Creator, 2 Holder (`REWARD_MODEL`). Immutable. */
    rewardModel: number;
    /**
     * The pool's reward rate, per 1e6 (NOT bps), charged on both sides on top of the config's
     * rates and paid to `creator`. 0 for Standard; at most 50_000 (5%). Immutable. deep-curve's
     * `graduate` passes the curve's `rewardBps` x 100.
     */
    rewardRate: bigint;
    /** The build-time create-pool fee WSOL account (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). */
    createPoolFeeReceiver: PublicKey;
    /** Default: the payer's associated token accounts under each mint's own program. */
    payerTokenA?: PublicKey;
    payerTokenB?: PublicKey;
    /**
     * Default: the pool PDA of (ammConfig, pair). Any other account must SIGN the transaction
     * (deep-curve's `graduate` passes its own PDA this way) and is marked as a signer here.
     */
    poolState?: PublicKey;
    /** `deepAmmSupportMintPda(mint)` for each allow-listed Token-2022 mint (remaining accounts). */
    supportMints?: PublicKey[];
    /** Defaults to deep-rewards (the program a Holder pool's distributor is derived under). */
    rewardsProgramId?: PublicKey;
}
/**
 * deep-amm `initialize_with_permission_v1(init_amount_0, init_amount_1, open_time,
 * creator_fee_on, reward_model, reward_rate)`: creates a DEEP V1 pool (fee model 1) under a
 * V1 AmmConfig. Same accounts as `initialize_with_permission`. The pool takes every fee in
 * `quoteMint`, charges the config's side rates and, on top, its own `rewardRate`, which
 * accrues for `creator`. Only the 5% ceiling applies here, not the config's current maximum.
 * deep-curve's `graduate` is the caller for every launched token; this builder is for a
 * permissioned payer creating one directly. Anyone can open a V1 pool with `initializeV1Ix`.
 *
 * A Holder pool quoted in anything but SOL needs the deep-rewards distributor of (the non-quote
 * token, the quote token) to exist already (HolderRewardsNeedDistributor, 6029); the builder
 * appends it as the last remaining account. A SOL-quoted pool needs none.
 */
export declare function initializeWithPermissionV1Ix(a: InitializeWithPermissionV1Args): TransactionInstruction;
/**
 * The optional per-creator override of `AmmConfig.creator_fee_share_rate`: seeds
 * ["creator_fee_share", creator, amm_config]. The collect instructions always take this
 * address; when the account does not exist the AmmConfig's rate applies.
 */
export declare function deepAmmCreatorFeeSharePda(creator: PublicKey, ammConfig: PublicKey, programId?: PublicKey): PublicKey;
/** `CreatorFeeShare.share_rate` from account data (8 disc + 1 bump + 32 creator + 32 config + u64). */
export declare function decodeCreatorFeeShareRate(data: Uint8Array): bigint;
/**
 * `resolve_creator_fee_share_rate`: the override account's rate when it exists and is owned
 * by the AMM program, otherwise the AmmConfig's.
 */
export declare function resolveCreatorFeeShareRate(config: {
    creatorFeeShareRate: bigint;
}, override: {
    owner: PublicKey;
    data: Uint8Array;
} | null | undefined, programId?: PublicKey): bigint;
/** The pool fields the creator-fee collect instructions need (a decoded PoolState has them all). */
export type CollectCreatorFeePool = CollectFeePool & Pick<CpmmPoolState, "poolCreator">;
/**
 * deep-amm `collect_creator_fee`, signed by the pool's recorded creator. Pays the creator
 * their part of BOTH sides' accrued creator fee into their associated token accounts (the
 * program creates them if missing, the creator pays that rent) and books the protocol's
 * share as protocol fee on the pool, where `collect_protocol_fee` picks it up. On a
 * graduation pool the fee is all WSOL, so it lands in the creator's WSOL account. Fails
 * with NoFeeCollect (6014) when nothing has accrued.
 */
export declare function deepAmmCollectCreatorFeeIx(a: {
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * deep-amm `collect_creator_fee_permissionless`: the same settlement, triggered by anyone.
 * The creator's part still goes to the CREATOR's associated token accounts; `payer` only
 * signs and pays the rent of any of those two accounts that does not exist yet (about
 * 0.002 SOL each). This is how DEEP's share gets booked when a creator never collects.
 */
export declare function deepAmmCollectCreatorFeePermissionlessIx(a: {
    payer: PublicKey;
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_creator_fee` for the creator's wallet. With `unwrapSol` (and a WSOL side) it
 * then closes the creator's WSOL account so the fee arrives as SOL: that unwraps the
 * account's WHOLE balance, including WSOL the creator already held there.
 */
export declare function deepAmmCollectCreatorFeeIxs(a: {
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    unwrapSol?: boolean;
    programId?: PublicKey;
}): TransactionInstruction[];
