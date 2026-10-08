/**
 * Holder Rewards API shapes (apps/api `GET /v1/rewards/...`, apps/web Rewards panel).
 * Amounts are decimal strings of integers in the reward asset's base units (lamports for SOL).
 * Hashes and proofs are lowercase hex. Everything comes from the chain or the snapshot job's
 * index; nothing here is an estimate.
 */
export type RewardsPayoutModeName = "claim" | "autoSend";
/** On-chain RewardsConfig, as served. */
export interface RewardsConfigView {
    admin: string;
    rootAuthority: string;
    payoutMode: RewardsPayoutModeName;
    paused: boolean;
    rootDelaySeconds: number;
    /** AUTO-SEND threshold, USD micro-dollars (20_000_000 = $20). */
    pushMinUsdMicros: string;
    /** Minimum holding to qualify at a snapshot, USD micro-dollars (10_000_000 = $10). */
    minHoldingUsdMicros: string;
    stableMints: string[];
}
export type RewardRoundStatus = "built" | "proposed" | "active" | "failed" | "superseded";
export interface RewardRoundView {
    distributor: string;
    rewardMint: string;
    round: number;
    status: RewardRoundStatus;
    snapshotSlot: string;
    /** When the snapshot was sampled, unix ms. */
    sampledAt: number;
    /** Funds allocated this round = previous unallocated + new deposits. */
    pool: string;
    allocated: string;
    /** Carried to the next round (rounding remainder). */
    dust: string;
    maxTotalClaim: string;
    root: string;
    dataHash: string;
    /** Wallets with a non-zero cumulative amount in this tree. */
    leaves: number;
    /** Wallets that qualified (weight > 0) in this snapshot. */
    eligible: number;
    excluded: number;
    /** sha256 commitment published at window start; the seed is revealed with the round. */
    sampleCommit: string;
    sampleSeed: string | null;
    signature: string | null;
    createdAt: number;
}
export interface RewardDistributorView {
    address: string;
    rewardMint: string;
    /** "SOL" for native SOL, else the mint (the UI resolves a symbol). */
    rewardSymbol: string | null;
    rewardDecimals: number;
    round: number;
    root: string;
    maxTotalClaim: string;
    totalClaimed: string;
    /** Vault balance that can still be paid out (SOL: above the rent reserve). */
    available: string;
    /** Available minus what the active root owes: goes into the next round. */
    unallocated: string;
    snapshotSlot: string;
    dataHash: string;
    hasPendingRoot: boolean;
}
/** GET /v1/rewards/:mint */
export interface TokenRewardsResponse {
    mint: string;
    /** False when no distributor exists for this mint (not a Holder Rewards token yet). */
    enabled: boolean;
    /** Snapshot cadence, seconds (3 h). */
    roundSeconds: number;
    /** Optional holding-time weighting (off by default). */
    holdingWeighting: boolean;
    config: RewardsConfigView | null;
    distributors: RewardDistributorView[];
    rounds: RewardRoundView[];
    /** Earliest start of the next snapshot window, unix ms (the sample time inside it is random). */
    nextWindowAt: number | null;
    source: "chain" | "mock";
}
export interface WalletRewardView {
    distributor: string;
    rewardMint: string;
    rewardDecimals: number;
    /** Round of the tree this proof belongs to (the active root on chain). */
    round: number;
    root: string;
    cumulative: string;
    /** Already paid (ClaimStatus.claimed on chain), or null if it could not be read. */
    claimed: string | null;
    /** cumulative − claimed (null if claimed is unknown). */
    claimable: string | null;
    proof: string[];
}
/** GET /v1/rewards/:mint/:wallet */
export interface WalletRewardsResponse {
    mint: string;
    wallet: string;
    rewards: WalletRewardView[];
    source: "chain" | "mock";
}
/**
 * Holder Rewards on mainnet: the owner's recorded approval after their legal check
 * (docs/LEGAL_REVIEW.md "Owner decisions recorded"). The API refuses HOLDER_REWARDS=on on a
 * mainnet cluster unless HOLDER_REWARDS_MAINNET_APPROVED equals this date, and
 * mainnet-preflight checks the same.
 */
export declare const HOLDER_REWARDS_MAINNET_APPROVAL_DATE = "2026-10-06";
/** One check of a published root (SDK `verifyRewardTree`). */
export interface RewardRootCheck {
    name: string;
    ok: boolean;
    detail?: string;
}
export interface RewardRootVerification {
    round: number;
    /** Every check passed. A failure is grounds for the admin to veto a pending root. */
    ok: boolean;
    checks: RewardRootCheck[];
}
/** GET /v1/rewards/:mint/verify */
export interface RewardsVerifyResponse {
    mint: string;
    distributors: {
        address: string;
        rewardMint: string;
        /** The root active on chain (null before the first one). */
        active: RewardRootVerification | null;
        /** The pending root waiting for its eta (null if none). */
        pending: (RewardRootVerification & {
            eta: number;
        }) | null;
    }[];
    source: "chain";
}
