/**
 * Reading a transaction whose log was truncated (see log-truncation.ts).
 *
 * `readCurveTransaction` and `readAmmTransaction` return the same events, with the same
 * numbering, that a complete log would have given:
 *
 *   - a complete log is parsed exactly as `parseEventsFromLogs` / `parseFeeEventsFromLogs` /
 *     `parseAmmSwapEventsWithSource` do;
 *   - in a truncated log the events before the marker are authoritative, and what the marker
 *     removed is rebuilt from data the runtime does not truncate: the instructions (program,
 *     discriminator, arguments, accounts, call tree), the System and SPL Token transfers each
 *     instruction made, the balances before and after, and DEEP's own integer maths;
 *   - every rebuilt event is PROVED against the chain before it is returned (the maths must
 *     reproduce the transfers the instruction really made, and the lamports and tokens of
 *     every event must add up to the account's balance change). When a proof fails, or an
 *     event cannot be rebuilt, the result is `unreadable` and carries NO events: a reader must
 *     never store part of such a transaction.
 *
 * What is exact and what is derived, per event field, is tabulated in docs/INTEGRATORS.md
 * ("Truncated logs").
 */
import {
  CurveMathError,
  graduationAllocation,
  quoteBuyV1,
  quoteDeepSwapExactIn as quoteV1ExactIn,
  quoteDeepSwapExactOut as quoteV1ExactOut,
  REWARD_MODEL,
  type CurveState,
  type FeeConfigV1,
  quoteSellV1,
} from "@deepliquidity/curve-math";
import { PublicKey } from "@solana/web3.js";
import {
  decodeAmmSwapEvent,
  decodeAmmSwapFeesV1,
  parseAmmSwapEventsWithSource,
  swapFeesV1Match,
  swapReservesAfter,
  type AmmSwapEventRaw,
  type AmmSwapFeesV1Raw,
  type ParsedAmmSwap,
} from "./amm-events.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";
import {
  decodeEvent,
  decodeFeeEvent,
  parseEventsFromLogs,
  parseFeeEventsFromLogs,
  type DeepEvent,
  type FeeEvent,
  type TradeEventData,
} from "./events.js";
import {
  configPda,
  curveFees,
  curvePda,
  decodeBondingCurve,
  decodeConfig,
  type BondingCurveAccount,
} from "./index.js";
import { logsBeforeTruncation, logsTruncated } from "./log-truncation.js";
import { decodeMintFacts } from "./pairs.js";
import { feeVaultPda } from "./splitter.js";
import {
  cpmmDirection,
  cpmmFeeModel,
  decodeCpmmAmmConfig,
  decodeCpmmPoolState,
  DEEP_AMM_FEE_MODEL,
  DEEP_AMM_PROGRAM_ID,
  deepSwapV1Rates,
  type CpmmAmmConfig,
  type CpmmPoolState,
} from "./raydium-cpmm.js";
import {
  frameDescendants,
  lamportBalances,
  SPL_TOKEN_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  systemLamportMove,
  systemNetLamports,
  tokenBalanceOpaque,
  tokenBalances,
  tokenMove,
  txFrames,
  type RpcTransaction,
  type TxFrame,
} from "./tx-frames.js";

/** An account as it is on chain now. */
export interface ChainAccount {
  data: Uint8Array;
  /** Owner program, base58. */
  owner: string;
}

/**
 * The chain reads a reconstruction may need. Nothing is read for a transaction whose log is
 * complete.
 */
export interface ChainReader {
  /** The account now, or null when it does not exist. Throw on a failed read. */
  account(address: string): Promise<ChainAccount | null>;
  /**
   * The newest SUCCESSFUL transaction that references `address` and is older than the
   * transaction `before` (a signature), or null when there is none. Used to find the state a
   * curve or a pool was in before the transaction being read, when that transaction's own log
   * does not show it. Without it such a transaction is `unreadable`.
   */
  previousTransaction?(
    address: string,
    before: string,
  ): Promise<{ signature: string; tx: RpcTransaction } | null>;
}

/**
 * `complete`: every event was in the log. `reconstructed`: the log was truncated and the
 * missing events were rebuilt and proved. `unreadable`: the log was truncated and the missing
 * events could not be rebuilt or proved; `events` is empty and nothing may be stored.
 */
export type TxReadStatus = "complete" | "reconstructed" | "unreadable";

export interface CurveTxEvent {
  /** The event's ordinal in the transaction, as `parseEventsFromLogs` numbers it. */
  index: number;
  event: DeepEvent;
  /** Set when the event was rebuilt, not read from the log. */
  reconstructed?: true;
}

export interface CurveTxFeeEvent {
  /** The event's ordinal among the transaction's fee events (`parseFeeEventsFromLogs`). */
  index: number;
  name: FeeEvent["name"];
  /**
   * Null for an event that is known to have been emitted but whose content is not on chain
   * any more (`LaunchFeeCharged`: the oracle price it quotes).
   */
  event: FeeEvent | null;
  reconstructed?: true;
}

export interface CurveTxRead {
  status: TxReadStatus;
  /** The runtime cut this transaction's log. */
  truncated: boolean;
  events: CurveTxEvent[];
  feeEvents: CurveTxFeeEvent[];
  /** `unreadable` only: why. */
  reason?: string;
  /** `reconstructed` only: the proofs that were made, in words. */
  checks?: string[];
  /**
   * Set when a rebuilt event carries a `timestamp`: where it came from. `event`: another
   * event of the same transaction that the log does show (the program's own clock, exact).
   * `blockTime`: the block's time. The program's clock is the block's time on some clusters
   * and the PARENT block's time on others, so this value can be one second later than what
   * the lost event said. Every other field of a rebuilt event is exact.
   */
  timestampSource?: "event" | "blockTime";
}

export interface AmmTxSwap extends ParsedAmmSwap {
  reconstructed?: true;
}

export interface AmmTxRead {
  status: TxReadStatus;
  truncated: boolean;
  /** In log order: position `i` is the index `parseAmmSwapEventsWithSource` gives the swap. */
  swaps: AmmTxSwap[];
  reason?: string;
  checks?: string[];
}

/** Raised inside a reconstruction: the transaction cannot be read, for the stated reason. */
class Unreadable extends Error {}
const giveUp = (reason: string): never => {
  throw new Unreadable(reason);
};

/** How many earlier transactions are searched for a curve's or a pool's previous state. */
const MAX_HISTORY = 40;
/** How deep a chain of truncated transactions is followed for that state. */
const MAX_DEPTH = 3;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const kindTable = (names: readonly string[]) =>
  new Map(names.map((n) => [hex(discriminator("global", n)), n]));
const kindOf = (table: Map<string, string>, f: TxFrame) =>
  f.data.length >= 8 ? (table.get(hex(f.data.subarray(0, 8))) ?? null) : null;
const u64At = (d: Uint8Array, o: number): bigint => {
  if (d.length < o + 8) giveUp("an instruction's arguments are shorter than expected");
  return new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
};

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** One invocation of a program as the reliable part of the log shows it. */
interface LoggedInvocation {
  depth: number;
  /** Its `success` line is before the truncation marker: every event it emitted is there. */
  complete: boolean;
  /** `Program data:` payloads it emitted itself, in order. */
  payloads: Uint8Array[];
}

/** Invocations of `pid` in the lines before the truncation marker, in execution order. */
function loggedInvocations(logs: readonly string[], pid: string): LoggedInvocation[] {
  const stack: (LoggedInvocation | null)[] = [];
  const out: LoggedInvocation[] = [];
  for (const line of logsBeforeTruncation(logs)) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const inv =
        invoke[1] === pid ? { depth: Number(invoke[2]), complete: false, payloads: [] } : null;
      if (inv) out.push(inv);
      stack.push(inv);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      const done = stack.pop();
      if (done) done.complete = true;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && line.startsWith("Program data: ")) {
      try {
        top.payloads.push(base64ToBytes(line.slice("Program data: ".length).trim()));
      } catch {
        // not base64: the log parsers skip it too
      }
    }
  }
  return out;
}

/** Lines `logged` up with the program's instructions, or the reason they cannot be. */
function align(logged: LoggedInvocation[], frames: TxFrame[]): void {
  if (logged.length > frames.length)
    giveUp("the log shows more invocations of the program than the transaction has");
  logged.forEach((inv, i) => {
    const f = frames[i]!;
    if (f.depth !== 0 && f.depth !== inv.depth)
      giveUp("the log and the instructions do not line up");
  });
}

const safeDecode = <T>(fn: (b: Uint8Array) => T | null, b: Uint8Array): T | null => {
  try {
    return fn(b);
  } catch {
    return null; // malformed payload: the log parsers skip it too
  }
};

/** Field-by-field equality of two decoded events (bigint-safe). */
function sameEvent(a: object, b: object): boolean {
  const norm = (o: object) =>
    JSON.stringify(
      Object.entries(o)
        .filter(([k, v]) => v !== undefined && k !== "reconstructed")
        .sort(([x], [y]) => (x < y ? -1 : 1)),
      (_k, v: unknown) =>
        typeof v === "bigint" ? `${v}n` : v instanceof PublicKey ? v.toBase58() : v,
    );
  return norm(a) === norm(b);
}

// ───────────────────────── deep-curve ─────────────────────────

const CURVE_KINDS = kindTable([
  "accept_admin",
  "apply_config_update",
  "apply_splitter_update",
  "buy",
  "cancel_config_update",
  "cancel_splitter_update",
  "claim_creator_fees",
  "create_token",
  "distribute",
  "graduate",
  "initialize_config",
  "initialize_splitter",
  "migrate_config",
  "migrate_curve",
  "propose_admin",
  "queue_config_update",
  "queue_splitter_update",
  "sell",
  "set_paused",
  "sweep_holder_fees",
  "sweep_protocol_fees",
  "withdraw_protocol_fees",
  "withdraw_vault_tokens",
]);

/** Where the BondingCurve account sits in the instructions that move its lamports or tokens. */
const CURVE_ACCOUNT_AT: Record<string, number> = {
  buy: 3,
  sell: 3,
  create_token: 3,
  graduate: 3,
  claim_creator_fees: 1,
  sweep_protocol_fees: 0,
  sweep_holder_fees: 0,
};

/** The instructions whose events can be rebuilt. */
const REBUILDABLE = new Set(["buy", "sell", "create_token", "graduate"]);
/**
 * Instructions that always emit exactly this many [events, fee events]. When the log shows
 * them all, nothing of the instruction is missing even if its `success` line was cut.
 */
const FIXED_EVENTS: Record<string, readonly [number, number]> = {
  claim_creator_fees: [1, 0],
  sweep_protocol_fees: [0, 1],
  sweep_holder_fees: [0, 1],
};

/**
 * `graduate` once took a leading payer account (a devnet build before the instruction became
 * signer-less): every account then sits one position later. The offset is found from the
 * accounts themselves: the curve must be its mint's curve PDA.
 */
function graduateOffset(frame: TxFrame, programId: PublicKey): number {
  for (const o of [0, 1]) {
    const [mint, curve] = [frame.accounts[2 + o], frame.accounts[3 + o]];
    try {
      if (mint && curve && curvePda(new PublicKey(mint), programId).toBase58() === curve) return o;
    } catch {
      // not a public key the curve PDA can be derived from: try the other layout
    }
  }
  return giveUp("an instruction's curve account is not its mint's curve");
}

const INIT_WITH_PERMISSION = [
  discriminator("global", "initialize_with_permission"),
  discriminator("global", "initialize_with_permission_v1"),
];
const startsWith = (data: Uint8Array, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((b, i) => data[i] === b);

interface CurveCtx {
  curve: string;
  mint: string;
  vault: string;
  account: BondingCurveAccount;
  fees: FeeConfigV1;
  /** The curve's reserves at this point of the transaction, when known. */
  state: CurveState | null;
  /** `state` comes from a logged event or a proved reconstruction (not from an assumption). */
  trusted: boolean;
  /** `create_token` for this mint ran earlier in this transaction. */
  createdHere: boolean;
  /** Lamports the program moved OUT of the curve account directly (no instruction shows them). */
  debits: bigint;
  /** The vault's token balance change the events so far account for. */
  tokenFlow: bigint;
}

interface FrameEvents {
  d: DeepEvent[];
  f: { name: FeeEvent["name"]; event: FeeEvent | null }[];
}

const stateAfter = (ctx: CurveCtx, e: TradeEventData): CurveState => ({
  virtualSolReserves: e.virtualSolReserves,
  virtualTokenReserves: e.virtualTokenReserves,
  realSolReserves: e.realSolReserves,
  realTokenReserves: e.realTokenReserves,
  curveSupply: ctx.account.state.curveSupply,
  tokenTotalSupply: ctx.account.state.tokenTotalSupply,
  complete: e.realTokenReserves === 0n,
});

/**
 * The reserves a curve starts with. `virtual - real` never changes on either side while the
 * curve trades, so the launch values follow from the account as it is now; after graduation
 * (real SOL zeroed) the SOL side comes from the program's Config. An assumption until the
 * first buy reproduces its transfers with it.
 */
async function launchState(
  ctx: CurveCtx,
  reader: ChainReader,
  programId: PublicKey,
): Promise<CurveState> {
  const s = ctx.account.state;
  let virtualSol = s.virtualSolReserves - s.realSolReserves;
  if (ctx.account.graduated) {
    const cfg = await reader.account(configPda(programId).toBase58());
    if (!cfg) return giveUp("the program's Config account is not available");
    virtualSol = decodeConfig(cfg.data).initialVirtualSol;
  }
  return {
    virtualSolReserves: virtualSol,
    virtualTokenReserves: s.virtualTokenReserves - s.realTokenReserves + s.curveSupply,
    realSolReserves: 0n,
    realTokenReserves: s.curveSupply,
    curveSupply: s.curveSupply,
    tokenTotalSupply: s.tokenTotalSupply,
    complete: false,
  };
}

/** The curve's reserves before `signature`, from the last trade an earlier transaction shows. */
async function earlierState(
  ctx: CurveCtx,
  signature: string,
  reader: ChainReader,
  programId: PublicKey,
  depth: number,
): Promise<{ state: CurveState; trusted: boolean }> {
  if (!reader.previousTransaction)
    return giveUp(
      "the curve's state before this transaction is needed, and no history reader was given",
    );
  let before = signature;
  for (let n = 0; n < MAX_HISTORY; n++) {
    const prev = await reader.previousTransaction(ctx.curve, before);
    if (!prev) break;
    before = prev.signature;
    const read = await readCurve(prev.tx, prev.signature, reader, programId, depth + 1);
    if (read.status === "unreadable")
      return giveUp(`an earlier transaction of this curve cannot be read (${read.reason})`);
    for (const { event } of [...read.events].reverse()) {
      if (!("mint" in event) || event.mint !== ctx.mint) continue;
      if (event.name === "TradeEvent") return { state: stateAfter(ctx, event), trusted: true };
      if (event.name === "TokenCreated")
        return { state: await launchState(ctx, reader, programId), trusted: false };
      if (event.name === "Graduated") return giveUp("the curve had already graduated");
    }
  }
  return giveUp("the curve's earlier state was not found in its recent transactions");
}

/** One `buy` or `sell` rebuilt from its instruction, its transfers and the curve maths. */
function rebuildTrade(
  ctx: CurveCtx,
  kind: "buy" | "sell",
  frame: TxFrame,
  frames: TxFrame[],
  state: CurveState,
  timestamp: bigint,
): { events: DeepEvent[]; next: CurveState; debit: bigint; tokens: bigint } {
  const below =
    frameDescendants(frames, frame) ??
    giveUp("the node did not report the call tree (stack heights) of this transaction");
  const user = frame.accounts[0] ?? giveUp("an instruction is missing accounts");
  const userToken = frame.accounts[5] ?? giveUp("an instruction is missing accounts");
  const amount = u64At(frame.data, 8);
  const minOut = u64At(frame.data, 16);
  const tokens = below
    .map(tokenMove)
    .filter(
      (m) =>
        m?.kind === "transfer" &&
        (kind === "buy"
          ? m.source === ctx.vault && m.destination === userToken
          : m.source === userToken && m.destination === ctx.vault),
    );
  if (tokens.length !== 1) giveUp(`a ${kind} without exactly one token transfer`);
  const moved = tokens[0]!.amount;
  const base = {
    name: "TradeEvent" as const,
    mint: ctx.mint,
    trader: user,
    timestamp,
    rewardModel: ctx.fees.rewardModel,
  };
  const reserves = (s: CurveState) => ({
    virtualSolReserves: s.virtualSolReserves,
    virtualTokenReserves: s.virtualTokenReserves,
    realSolReserves: s.realSolReserves,
    realTokenReserves: s.realTokenReserves,
  });

  if (kind === "buy") {
    const paid = below
      .map(systemLamportMove)
      .filter((m) => m && m.from === user && m.to === ctx.curve);
    if (paid.length !== 1) giveUp("a buy without exactly one SOL transfer to the curve");
    const q = quoteBuyV1(state, amount, ctx.fees, minOut);
    // the proof: the maths, from the chained reserves and the token's own fee terms, must give
    // exactly the lamports and the tokens the instruction really moved
    if (q.solIn !== paid[0]!.lamports || q.tokensOut !== moved)
      giveUp("the curve maths does not reproduce the transfers of a buy");
    const trade: DeepEvent = {
      ...base,
      isBuy: true,
      solAmount: q.solIn,
      tokenAmount: q.tokensOut,
      protocolFee: q.routing.protocol,
      creatorFee: q.routing.creator,
      ...reserves(q.next),
      holderFee: q.routing.holder,
    };
    return {
      events: q.next.complete
        ? [
            trade,
            { name: "CurveCompleted", mint: ctx.mint, realSolReserves: q.next.realSolReserves },
          ]
        : [trade],
      next: q.next,
      debit: 0n,
      tokens: -q.tokensOut,
    };
  }

  if (moved !== amount) giveUp("a sell's token transfer is not the amount it asked to sell");
  const q = quoteSellV1(state, amount, ctx.fees, minOut);
  return {
    events: [
      {
        ...base,
        isBuy: false,
        solAmount: q.solOut,
        tokenAmount: amount,
        protocolFee: q.routing.protocol,
        creatorFee: q.routing.creator,
        ...reserves(q.next),
        holderFee: q.routing.holder,
      },
    ],
    next: q.next,
    // paid by moving the curve account's lamports directly: proved by the balance check
    debit: q.solOut,
    tokens: amount,
  };
}

/** `create_token`: its `TokenCreated`, and whether a launch fee (`LaunchFeeCharged`) was charged. */
function rebuildCreate(ctx: CurveCtx, frame: TxFrame, frames: TxFrame[]): FrameEvents {
  const below =
    frameDescendants(frames, frame) ??
    giveUp("the node did not report the call tree (stack heights) of this transaction");
  const creator = frame.accounts[0] ?? giveUp("an instruction is missing accounts");
  const d = frame.data;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let o = 8;
  const str = () => {
    if (d.length < o + 4) giveUp("create_token arguments are cut short");
    const len = view.getUint32(o, true);
    o += 4;
    if (len > 1024 || d.length < o + len) giveUp("create_token arguments are cut short");
    const s = new TextDecoder("utf-8", { fatal: true }).decode(d.slice(o, o + len));
    o += len;
    return s;
  };
  const tokenName = str();
  const symbol = str();
  const uri = str();
  // appended by the V1 program; an older create_token ends after the three strings
  const v1 = d.length >= o + 3;
  const rewardModel = v1 ? d[o]! : undefined;
  const rewardBps = v1 ? view.getUint16(o + 1, true) : undefined;

  const minted = below
    .map(tokenMove)
    .filter((m) => m?.kind === "mint" && m.destination === ctx.vault)
    .reduce((n, m) => n + m!.amount, 0n);
  const a = ctx.account;
  // the account the instruction created must be the one on chain now, with the same terms
  if (
    a.creator.toBase58() !== creator ||
    a.state.tokenTotalSupply !== minted ||
    (rewardBps !== undefined && a.creatorFeeBps !== rewardBps) ||
    (rewardModel !== undefined && a.rewardModel !== rewardModel)
  )
    giveUp("create_token does not match the curve account on chain");

  // The launch fee is a SOL transfer from the creator to the curve AFTER the curve account
  // exists (its creation is a transfer too when the address was pre-funded).
  let exists = false;
  let launchFees = 0;
  for (const f of below) {
    if (f.programId !== SYSTEM_PROGRAM_ADDRESS) continue;
    const tag =
      f.data.length >= 4 ? new DataView(f.data.buffer, f.data.byteOffset).getUint32(0, true) : -1;
    if ((tag === 0 && f.accounts[1] === ctx.curve) || (tag === 1 && f.accounts[0] === ctx.curve))
      exists = true;
    else if (tag === 2 && exists && f.accounts[0] === creator && f.accounts[1] === ctx.curve)
      launchFees++;
  }
  if (!exists || launchFees > 1) giveUp("create_token's transfers are not the ones expected");
  return {
    d: [
      {
        name: "TokenCreated",
        mint: ctx.mint,
        creator,
        tokenName,
        symbol,
        uri,
        curveSupply: a.state.curveSupply,
        tokenTotalSupply: minted,
        ...(rewardModel !== undefined ? { rewardModel } : {}),
        ...(rewardBps !== undefined ? { rewardBps } : {}),
      },
    ],
    f: launchFees ? [{ name: "LaunchFeeCharged", event: null }] : [],
  };
}

/** Lamports a program credited to `address` directly: its balance change beyond every System transfer. */
function directCredit(tx: RpcTransaction, frames: TxFrame[], address: string): bigint {
  const bal = lamportBalances(tx, address) ?? giveUp("the node recorded no balances");
  return bal.post - bal.pre - systemNetLamports(frames, address);
}

/**
 * `graduate`: `Graduated`, and the two sweeps it emits (`ProtocolFeesSwept`,
 * `HolderFeesSwept`). The pool's two seed amounts are the arguments of the pool-creating CPI;
 * the SOL raised is what left the curve account beyond the two sweeps, and it is proved by
 * running the program's own allocation on it: seed SOL, seed tokens and burn must come out
 * exactly as they are on chain.
 */
function rebuildGraduate(
  ctx: CurveCtx,
  frame: TxFrame,
  frames: TxFrame[],
  programFrames: TxFrame[],
  tx: RpcTransaction,
  timestamp: bigint,
  programId: PublicKey,
): FrameEvents & { debit: bigint; tokens: bigint } {
  const below =
    frameDescendants(frames, frame) ??
    giveUp("the node did not report the call tree (stack heights) of this transaction");
  const A = frame.accounts.slice(graduateOffset(frame, programId));
  if (A.length < 21) giveUp("an instruction is missing accounts");
  const [feeVault, recipient, wsolMint, pool, amm] = [A[1]!, A[5]!, A[8]!, A[11]!, A[20]!];
  if (feeVault !== feeVaultPda(programId).toBase58())
    giveUp("a graduation's fee account is not the program's fee vault");
  const a = ctx.account;
  if (!a.graduated || a.pool.toBase58() !== pool)
    giveUp("the curve account on chain does not show this graduation");

  const inits = below.filter(
    (f) => f.programId === amm && INIT_WITH_PERMISSION.some((disc) => startsWith(f.data, disc)),
  );
  if (inits.length !== 1) giveUp("a graduation without exactly one pool creation");
  const init = inits[0]!;
  const [amount0, amount1] = [u64At(init.data, 8), u64At(init.data, 16)];
  const [lpSol, lpTokens] = init.accounts[5] === wsolMint ? [amount0, amount1] : [amount1, amount0];
  const out = below.map(tokenMove).filter((m) => m?.source === ctx.vault);
  const burned = out.filter((m) => m!.kind === "burn").reduce((n, m) => n + m!.amount, 0n);
  const seeded = out.filter((m) => m!.kind === "transfer").reduce((n, m) => n + m!.amount, 0n);
  if (seeded !== lpTokens) giveUp("a graduation's token transfer is not the pool's seed amount");

  // Both sweeps are direct lamport credits. They can be read off the receiving account only
  // when no other instruction of the program touches it in this transaction.
  const alone = (address: string) =>
    programFrames.every((f) => f === frame || !f.accounts.includes(address)) ||
    giveUp("another instruction of this transaction moves the same fee account");
  alone(feeVault);
  const swept = directCredit(tx, frames, feeVault);
  let held = 0n;
  if (ctx.fees.rewardModel === REWARD_MODEL.Holder && recipient !== feeVault) {
    alone(recipient);
    held = directCredit(tx, frames, recipient);
  }
  if (swept < 0n || held < 0n) giveUp("a fee account lost lamports in a graduation");

  const bal = lamportBalances(tx, ctx.curve) ?? giveUp("the node recorded no balances");
  const raised =
    systemNetLamports(frames, ctx.curve) - (bal.post - bal.pre) - ctx.debits - swept - held;
  if (raised <= 0n) giveUp("the SOL a graduation moved cannot be told from the balances");
  if (ctx.state && ctx.trusted && (ctx.state.realSolReserves !== raised || !ctx.state.complete))
    giveUp("the SOL a graduation moved is not the curve's reserves");
  const alloc = graduationAllocation(
    { ...a.state, realSolReserves: raised, realTokenReserves: 0n, complete: true },
    BigInt(a.migrationFeeBps),
  );
  if (alloc.lpSol !== lpSol || alloc.lpTokens !== lpTokens || alloc.burnTokens !== burned)
    giveUp("the graduation maths does not reproduce the pool's seed amounts and the burn");

  return {
    d: [
      {
        name: "Graduated",
        mint: ctx.mint,
        lpSol,
        lpTokens,
        burnedTokens: burned,
        migrationFee: alloc.migrationFee,
        timestamp,
      },
    ],
    f: [
      ...(swept > 0n
        ? [
            {
              name: "ProtocolFeesSwept" as const,
              event: { name: "ProtocolFeesSwept" as const, mint: ctx.mint, amount: swept },
            },
          ]
        : []),
      ...(held > 0n
        ? [
            {
              name: "HolderFeesSwept" as const,
              event: {
                name: "HolderFeesSwept" as const,
                mint: ctx.mint,
                holderVault: recipient,
                amount: held,
              },
            },
          ]
        : []),
    ],
    debit: raised + swept + held,
    tokens: -(lpTokens + burned),
  };
}

/** What a fully logged instruction did to its curve: state, direct lamports out, vault tokens. */
function applyLogged(
  ctx: CurveCtx,
  kind: string,
  frame: TxFrame,
  frames: TxFrame[],
  logged: { d: DeepEvent[]; f: FeeEvent[] },
  checks: string[],
): void {
  const first = logged.d[0];
  const feeSum = (name: FeeEvent["name"]) =>
    logged.f.reduce((n, e) => (e.name === name && "amount" in e ? n + e.amount : n), 0n);
  if (kind === "buy" || kind === "sell") {
    if (first?.name !== "TradeEvent" || first.mint !== ctx.mint)
      return giveUp("a logged trade has no TradeEvent");
    if (ctx.state) {
      // the events the log does show must come out of the same reconstruction bit for bit
      let ok = false;
      try {
        const again = rebuildTrade(ctx, kind, frame, frames, ctx.state, first.timestamp);
        ok =
          again.events.length === logged.d.length &&
          again.events.every((e, i) => sameEvent(normalise(e, logged.d[i]!), logged.d[i]!));
      } catch (e) {
        if (!(e instanceof Unreadable) && !(e instanceof CurveMathError)) throw e;
      }
      if (ok) checks.push(`a logged ${kind} is reproduced exactly`);
      else if (ctx.trusted) giveUp("a logged trade is not reproduced by the reconstruction");
    }
    ctx.state = stateAfter(ctx, first);
    ctx.trusted = true;
    if (first.isBuy) ctx.tokenFlow -= first.tokenAmount;
    else {
      ctx.tokenFlow += first.tokenAmount;
      ctx.debits += first.solAmount;
    }
    return;
  }
  if (kind === "create_token") {
    if (first?.name !== "TokenCreated") return giveUp("a logged launch has no TokenCreated");
    ctx.createdHere = true;
    ctx.state = null;
    ctx.tokenFlow += first.tokenTotalSupply;
    return;
  }
  if (kind === "graduate") {
    if (first?.name !== "Graduated") return giveUp("a logged graduation has no Graduated");
    ctx.debits +=
      first.lpSol + first.migrationFee + feeSum("ProtocolFeesSwept") + feeSum("HolderFeesSwept");
    ctx.tokenFlow -= first.lpTokens + first.burnedTokens;
    ctx.state = null;
    return;
  }
  if (kind === "claim_creator_fees") {
    if (first?.name !== "CreatorFeesClaimed") return giveUp("a logged claim has no event");
    ctx.debits += first.amount;
  } else if (kind === "sweep_protocol_fees") ctx.debits += feeSum("ProtocolFeesSwept");
  else if (kind === "sweep_holder_fees") ctx.debits += feeSum("HolderFeesSwept");
}

/** An event rebuilt by today's program layout, cut down to the fields an older log event has. */
function normalise(rebuilt: DeepEvent, logged: DeepEvent): DeepEvent {
  if (
    rebuilt.name === "TradeEvent" &&
    logged.name === "TradeEvent" &&
    logged.rewardModel === undefined
  )
    return { ...rebuilt, rewardModel: undefined };
  return rebuilt;
}

async function readCurve(
  tx: RpcTransaction,
  signature: string,
  reader: ChainReader,
  programId: PublicKey,
  depth: number,
): Promise<CurveTxRead> {
  const logs = tx.meta?.logMessages ?? [];
  const fromLogs = (lines: readonly string[], truncated: boolean): CurveTxRead => ({
    status: "complete",
    truncated,
    events: parseEventsFromLogs(lines, programId),
    feeEvents: parseFeeEventsFromLogs(lines, programId).map((event, index) => ({
      index,
      name: event.name,
      event,
    })),
  });
  if (!logsTruncated(logs)) return fromLogs(logs, false);
  try {
    if (depth > MAX_DEPTH) giveUp("too many truncated transactions in a row");
    const pid = programId.toBase58();
    const frames = txFrames(tx);
    const mine = frames.filter((f) => f.programId === pid);
    const logged = loggedInvocations(logs, pid);
    align(logged, mine);
    // every invocation finished before the marker: nothing of this program is missing
    if (mine.every((_, i) => logged[i]?.complete))
      return fromLogs(logsBeforeTruncation(logs), true);

    const kinds = mine.map((f) => kindOf(CURVE_KINDS, f));
    const decoded = mine.map((_, i) => ({
      d: (logged[i]?.payloads ?? []).flatMap((p) => safeDecode(decodeEvent, p) ?? []),
      f: (logged[i]?.payloads ?? []).flatMap((p) => safeDecode(decodeFeeEvent, p) ?? []),
    }));
    for (const [i, inv] of logged.entries()) {
      const fixed = FIXED_EVENTS[kinds[i] ?? ""];
      if (fixed && decoded[i]!.d.length === fixed[0] && decoded[i]!.f.length === fixed[1])
        inv.complete = true;
    }

    const offsets = mine.map((f, i) =>
      kinds[i] === "graduate" ? graduateOffset(f, programId) : 0,
    );
    // the curves whose events have to be rebuilt, with their account as it is on chain now
    const ctxs = new Map<string, CurveCtx>();
    for (const [i, f] of mine.entries()) {
      if (logged[i]?.complete) continue;
      const kind = kinds[i];
      if (!kind || !REBUILDABLE.has(kind))
        giveUp(`the events of \`${kind ?? "an unknown instruction"}\` cannot be rebuilt`);
      const o = offsets[i]!;
      const [mint, curve, vault] = [f.accounts[2 + o], f.accounts[3 + o], f.accounts[4 + o]];
      if (!mint || !curve || !vault) return giveUp("an instruction is missing accounts");
      if (ctxs.has(curve)) continue;
      if (curvePda(new PublicKey(mint), programId).toBase58() !== curve)
        giveUp("an instruction's curve account is not its mint's curve");
      const acc = await reader.account(curve);
      if (!acc || acc.owner !== pid) return giveUp("the curve account is not available");
      const account = decodeBondingCurve(acc.data);
      if (account.mint.toBase58() !== mint) giveUp("the curve account is not this mint's");
      ctxs.set(curve, {
        curve,
        mint,
        vault,
        account,
        fees: curveFees(account),
        state: null,
        trusted: false,
        createdHere: false,
        debits: 0n,
        tokenFlow: 0n,
      });
    }

    const firstLogged = decoded
      .flatMap((x) => x.d)
      .find((e) => e.name === "TradeEvent" || e.name === "Graduated");
    const blockTime = tx.blockTime;
    // The programs stamp events with the cluster clock. An event the log does show gives it
    // exactly; the block's time is the same value or one second more (see `timestampSource`).
    const timestamp =
      firstLogged && "timestamp" in firstLogged
        ? firstLogged.timestamp
        : typeof blockTime === "number"
          ? BigInt(blockTime)
          : giveUp("the node has no block time for this transaction yet");

    const checks: string[] = [];
    const events: CurveTxEvent[] = [];
    const feeEvents: CurveTxFeeEvent[] = [];
    for (const [i, frame] of mine.entries()) {
      const kind = kinds[i] ?? "";
      const ctx = ctxs.get(frame.accounts[(CURVE_ACCOUNT_AT[kind] ?? -1) + offsets[i]!] ?? "");
      const seen = decoded[i]!;
      if (logged[i]?.complete) {
        if (ctx) applyLogged(ctx, kind, frame, frames, seen, checks);
        for (const event of seen.d) events.push({ index: events.length, event });
        for (const event of seen.f)
          feeEvents.push({ index: feeEvents.length, name: event.name, event });
        continue;
      }
      if (!ctx) return giveUp("an instruction's curve is not known");

      let rebuilt: FrameEvents;
      if (kind === "buy" || kind === "sell") {
        if (!ctx.state) {
          if (ctx.createdHere) {
            ctx.state = await launchState(ctx, reader, programId);
            ctx.trusted = false;
          } else {
            const s = await earlierState(ctx, signature, reader, programId, depth);
            ctx.state = s.state;
            ctx.trusted = s.trusted;
          }
        }
        // a sell proves nothing about the reserves it starts from: they must be known for sure
        if (kind === "sell" && !ctx.trusted)
          giveUp("a sell cannot be rebuilt from reserves that are only assumed");
        const t = rebuildTrade(ctx, kind, frame, frames, ctx.state, timestamp);
        ctx.state = t.next;
        ctx.trusted = true;
        ctx.debits += t.debit;
        ctx.tokenFlow += t.tokens;
        rebuilt = { d: t.events, f: [] };
        if (kind === "buy")
          checks.push("the curve maths reproduces a rebuilt buy's SOL and token transfers");
      } else if (kind === "create_token") {
        rebuilt = rebuildCreate(ctx, frame, frames);
        ctx.createdHere = true;
        ctx.state = null;
        ctx.tokenFlow += ctx.account.state.tokenTotalSupply;
      } else {
        // The SOL a graduation moves must be the reserves the curve's last trade left. When
        // this transaction does not show that trade, an earlier one does (if it can be found:
        // the allocation proof below stands on its own).
        if (!ctx.state && !ctx.createdHere && reader.previousTransaction) {
          try {
            const s = await earlierState(ctx, signature, reader, programId, depth);
            if (s.trusted) [ctx.state, ctx.trusted] = [s.state, true];
          } catch (e) {
            if (!(e instanceof Unreadable)) throw e;
          }
        }
        const proved = ctx.state !== null && ctx.trusted;
        const g = rebuildGraduate(ctx, frame, frames, mine, tx, timestamp, programId);
        ctx.debits += g.debit;
        ctx.tokenFlow += g.tokens;
        ctx.state = null;
        rebuilt = g;
        checks.push("the graduation maths reproduces the pool's seed amounts and the burn");
        if (proved) checks.push("the SOL a graduation moved is the reserves its last trade left");
      }

      // what the log does show of this instruction stays authoritative, and must agree
      if (seen.d.length > rebuilt.d.length || seen.f.length > rebuilt.f.length)
        giveUp("the log shows more events than the instruction emits");
      rebuilt.d.forEach((event, j) => {
        const inLog = seen.d[j];
        if (inLog && !sameEvent(normalise(event, inLog), inLog))
          giveUp("a logged event differs from its reconstruction");
        events.push(
          inLog
            ? { index: events.length, event: inLog }
            : { index: events.length, event, reconstructed: true },
        );
      });
      rebuilt.f.forEach((fe, j) => {
        const inLog = seen.f[j];
        if (inLog && inLog.name !== fe.name)
          giveUp("a logged event differs from its reconstruction");
        feeEvents.push(
          inLog
            ? { index: feeEvents.length, name: inLog.name, event: inLog }
            : { index: feeEvents.length, name: fe.name, event: fe.event, reconstructed: true },
        );
      });
    }

    // The balance proofs. Every lamport the curve account gained or lost is either a System
    // transfer (an instruction) or a direct debit an event stands for; every token the vault
    // gained or lost belongs to an event.
    for (const ctx of ctxs.values()) {
      const sol = lamportBalances(tx, ctx.curve) ?? giveUp("the node recorded no balances");
      if (sol.post - sol.pre !== systemNetLamports(frames, ctx.curve) - ctx.debits)
        giveUp("the events do not add up to the curve account's SOL balance change");
      const tok = tokenBalances(tx, ctx.vault) ?? giveUp("the node recorded no token balances");
      if (tok.post - tok.pre !== ctx.tokenFlow)
        giveUp("the events do not add up to the curve vault's token balance change");
      checks.push(
        "the events add up to the curve account's SOL and the vault's token balance change",
      );
    }
    const stamped = events.some((e) => e.reconstructed && "timestamp" in e.event);
    return {
      status: "reconstructed",
      truncated: true,
      events,
      feeEvents,
      checks: [...new Set(checks)],
      ...(stamped ? { timestampSource: firstLogged ? "event" : "blockTime" } : {}),
    };
  } catch (e) {
    if (e instanceof Unreadable || e instanceof CurveMathError)
      return {
        status: "unreadable",
        truncated: true,
        events: [],
        feeEvents: [],
        reason: e.message,
      };
    throw e;
  }
}

/**
 * The deep-curve events of one confirmed, successful transaction, complete even when its log
 * was truncated (see the top of this file). `signature` is the transaction's own signature;
 * `reader` is asked only when the log was truncated.
 *
 * Rebuilt today: `TradeEvent` (buy and sell), `CurveCompleted`, `TokenCreated`, `Graduated`
 * with its `ProtocolFeesSwept` / `HolderFeesSwept`, and the presence of `LaunchFeeCharged`.
 * A truncated transaction that lost the event of any other instruction is `unreadable`.
 */
export function readCurveTransaction(
  tx: RpcTransaction,
  signature: string,
  reader: ChainReader,
  programId: PublicKey = DEEP_CURVE_PROGRAM_ID,
): Promise<CurveTxRead> {
  return readCurve(tx, signature, reader, programId, 0);
}

// ───────────────────────── DeepSwap (deep-amm) ─────────────────────────

const AMM_KINDS = kindTable([
  "swap_base_input",
  "swap_base_output",
  "deposit",
  "withdraw",
  "initialize",
  "initialize_v1",
  "initialize_with_permission",
  "initialize_with_permission_v1",
]);
const isSwap = (kind: string | null) => kind === "swap_base_input" || kind === "swap_base_output";
/** Instructions that change a pool's balances but not its accrued, uncollected fees. */
const FEE_NEUTRAL = new Set(["deposit", "withdraw"]);
const POOL_CREATED_AT: Record<string, number> = {
  initialize: 3,
  initialize_v1: 3,
  initialize_with_permission: 4,
  initialize_with_permission_v1: 4,
};

/** A token account's balance at any point of the transaction, from the instructions that moved it. */
function tokenTimeline(tx: RpcTransaction, frames: TxFrame[], account: string) {
  const bal = tokenBalances(tx, account) ?? giveUp("the node recorded no token balances");
  const moves: { at: number; delta: bigint }[] = [];
  for (const f of frames) {
    if (tokenBalanceOpaque(f, account))
      giveUp("a vault's balance changed in a way its instructions do not show");
    const m = tokenMove(f);
    if (!m) continue;
    if (m.destination === account) moves.push({ at: f.index, delta: m.amount });
    if (m.source === account) moves.push({ at: f.index, delta: -m.amount });
  }
  // the instruction view is complete only if it lands on the recorded balance
  if (bal.pre + moves.reduce((n, m) => n + m.delta, 0n) !== bal.post)
    giveUp("a vault's token transfers do not add up to its balance change");
  return (beforeFrame: number) =>
    moves.reduce((n, m) => (m.at < beforeFrame ? n + m.delta : n), bal.pre);
}

interface PoolCtx {
  address: string;
  pool: CpmmPoolState;
  config: CpmmAmmConfig;
  vault0: (beforeFrame: number) => bigint;
  vault1: (beforeFrame: number) => bigint;
  /** Accrued, uncollected fees per side at this point of the transaction; null: not known yet. */
  accrued: Pair | null;
  /** While `accrued` is not known: what fee collections of this transaction took out so far. */
  collected: Pair;
  /** A swap of this transaction changed the fees in a way its event does not show. */
  broken: boolean;
}

type Pair = [bigint, bigint];
const add = (a: Pair, b: Pair): Pair => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pair, b: Pair): Pair => {
  const out: Pair = [a[0] - b[0], a[1] - b[1]];
  return out[0] < 0n || out[1] < 0n
    ? giveUp("a pool's fee collections exceed the fees its swaps accrued")
    : out;
};

/**
 * What an instruction took out of a pool's two vaults. For an instruction that is neither a
 * swap nor a withdrawal that is a fee collection: the accrued fees fall by exactly this.
 */
function vaultOutflows(frame: TxFrame, frames: TxFrame[], pool: CpmmPoolState): Pair {
  const below =
    frameDescendants(frames, frame) ??
    giveUp("the node did not report the call tree (stack heights) of this transaction");
  const out: Pair = [0n, 0n];
  for (const m of below.map(tokenMove)) {
    if (m?.kind !== "transfer") continue;
    if (m.source === pool.token0Vault.toBase58()) out[0] += m.amount;
    if (m.source === pool.token1Vault.toBase58()) out[1] += m.amount;
  }
  return out;
}

interface AmmItem {
  frame: TxFrame;
  swap: AmmTxSwap;
}

interface AmmInternal extends AmmTxRead {
  frames: TxFrame[];
  mine: TxFrame[];
  items: AmmItem[];
}

/** Events of one logged invocation: a swap, with the `SwapFeesV1` that directly follows it. */
function loggedSwap(inv: LoggedInvocation | undefined): {
  event: AmmSwapEventRaw;
  feesV1?: AmmSwapFeesV1Raw;
} | null {
  let out: { event: AmmSwapEventRaw; feesV1?: AmmSwapFeesV1Raw } | null = null;
  let waiting = false;
  for (const p of inv?.payloads ?? []) {
    const ev = safeDecode(decodeAmmSwapEvent, p);
    if (ev) {
      if (out) giveUp("one instruction logged two swaps");
      out = { event: ev };
      waiting = true;
      continue;
    }
    const fees = waiting ? safeDecode(decodeAmmSwapFeesV1, p) : null;
    if (out && fees && swapFeesV1Match(out.event, fees)) out.feesV1 = fees;
    waiting = false;
  }
  return out;
}

/** The pool's accrued fees right after `item`, from its event and the vaults' balances then. */
function accruedAfter(
  item: AmmItem,
  pool: CpmmPoolState,
  vault0: (b: number) => bigint,
  vault1: (b: number) => bigint,
): [bigint, bigint] | null {
  const { event, feesV1 } = item.swap;
  if (!feesV1) return null;
  const after = swapReservesAfter(event, { protocolFeeRate: 0n, fundFeeRate: 0n }, feesV1);
  if (!after) return null;
  const zeroForOne = event.inputMint.equals(pool.token0Mint);
  const [r0, r1] = zeroForOne ? after : [after[1], after[0]];
  const a: [bigint, bigint] = [vault0(item.frame.end) - r0, vault1(item.frame.end) - r1];
  return a[0] < 0n || a[1] < 0n ? null : a;
}

/** The pool's accrued fees before `signature`, from the last swap an earlier transaction shows. */
async function earlierAccrued(
  ctx: PoolCtx,
  signature: string,
  reader: ChainReader,
  programId: PublicKey,
  depth: number,
): Promise<[bigint, bigint]> {
  if (!reader.previousTransaction)
    return giveUp(
      "the pool's state before this transaction is needed, and no history reader was given",
    );
  let before = signature;
  // fee collections met on the way back: they came after the swap that is being looked for
  let collected: Pair = [0n, 0n];
  for (let n = 0; n < MAX_HISTORY; n++) {
    const prev = await reader.previousTransaction(ctx.address, before);
    if (!prev) break;
    before = prev.signature;
    const read = await readAmm(prev.tx, prev.signature, reader, programId, depth + 1, true);
    if (read.status === "unreadable")
      return giveUp(`an earlier transaction of this pool cannot be read (${read.reason})`);
    const touching = read.mine.filter((f) => f.accounts.includes(ctx.address)).reverse();
    for (const f of touching) {
      const kind = kindOf(AMM_KINDS, f);
      if (isSwap(kind)) {
        const item = read.items.find((x) => x.frame === f);
        const a =
          item &&
          accruedAfter(
            item,
            ctx.pool,
            tokenTimeline(prev.tx, read.frames, ctx.pool.token0Vault.toBase58()),
            tokenTimeline(prev.tx, read.frames, ctx.pool.token1Vault.toBase58()),
          );
        return sub(a ?? giveUp("the pool's last swap does not show its accrued fees"), collected);
      }
      if (kind && f.accounts[POOL_CREATED_AT[kind] ?? -1] === ctx.address)
        return sub([0n, 0n], collected);
      if (!kind || !FEE_NEUTRAL.has(kind))
        collected = add(collected, vaultOutflows(f, read.frames, ctx.pool));
    }
  }
  return giveUp("the pool's earlier state was not found in its recent transactions");
}

/** One swap rebuilt from its instruction, its two transfers and the pool maths. */
function rebuildSwap(
  ctx: PoolCtx,
  kind: string,
  frame: TxFrame,
  frames: TxFrame[],
  accrued: [bigint, bigint],
): { event: AmmSwapEventRaw; feesV1: AmmSwapFeesV1Raw; accrued: [bigint, bigint] } {
  const below =
    frameDescendants(frames, frame) ??
    giveUp("the node did not report the call tree (stack heights) of this transaction");
  const A = frame.accounts;
  if (A.length < 12) giveUp("an instruction is missing accounts");
  const [inAccount, outAccount, inVault, outVault, inMint, outMint] = [
    A[4]!,
    A[5]!,
    A[6]!,
    A[7]!,
    new PublicKey(A[10]!),
    new PublicKey(A[11]!),
  ];
  const { pool, config } = ctx;
  const zeroForOne = inVault === pool.token0Vault.toBase58();
  const [vIn, vOut, mIn, mOut] = zeroForOne
    ? [pool.token0Vault, pool.token1Vault, pool.token0Mint, pool.token1Mint]
    : [pool.token1Vault, pool.token0Vault, pool.token1Mint, pool.token0Mint];
  if (
    vIn.toBase58() !== inVault ||
    vOut.toBase58() !== outVault ||
    !mIn.equals(inMint) ||
    !mOut.equals(outMint)
  )
    giveUp("a swap's accounts are not its pool's vaults and mints");

  const moves = below.map(tokenMove).filter((m) => m?.kind === "transfer");
  const paid = moves.filter((m) => m!.source === inAccount && m!.destination === inVault);
  const got = moves.filter((m) => m!.source === outVault && m!.destination === outAccount);
  if (paid.length !== 1 || got.length !== 1) giveUp("a swap without exactly two token transfers");
  const [amountIn, amountOut] = [paid[0]!.amount, got[0]!.amount];

  const [r0, r1] = [ctx.vault0(frame.index) - accrued[0], ctx.vault1(frame.index) - accrued[1]];
  const [reserveIn, reserveOut] = zeroForOne ? [r0, r1] : [r1, r0];
  if (reserveIn <= 0n || reserveOut <= 0n) giveUp("the pool's reserves cannot be told");
  const isBuy = cpmmDirection(pool, inMint).creatorFeeOnInput;
  const rates = deepSwapV1Rates(config, pool, isBuy);
  const baseInput = kind === "swap_base_input";
  const q = baseInput
    ? quoteV1ExactIn({ amountIn: u64At(frame.data, 8), reserveIn, reserveOut, rates, isBuy })
    : quoteV1ExactOut({ amountOut: u64At(frame.data, 16), reserveIn, reserveOut, rates, isBuy });
  // the proof: the pool maths, from the chained reserves and the pool's own rates, must give
  // exactly the two amounts the instruction really moved
  if (q.amountIn !== amountIn || q.amountOut !== amountOut)
    giveUp("the pool maths does not reproduce the transfers of a swap");

  const poolId = new PublicKey(ctx.address);
  const quoteIs0 = isBuy === zeroForOne;
  const next: [bigint, bigint] = [...accrued];
  next[quoteIs0 ? 0 : 1] += q.protocolFee + q.rewardFee;
  return {
    event: {
      poolId,
      inputVaultBefore: reserveIn,
      outputVaultBefore: reserveOut,
      inputAmount: amountIn,
      outputAmount: amountOut,
      inputTransferFee: 0n,
      outputTransferFee: 0n,
      baseInput,
      inputMint: inMint,
      outputMint: outMint,
      tradeFee: q.lpFee + q.protocolFee,
      creatorFee: q.rewardFee,
      creatorFeeOnInput: isBuy,
    },
    feesV1: {
      poolId,
      isBuy,
      quoteMint: isBuy ? inMint : outMint,
      lpFee: q.lpFee,
      protocolFee: q.protocolFee,
      rewardFee: q.rewardFee,
      rewardModel: pool.rewardModel,
    },
    accrued: next,
  };
}

async function loadPool(
  address: string,
  tx: RpcTransaction,
  frames: TxFrame[],
  reader: ChainReader,
  pid: string,
): Promise<PoolCtx> {
  const acc = await reader.account(address);
  if (!acc || acc.owner !== pid) return giveUp("the pool account is not available");
  const pool = decodeCpmmPoolState(acc.data);
  const cfg = await reader.account(pool.ammConfig.toBase58());
  if (!cfg || cfg.owner !== pid) return giveUp("the pool's AmmConfig is not available");
  const config = decodeCpmmAmmConfig(cfg.data);
  if (cpmmFeeModel(config, pool) !== DEEP_AMM_FEE_MODEL.v1)
    giveUp("the swap of a legacy pool cannot be rebuilt");
  // a Token-2022 transfer fee changes what reaches the vault: not rebuilt
  for (const [mint, program] of [
    [pool.token0Mint, pool.token0Program],
    [pool.token1Mint, pool.token1Program],
  ] as const) {
    if (program.toBase58() === SPL_TOKEN_PROGRAM_ADDRESS) continue;
    const m = await reader.account(mint.toBase58());
    if (!m) return giveUp("a pool mint is not available");
    const facts = decodeMintFacts(mint, { data: m.data, owner: new PublicKey(m.owner) }, 0n);
    if (facts.extensions.includes("TransferFeeConfig"))
      giveUp("the swap of a token with a transfer fee cannot be rebuilt");
  }
  return {
    address,
    pool,
    config,
    vault0: tokenTimeline(tx, frames, pool.token0Vault.toBase58()),
    vault1: tokenTimeline(tx, frames, pool.token1Vault.toBase58()),
    accrued: null,
    collected: [0n, 0n],
    broken: false,
  };
}

async function readAmm(
  tx: RpcTransaction,
  signature: string,
  reader: ChainReader,
  programId: PublicKey,
  depth: number,
  withFrames: boolean,
): Promise<AmmInternal> {
  const logs = tx.meta?.logMessages ?? [];
  const truncated = logsTruncated(logs);
  const none = { frames: [], mine: [], items: [] };
  if (!truncated && !withFrames)
    return {
      status: "complete",
      truncated,
      swaps: parseAmmSwapEventsWithSource(logs, programId),
      ...none,
    };
  try {
    if (depth > MAX_DEPTH) giveUp("too many truncated transactions in a row");
    const pid = programId.toBase58();
    const frames = txFrames(tx);
    const mine = frames.filter((f) => f.programId === pid);
    const logged = loggedInvocations(logs, pid);
    align(logged, mine);
    const kinds = mine.map((f) => kindOf(AMM_KINDS, f));
    // the position of a CPI among the program's inner instructions of its top-level one
    const source = (f: TxFrame) => ({
      topLevel: f.top,
      cpi:
        f.depth === 1
          ? null
          : mine.filter((x) => x.top === f.top && x.depth !== 1 && x.index < f.index).length,
    });

    const pending = mine.filter((_, i) => isSwap(kinds[i] ?? null) && !logged[i]?.complete);
    // every swap finished before the marker: nothing of this program is missing
    if (pending.length === 0 && !withFrames)
      return {
        status: "complete",
        truncated,
        swaps: parseAmmSwapEventsWithSource(logsBeforeTruncation(logs), programId),
        ...none,
      };
    const ctxs = new Map<string, PoolCtx>();
    for (const f of pending) {
      const address = f.accounts[3] ?? giveUp("an instruction is missing accounts");
      if (!ctxs.has(address)) ctxs.set(address, await loadPool(address, tx, frames, reader, pid));
    }

    const checks: string[] = [];
    const items: AmmItem[] = [];
    for (const [i, frame] of mine.entries()) {
      const kind = kinds[i] ?? null;
      const touched = [...ctxs.values()].filter((c) => frame.accounts.includes(c.address));
      if (!isSwap(kind)) {
        for (const c of touched) {
          if (kind && frame.accounts[POOL_CREATED_AT[kind] ?? -1] === c.address)
            c.accrued = [0n, 0n];
          else if (!kind || !FEE_NEUTRAL.has(kind)) {
            // a fee collection: the accrued fees fall by what it took out of the vaults
            const out = vaultOutflows(frame, frames, c.pool);
            if (c.accrued) c.accrued = sub(c.accrued, out);
            else c.collected = add(c.collected, out);
          }
        }
        continue;
      }
      const ctx = ctxs.get(frame.accounts[3] ?? "");
      const seen = loggedSwap(logged[i]);
      if (logged[i]?.complete) {
        if (!seen) continue; // a swap instruction that logged no SwapEvent: the parsers show none either
        const item = { frame, swap: { ...seen, source: source(frame) } };
        items.push(item);
        if (ctx) {
          ctx.accrued = accruedAfter(item, ctx.pool, ctx.vault0, ctx.vault1);
          ctx.broken = !ctx.accrued;
        }
        continue;
      }
      if (!ctx) return giveUp("an instruction's pool is not known");
      if (!ctx.accrued) {
        if (ctx.broken)
          giveUp("an earlier swap of this transaction does not show the pool's accrued fees");
        ctx.accrued = sub(
          await earlierAccrued(ctx, signature, reader, programId, depth),
          ctx.collected,
        );
      }
      const r = rebuildSwap(ctx, kind!, frame, frames, ctx.accrued);
      ctx.accrued = r.accrued;
      // what the log does show of this swap stays authoritative, and must agree
      if (seen && !sameEvent(seen.event, r.event))
        giveUp("a logged swap differs from its reconstruction");
      checks.push("the pool maths reproduces a rebuilt swap's two token transfers");
      checks.push("the pool vaults' token transfers add up to their balance change");
      items.push({
        frame,
        swap: {
          event: seen?.event ?? r.event,
          feesV1: seen?.feesV1 ?? r.feesV1,
          source: source(frame),
          reconstructed: true,
        },
      });
    }
    const rebuilt = items.some((x) => x.swap.reconstructed);
    return {
      status: rebuilt ? "reconstructed" : "complete",
      truncated,
      swaps: items.map((x) => x.swap),
      ...(rebuilt ? { checks: [...new Set(checks)] } : {}),
      frames,
      mine,
      items,
    };
  } catch (e) {
    if (e instanceof Unreadable || e instanceof CurveMathError)
      return { status: "unreadable", truncated, swaps: [], reason: e.message, ...none };
    throw e;
  }
}

/**
 * The DeepSwap `SwapEvent`s (with their `SwapFeesV1`) of one confirmed, successful
 * transaction, complete even when its log was truncated (see the top of this file).
 * `signature` is the transaction's own signature; `reader` is asked only when the log was
 * truncated.
 *
 * Rebuilt today: swaps of DEEP V1 pools whose two tokens have no Token-2022 transfer fee. A
 * truncated transaction that lost the swap of any other pool is `unreadable`.
 */
export async function readAmmTransaction(
  tx: RpcTransaction,
  signature: string,
  reader: ChainReader,
  programId: PublicKey = DEEP_AMM_PROGRAM_ID,
): Promise<AmmTxRead> {
  const { status, truncated, swaps, reason, checks } = await readAmm(
    tx,
    signature,
    reader,
    programId,
    0,
    false,
  );
  return {
    status,
    truncated,
    swaps,
    ...(reason !== undefined ? { reason } : {}),
    ...(checks ? { checks } : {}),
  };
}
