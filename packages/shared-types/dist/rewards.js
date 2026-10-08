/**
 * Holder Rewards API shapes (apps/api `GET /v1/rewards/...`, apps/web Rewards panel).
 * Amounts are decimal strings of integers in the reward asset's base units (lamports for SOL).
 * Hashes and proofs are lowercase hex. Everything comes from the chain or the snapshot job's
 * index; nothing here is an estimate.
 */
/**
 * Holder Rewards on mainnet: the owner's recorded approval after their legal check
 * (docs/LEGAL_REVIEW.md "Owner decisions recorded"). The API refuses HOLDER_REWARDS=on on a
 * mainnet cluster unless HOLDER_REWARDS_MAINNET_APPROVED equals this date, and
 * mainnet-preflight checks the same.
 */
export const HOLDER_REWARDS_MAINNET_APPROVAL_DATE = "2026-10-06";
//# sourceMappingURL=rewards.js.map