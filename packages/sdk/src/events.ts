/**
 * Decoders for deep-curve Anchor events. `emit!` writes
 * `Program data: <base64(discriminator ‖ borsh(event))>` to the transaction logs.
 * Layouts must match the `#[event]` structs in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import {
  CONFIG_PARAMS_SIZE,
  CONFIG_PARAMS_V2_SIZE,
  readConfigParams,
  type ConfigParamsData,
} from "./config.js";
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
  /**
   * DEEP V1 (appended): 0 Standard, 1 Creator, 2 Holder. Absent on events emitted before the
   * Phase 2 program (the token's model is then on its curve account).
   */
  rewardModel?: number;
  /**
   * DEEP V1 (appended after `rewardModel`): the reward rate the creator chose, bps per side
   * (0 for Standard). Absent on events emitted before the program carried it.
   */
  rewardBps?: number;
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
  /** DEEP V1 (appended): the token's reward model. Absent on pre-Phase-2 events. */
  rewardModel?: number;
  /**
   * DEEP V1 (appended): the reward part of the fee when the model is Holder (`creatorFee` is
   * then 0), else 0n. `protocolFee + creatorFee + holderFee` is the whole fee of the trade.
   * Always set by the decoder (0n for pre-Phase-2 events).
   */
  holderFee?: bigint;
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
   * The fund slice of `tradeFee` (input token units): the DEEP builder share
   * (floor(tradeFee * fund_fee_rate / 1e6)). Part of `protocolFee`, never added to it; DEEP's
   * own protocol part is `protocolFee - fundFee`. Absent on events built before it existed.
   */
  fundFee?: bigint;
  /**
   * The creator fee charged ON TOP of `tradeFee` (0 on pools without it). It is neither LP
   * nor protocol trade fee: the pool's creator and the protocol share it when it is
   * collected (AmmConfig.creator_fee_share_rate). In lamports when `creatorFeeInSol`,
   * otherwise in the token's base units. Absent on events built before this field existed.
   */
  creatorFee?: bigint;
  /** Which side `creatorFee` was taken in. Graduation pools always take it in SOL. */
  creatorFeeInSol?: boolean;
  /**
   * DEEP V1 pools only (set to 1 when the swap carried a `SwapFeesV1`; absent on a legacy
   * swap). Then every fee is in the pool's quote token (SOL), whatever the direction:
   * `tradeFee` is `lpFee + protocolFee`, NOT in the input token's units on a sell (see
   * `tradeFeeInSol`); `protocolFee` is DEEP's exact part; `fundFee` is 0; `creatorFee` is the
   * reward part, 100% the pool's reward recipient's (never shared with the protocol); and on
   * a sell `solAmount` is net of all of them.
   */
  feeModel?: 1;
  /** V1 only: `tradeFee` and its parts are in lamports (always true on a SOL pair). */
  tradeFeeInSol?: boolean;
  /** V1 only: the part of `tradeFee` that stays in the pool for LPs. */
  lpFee?: bigint;
  /** V1 only: the pool's reward model, 0 Standard, 1 Creator (to the creator), 2 Holder (to the holder vault). */
  rewardModel?: number;
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
  /** Bytes not read yet: how appended (newer) fields are detected. */
  remaining() {
    return this.b.length - this.o;
  }
  u8() {
    this.need(1);
    return this.b[this.o++]!;
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
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
  /** ConfigParams as the LAST field of an event: v3 (147 B), or v2 (141 B) on older events. */
  params(): ConfigParamsData {
    const v3 = this.remaining() >= CONFIG_PARAMS_SIZE;
    const size = v3 ? CONFIG_PARAMS_SIZE : CONFIG_PARAMS_V2_SIZE;
    this.need(size);
    const p = readConfigParams(this.b, this.o, v3 ? 3 : 2);
    this.o += size;
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
    ...(r.remaining() >= 1 ? { rewardModel: r.u8() } : {}),
    ...(r.remaining() >= 2 ? { rewardBps: r.u16() } : {}),
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
    // appended in DEEP V1 Phase 2 (u8 reward_model, u64 holder_fee); older events end here
    ...(r.remaining() >= 9 ? { rewardModel: r.u8(), holderFee: r.u64() } : { holderFee: 0n }),
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
// deep-curve also emits LaunchFeeCharged (create_token with a launch fee), ProtocolFeesSwept
// (sweep_protocol_fees, graduate: now into the fee vault), HolderFeesSwept (sweep_holder_fees:
// a Holder token's curve reward fees into its holder vault), and the DEEP V1 splitter events
// RevenueDistributed (distribute), SplitterUpdated / SplitterUpdateQueued /
// SplitterUpdateCancelled (destination changes) and VaultTokensWithdrawn. BuilderFeePaid (the
// retired 5/70 share) is still decoded for history. They are decoded separately: parseEventsFromLogs numbers the
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

/**
 * The builder share of protocol revenue credited to the Treasury in one instruction:
 * builderAmount = floor(base * 5 / 70), treasuryAmount = base - builderAmount. `base` is the
 * swept curve fees (sweep_protocol_fees) or migration-fee remainder + swept fees (graduate).
 */
export interface BuilderFeePaidEvent {
  name: "BuilderFeePaid";
  mint: string;
  base: bigint;
  builderAmount: bigint;
  treasuryAmount: bigint;
}

/**
 * DEEP V1 splitter `distribute`: `base` is the NEW revenue of this round; the builder got
 * `builderAmount` (its cumulative pay is `builderPaidTotal` = floor(baseTotal / 10));
 * `amounts[i]` is what `wallets[i]` received (share + previously owed), `owed[i]` what it is
 * still owed (it would have stayed below rent exemption).
 */
export interface RevenueDistributedEvent {
  name: "RevenueDistributed";
  base: bigint;
  retainedIn: bigint;
  builderAmount: bigint;
  /** Builder pay still due (wallet could not receive yet), paid on a later round. */
  builderOwed: bigint;
  builderPaidTotal: bigint;
  baseTotal: bigint;
  wallets: string[];
  amounts: bigint[];
  owed: bigint[];
  retained: bigint;
  wsolUnwrapped: bigint;
  timestamp: bigint;
}

export interface SplitterUpdatedEvent {
  name: "SplitterUpdated";
  wallets: string[];
  bps: number[];
  minDistributeLamports: bigint;
}

export interface SplitterUpdateQueuedEvent {
  name: "SplitterUpdateQueued";
  eta: bigint;
  queuedAt: bigint;
  wallets: string[];
  bps: number[];
  minDistributeLamports: bigint;
}

export interface SplitterUpdateCancelledEvent {
  name: "SplitterUpdateCancelled";
  eta: bigint;
}

export interface VaultTokensWithdrawnEvent {
  name: "VaultTokensWithdrawn";
  mint: string;
  recipient: string;
  amount: bigint;
}

/** `sweep_holder_fees`: a Holder token's curve reward fees moved to its holder vault. */
export interface HolderFeesSweptEvent {
  name: "HolderFeesSwept";
  mint: string;
  /** deep-rewards PDA ["holder_vault", mint]. */
  holderVault: string;
  amount: bigint;
}

export type FeeEvent =
  | LaunchFeeChargedEvent
  | ProtocolFeesSweptEvent
  | HolderFeesSweptEvent
  | BuilderFeePaidEvent
  | RevenueDistributedEvent
  | SplitterUpdatedEvent
  | SplitterUpdateQueuedEvent
  | SplitterUpdateCancelledEvent
  | VaultTokensWithdrawnEvent;

const FEE_DISC = {
  LaunchFeeCharged: hex(discriminator("event", "LaunchFeeCharged")),
  ProtocolFeesSwept: hex(discriminator("event", "ProtocolFeesSwept")),
  HolderFeesSwept: hex(discriminator("event", "HolderFeesSwept")),
  BuilderFeePaid: hex(discriminator("event", "BuilderFeePaid")),
  RevenueDistributed: hex(discriminator("event", "RevenueDistributed")),
  SplitterUpdated: hex(discriminator("event", "SplitterUpdated")),
  SplitterUpdateQueued: hex(discriminator("event", "SplitterUpdateQueued")),
  SplitterUpdateCancelled: hex(discriminator("event", "SplitterUpdateCancelled")),
  VaultTokensWithdrawn: hex(discriminator("event", "VaultTokensWithdrawn")),
};

/** Sequential Borsh reader over an event payload (after the discriminator). */
function borsh(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const need = (n: number) => {
    if (o + n > b.length) throw new RangeError("event data truncated");
  };
  const r = {
    u16: () => {
      need(2);
      const x = v.getUint16(o, true);
      o += 2;
      return x;
    },
    u32: () => {
      need(4);
      const x = v.getUint32(o, true);
      o += 4;
      return x;
    },
    u64: () => {
      need(8);
      const x = v.getBigUint64(o, true);
      o += 8;
      return x;
    },
    i64: () => {
      need(8);
      const x = v.getBigInt64(o, true);
      o += 8;
      return x;
    },
    u128: () => {
      const lo = r.u64();
      const hi = r.u64();
      return (hi << 64n) | lo;
    },
    pk: () => {
      need(32);
      const k = new PublicKey(b.slice(o, o + 32)).toBase58();
      o += 32;
      return k;
    },
    vec: <T>(item: () => T): T[] => {
      const n = r.u32();
      if (n > 64) throw new RangeError("event vec too long");
      return Array.from({ length: n }, item);
    },
  };
  return r;
}

/** Decode a deep-curve fee/splitter event payload (with discriminator), else null. */
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
  if (d === FEE_DISC.HolderFeesSwept) {
    if (b.length < 72) throw new RangeError("event data truncated");
    return {
      name: "HolderFeesSwept",
      mint: pk(0),
      holderVault: pk(32),
      amount: v.getBigUint64(64, true),
    };
  }
  if (d === FEE_DISC.BuilderFeePaid) {
    if (b.length < 56) throw new RangeError("event data truncated");
    return {
      name: "BuilderFeePaid",
      mint: pk(0),
      base: v.getBigUint64(32, true),
      builderAmount: v.getBigUint64(40, true),
      treasuryAmount: v.getBigUint64(48, true),
    };
  }
  if (d === FEE_DISC.RevenueDistributed) {
    const r = borsh(b);
    return {
      name: "RevenueDistributed",
      base: r.u64(),
      retainedIn: r.u64(),
      builderAmount: r.u64(),
      builderOwed: r.u64(),
      builderPaidTotal: r.u64(),
      baseTotal: r.u128(),
      wallets: r.vec(r.pk),
      amounts: r.vec(r.u64),
      owed: r.vec(r.u64),
      retained: r.u64(),
      wsolUnwrapped: r.u64(),
      timestamp: r.i64(),
    };
  }
  if (d === FEE_DISC.SplitterUpdated) {
    const r = borsh(b);
    return {
      name: "SplitterUpdated",
      wallets: r.vec(r.pk),
      bps: r.vec(r.u16),
      minDistributeLamports: r.u64(),
    };
  }
  if (d === FEE_DISC.SplitterUpdateQueued) {
    const r = borsh(b);
    const eta = r.i64();
    const queuedAt = r.i64();
    const dests = r.vec(() => ({ wallet: r.pk(), bps: r.u16() }));
    return {
      name: "SplitterUpdateQueued",
      eta,
      queuedAt,
      wallets: dests.map((x) => x.wallet),
      bps: dests.map((x) => x.bps),
      minDistributeLamports: r.u64(),
    };
  }
  if (d === FEE_DISC.SplitterUpdateCancelled) {
    return { name: "SplitterUpdateCancelled", eta: borsh(b).i64() };
  }
  if (d === FEE_DISC.VaultTokensWithdrawn) {
    const r = borsh(b);
    return { name: "VaultTokensWithdrawn", mint: r.pk(), recipient: r.pk(), amount: r.u64() };
  }
  return null;
}

/** deep-curve fee/splitter events emitted by `programId` itself (same spoofing rules). */
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
