/**
 * Public verification of a deep-rewards root (docs/KNOWN_ISSUES.md DR-1). The program cannot
 * check per-claimant amounts on chain; these checks let anyone do it off chain during the root
 * delay (at least 12 h; 24 h on mainnet), from the published tree file, the published snapshot
 * file and the chain, and ask the admin or the guardian to veto a bad root.
 *
 * Shared by the API (`GET /v1/rewards/:mint/verify`) and the CLI verifier
 * (packages/sdk/scripts/verify-rewards-root.ts).
 */
import { PublicKey } from "@solana/web3.js";
import { buildRewardTree, fromHex, rewardTreeDataHash, toHex, type RewardTree } from "./merkle.js";
import { allocateRewardRound } from "./rewards.js";

export interface ParsedRewardTreeFile {
  version: number;
  distributor: string;
  mint: string;
  rewardMint: string;
  round: number;
  snapshotSlot: string;
  root: string;
  maxTotalClaim: string;
  leaves: { claimant: string; cumulative: string }[];
}

export function parseRewardTreeFile(text: string): ParsedRewardTreeFile {
  const j = JSON.parse(text) as ParsedRewardTreeFile;
  if (j.version !== 1 || !Array.isArray(j.leaves)) throw new Error("unsupported tree file");
  return j;
}

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
  weights: { owner: string; balance: string; weight: string }[];
  excluded: { owner: string; balance: string; reason: string }[];
}

/** Canonical JSON (fixed key order, sorted owners) so it can be hashed and compared. */
export function rewardSnapshotFile(d: RewardSnapshotFileData): string {
  const byOwner = <T extends { owner: string }>(a: T[]) =>
    [...a].sort((x, y) => (x.owner < y.owner ? -1 : x.owner > y.owner ? 1 : 0));
  return JSON.stringify({
    version: 1,
    distributor: d.distributor,
    mint: d.mint,
    rewardMint: d.rewardMint,
    round: d.round,
    snapshotSlot: d.snapshotSlot,
    pool: d.pool,
    previousRound: d.previousRound,
    weights: byOwner(d.weights).map((w) => ({
      owner: w.owner,
      balance: w.balance,
      weight: w.weight,
    })),
    excluded: byOwner(d.excluded).map((x) => ({
      owner: x.owner,
      balance: x.balance,
      reason: x.reason,
    })),
  });
}

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
export function verifyRewardTree(i: VerifyRewardTreeInput): VerifyRewardTreeResult {
  const checks: RootCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) =>
    checks.push(detail ? { name, ok, detail } : { name, ok });
  const f = parseRewardTreeFile(i.treeFile);

  if (i.chainDataHash !== undefined) {
    const h = toHex(rewardTreeDataHash(i.treeFile));
    add("data_hash: sha256(tree file) == on-chain data_hash", h === i.chainDataHash, h);
  }

  let tree: RewardTree | null = null;
  try {
    tree = buildRewardTree(
      new PublicKey(f.distributor),
      f.leaves.map((l) => ({
        claimant: new PublicKey(l.claimant),
        cumulative: BigInt(l.cumulative),
      })),
    );
  } catch (e) {
    add("leaves are valid (unique wallets, positive amounts)", false, (e as Error).message);
  }
  if (tree) {
    const root = toHex(tree.root);
    add("root recomputed from the leaves == file root", root === f.root, root);
    if (i.chainRoot !== undefined) add("file root == on-chain root", f.root === i.chainRoot);
    add(
      "sum of leaves == file max_total_claim",
      tree.maxTotalClaim.toString() === f.maxTotalClaim,
      tree.maxTotalClaim.toString(),
    );
    if (i.chainMaxTotalClaim !== undefined)
      add(
        "file max_total_claim == on-chain total",
        BigInt(f.maxTotalClaim) === i.chainMaxTotalClaim,
      );
    add(
      "every leaf amount > 0",
      f.leaves.every((l) => BigInt(l.cumulative) > 0n),
    );
    add(
      "leaves in canonical order",
      f.leaves.every((l, k) => tree!.leaves[k]!.claimant.toBase58() === l.claimant),
    );
  }
  if (i.chainSnapshotSlot !== undefined)
    add("file snapshot slot == on-chain slot", BigInt(f.snapshotSlot) === i.chainSnapshotSlot);

  const current = new Map(f.leaves.map((l) => [l.claimant, BigInt(l.cumulative)]));
  let previous = new Map<string, bigint>();
  if (i.previousTreeFile) {
    const p = parseRewardTreeFile(i.previousTreeFile);
    previous = new Map(p.leaves.map((l) => [l.claimant, BigInt(l.cumulative)]));
    const decreased = [...previous].filter(([w, c]) => (current.get(w) ?? 0n) < c);
    add(
      "no wallet's cumulative amount decreased vs the previous round",
      decreased.length === 0,
      decreased.length ? `${decreased.length} wallets, e.g. ${decreased[0]![0]}` : undefined,
    );
    add("total does not decrease", BigInt(f.maxTotalClaim) >= BigInt(p.maxTotalClaim));
  }

  if (i.snapshotFile) {
    const s = JSON.parse(i.snapshotFile) as RewardSnapshotFileData;
    add("snapshot file is for this round", s.round === f.round && s.distributor === f.distributor);
    const excludedOwners = new Set(s.excluded.map((x) => x.owner));
    add(
      "no excluded owner has a weight",
      s.weights.every((w) => !excludedOwners.has(w.owner)),
    );
    const alloc = allocateRewardRound({
      pool: BigInt(s.pool),
      weights: new Map(s.weights.map((w) => [w.owner, BigInt(w.weight)])),
      previous,
    });
    const mismatched = [...new Set([...alloc.cumulative.keys(), ...current.keys()])].filter(
      (w) => (alloc.cumulative.get(w) ?? 0n) !== (current.get(w) ?? 0n),
    );
    add(
      "allocation recomputed from the snapshot == tree leaves",
      mismatched.length === 0,
      mismatched.length ? `${mismatched.length} wallets differ, e.g. ${mismatched[0]}` : undefined,
    );
    for (const x of s.excluded) {
      if (x.reason === "off_curve" && PublicKey.isOnCurve(new PublicKey(x.owner))) {
        add(`excluded owner ${x.owner} is really off-curve`, false);
      }
    }
  }
  return { ok: checks.every((c) => c.ok), round: f.round, checks };
}

/** Hex helpers re-exported for callers verifying raw account bytes. */
export const hexOf = toHex;
export const bytesOfHex = fromHex;
