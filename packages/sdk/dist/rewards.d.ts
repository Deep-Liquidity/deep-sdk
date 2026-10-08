import { PublicKey, TransactionInstruction } from "@solana/web3.js";
/** deep-rewards program id (devnet/localnet keypair; not deployed until the rollout runs). */
export declare const DEEP_REWARDS_PROGRAM_ID: PublicKey;
export declare const REWARDS_PAYOUT_MODE: {
    readonly claim: 0;
    readonly autoSend: 1;
};
export type RewardsPayoutMode = keyof typeof REWARDS_PAYOUT_MODE;
export declare const DEFAULT_PUSH_MIN_USD_MICROS = 20000000n;
export declare const DEFAULT_MIN_HOLDING_USD_MICROS = 10000000n;
export declare const MAX_STABLE_MINTS = 4;
/**
 * On-chain lower bound for the root delay (every cluster): roots and settings changes wait at
 * least 12 h (was 1 h), long enough for a person holding the guardian key to see a bad root
 * and veto it.
 */
export declare const MIN_ROOT_DELAY_SECONDS: number;
/** The root delay mainnet starts with: 24 h. */
export declare const MAINNET_ROOT_DELAY_SECONDS: number;
/** RewardsError codes (append-only in the program). */
export declare const REWARDS_ERRORS: {
    readonly Unauthorized: 6000;
    readonly InvalidParams: 6001;
    readonly Paused: 6002;
    readonly InvalidMint: 6003;
    readonly UnsupportedRewardMint: 6004;
    readonly NotSolDistributor: 6005;
    readonly NotTokenDistributor: 6006;
    readonly InvalidVault: 6007;
    readonly NoRoot: 6008;
    readonly ProofTooLong: 6009;
    readonly InvalidProof: 6010;
    readonly NothingToClaim: 6011;
    readonly ExceedsMaxTotal: 6012;
    readonly RootNotMonotonic: 6013;
    readonly RootUnfunded: 6014;
    readonly StaleSnapshot: 6015;
    readonly NoPendingRoot: 6016;
    readonly RootNotReady: 6017;
    readonly PushDisabled: 6018;
    readonly BelowPushThreshold: 6019;
    readonly PushUnsupportedAsset: 6020;
    readonly RecipientNotEligible: 6021;
    readonly RecipientFrozen: 6022;
    readonly PriceInvalid: 6023;
    readonly Overflow: 6024;
    readonly ZeroAmount: 6025;
    readonly InvalidClaimStatus: 6026;
    readonly VaultShort: 6027;
    readonly ConfigUpdatePending: 6028;
    readonly NoPendingConfigUpdate: 6029;
    readonly ConfigUpdateNotReady: 6030;
    readonly ConfigUpdateExpired: 6031;
    readonly NotStray: 6032;
    /** PendingRewardsConfig is still in the pre-guardian layout: send `rewardsMigrateConfigIx` first. */
    readonly ConfigNotMigrated: 6033;
};
export declare function rewardsConfigPda(programId?: PublicKey): PublicKey;
/** The queued settings change (queue_config_update → apply_config_update after the delay). */
export declare function pendingRewardsConfigPda(programId?: PublicKey): PublicKey;
/**
 * The per-token holder vault: a system-owned, data-less PDA. SOL rewards are its lamports;
 * token rewards sit in its ATAs. THIS is the deposit address for Phase 2–3 (see V1_FEES.md 4.5).
 */
export declare function holderVaultPda(mint: PublicKey, programId?: PublicKey): PublicKey;
/** ATA(rewardMint, holder vault): the token vault (for SOL, the WSOL ATA that gets unwrapped). */
export declare function holderVaultTokenAccount(mint: PublicKey, rewardMint: PublicKey, rewardTokenProgram?: PublicKey, programId?: PublicKey): PublicKey;
export declare function distributorPda(mint: PublicKey, rewardMint: PublicKey, programId?: PublicKey): PublicKey;
export declare function claimStatusPda(distributor: PublicKey, claimant: PublicKey, programId?: PublicKey): PublicKey;
export declare function rewardsWsolUnwrapPda(distributor: PublicKey, programId?: PublicKey): PublicKey;
export declare const isSolReward: (rewardMint: PublicKey) => boolean;
export interface RewardsConfigParams {
    rootAuthority: PublicKey;
    payoutMode: number;
    rootDelaySeconds: number;
    maxProofLen: number;
    pushMinUsdMicros: bigint;
    minHoldingUsdMicros: bigint;
    maxPriceAgeSeconds: number;
    solUsdPriceUpdate: PublicKey;
    stableMints: PublicKey[];
    /** Receives non-reward tokens swept by `recover_stray` (default the admin; Phase 1: fee vault). */
    strayRecipient: PublicKey;
    /**
     * Veto-only key: may sign `veto_root` and `set_paused`, nothing else. Never the root
     * authority, never the zero key (the program rejects both); it may be the admin. Mainnet: the
     * instant "pause" Squads vault, so a bad root can be stopped without the admin's time lock.
     */
    guardian: PublicKey;
}
/**
 * Defaults: CLAIM mode, 12 h root delay (the on-chain minimum, every cluster), $20 push, $10
 * minimum, Pyth age 600 s (devnet; use 120 on mainnet). `strayRecipient` and `guardian` have
 * no default: on a test cluster pass the admin for both.
 */
export declare function defaultRewardsConfigParams(rootAuthority: PublicKey, strayRecipient: PublicKey, guardian: PublicKey, stableMints?: PublicKey[]): RewardsConfigParams;
export declare function rewardsInitializeIx(admin: PublicKey, params: RewardsConfigParams, programId?: PublicKey): TransactionInstruction;
/** The current settings as params (to queue a change of one field). */
export declare function rewardsParamsFromConfig(c: RewardsConfigAccount): RewardsConfigParams;
/**
 * Admin, step 1 of every settings change (root authority, payout mode, delay, thresholds,
 * stablecoins, stray recipient). Applicable by anyone after `config.rootDelaySeconds`.
 */
export declare function rewardsQueueConfigUpdateIx(admin: PublicKey, params: RewardsConfigParams, programId?: PublicKey): TransactionInstruction;
/** Admin: queue a payout-mode change (CLAIM / AUTO-SEND), keeping every other setting. */
export declare function rewardsQueuePayoutModeIx(admin: PublicKey, current: RewardsConfigAccount, mode: RewardsPayoutMode, programId?: PublicKey): TransactionInstruction;
/** Permissionless, after the queued change's eta. */
export declare function rewardsApplyConfigUpdateIx(programId?: PublicKey): TransactionInstruction;
export declare function rewardsCancelConfigUpdateIx(admin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * Permissionless: moves a NON-reward token held by the holder vault (e.g. the rewarded token
 * itself) to the stray recipient's ATA and closes the emptied vault account (rent to the stray
 * recipient). The program refuses SOL/WSOL, configured stablecoins and any mint with a
 * distributor for `mint`.
 */
export declare function rewardsRecoverStrayIx(cranker: PublicKey, mint: PublicKey, strayMint: PublicKey, strayRecipient: PublicKey, opts?: {
    tokenProgram?: PublicKey;
    vaultToken?: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `set_paused`: signed by the admin OR the guardian (`RewardsConfig.guardian`). Pauses (or
 * resumes) root publication and pushes; claims are never paused.
 */
export declare function rewardsSetPausedIx(authority: PublicKey, paused: boolean, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS, idempotent `migrate_config`: brings a deep-rewards deployed before the
 * guardian existed (devnet) to the current rules. Grows PendingRewardsConfig from 280 to 312
 * bytes (`payer` funds the rent difference) and raises a root delay below the 12 h minimum to
 * it. It sets no guardian: the admin does that with a normal settings change, and a change
 * that was queued before the upgrade has to be cancelled and queued again.
 */
export declare function rewardsMigrateConfigIx(payer: PublicKey, programId?: PublicKey): TransactionInstruction;
export declare function rewardsProposeAdminIx(admin: PublicKey, newAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
export declare function rewardsAcceptAdminIx(newAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
export interface DistributorRef {
    /** The token whose holders are rewarded. */
    mint: PublicKey;
    /** The paired asset; NATIVE_MINT (WSOL) = native SOL. */
    rewardMint: PublicKey;
    /** Token program of `rewardMint` (SPL Token for SOL). */
    rewardTokenProgram?: PublicKey;
}
/** Admin or root authority. */
export declare function rewardsInitDistributorIx(authority: PublicKey, d: DistributorRef, programId?: PublicKey): TransactionInstruction;
export declare function rewardsDepositSolIx(depositor: PublicKey, mint: PublicKey, amount: bigint, programId?: PublicKey): TransactionInstruction;
export declare function rewardsDepositTokenIx(depositor: PublicKey, depositorToken: PublicKey, d: DistributorRef, amount: bigint, programId?: PublicKey): TransactionInstruction;
/** Permissionless: WSOL in the holder vault's ATA → vault lamports (payer refunded). */
export declare function rewardsUnwrapWsolIx(payer: PublicKey, mint: PublicKey, programId?: PublicKey): TransactionInstruction;
export interface ProposeRootArgs {
    root: Uint8Array;
    maxTotalClaim: bigint;
    snapshotSlot: bigint;
    dataHash: Uint8Array;
}
export declare function rewardsProposeRootIx(rootAuthority: PublicKey, d: DistributorRef, a: ProposeRootArgs, programId?: PublicKey): TransactionInstruction;
export declare function rewardsActivateRootIx(d: DistributorRef, programId?: PublicKey): TransactionInstruction;
/**
 * `veto_root`: signed by the admin OR the guardian (`RewardsConfig.guardian`). Discards the
 * pending root; moves no funds, the active root stays.
 */
export declare function rewardsVetoRootIx(authority: PublicKey, d: DistributorRef, programId?: PublicKey): TransactionInstruction;
/**
 * The claimant's own claim (signer = claimant). For a token reward, `claimantToken` defaults
 * to the claimant's ATA; prepend `createAssociatedTokenAccountIdempotentInstruction` if it may
 * not exist (see `rewardsClaimIxs`).
 */
export declare function rewardsClaimIx(claimant: PublicKey, d: DistributorRef, cumulative: bigint, proof: Uint8Array[], claimantToken?: PublicKey, programId?: PublicKey): TransactionInstruction;
/** AUTO-SEND crank (payout mode AUTO-SEND only; permissionless). */
export declare function rewardsPushIx(cranker: PublicKey, claimant: PublicKey, d: DistributorRef, cumulative: bigint, proof: Uint8Array[], opts?: {
    priceUpdate?: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
export declare const REWARDS_CONFIG_SIZE = 390;
/** PendingRewardsConfig since the guardian was added to its params. */
export declare const PENDING_REWARDS_CONFIG_SIZE = 312;
/** PendingRewardsConfig before that (devnet until `migrate_config` runs). */
export declare const PENDING_REWARDS_CONFIG_V1_SIZE = 280;
export declare const DISTRIBUTOR_SIZE = 465;
export declare const CLAIM_STATUS_SIZE = 122;
export interface RewardsConfigAccount {
    version: number;
    bump: number;
    admin: PublicKey;
    pendingAdmin: PublicKey;
    rootAuthority: PublicKey;
    payoutMode: number;
    paused: boolean;
    rootDelaySeconds: number;
    maxProofLen: number;
    pushMinUsdMicros: bigint;
    minHoldingUsdMicros: bigint;
    maxPriceAgeSeconds: number;
    solUsdPriceUpdate: PublicKey;
    stableMints: PublicKey[];
    strayRecipient: PublicKey;
    /**
     * The veto-only key (`veto_root`, `set_paused`). The zero key (`PublicKey.default`) means
     * none is set: a config written before the guardian existed, until the admin's next
     * settings change.
     */
    guardian: PublicKey;
}
/** True when a RewardsConfig has a guardian (a non-zero key). */
export declare const rewardsHasGuardian: (c: Pick<RewardsConfigAccount, "guardian">) => boolean;
export declare function decodeRewardsConfig(data: Uint8Array): RewardsConfigAccount;
export interface PendingRewardsConfigAccount {
    bump: number;
    active: boolean;
    /** Unix seconds after which anyone may apply it. */
    eta: bigint;
    queuedAt: bigint;
    params: RewardsConfigParams;
}
/**
 * Decodes a PendingRewardsConfig in the current layout (312 bytes) or the one before the
 * guardian (280 bytes, devnet until `migrate_config`): there `params.guardian` is the zero key.
 */
export declare function decodePendingRewardsConfig(data: Uint8Array): PendingRewardsConfigAccount;
export interface DistributorAccount {
    version: number;
    bump: number;
    vaultBump: number;
    mint: PublicKey;
    rewardMint: PublicKey;
    rewardTokenProgram: PublicKey;
    rewardDecimals: number;
    holderVault: PublicKey;
    tokenVault: PublicKey;
    vaultReserve: bigint;
    round: number;
    root: Uint8Array;
    maxTotalClaim: bigint;
    totalClaimed: bigint;
    snapshotSlot: bigint;
    dataHash: Uint8Array;
    activatedAt: bigint;
    hasPending: boolean;
    pendingRoot: Uint8Array;
    pendingMaxTotalClaim: bigint;
    pendingSnapshotSlot: bigint;
    pendingDataHash: Uint8Array;
    pendingEta: bigint;
    createdBy: PublicKey;
}
export declare function decodeDistributor(data: Uint8Array): DistributorAccount;
export interface ClaimStatusAccount {
    version: number;
    bump: number;
    distributor: PublicKey;
    claimant: PublicKey;
    payer: PublicKey;
    claimed: bigint;
    lastClaimAt: bigint;
}
export declare function decodeClaimStatus(data: Uint8Array): ClaimStatusAccount;
/**
 * What the vault can still pay (SOL: lamports above the reserve; token: the ATA balance) and
 * the part no root has allocated yet (new deposits + carried rounding dust).
 */
export declare function distributorFunds(d: Pick<DistributorAccount, "rewardMint" | "vaultReserve" | "maxTotalClaim" | "totalClaimed">, vaultLamports: bigint, tokenVaultAmount: bigint): {
    available: bigint;
    outstanding: bigint;
    unallocated: bigint;
};
export interface AllocationInput {
    /** New funds to allocate this round: `unallocated` from `distributorFunds`. */
    pool: bigint;
    /** wallet (base58) → weight (eligible balance; excluded owners must not appear). */
    weights: Map<string, bigint>;
    /** wallet → cumulative amount in the previous root (every wallet ever paid stays). */
    previous: Map<string, bigint>;
}
export interface AllocationResult {
    /** wallet → new cumulative amount (previous + this round). */
    cumulative: Map<string, bigint>;
    /** wallet → amount allocated this round (non-zero only). */
    allocated: Map<string, bigint>;
    allocatedTotal: bigint;
    /** pool − allocatedTotal: carried to the next round (stays in the vault, unallocated). */
    dust: bigint;
}
/**
 * Pro-rata: floor(pool · w / Σw) per wallet; the remainder is carried forward (it remains in
 * the vault and is part of the next round's pool). Previous cumulatives never decrease.
 */
export declare function allocateRewardRound(input: AllocationInput): AllocationResult;
/** USD micro-dollars of `lamports` at a Pyth price (price · 10^expo USD/SOL), floored. */
export declare function lamportsUsdMicros(lamports: bigint, price: bigint, exponent: number): bigint;
/** USD micro-dollars of `amount` of a USD stablecoin at face value, floored. */
export declare function stableUsdMicros(amount: bigint, decimals: number): bigint;
/** One token account of the rewarded mint, as read by getProgramAccounts. */
export interface TokenHolding {
    tokenAccount: string;
    /** Token account owner (the wallet or a program authority), base58. */
    owner: string;
    amount: bigint;
}
export type ExclusionReason = "excluded" | "program_owned" | "off_curve" | "below_minimum";
export interface EligibilityOptions {
    /**
     * Owners that can never claim: DeepSwap pool authority, bonding-curve PDA, LP lock / burn,
     * the holder vault itself, the incinerator, ... (exact list built by the snapshot job).
     */
    excludedOwners: Set<string>;
    /** Off-curve owners that CAN claim (e.g. a Squads vault of a team/treasury holder). */
    allowOffCurve: Set<string>;
    /** owner → program owning the owner's account (null/absent = no account or System). */
    ownerPrograms?: Map<string, string | null>;
    /** Minimum aggregated raw balance to qualify (≈ $10 at snapshot). */
    minAmount: bigint;
    /** Defaults to `PublicKey.isOnCurve`. */
    isOnCurve?: (owner: string) => boolean;
}
/**
 * Aggregates balances per owner and drops owners who cannot claim or hold too little. Their
 * share is not set aside: weights only contain real holders, so the whole pool goes to them.
 */
export declare function eligibleWeights(holdings: TokenHolding[], opts: EligibilityOptions): {
    weights: Map<string, bigint>;
    excluded: Map<string, ExclusionReason>;
};
/** A queued settings change must be applied within this window after its eta (program constant). */
export declare const REWARDS_CONFIG_UPDATE_GRACE_SECONDS: number;
