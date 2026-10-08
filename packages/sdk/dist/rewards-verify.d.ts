import { fromHex } from "./merkle.js";
export interface ParsedRewardTreeFile {
    version: number;
    distributor: string;
    mint: string;
    rewardMint: string;
    round: number;
    snapshotSlot: string;
    root: string;
    maxTotalClaim: string;
    leaves: {
        claimant: string;
        cumulative: string;
    }[];
}
export declare function parseRewardTreeFile(text: string): ParsedRewardTreeFile;
/** The published snapshot behind a round: everything needed to recompute its allocation. */
export interface RewardSnapshotFileData {
    version: 1;
    distributor: string;
    mint: string;
    rewardMint: string;
    round: number;
    snapshotSlot: string;
    /** Funds allocated this round (unallocated vault balance at the sample). */
    pool: string;
    /** Round whose cumulative amounts this round builds on (null for the first). */
    previousRound: number | null;
    /** owner → weight (eligible balance, or the holding-time weighted balance). */
    weights: {
        owner: string;
        balance: string;
        weight: string;
    }[];
    excluded: {
        owner: string;
        balance: string;
        reason: string;
    }[];
}
/** Canonical JSON (fixed key order, sorted owners) so it can be hashed and compared. */
export declare function rewardSnapshotFile(d: RewardSnapshotFileData): string;
export interface RootCheck {
    name: string;
    ok: boolean;
    detail?: string;
}
export interface VerifyRewardTreeInput {
    treeFile: string;
    /** The on-chain root being checked (active or pending), hex. */
    chainRoot?: string;
    chainMaxTotalClaim?: bigint;
    chainDataHash?: string;
    chainSnapshotSlot?: bigint;
    /** The tree file of the previous ACTIVE round (cumulative amounts must not decrease). */
    previousTreeFile?: string | null;
    /** The snapshot file of this round (allocation recomputed exactly). */
    snapshotFile?: string | null;
}
export interface VerifyRewardTreeResult {
    ok: boolean;
    round: number;
    checks: RootCheck[];
}
/**
 * Every check a third party can run without trusting DEEP's API or job. A failure of any check
 * is grounds for the admin to veto the pending root (`veto_root`).
 */
export declare function verifyRewardTree(i: VerifyRewardTreeInput): VerifyRewardTreeResult;
/** Hex helpers re-exported for callers verifying raw account bytes. */
export declare const hexOf: (b: Uint8Array) => string;
export declare const bytesOfHex: typeof fromHex;
