/**
 * @deepliquidity/sdk — client bindings for programs/deep-curve.
 * Hand-written against the program's account/instruction layout; must be kept in
 * sync with programs/deep-curve/src/lib.rs (layout tests in test/sdk.test.ts).
 */
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  REWARD_MODEL,
  totalFeeBps,
  validateFeesV1,
  validateLaunchReward,
  validateRewardModel,
  type CurveState,
  type FeeConfigV1,
  type FeeSchedule,
  type RewardModel,
} from "@deepliquidity/curve-math";
import { DEEP_CURVE_PROGRAM_ID, discriminator, TOKEN_METADATA_PROGRAM_ID } from "./constants.js";
import { PYTH_SOL_USD_PRICE_UPDATE } from "./pyth.js";

export * from "./constants.js";
export * from "./events.js";
export * from "./raydium-cpmm.js";
export * from "./deep-amm.js";
export * from "./cpmm-liquidity.js";
export * from "./amm-events.js";
export * from "./lifecycle.js";
export * from "./pyth.js";
export * from "./config.js";
export * from "./program-data.js";
export * from "./pairs.js";
export * from "./cpmm-initialize.js";
export * from "./creator-links.js";
export * from "./squads.js";
export * from "./genesis.js";
export * from "./builder.js";
export * from "./splitter.js";
export * from "./merkle.js";
export * from "./rewards.js";
export * from "./rewards-verify.js";

const enc = new TextEncoder();

// ───────────── PDAs ─────────────

export function configPda(programId = DEEP_CURVE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("config")], programId)[0];
}

/** Program-owned PDA that accrues protocol trade fees and migration fees. */
export function treasuryPda(programId = DEEP_CURVE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("treasury")], programId)[0];
}

export function curvePda(mint: PublicKey, programId = DEEP_CURVE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("curve"), mint.toBytes()], programId)[0];
}

export function vaultAddress(mint: PublicKey, programId = DEEP_CURVE_PROGRAM_ID): PublicKey {
  return getAssociatedTokenAddressSync(mint, curvePda(mint, programId), true);
}

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("metadata"), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];
}

// ───────────── borsh ─────────────

class Writer {
  private parts: Uint8Array[] = [];
  bytes(b: Uint8Array) {
    this.parts.push(b);
    return this;
  }
  u64(v: bigint) {
    if (v < 0n || v >= 1n << 64n) throw new RangeError("u64 out of range");
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return this.bytes(b);
  }
  i64(v: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return this.bytes(b);
  }
  string(s: string) {
    const data = enc.encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length, true);
    return this.bytes(len).bytes(data);
  }
  finish(): Buffer {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return Buffer.from(out);
  }
}

// ───────────── instructions ─────────────

export const METADATA_LIMITS = { name: 32, symbol: 10, uri: 200 } as const;

export interface CreateTokenArgs {
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /**
   * DEEP V1 reward model: 0 Standard (default), 1 Creator, 2 Holder (`REWARD_MODEL`). Chosen
   * here together with `rewardBps`, stored on the curve and never changed afterwards;
   * graduation carries both into the token's DeepSwap pool.
   */
  rewardModel?: RewardModel;
  /**
   * The token's reward rate, bps, charged on both sides of every trade on top of DEEP's
   * protocol fee: on the curve and, after graduation, in the DeepSwap pool. 0 for Standard
   * (the default); 1..=500 (`MAX_REWARD_BPS`, 5%) for Creator (paid to the creator) and
   * Holder (paid to the token's holders). The program also rejects a rate above the Config's
   * current maximum (`maxRewardBps`) and one that pushes a side above 10% in total.
   */
  rewardBps?: number;
  /**
   * Optional, for a clearer error before sending: the decoded Config. With it the builder
   * applies the two checks that depend on it, `Config.maxRewardBps` (RewardRateAboveMax,
   * 6040) and the 10% total per side with the Config's protocol rates (InvalidFee, 6009).
   */
  config?: Pick<ConfigAccount, "maxRewardBps" | "protocolFeeBps" | "sellProtocolFeeBps">;
  /**
   * The most the creator agrees to pay as launch fee, lamports (u64). The fee is set in USD
   * and converted at the Pyth SOL/USD price inside the instruction; above this limit the
   * transaction fails (LaunchFeeAboveMax, 6041) and nothing is charged. Pass the fee quoted
   * to the user plus a small tolerance: `launchFeeLimitLamports(quoteLaunchFeeLamports(...))`.
   * Not read when the Config's launch fee is 0.
   */
  maxLaunchFeeLamports: bigint;
  programId?: PublicKey;
}

/** Default tolerance on top of the quoted launch fee: 2% (the price moves between quote and landing). */
export const LAUNCH_FEE_TOLERANCE_BPS = 200n;

/**
 * `maxLaunchFeeLamports` for `createTokenIx`: the quoted fee plus `toleranceBps` (default 2%),
 * rounded up. A quote of 0 (no launch fee) gives 0.
 */
export function launchFeeLimitLamports(
  quotedLamports: bigint,
  toleranceBps: bigint = LAUNCH_FEE_TOLERANCE_BPS,
): bigint {
  if (quotedLamports < 0n || toleranceBps < 0n) throw new RangeError("negative launch fee limit");
  const limit = quotedLamports + (quotedLamports * toleranceBps + 9_999n) / 10_000n;
  if (limit > 0xffff_ffff_ffff_ffffn) throw new RangeError("launch fee limit exceeds u64");
  return limit;
}

/**
 * The checks `create_token` makes on the reward terms, as an error message or null: Standard
 * takes no rate, Creator / Holder 1..=500 bps; with `config`, also the admin's current
 * maximum and the 10% total cap per side.
 */
export function validateLaunchTerms(
  rewardModel: number,
  rewardBps: number,
  config?: Pick<ConfigAccount, "maxRewardBps" | "protocolFeeBps" | "sellProtocolFeeBps">,
): string | null {
  if (!Number.isInteger(rewardBps) || rewardBps < 0 || rewardBps > 0xffff)
    return "Reward rate must be a whole number of bps";
  try {
    validateLaunchReward(
      rewardModel,
      BigInt(rewardBps),
      config ? BigInt(config.maxRewardBps) : undefined,
    );
    if (config)
      validateFeesV1({
        buyProtocolFeeBps: BigInt(config.protocolFeeBps),
        sellProtocolFeeBps: BigInt(config.sellProtocolFeeBps),
        rewardBps: BigInt(rewardBps),
        rewardModel: rewardModel as RewardModel,
      });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

export function validateMetadata(name: string, symbol: string, uri: string): string | null {
  const len = (s: string) => enc.encode(s).length;
  if (!name.trim()) return "Name is required";
  if (len(name) > METADATA_LIMITS.name) return `Name must be ≤ ${METADATA_LIMITS.name} bytes`;
  if (!symbol.trim()) return "Symbol is required";
  if (len(symbol) > METADATA_LIMITS.symbol)
    return `Symbol must be ≤ ${METADATA_LIMITS.symbol} bytes`;
  if (len(uri) > METADATA_LIMITS.uri) return `Metadata URI must be ≤ ${METADATA_LIMITS.uri} bytes`;
  return null;
}

export function createTokenIx(a: CreateTokenArgs): TransactionInstruction {
  const programId = a.programId ?? DEEP_CURVE_PROGRAM_ID;
  const err = validateMetadata(a.name, a.symbol, a.uri);
  if (err) throw new Error(err);
  const rewardModel: number = a.rewardModel ?? REWARD_MODEL.Standard;
  const rewardBps = a.rewardBps ?? 0;
  validateRewardModel(rewardModel);
  const termsErr = validateLaunchTerms(rewardModel, rewardBps, a.config);
  if (termsErr) throw new Error(termsErr);
  const rewardBpsLe = new Uint8Array(2);
  new DataView(rewardBpsLe.buffer).setUint16(0, rewardBps, true);
  if (
    typeof a.maxLaunchFeeLamports !== "bigint" ||
    a.maxLaunchFeeLamports < 0n ||
    a.maxLaunchFeeLamports > 0xffff_ffff_ffff_ffffn
  )
    throw new RangeError("maxLaunchFeeLamports must be a u64 (lamports)");
  const curve = curvePda(a.mint, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.creator, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: a.mint, isSigner: true, isWritable: true },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: vaultAddress(a.mint, programId), isSigner: false, isWritable: true },
      { pubkey: metadataPda(a.mint), isSigner: false, isWritable: true },
      // Pyth SOL/USD PriceUpdateV2 (pinned on-chain; read only when the launch fee > 0)
      { pubkey: PYTH_SOL_USD_PRICE_UPDATE, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: new Writer()
      .bytes(discriminator("global", "create_token"))
      .string(a.name)
      .string(a.symbol)
      .string(a.uri)
      .bytes(new Uint8Array([rewardModel]))
      .bytes(rewardBpsLe)
      .u64(a.maxLaunchFeeLamports)
      .finish(),
  });
}

export interface TradeArgs {
  user: PublicKey;
  mint: PublicKey;
  /**
   * @deprecated Ignored. Protocol fees accrue on the curve PDA and are swept to the
   * Treasury by `sweepProtocolFeesIx`; trades take no fee account at all.
   */
  feeRecipient?: PublicKey;
  /** buy: lamports in. sell: token base units in. */
  amount: bigint;
  /** buy: min tokens out. sell: min lamports out. */
  minOut: bigint;
  /** Unix seconds after which the program rejects the trade. */
  deadline: bigint;
  programId?: PublicKey;
}

function tradeIx(name: "buy" | "sell", a: TradeArgs): TransactionInstruction {
  const programId = a.programId ?? DEEP_CURVE_PROGRAM_ID;
  const curve = curvePda(a.mint, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.user, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: a.mint, isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: vaultAddress(a.mint, programId), isSigner: false, isWritable: true },
      {
        pubkey: getAssociatedTokenAddressSync(a.mint, a.user),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: new Writer()
      .bytes(discriminator("global", name))
      .u64(a.amount)
      .u64(a.minOut)
      .i64(a.deadline)
      .finish(),
  });
}

export const buyIx = (a: TradeArgs) => tradeIx("buy", a);
export const sellIx = (a: TradeArgs) => tradeIx("sell", a);

/** Emergency pause toggle. Only succeeds when `admin` is Config.admin (enforced on-chain). */
export function setPausedIx(
  admin: PublicKey,
  paused: boolean,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
    ],
    data: new Writer()
      .bytes(discriminator("global", "set_paused"))
      .bytes(new Uint8Array([paused ? 1 : 0]))
      .finish(),
  });
}

/** min-out after applying slippage tolerance (bps). Rounds down. */
export function applySlippage(expected: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000)
    throw new RangeError("slippage must be 0–5000 bps");
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}

// ───────────── accounts ─────────────

export interface BondingCurveAccount {
  mint: PublicKey;
  creator: PublicKey;
  state: CurveState;
  protocolFeeBps: number;
  /** The stored field behind `rewardBps` (its name is kept from the v1/v2 layout). */
  creatorFeeBps: number;
  /**
   * The token's reward rate, bps, charged on both sides on top of the protocol fee: chosen
   * by its creator at launch, immutable, 0 for Standard. Alias of `creatorFeeBps` (bytes
   * 122..124). Where it goes is `rewardModel`. Graduation carries it into the DeepSwap pool
   * as `rewardBps * 100` per 1e6.
   */
  rewardBps: number;
  migrationFeeBps: number;
  creatorFeesUnclaimed: bigint;
  graduated: boolean;
  createdAt: bigint;
  bump: number;
  /** deep-amm pool created at graduation; PublicKey.default until graduated. */
  pool: PublicKey;
  /** v2: protocol fees (trade + launch) held on the curve until swept. 0n for v1 accounts. */
  protocolFeesUnclaimed: bigint;
  /**
   * v3 (DEEP V1): protocol fee on SELLS; `protocolFeeBps` is the BUY rate. For a v1/v2 account
   * it is `protocolFeeBps` (what `migrate_curve` writes).
   */
  sellProtocolFeeBps: number;
  /**
   * v3: 0 Standard, 1 Creator, 2 Holder. `rewardBps` is this token's reward rate on both
   * sides (to the creator for Standard / Creator, to the holder vault for Holder). For a v1/v2
   * account: Creator when it charges a creator fee, else Standard (what `migrate_curve` writes).
   * The raw byte: the program only ever writes 0, 1 or 2 (`curveFees` rejects anything else).
   */
  rewardModel: number;
  /** v3: Holder reward fees held on the curve until `sweepHolderFeesIx`. 0n before v3. */
  holderFeesUnclaimed: bigint;
}

/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateCurveIx). */
export const BONDING_CURVE_V1_SIZE = 8 + 32 + 32 + 8 * 6 + 2 * 3 + 8 + 1 + 1 + 8 + 1 + 32;
/** v2 layout (+u64 protocol_fees_unclaimed; devnet before DEEP V1 Phase 2): 185. */
export const BONDING_CURVE_V2_SIZE = BONDING_CURVE_V1_SIZE + 8;
/**
 * Byte size of BondingCurve v3 including the 8-byte discriminator (196):
 * + u16 sell_protocol_fee_bps, u8 reward_model, u64 holder_fees_unclaimed.
 */
export const BONDING_CURVE_SIZE = BONDING_CURVE_V2_SIZE + 2 + 1 + 8;
/** Offset of `protocol_fees_unclaimed` (u64) in a v2/v3 BondingCurve account. */
export const BONDING_CURVE_PROTOCOL_FEES_OFFSET = BONDING_CURVE_V1_SIZE;
/** Offset of `reward_model` (u8) in a v3 BondingCurve account (for memcmp filters). */
export const BONDING_CURVE_REWARD_MODEL_OFFSET = BONDING_CURVE_V2_SIZE + 2;

/** The fee terms a curve trades at (`quoteBuyV1` / `quoteSellV1` in @deepliquidity/curve-math). */
export function curveFees(curve: BondingCurveAccount): FeeConfigV1 {
  const rewardModel = curve.rewardModel;
  validateRewardModel(rewardModel);
  return {
    buyProtocolFeeBps: BigInt(curve.protocolFeeBps),
    sellProtocolFeeBps: BigInt(curve.sellProtocolFeeBps),
    rewardBps: BigInt(curve.creatorFeeBps),
    rewardModel,
  };
}

/**
 * The curve's total fee per side, bps: buy = `protocolFeeBps + rewardBps`,
 * sell = `sellProtocolFeeBps + rewardBps`.
 */
export function curveTotalFeeBps(
  curve: Pick<BondingCurveAccount, "protocolFeeBps" | "sellProtocolFeeBps" | "rewardBps">,
): { buy: number; sell: number } {
  const t = totalFeeBps({
    buyProtocolFeeBps: BigInt(curve.protocolFeeBps),
    sellProtocolFeeBps: BigInt(curve.sellProtocolFeeBps),
    rewardBps: BigInt(curve.rewardBps),
    rewardModel: REWARD_MODEL.Standard,
  });
  return { buy: Number(t.buy), sell: Number(t.sell) };
}

/** Accepts v1 (177 B), v2 (185 B) (neither migrated yet) and v3 (196 B) accounts. */
export function decodeBondingCurve(data: Uint8Array): BondingCurveAccount {
  if (data.length < BONDING_CURVE_V1_SIZE) throw new Error("account too small for BondingCurve");
  const disc = discriminator("account", "BondingCurve");
  for (let i = 0; i < 8; i++)
    if (data[i] !== disc[i]) throw new Error("not a BondingCurve account");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const pk = () => {
    const k = new PublicKey(data.slice(o, o + 32));
    o += 32;
    return k;
  };
  const u64 = () => {
    const x = v.getBigUint64(o, true);
    o += 8;
    return x;
  };
  const u16 = () => {
    const x = v.getUint16(o, true);
    o += 2;
    return x;
  };
  const bool = () => data[o++] === 1;
  const mint = pk();
  const creator = pk();
  const virtualSolReserves = u64();
  const virtualTokenReserves = u64();
  const realSolReserves = u64();
  const realTokenReserves = u64();
  const curveSupply = u64();
  const tokenTotalSupply = u64();
  const protocolFeeBps = u16();
  const creatorFeeBps = u16();
  const migrationFeeBps = u16();
  const creatorFeesUnclaimed = u64();
  const complete = bool();
  const graduated = bool();
  const createdAt = v.getBigInt64(o, true);
  o += 8;
  const bump = data[o++]!;
  const pool = pk();
  const protocolFeesUnclaimed = data.length >= BONDING_CURVE_V2_SIZE ? u64() : 0n;
  const v3 = data.length >= BONDING_CURVE_SIZE;
  const sellProtocolFeeBps = v3 ? u16() : protocolFeeBps;
  const model: number = v3
    ? data[o++]!
    : creatorFeeBps > 0
      ? REWARD_MODEL.Creator
      : REWARD_MODEL.Standard;
  const holderFeesUnclaimed = v3 ? u64() : 0n;
  return {
    mint,
    creator,
    state: {
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
      curveSupply,
      tokenTotalSupply,
      complete,
    },
    protocolFeeBps,
    creatorFeeBps,
    rewardBps: creatorFeeBps,
    migrationFeeBps,
    creatorFeesUnclaimed,
    graduated,
    createdAt,
    bump,
    pool,
    protocolFeesUnclaimed,
    sellProtocolFeeBps,
    rewardModel: model,
    holderFeesUnclaimed,
  };
}

export interface ConfigAccount {
  admin: PublicKey;
  pendingAdmin: PublicKey;
  feeRecipient: PublicKey;
  migrationAuthority: PublicKey;
  protocolFeeBps: number;
  creatorFeeBps: number;
  migrationFeeBps: number;
  initialVirtualSol: bigint;
  initialVirtualToken: bigint;
  curveSupply: bigint;
  tokenTotalSupply: bigint;
  decimals: number;
  paused: boolean;
  bump: number;
  /** Raydium CPMM AmmConfig used for graduation pools. */
  raydiumAmmConfig: PublicKey;
  /** Delay applied to queued config updates. */
  timelockSeconds: number;
  /** v2: launch fee in US cents (0 for v1 accounts / launch fee off). */
  launchFeeUsdCents: number;
  /**
   * v3 (DEEP V1): protocol fee on SELLS; `protocolFeeBps` is the BUY rate. For a v1/v2 account
   * it is `protocolFeeBps` (what `migrate_config` writes).
   */
  sellProtocolFeeBps: number;
  /**
   * v3: the admin's CURRENT maximum reward rate a creator may choose for a NEW launch, bps
   * (at most 500). Never a token's rate by itself; tokens already launched keep theirs.
   * 0 on a v1/v2 account (`migrate_config` then writes 500).
   */
  maxRewardBps: number;
  /** v3: reserved (stored, read by no instruction). */
  reservedBps: number;
}

/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateConfigIx). */
export const CONFIG_V1_SIZE = 8 + 32 * 4 + 2 * 3 + 8 * 4 + 1 + 1 + 1 + 32 + 4; // 213
/** v2 layout (+u16 launch_fee_usd_cents; devnet before DEEP V1 Phase 2). */
export const CONFIG_V2_SIZE = CONFIG_V1_SIZE + 2; // 215
/** Byte size of Config v3 (+3 × u16: sell protocol fee, max reward rate, reserved). */
export const CONFIG_SIZE = CONFIG_V2_SIZE + 6; // 221

/**
 * The Config's fee rates as @deepliquidity/curve-math's `FeeSchedule`: what a launch is checked
 * against (`snapshotFees(schedule, rewardModel, rewardBps)`), and the Config's own cap.
 */
export function configFeeSchedule(c: ConfigAccount): FeeSchedule {
  return {
    buyProtocolFeeBps: BigInt(c.protocolFeeBps),
    sellProtocolFeeBps: BigInt(c.sellProtocolFeeBps),
    creatorFeeBps: BigInt(c.creatorFeeBps),
    maxRewardBps: BigInt(c.maxRewardBps),
    reservedBps: BigInt(c.reservedBps),
  };
}

/** Accepts v1 (213 B), v2 (215 B) and v3 (221 B) accounts. */
export function decodeConfig(data: Uint8Array): ConfigAccount {
  if (data.length < CONFIG_V1_SIZE) throw new Error("account too small for Config");
  const disc = discriminator("account", "Config");
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) throw new Error("not a Config account");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const pk = () => {
    const k = new PublicKey(data.slice(o, o + 32));
    o += 32;
    return k;
  };
  const u16 = () => {
    const x = v.getUint16(o, true);
    o += 2;
    return x;
  };
  const u64 = () => {
    const x = v.getBigUint64(o, true);
    o += 8;
    return x;
  };
  const head = {
    admin: pk(),
    pendingAdmin: pk(),
    feeRecipient: pk(),
    migrationAuthority: pk(),
    protocolFeeBps: u16(),
    creatorFeeBps: u16(),
    migrationFeeBps: u16(),
    initialVirtualSol: u64(),
    initialVirtualToken: u64(),
    curveSupply: u64(),
    tokenTotalSupply: u64(),
    decimals: data[o++]!,
    paused: data[o++] === 1,
    bump: data[o++]!,
    raydiumAmmConfig: pk(),
    timelockSeconds: v.getUint32(o, true),
    launchFeeUsdCents: data.length >= CONFIG_V2_SIZE ? v.getUint16(o + 4, true) : 0,
  };
  const v3 = data.length >= CONFIG_SIZE;
  return {
    ...head,
    sellProtocolFeeBps: v3 ? v.getUint16(CONFIG_V2_SIZE, true) : head.protocolFeeBps,
    maxRewardBps: v3 ? v.getUint16(CONFIG_V2_SIZE + 2, true) : 0,
    reservedBps: v3 ? v.getUint16(CONFIG_V2_SIZE + 4, true) : 0,
  };
}
