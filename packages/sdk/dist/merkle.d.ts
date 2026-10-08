import { PublicKey } from "@solana/web3.js";
export declare const MERKLE_LEAF_PREFIX = 0;
export declare const MERKLE_NODE_PREFIX = 1;
export declare const MERKLE_MAX_PROOF_LEN = 32;
/** -1 / 0 / 1, lexicographic over bytes (the Rust `[u8; 32]` ordering). */
export declare function compareBytes(a: Uint8Array, b: Uint8Array): number;
export declare function rewardLeafHash(distributor: PublicKey, claimant: PublicKey, cumulativeAmount: bigint): Uint8Array;
export declare function rewardNodeHash(a: Uint8Array, b: Uint8Array): Uint8Array;
export declare function verifyRewardProof(proof: Uint8Array[], root: Uint8Array, leaf: Uint8Array): boolean;
export interface RewardEntry {
    claimant: PublicKey;
    /** Cumulative amount earned so far in the reward asset's base units (lamports for SOL). */
    cumulative: bigint;
}
export interface RewardTreeLeaf extends RewardEntry {
    index: number;
    leaf: Uint8Array;
    proof: Uint8Array[];
}
export interface RewardTree {
    distributor: PublicKey;
    root: Uint8Array;
    /** Sum of every cumulative amount: the root's `max_total_claim`. */
    maxTotalClaim: bigint;
    leaves: RewardTreeLeaf[];
}
/**
 * Builds the tree. Entries are sorted by claimant bytes; zero amounts are dropped (they can
 * never be claimed); duplicate claimants are an error (aggregate by wallet first).
 */
export declare function buildRewardTree(distributor: PublicKey, entries: RewardEntry[]): RewardTree;
/** Lowercase hex (proofs and roots in the API and fixtures). */
export declare const toHex: (b: Uint8Array) => string;
export declare function fromHex(h: string): Uint8Array;
export interface RewardTreeFileMeta {
    mint: string;
    rewardMint: string;
    round: number;
    snapshotSlot: string;
}
/**
 * The published tree file (GET /v1/rewards/:mint/tree/:round). Canonical JSON (fixed key
 * order, amounts as decimal strings, leaves in tree order) so anyone can recompute
 * `data_hash = sha256(file)` and every root from it.
 */
export declare function rewardTreeFile(tree: RewardTree, meta: RewardTreeFileMeta): string;
export declare const rewardTreeDataHash: (file: string) => Uint8Array;
