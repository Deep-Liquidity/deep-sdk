/**
 * deep-curve lifecycle/admin instruction builders: initialize_config, the timelocked
 * queue/apply/cancel_config_update,
 * withdraw_protocol_fees, claim_creator_fees, graduate.
 * Account order mirrors the `#[derive(Accounts)]` structs in programs/deep-curve/src/lib.rs
 * (and the Rust LiteSVM test helpers that exercise them).
 */
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
/** Raydium cp-swap's devnet create-pool fee receiver (legacy; graduation now targets deep-amm). */
export declare const CPMM_CREATE_POOL_FEE_RECEIVER_DEVNET: PublicKey;
/** Compute units to request for `graduate` (see docs/PROGRAMS.md for the LiteSVM measurement). */
export declare const GRADUATE_COMPUTE_UNITS = 400000;
/**
 * The deep-curve PDA that pays for and signs pool creation at graduation. ONE address for
 * every token (seed "pool_creator" alone). deep-amm compiles it in
 * (`deep_keys::GRADUATION_PAYER`, `DEEP_GRADUATION_PAYER` below): for this payer
 * `initialize_with_permission[_v1]` needs no Permission account, ignores an AmmConfig's
 * `disable_create_pool`, and its Permission cannot be closed, so no deep-amm admin action can
 * block a graduation.
 */
export declare function graduationPayerPda(programId?: PublicKey): PublicKey;
/**
 * `graduationPayerPda()` of deep-curve 7czUR…CDtA, the same on every cluster: the address
 * deep-amm compiles in as `deep_keys::GRADUATION_PAYER` (pinned by packages/sdk tests and by
 * programs/deep-curve tests).
 */
export declare const DEEP_GRADUATION_PAYER: PublicKey;
/** The deep-curve-owned PDA used as the Raydium pool_state (un-griefable). */
export declare function graduationPoolPda(mint: PublicKey, programId?: PublicKey): PublicKey;
/**
 * True only for the pool deep-curve created when `token` graduated. Anyone can open
 * other pools for the same pair (any price, any AmmConfig), so UIs must not treat those
 * as the token's DEEP market. Pure: needs only the pool address and its two mints.
 */
export declare function isGraduationPool(poolId: PublicKey, mint0: PublicKey, mint1: PublicKey, programId?: PublicKey): boolean;
/** Holds the single queued (timelocked) config change. */
export declare function pendingConfigPda(programId?: PublicKey): PublicKey;
export declare function programDataPda(programId?: PublicKey): PublicKey;
export interface ConfigParamsArgs {
    feeRecipient: PublicKey;
    migrationAuthority: PublicKey;
    protocolFeeBps: number;
    creatorFeeBps: number;
    migrationFeeBps: number;
    initialVirtualSol: bigint;
    initialVirtualToken: bigint;
    curveSupply: bigint;
    tokenTotalSupply: bigint;
    decimals: number;
    raydiumAmmConfig: PublicKey;
    /**
     * Delay (seconds) applied to every later config change; 0..=30 days.
     * Use 0 on localnet/devnet, at least 48h (172_800) on mainnet.
     */
    timelockSeconds: number;
    /** v2: launch fee in US cents, 0..=2000 (on-chain cap). Defaults to 0 (no fee). */
    launchFeeUsdCents?: number;
    /**
     * v3 (DEEP V1): protocol fee on SELLS, bps; `protocolFeeBps` is the BUY rate. When omitted
     * the sell rate EQUALS `protocolFeeBps`. A caller that re-queues the current config must
     * pass the decoded `sellProtocolFeeBps` through, or it resets the sell rate to the buy rate.
     */
    sellProtocolFeeBps?: number;
    /**
     * v3: the admin's CURRENT maximum reward rate a creator may choose for a NEW launch, bps.
     * At most 500 (`MAX_REWARD_BPS`; InvalidRewardRate 6039 above it). Defaults to 0, which
     * allows Standard launches only. On each side protocol + max(creatorFeeBps, maxRewardBps,
     * reservedBps) must be <= 1000 (the on-chain 10% cap). Tokens already launched keep the
     * rate their creator chose.
     */
    maxRewardBps?: number;
    /** v3: reserved (stored, read by no instruction). Defaults to 0. */
    reservedBps?: number;
}
/** Every `ConfigParamsArgs` field of a decoded Config or queued params, new fields included. */
export declare function configParamsOf(c: {
    feeRecipient: PublicKey;
    migrationAuthority: PublicKey;
    protocolFeeBps: number;
    creatorFeeBps: number;
    migrationFeeBps: number;
    initialVirtualSol: bigint;
    initialVirtualToken: bigint;
    curveSupply: bigint;
    tokenTotalSupply: bigint;
    decimals: number;
    raydiumAmmConfig: PublicKey;
    timelockSeconds: number;
    launchFeeUsdCents: number;
    sellProtocolFeeBps: number;
    maxRewardBps: number;
    reservedBps: number;
}): Required<ConfigParamsArgs>;
/** Program-side bound (MAX_TIMELOCK_SECONDS) and the recommended mainnet value. */
export declare const MAX_TIMELOCK_SECONDS: number;
export declare const RECOMMENDED_MAINNET_TIMELOCK_SECONDS: number;
export declare function encodeConfigParams(p: ConfigParamsArgs): Buffer;
/** Must be signed by the program's upgrade authority (enforced on-chain via ProgramData). */
export declare function initializeConfigIx(admin: PublicKey, params: ConfigParamsArgs, programId?: PublicKey): TransactionInstruction;
/**
 * Timelocked config change, step 1 (admin only). Takes effect after
 * Config.timelock_seconds via `applyConfigUpdateIx`; only one change can be queued.
 */
export declare function queueConfigUpdateIx(admin: PublicKey, params: ConfigParamsArgs, programId?: PublicKey): TransactionInstruction;
/**
 * Timelocked config change, step 2. Permissionless (no signer in the account list):
 * any fee payer can execute once the queued change's eta has passed.
 */
export declare function applyConfigUpdateIx(programId?: PublicKey): TransactionInstruction;
/** Admin veto for the queued change. */
export declare function cancelConfigUpdateIx(admin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS: moves a curve's accrued protocol fees (trade + launch) to the DEEP fee vault
 * (DEEP V1), where `distribute` pays the builder 10% and the destinations 90%. Any fee payer may
 * send it (e.g. a crank batching many curves). The vault must already be funded to its rent
 * minimum (`initializeSplitterIx`).
 *
 * Breaking change (V1): the second argument is the program id again; the builder account of
 * the 5/70 build is gone.
 */
export declare function sweepProtocolFeesIx(mint: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS: moves a Holder token's accrued curve reward fees
 * (`BondingCurve.holder_fees_unclaimed`) to its holder vault, the deep-rewards PDA
 * `holderVaultPda(mint)`, from where deep-rewards pays holders. Works before and after
 * graduation. Fails with `ZeroAmount` when nothing accrued (always the case while the curve
 * reward rate is 0), and with `HolderVaultBelowRent` while the vault would end below the 0-byte
 * rent minimum: run deep-rewards `init_distributor` for the mint first (it funds the reserve),
 * or wait until the accrued amount alone covers it. The fees stay on the curve until then.
 */
export declare function sweepHolderFeesIx(mint: PublicKey, programId?: PublicKey, rewardsProgramId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS, idempotent: grows a v1 / v2 Config (+ PendingConfig) to v3. Payer funds rent.
 * The new sell rate is set to the account's own protocol rate, the reward rates to 0.
 */
export declare function migrateConfigIx(payer: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS, idempotent: grows a v1 / v2 BondingCurve to v3. Payer funds rent. The token
 * keeps its economics: sell rate = its protocol rate; reward model = Creator when it charges a
 * creator fee, else Standard.
 */
export declare function migrateCurveIx(payer: PublicKey, mint: PublicKey, programId?: PublicKey): TransactionInstruction;
/** Two-step admin transfer, step 1 (current admin). Immediate; not timelocked. */
export declare function proposeAdminIx(admin: PublicKey, newAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * Two-step admin transfer, step 2: must be signed by Config.pending_admin. For a
 * Squads vault this instruction goes into a multisig proposal (the vault signs on
 * execution), it cannot be sent directly.
 */
export declare function acceptAdminIx(pendingAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
export declare function withdrawProtocolFeesIx(admin: PublicKey, feeRecipient: PublicKey, amount: bigint, programId?: PublicKey): TransactionInstruction;
export declare function claimCreatorFeesIx(creator: PublicKey, mint: PublicKey, programId?: PublicKey): TransactionInstruction;
export interface GraduationAccounts {
    /** `graduationPayerPda`: pays for the pool, never the pool's recorded creator. */
    poolCreator: PublicKey;
    /**
     * deep-amm Permission PDA of `poolCreator`. Passed for the account layout only: deep-amm
     * requires no permission from the graduation payer, so it does not have to exist.
     */
    permission: PublicKey;
    poolState: PublicKey;
    lpMint: PublicKey;
    token0Vault: PublicKey;
    token1Vault: PublicKey;
    observation: PublicKey;
    creatorToken: PublicKey;
    creatorWsol: PublicKey;
    creatorLp: PublicKey;
}
/** Every address `graduate` touches for `mint`. `poolState` is where the Raydium pool will live. */
export declare function graduationAccounts(mint: PublicKey, programId?: PublicKey, cpSwap?: PublicKey): GraduationAccounts;
/**
 * The one address a token's DeepSwap reward fees can go to (deep-curve
 * `reward_recipient_address`): the token's deep-rewards holder vault (`holderVaultPda(mint)`)
 * for a Holder token, the token's creator otherwise. `graduate` requires exactly this account
 * and records it as the pool's `pool_creator`. A Standard pool never accrues a reward; its
 * creator is recorded all the same.
 */
export declare function rewardRecipientAddress(a: {
    mint: PublicKey;
    /** `BondingCurve.creator`. */
    creator: PublicKey;
    /** `BondingCurve.reward_model`: 0 Standard, 1 Creator, 2 Holder. */
    rewardModel: number;
    rewardsProgramId?: PublicKey;
}): PublicKey;
export interface GraduateArgs {
    /**
     * @deprecated Ignored. `graduate` is PERMISSIONLESS and has no signer account: any wallet
     * can send it and pays only the network fee. `Config.migrationAuthority` is read by no
     * instruction.
     */
    migrationAuthority?: PublicKey;
    mint: PublicKey;
    /** The token's creator (`BondingCurve.creator`). */
    creator: PublicKey;
    /**
     * The token's reward model (`BondingCurve.reward_model`: 0 Standard, 1 Creator, 2 Holder).
     * Default 0. It decides the reward recipient `graduate` requires
     * (`rewardRecipientAddress`): the creator, or for a Holder token its holder vault. A wrong
     * value fails the transaction (InvalidPool) and changes nothing, so read it from the curve.
     */
    rewardModel?: number;
    /** Defaults to deep-rewards (the program the holder vault is derived under). */
    rewardsProgramId?: PublicKey;
    /** Config.raydium_amm_config */
    ammConfig: PublicKey;
    programId?: PublicKey;
    /** Defaults to deep-amm. */
    cpSwapProgramId?: PublicKey;
    /**
     * deep-amm's build-time create-pool fee WSOL account (DEEP_AMM_CREATE_POOL_FEE_RECEIVER).
     * DEEP V1: the fee vault's WSOL ATA (`feeVaultWsolAta()`), the default.
     */
    createPoolFeeReceiver?: PublicKey;
}
/**
 * PERMISSIONLESS `graduate`: 24 accounts, no signer. The sender of the transaction pays the
 * network fee only and receives nothing; the pool payer PDA pays the pool costs and the
 * temporary token accounts out of the migration fee, and every remainder goes to the DEEP fee
 * vault. Position of `reward_recipient`: `GRADUATE_REWARD_RECIPIENT_INDEX`.
 */
export declare const GRADUATE_REWARD_RECIPIENT_INDEX = 5;
export declare function graduateIx(a: GraduateArgs): TransactionInstruction;
/** graduate plus the compute budget it needs. */
export declare function graduateIxs(a: GraduateArgs): TransactionInstruction[];
