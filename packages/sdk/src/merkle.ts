/**
 * Cumulative-amount Merkle tree for deep-rewards (programs/deep-rewards/src/merkle.rs).
 *
 *   leaf = sha256(0x00 || distributor || claimant || cumulative_amount u64 LE)
 *   node = sha256(0x01 || min(a, b) || max(a, b))      (byte-wise comparison)
 *
 * Domain bytes keep leaves and nodes apart (no second-preimage); sorted pairs make a proof a
 * plain list of siblings; an odd node is promoted unchanged. Leaves are ordered by claimant
 * (base58-independent byte order) so the same allocation always yields the same root.
 * Pinned against the Rust program by fixtures/merkle-vectors.json.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";

export const MERKLE_LEAF_PREFIX = 0x00;
export const MERKLE_NODE_PREFIX = 0x01;
export const MERKLE_MAX_PROOF_LEN = 32;

const U64_MAX = (1n << 64n) - 1n;

function u64le(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new RangeError("u64 out of range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** -1 / 0 / 1, lexicographic over bytes (the Rust `[u8; 32]` ordering). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return a.length - b.length;
}

export function rewardLeafHash(
  distributor: PublicKey,
  claimant: PublicKey,
  cumulativeAmount: bigint,
): Uint8Array {
  return sha256(
    concat(
      Uint8Array.of(MERKLE_LEAF_PREFIX),
      distributor.toBytes(),
      claimant.toBytes(),
      u64le(cumulativeAmount),
    ),
  );
}

export function rewardNodeHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [l, r] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(concat(Uint8Array.of(MERKLE_NODE_PREFIX), l, r));
}

export function verifyRewardProof(
  proof: Uint8Array[],
  root: Uint8Array,
  leaf: Uint8Array,
): boolean {
  let h = leaf;
  for (const p of proof) h = rewardNodeHash(h, p);
  return compareBytes(h, root) === 0;
}

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
export function buildRewardTree(distributor: PublicKey, entries: RewardEntry[]): RewardTree {
  const sorted = entries
    .filter((e) => e.cumulative > 0n)
    .slice()
    .sort((a, b) => compareBytes(a.claimant.toBytes(), b.claimant.toBytes()));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.claimant.equals(sorted[i - 1]!.claimant))
      throw new Error(`duplicate claimant ${sorted[i]!.claimant.toBase58()}`);
  }
  if (sorted.length === 0) throw new Error("empty reward tree");
  const leafHashes = sorted.map((e) => rewardLeafHash(distributor, e.claimant, e.cumulative));
  const levels: Uint8Array[][] = [leafHashes];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? rewardNodeHash(cur[i]!, cur[i + 1]!) : cur[i]!);
    }
    levels.push(next);
  }
  const proofOf = (index: number): Uint8Array[] => {
    const proof: Uint8Array[] = [];
    let i = index;
    for (let l = 0; l < levels.length - 1; l++) {
      const level = levels[l]!;
      const sib = i ^ 1;
      if (sib < level.length) proof.push(level[sib]!);
      i = Math.floor(i / 2);
    }
    return proof;
  };
  let maxTotalClaim = 0n;
  const leaves = sorted.map((e, index) => {
    maxTotalClaim += e.cumulative;
    return { ...e, index, leaf: leafHashes[index]!, proof: proofOf(index) };
  });
  if (maxTotalClaim > U64_MAX) throw new RangeError("max_total_claim exceeds u64");
  return { distributor, root: levels[levels.length - 1]![0]!, maxTotalClaim, leaves };
}

/** Lowercase hex (proofs and roots in the API and fixtures). */
export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(h: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

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
export function rewardTreeFile(tree: RewardTree, meta: RewardTreeFileMeta): string {
  return JSON.stringify({
    version: 1,
    distributor: tree.distributor.toBase58(),
    mint: meta.mint,
    rewardMint: meta.rewardMint,
    round: meta.round,
    snapshotSlot: meta.snapshotSlot,
    root: toHex(tree.root),
    maxTotalClaim: tree.maxTotalClaim.toString(),
    leaves: tree.leaves.map((l) => ({
      claimant: l.claimant.toBase58(),
      cumulative: l.cumulative.toString(),
    })),
  });
}

export const rewardTreeDataHash = (file: string): Uint8Array =>
  sha256(new TextEncoder().encode(file));
