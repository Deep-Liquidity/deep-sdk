/**
 * Shared helpers for the examples. Every example builds real transactions and SIMULATES them on
 * devnet (`simulateTransaction` with sigVerify off). Nothing is signed or sent, so no keypair is
 * ever needed: `--payer <PUBLIC KEY>` picks whose account the simulation runs as.
 *
 * Common flags: --rpc <devnet RPC URL> (default: SOLANA_RPC_URL env, else the public devnet
 * endpoint) · --payer <base58 public key>
 */
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  clusterFromGenesisHash,
  DEEP_AMM_PROGRAM_ID,
  DEEP_CURVE_PROGRAM_ID,
  parseAmmSwapEvents,
  parseEventsFromLogs,
  parseFeeEventsFromLogs,
} from "@deepliquidity/sdk";

export function args<T extends NonNullable<ParseArgsConfig["options"]>>(options: T) {
  return parseArgs({
    options: { rpc: { type: "string" }, payer: { type: "string" }, ...options },
    allowPositionals: false,
  }).values;
}

/** A devnet connection. The examples are devnet material, so any other cluster is refused. */
export async function devnet(rpc?: string): Promise<Connection> {
  const conn = new Connection(rpc ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), {
    commitment: "confirmed",
  });
  const cluster = clusterFromGenesisHash(await conn.getGenesisHash());
  if (cluster !== "devnet") throw new Error(`expected a devnet RPC, got ${cluster}`);
  return conn;
}

export const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toFixed(9)} SOL`;
export const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
export const json = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x),
    2,
  );

/** Compute units per top-level instruction, from the "consumed N of M" log lines at depth 1. */
export function unitsPerInstruction(logs: readonly string[]): { program: string; units: number }[] {
  const out: { program: string; units: number }[] = [];
  let depth = 0;
  for (const l of logs) {
    if (/^Program \w+ invoke \[\d+\]$/.test(l)) depth++;
    const m = /^Program (\w+) consumed (\d+) of \d+ compute units$/.exec(l);
    if (m && depth === 1) out.push({ program: m[1]!, units: Number(m[2]) });
    if (/^Program \w+ (success|failed)/.test(l)) depth--;
  }
  return out;
}

const NAMES: Record<string, string> = {
  [DEEP_CURVE_PROGRAM_ID.toBase58()]: "deep-curve",
  [DEEP_AMM_PROGRAM_ID.toBase58()]: "deep-amm",
  ComputeBudget111111111111111111111111111111: "compute-budget",
  "11111111111111111111111111111111": "system",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "spl-token",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "associated-token",
};

/**
 * Simulates `ixs` as a v0 transaction paid by `payer` (no signature: sigVerify off, the
 * blockhash is replaced by the RPC). Prints the result, compute units and decoded DEEP events.
 */
export async function simulate(conn: Connection, payer: PublicKey, ixs: TransactionInstruction[]) {
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  console.log(
    `\nsimulating ${ixs.length} instruction(s) as ${payer.toBase58()} (not signed, not sent)`,
  );
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  const logs = r.value.logs ?? [];
  console.log(`  result: ${r.value.err ? `ERROR ${JSON.stringify(r.value.err)}` : "success"}`);
  console.log(`  compute units: ${r.value.unitsConsumed} total`);
  for (const u of unitsPerInstruction(logs))
    console.log(`    ${(NAMES[u.program] ?? u.program).padEnd(18)} ${u.units}`);
  const curveEvents = parseEventsFromLogs(logs).map((e) => e.event);
  const feeEvents = parseFeeEventsFromLogs(logs);
  const swaps = parseAmmSwapEvents(logs);
  for (const e of [...feeEvents, ...curveEvents]) console.log(`  event ${e.name}: ${json(e)}`);
  for (const s of swaps) console.log(`  event SwapEvent: ${json(s)}`);
  if (r.value.err) console.log("  logs:\n    " + logs.slice(-12).join("\n    "));
  return { err: r.value.err, units: r.value.unitsConsumed, logs, curveEvents, swaps };
}

/** The first of `candidates` holding at least `lamports` (to pay for a simulated transaction). */
export async function fundedKey(conn: Connection, candidates: PublicKey[], lamports: bigint) {
  for (const k of candidates) if (BigInt(await conn.getBalance(k)) >= lamports) return k;
  throw new Error("no funded payer found: pass --payer <public key with devnet SOL>");
}
