/**
 * Decoders for deep-curve Anchor events. `emit!` writes
 * `Program data: <base64(discriminator ‖ borsh(event))>` to the transaction logs.
 * Layouts must match the `#[event]` structs in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import { CONFIG_PARAMS_SIZE, readConfigParams, type ConfigParamsData } from "./config.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";

export interface TokenCreatedEvent {
  name: "TokenCreated";
  mint: string;
  creator: string;
  tokenName: string;
  symbol: string;
  uri: string;
  curveSupply: bigint;
  tokenTotalSupply: bigint;
}

export interface TradeEventData {
  name: "TradeEvent";
  mint: string;
  trader: string;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  timestamp: bigint;
}

export interface CurveCompletedEvent {
  name: "CurveCompleted";
  mint: string;
  realSolReserves: bigint;
}

export interface CreatorFeesClaimedEvent {
  name: "CreatorFeesClaimed";
  mint: string;
  creator: string;
  amount: bigint;
}

export interface GraduatedEvent {
  name: "Graduated";
  mint: string;
  lpSol: bigint;
  lpTokens: bigint;
  burnedTokens: bigint;
  migrationFee: bigint;
  timestamp: bigint;
}

export interface PauseChangedEvent {
  name: "PauseChanged";
  paused: boolean;
}

export interface ProtocolFeesWithdrawnEvent {
  name: "ProtocolFeesWithdrawn";
  recipient: string;
  amount: bigint;
}

export interface ConfigUpdateQueuedEvent {
  name: "ConfigUpdateQueued";
  eta: bigint;
  queuedAt: bigint;
  params: ConfigParamsData;
}

export interface ConfigUpdateCancelledEvent {
  name: "ConfigUpdateCancelled";
  eta: bigint;
}

export interface ConfigUpdatedEvent {
  name: "ConfigUpdated";
  admin: string;
}

/**
 * A swap in a token's DeepSwap graduation pool (from deep-amm's SwapEvent, see
 * amm-events.ts). Not emitted by deep-curve: the indexer builds it.
 */
export interface PoolSwapEvent {
  name: "PoolSwap";
  pool: string;
  mint: string;
  /** Transaction fee payer (SwapEvent doesn't carry the trader). */
  trader: string;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  /** In the input token's units. */
  tradeFee: bigint;
  /**
   * The protocol + fund slices of `tradeFee` (input token units) at the pool's AmmConfig
   * rates when the swap was indexed; the rest of the trade fee stays with LPs. Absent on
   * events built before this field existed.
   */
  protocolFee?: bigint;
  /**
   * The creator fee charged ON TOP of `tradeFee` (0 on pools without it). It is neither LP
   * nor protocol trade fee: the pool's creator and the protocol share it when it is
   * collected (AmmConfig.creator_fee_share_rate). In lamports when `creatorFeeInSol`,
   * otherwise in the token's base units. Absent on events built before this field existed.
   */
  creatorFee?: bigint;
  /** Which side `creatorFee` was taken in. Graduation pools always take it in SOL. */
  creatorFeeInSol?: boolean;
  solReservesAfter: bigint;
  tokenReservesAfter: bigint;
  /** unix seconds (block time) */
  timestamp: bigint;
}

export type DeepEvent =
  | PoolSwapEvent
  | TokenCreatedEvent
  | TradeEventData
  | CurveCompletedEvent
  | CreatorFeesClaimedEvent
  | GraduatedEvent
  | PauseChangedEvent
  | ProtocolFeesWithdrawnEvent
  | ConfigUpdateQueuedEvent
  | ConfigUpdateCancelledEvent
  | ConfigUpdatedEvent;

class Reader {
  private o = 0;
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (this.o + n > this.b.length) throw new RangeError("event data truncated");
  }
  pubkey() {
    this.need(32);
    const k = new PublicKey(this.b.slice(this.o, this.o + 32)).toBase58();
    this.o += 32;
    return k;
  }
  u64() {
    this.need(8);
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  }
  i64() {
    this.need(8);
    const x = this.v.getBigInt64(this.o, true);
    this.o += 8;
    return x;
  }
  bool() {
    this.need(1);
    const x = this.b[this.o++];
    if (x !== 0 && x !== 1) throw new RangeError("invalid bool");
    return x === 1;
  }
  params(): ConfigParamsData {
    this.need(CONFIG_PARAMS_SIZE);
    const p = readConfigParams(this.b, this.o);
    this.o += CONFIG_PARAMS_SIZE;
    return p;
  }
  string() {
    this.need(4);
    const len = this.v.getUint32(this.o, true);
    this.o += 4;
    if (len > 1024) throw new RangeError("string too long");
    this.need(len);
    const s = new TextDecoder("utf-8", { fatal: true }).decode(this.b.slice(this.o, this.o + len));
    this.o += len;
    return s;
  }
}

type Decoder = (r: Reader) => DeepEvent;

const DECODERS: Record<string, Decoder> = {
  TokenCreated: (r) => ({
    name: "TokenCreated",
    mint: r.pubkey(),
    creator: r.pubkey(),
    tokenName: r.string(),
    symbol: r.string(),
    uri: r.string(),
    curveSupply: r.u64(),
    tokenTotalSupply: r.u64(),
  }),
  TradeEvent: (r) => ({
    name: "TradeEvent",
    mint: r.pubkey(),
    trader: r.pubkey(),
    isBuy: r.bool(),
    solAmount: r.u64(),
    tokenAmount: r.u64(),
    protocolFee: r.u64(),
    creatorFee: r.u64(),
    virtualSolReserves: r.u64(),
    virtualTokenReserves: r.u64(),
    realSolReserves: r.u64(),
    realTokenReserves: r.u64(),
    timestamp: r.i64(),
  }),
  CurveCompleted: (r) => ({ name: "CurveCompleted", mint: r.pubkey(), realSolReserves: r.u64() }),
  CreatorFeesClaimed: (r) => ({
    name: "CreatorFeesClaimed",
    mint: r.pubkey(),
    creator: r.pubkey(),
    amount: r.u64(),
  }),
  Graduated: (r) => ({
    name: "Graduated",
    mint: r.pubkey(),
    lpSol: r.u64(),
    lpTokens: r.u64(),
    burnedTokens: r.u64(),
    migrationFee: r.u64(),
    timestamp: r.i64(),
  }),
  PauseChanged: (r) => ({ name: "PauseChanged", paused: r.bool() }),
  ConfigUpdated: (r) => ({ name: "ConfigUpdated", admin: r.pubkey() }),
  ConfigUpdateQueued: (r) => ({
    name: "ConfigUpdateQueued",
    eta: r.i64(),
    queuedAt: r.i64(),
    params: r.params(),
  }),
  ConfigUpdateCancelled: (r) => ({ name: "ConfigUpdateCancelled", eta: r.i64() }),
  ProtocolFeesWithdrawn: (r) => ({
    name: "ProtocolFeesWithdrawn",
    recipient: r.pubkey(),
    amount: r.u64(),
  }),
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const BY_DISC = new Map(
  Object.entries(DECODERS).map(([name, dec]) => [hex(discriminator("event", name)), dec]),
);

/** Decode one event payload (discriminator included). Returns null for unknown events. */
export function decodeEvent(data: Uint8Array): DeepEvent | null {
  if (data.length < 8) return null;
  const dec = BY_DISC.get(hex(data.subarray(0, 8)));
  return dec ? dec(new Reader(data.subarray(8))) : null;
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Extract deep-curve events from a transaction's log messages. Tracks the invoke
 * stack so `Program data:` lines emitted by OTHER programs (spoofing) are ignored.
 * `index` is the event's ordinal within the transaction, for idempotent storage.
 */
export function parseEventsFromLogs(
  logs: readonly string[],
  programId: PublicKey = DEEP_CURVE_PROGRAM_ID,
): { index: number; event: DeepEvent }[] {
  const pid = programId.toBase58();
  const stack: string[] = [];
  const out: { index: number; event: DeepEvent }[] = [];
  let index = 0;
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === pid) {
      try {
        const ev = decodeEvent(base64ToBytes(line.slice("Program data: ".length).trim()));
        if (ev) out.push({ index: index++, event: ev });
      } catch {
        // malformed payload from our program id — skip, never crash the indexer
      }
    }
  }
  return out;
}

// ───────────── fee events (not part of DeepEvent) ─────────────
//
// deep-curve also emits LaunchFeeCharged (create_token with a launch fee) and ProtocolFeesSwept
// (sweep_protocol_fees, graduate). They are decoded separately: parseEventsFromLogs numbers the
// DeepEvents of a transaction, and the indexer stores them by (signature, that number), so its
// numbering must not change.

export interface LaunchFeeChargedEvent {
  name: "LaunchFeeCharged";
  mint: string;
  creator: string;
  usdCents: number;
  lamports: bigint;
  /** Pyth SOL/USD price used, fixed point with `exponent`. */
  price: bigint;
  exponent: number;
  /** Pyth publish time, unix seconds. */
  publishTime: bigint;
}

export interface ProtocolFeesSweptEvent {
  name: "ProtocolFeesSwept";
  mint: string;
  amount: bigint;
}

export type FeeEvent = LaunchFeeChargedEvent | ProtocolFeesSweptEvent;

const FEE_DISC = {
  LaunchFeeCharged: hex(discriminator("event", "LaunchFeeCharged")),
  ProtocolFeesSwept: hex(discriminator("event", "ProtocolFeesSwept")),
};

/** Decode a LaunchFeeCharged or ProtocolFeesSwept payload (discriminator included), else null. */
export function decodeFeeEvent(data: Uint8Array): FeeEvent | null {
  if (data.length < 8) return null;
  const d = hex(data.subarray(0, 8));
  const b = data.subarray(8);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pk = (o: number) => new PublicKey(b.slice(o, o + 32)).toBase58();
  if (d === FEE_DISC.LaunchFeeCharged) {
    if (b.length < 32 + 32 + 2 + 8 + 8 + 4 + 8) throw new RangeError("event data truncated");
    return {
      name: "LaunchFeeCharged",
      mint: pk(0),
      creator: pk(32),
      usdCents: v.getUint16(64, true),
      lamports: v.getBigUint64(66, true),
      price: v.getBigInt64(74, true),
      exponent: v.getInt32(82, true),
      publishTime: v.getBigInt64(86, true),
    };
  }
  if (d === FEE_DISC.ProtocolFeesSwept) {
    if (b.length < 40) throw new RangeError("event data truncated");
    return { name: "ProtocolFeesSwept", mint: pk(0), amount: v.getBigUint64(32, true) };
  }
  return null;
}

/** LaunchFeeCharged / ProtocolFeesSwept emitted by `programId` itself (same spoofing rules). */
export function parseFeeEventsFromLogs(
  logs: readonly string[],
  programId: PublicKey = DEEP_CURVE_PROGRAM_ID,
): FeeEvent[] {
  const pid = programId.toBase58();
  const stack: string[] = [];
  const out: FeeEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === pid) {
      try {
        const ev = decodeFeeEvent(base64ToBytes(line.slice("Program data: ".length).trim()));
        if (ev) out.push(ev);
      } catch {
        // malformed payload: skip
      }
    }
  }
  return out;
}
