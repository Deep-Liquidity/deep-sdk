/**
 * A confirmed transaction as the RPC records it, independent of its log text: every
 * instruction (top-level and inner) with its place in the call tree, the SOL and token
 * movements those instructions made, and the balances before and after.
 *
 * This is the data the runtime never truncates. It is what `tx-reconstruct.ts` rebuilds
 * events from when the log was cut.
 */
import type { VersionedTransactionResponse } from "@solana/web3.js";

/** One instruction as `getTransaction` (encoding "json") returns it. */
export interface RpcInstruction {
  programIdIndex: number;
  accounts: number[];
  /** base58 (the RPC's form), or the raw bytes. */
  data: string | Uint8Array;
  /** Inner instructions only: 2 when called by the top-level instruction, 3 below that... */
  stackHeight?: number | null;
}

export interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  uiTokenAmount: { amount: string };
}

/** `getTransaction` with encoding "json": the fields used here (others are ignored). */
export interface RpcTransaction {
  slot: number;
  blockTime?: number | null;
  transaction: {
    message: { accountKeys: string[]; instructions: RpcInstruction[] };
  };
  meta: {
    err: unknown;
    fee?: number;
    logMessages?: string[] | null;
    innerInstructions?: { index: number; instructions: RpcInstruction[] }[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
    preBalances?: number[] | null;
    postBalances?: number[] | null;
    preTokenBalances?: RpcTokenBalance[] | null;
    postTokenBalances?: RpcTokenBalance[] | null;
  } | null;
}

/** The same transaction from `Connection.getTransaction` (web3.js), in the RPC's "json" shape. */
export function rpcTransactionFromResponse(tx: VersionedTransactionResponse): RpcTransaction {
  const msg = tx.transaction.message;
  const meta = tx.meta;
  return {
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    transaction: {
      message: {
        accountKeys: msg.staticAccountKeys.map((k) => k.toBase58()),
        instructions: msg.compiledInstructions.map((ix) => ({
          programIdIndex: ix.programIdIndex,
          accounts: [...ix.accountKeyIndexes],
          data: ix.data,
        })),
      },
    },
    meta: meta
      ? {
          err: meta.err,
          fee: meta.fee,
          logMessages: meta.logMessages ?? null,
          // web3.js passes the node's `stackHeight` through although its types omit it
          innerInstructions: (meta.innerInstructions ?? null) as
            { index: number; instructions: RpcInstruction[] }[] | null,
          loadedAddresses: meta.loadedAddresses
            ? {
                writable: meta.loadedAddresses.writable.map((k) => k.toBase58()),
                readonly: meta.loadedAddresses.readonly.map((k) => k.toBase58()),
              }
            : null,
          preBalances: meta.preBalances,
          postBalances: meta.postBalances,
          preTokenBalances: (meta.preTokenBalances ?? null) as RpcTokenBalance[] | null,
          postTokenBalances: (meta.postTokenBalances ?? null) as RpcTokenBalance[] | null,
        }
      : null,
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** base58 (Bitcoin alphabet) to bytes. Throws on a character outside the alphabet. */
export function decodeBase58(s: string): Uint8Array {
  const le: number[] = [];
  for (const c of s) {
    let carry = B58.indexOf(c);
    if (carry < 0) throw new Error("invalid base58");
    for (let i = 0; i < le.length; i++) {
      carry += le[i]! * 58;
      le[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      le.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of s) {
    if (c !== "1") break;
    le.push(0);
  }
  return Uint8Array.from(le.reverse());
}

/** Static keys, then the writable and read-only keys loaded from address lookup tables. */
export function txAccountKeys(tx: RpcTransaction): string[] {
  const loaded = tx.meta?.loadedAddresses;
  return [
    ...tx.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
}

/** One instruction of a transaction, top-level or inner, in execution order. */
export interface TxFrame {
  /** Position in execution order across the whole transaction. */
  index: number;
  /** Index of the top-level instruction this one ran under (its own index if top-level). */
  top: number;
  /** 1 for a top-level instruction, else the node's stack height; 0 when it reported none. */
  depth: number;
  programId: string;
  accounts: string[];
  data: Uint8Array;
  /**
   * `frames.slice(index + 1, end)` are the instructions this one invoked, directly or below.
   * Meaningful only when `descendantsKnown`.
   */
  end: number;
  /** False for an inner instruction of a transaction whose node reported no stack heights. */
  descendantsKnown: boolean;
}

/**
 * Every instruction of the transaction with its call tree, from what the validator recorded
 * (program ids and stack heights), never from log text.
 */
export function txFrames(tx: RpcTransaction): TxFrame[] {
  const keys = txAccountKeys(tx);
  const key = (i: number) => {
    const k = keys[i];
    if (k === undefined) throw new Error("transaction refers to an account it does not list");
    return k;
  };
  const inner = new Map<number, RpcInstruction[]>();
  for (const g of tx.meta?.innerInstructions ?? []) inner.set(g.index, g.instructions);

  const out: TxFrame[] = [];
  const push = (ix: RpcInstruction, top: number, depth: number, descendantsKnown: boolean) =>
    out.push({
      index: out.length,
      top,
      depth,
      programId: key(ix.programIdIndex),
      accounts: ix.accounts.map(key),
      data: typeof ix.data === "string" ? decodeBase58(ix.data) : ix.data,
      end: out.length + 1,
      descendantsKnown,
    });

  tx.transaction.message.instructions.forEach((topIx, i) => {
    const start = out.length;
    push(topIx, i, 1, true);
    const group = inner.get(i) ?? [];
    const heights = group.every((ix) => typeof ix.stackHeight === "number" && ix.stackHeight >= 2);
    for (const ix of group) push(ix, i, heights ? (ix.stackHeight as number) : 0, heights);
    out[start]!.end = out.length;
    if (!heights) return;
    // an inner instruction's descendants: the following ones that are deeper than it
    for (let a = start + 1; a < out.length; a++) {
      let b = a + 1;
      while (b < out.length && out[b]!.depth > out[a]!.depth) b++;
      out[a]!.end = b;
    }
  });
  return out;
}

/** The instructions `frame` invoked, directly or below; null when the node did not say. */
export function frameDescendants(frames: readonly TxFrame[], frame: TxFrame): TxFrame[] | null {
  return frame.descendantsKnown ? frames.slice(frame.index + 1, frame.end) : null;
}

export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
export const SPL_TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const u32 = (d: Uint8Array, o: number) =>
  d.length >= o + 4 ? new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true) : null;
const u64 = (d: Uint8Array, o: number) =>
  d.length >= o + 8
    ? new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true)
    : null;

/** Lamports one System Program instruction moved. */
export interface LamportMove {
  from: string;
  to: string;
  lamports: bigint;
}

/**
 * The lamports a System Program instruction moved: `Transfer`, `CreateAccount`,
 * `CreateAccountWithSeed`, `TransferWithSeed`, `WithdrawNonceAccount`. Null for every other
 * instruction (they move none). Lamports a program moves by writing its own accounts'
 * balances directly are NOT instructions and never appear here.
 */
export function systemLamportMove(f: TxFrame): LamportMove | null {
  if (f.programId !== SYSTEM_PROGRAM_ADDRESS) return null;
  const tag = u32(f.data, 0);
  const pair = (from: number, to: number, lamports: bigint | null): LamportMove | null => {
    const a = f.accounts[from];
    const b = f.accounts[to];
    return a !== undefined && b !== undefined && lamports !== null
      ? { from: a, to: b, lamports }
      : null;
  };
  if (tag === 0 || tag === 2 || tag === 5) return pair(0, 1, u64(f.data, 4));
  if (tag === 11) return pair(0, 2, u64(f.data, 4));
  if (tag === 3) {
    // base (32), seed (u64 length + bytes), lamports
    const len = u64(f.data, 36);
    return len === null || len > 64n ? null : pair(0, 1, u64(f.data, 44 + Number(len)));
  }
  return null;
}

/** Tokens one SPL Token / Token-2022 instruction moved, minted or burned. */
export interface TokenMove {
  kind: "transfer" | "mint" | "burn";
  /** The token account debited (null for a mint). */
  source: string | null;
  /** The token account credited (null for a burn). */
  destination: string | null;
  amount: bigint;
}

const isTokenProgram = (p: string) =>
  p === SPL_TOKEN_PROGRAM_ADDRESS || p === TOKEN_2022_PROGRAM_ADDRESS;

/**
 * The tokens an SPL Token or Token-2022 instruction moved: `Transfer`, `TransferChecked`,
 * `MintTo`, `MintToChecked`, `Burn`, `BurnChecked`. Null for every other instruction.
 * `amount` is the instruction's amount: a Token-2022 transfer fee is not subtracted.
 */
export function tokenMove(f: TxFrame): TokenMove | null {
  if (!isTokenProgram(f.programId)) return null;
  const amount = u64(f.data, 1);
  const a = f.accounts;
  if (amount === null) return null;
  switch (f.data[0]) {
    case 3:
      return a[0] && a[1] ? { kind: "transfer", source: a[0], destination: a[1], amount } : null;
    case 12:
      return a[0] && a[2] ? { kind: "transfer", source: a[0], destination: a[2], amount } : null;
    case 7:
    case 14:
      return a[1] ? { kind: "mint", source: null, destination: a[1], amount } : null;
    case 8:
    case 15:
      return a[0] ? { kind: "burn", source: a[0], destination: null, amount } : null;
    default:
      return null;
  }
}

/**
 * True when `f` is a token-program instruction that can change `account`'s token balance in
 * a way `tokenMove` does not report: closing it, `SyncNative` (wrapped SOL), or a Token-2022
 * extension instruction (transfers with a fee, withheld-fee handling). A reader that needs
 * the exact balance of `account` at some point of the transaction must give up on these.
 */
export function tokenBalanceOpaque(f: TxFrame, account: string): boolean {
  if (!isTokenProgram(f.programId) || !f.accounts.includes(account)) return false;
  const tag = f.data[0];
  return tag === 9 || tag === 17 || (tag !== undefined && tag >= 25);
}

const big = (n: number | undefined): bigint | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? BigInt(n) : null;

/** An account's lamports before and after the transaction; null when it is not recorded. */
export function lamportBalances(
  tx: RpcTransaction,
  address: string,
): { pre: bigint; post: bigint } | null {
  const i = txAccountKeys(tx).indexOf(address);
  const pre = big(tx.meta?.preBalances?.[i]);
  const post = big(tx.meta?.postBalances?.[i]);
  return i >= 0 && pre !== null && post !== null ? { pre, post } : null;
}

/**
 * A token account's balance before and after the transaction; 0 on the side where it was not
 * a token account (created or closed in the transaction). Null when the transaction does not
 * list the address or the node recorded no token balances.
 */
export function tokenBalances(
  tx: RpcTransaction,
  address: string,
): { pre: bigint; post: bigint } | null {
  const i = txAccountKeys(tx).indexOf(address);
  const pre = tx.meta?.preTokenBalances;
  const post = tx.meta?.postTokenBalances;
  if (i < 0 || !Array.isArray(pre) || !Array.isArray(post)) return null;
  const at = (list: RpcTokenBalance[]) => {
    const b = list.find((x) => x.accountIndex === i);
    if (!b) return 0n;
    return /^\d+$/.test(b.uiTokenAmount.amount) ? BigInt(b.uiTokenAmount.amount) : null;
  };
  const a = at(pre);
  const b = at(post);
  return a === null || b === null ? null : { pre: a, post: b };
}

/** Net lamports `address` received through System Program instructions in the transaction. */
export function systemNetLamports(frames: readonly TxFrame[], address: string): bigint {
  let net = 0n;
  for (const f of frames) {
    const m = systemLamportMove(f);
    if (!m) continue;
    if (m.to === address) net += m.lamports;
    if (m.from === address) net -= m.lamports;
  }
  return net;
}
