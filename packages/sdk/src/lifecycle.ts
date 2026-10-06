/**
 * deep-curve lifecycle/admin instruction builders: initialize_config, the timelocked
 * queue/apply/cancel_config_update,
 * withdraw_protocol_fees, claim_creator_fees, graduate.
 * Account order mirrors the `#[derive(Accounts)]` structs in programs/deep-curve/src/lib.rs
 * (and the Rust LiteSVM test helpers that exercise them).
 */
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";
import { deepAmmPermissionPda } from "./deep-amm.js";
import {
  cpmmAuthority,
  DEEP_AMM_CREATE_POOL_FEE_RECEIVER,
  DEEP_AMM_PROGRAM_ID,
  cpmmLpMint,
  cpmmObservation,
  cpmmVault,
  sortMints,
} from "./raydium-cpmm.js";

const enc = new TextEncoder();
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** Raydium cp-swap's devnet create-pool fee receiver (legacy; graduation now targets deep-amm). */
export const CPMM_CREATE_POOL_FEE_RECEIVER_DEVNET = new PublicKey(
  "3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy",
);

/** Compute units to request for `graduate` (see docs/PROGRAMS.md for the LiteSVM measurement). */
export const GRADUATE_COMPUTE_UNITS = 400_000;

const pda = (seeds: Uint8Array[], programId: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

const configPdaOf = (pid: PublicKey) => pda([enc.encode("config")], pid);
const treasuryPdaOf = (pid: PublicKey) => pda([enc.encode("treasury")], pid);
const curvePdaOf = (mint: PublicKey, pid: PublicKey) =>
  pda([enc.encode("curve"), mint.toBytes()], pid);

/**
 * The deep-curve PDA that pays for and signs pool creation at graduation. ONE address for
 * every token (seed "pool_creator" alone): deep-amm's `initialize_with_permission` needs
 * a Permission account derived from the payer (`deepAmmPermissionPda`), which the deep-amm
 * admin creates once for this address. It replaces the per-mint `poolCreatorPda(mint)` of
 * builds before the DeepSwap creator fee.
 */
export function graduationPayerPda(programId = DEEP_CURVE_PROGRAM_ID) {
  return pda([enc.encode("pool_creator")], programId);
}

/** The deep-curve-owned PDA used as the Raydium pool_state (un-griefable). */
export function graduationPoolPda(mint: PublicKey, programId = DEEP_CURVE_PROGRAM_ID) {
  return pda([enc.encode("raydium_pool"), mint.toBytes()], programId);
}

/**
 * True only for the pool deep-curve created when `token` graduated. Anyone can open
 * other pools for the same pair (any price, any AmmConfig), so UIs must not treat those
 * as the token's DEEP market. Pure: needs only the pool address and its two mints.
 */
export function isGraduationPool(
  poolId: PublicKey,
  mint0: PublicKey,
  mint1: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): boolean {
  const token = mint0.equals(NATIVE_MINT) ? mint1 : mint1.equals(NATIVE_MINT) ? mint0 : null;
  return !!token && graduationPoolPda(token, programId).equals(poolId);
}

/** Holds the single queued (timelocked) config change. */
export function pendingConfigPda(programId = DEEP_CURVE_PROGRAM_ID) {
  return pda([enc.encode("pending_config")], programId);
}

export function programDataPda(programId = DEEP_CURVE_PROGRAM_ID) {
  return pda([programId.toBytes()], BPF_LOADER_UPGRADEABLE);
}

// ───────────── tiny borsh writer ─────────────

class W {
  private b: number[] = [];
  raw(x: Uint8Array) {
    this.b.push(...x);
    return this;
  }
  pk(k: PublicKey) {
    return this.raw(k.toBytes());
  }
  u8(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError("u8 out of range");
    this.b.push(v);
    return this;
  }
  u16(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError("u16 out of range");
    this.b.push(v & 0xff, v >> 8);
    return this;
  }
  u32(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError("u32 out of range");
    this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: bigint) {
    if (v < 0n || v >= 1n << 64n) throw new RangeError("u64 out of range");
    for (let i = 0n; i < 8n; i++) this.b.push(Number((v >> (8n * i)) & 0xffn));
    return this;
  }
  done() {
    return Buffer.from(this.b);
  }
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable,
});

// ───────────── config ─────────────

export interface ConfigParamsArgs {
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
  raydiumAmmConfig: PublicKey;
  /**
   * Delay (seconds) applied to every later config change; 0..=30 days.
   * Use 0 on localnet/devnet, at least 48h (172_800) on mainnet.
   */
  timelockSeconds: number;
  /** v2: launch fee in US cents, 0..=2000 (on-chain cap). Defaults to 0 (no fee). */
  launchFeeUsdCents?: number;
}

/** Program-side bound (MAX_TIMELOCK_SECONDS) and the recommended mainnet value. */
export const MAX_TIMELOCK_SECONDS = 30 * 24 * 3600;
export const RECOMMENDED_MAINNET_TIMELOCK_SECONDS = 48 * 3600;

export function encodeConfigParams(p: ConfigParamsArgs): Buffer {
  return new W()
    .pk(p.feeRecipient)
    .pk(p.migrationAuthority)
    .u16(p.protocolFeeBps)
    .u16(p.creatorFeeBps)
    .u16(p.migrationFeeBps)
    .u64(p.initialVirtualSol)
    .u64(p.initialVirtualToken)
    .u64(p.curveSupply)
    .u64(p.tokenTotalSupply)
    .u8(p.decimals)
    .pk(p.raydiumAmmConfig)
    .u32(p.timelockSeconds)
    .u16(p.launchFeeUsdCents ?? 0)
    .done();
}

/** Must be signed by the program's upgrade authority (enforced on-chain via ProgramData). */
export function initializeConfigIx(
  admin: PublicKey,
  params: ConfigParamsArgs,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(admin, true, true),
      meta(configPdaOf(programId), true),
      meta(treasuryPdaOf(programId), true),
      meta(programId),
      meta(programDataPda(programId)),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      Buffer.from(discriminator("global", "initialize_config")),
      encodeConfigParams(params),
    ]),
  });
}

/**
 * Timelocked config change, step 1 (admin only). Takes effect after
 * Config.timelock_seconds via `applyConfigUpdateIx`; only one change can be queued.
 */
export function queueConfigUpdateIx(
  admin: PublicKey,
  params: ConfigParamsArgs,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(admin, true, true),
      meta(configPdaOf(programId)),
      meta(pendingConfigPda(programId), true),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      Buffer.from(discriminator("global", "queue_config_update")),
      encodeConfigParams(params),
    ]),
  });
}

/**
 * Timelocked config change, step 2. Permissionless (no signer in the account list):
 * any fee payer can execute once the queued change's eta has passed.
 */
export function applyConfigUpdateIx(programId = DEEP_CURVE_PROGRAM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(configPdaOf(programId), true), meta(pendingConfigPda(programId), true)],
    data: Buffer.from(discriminator("global", "apply_config_update")),
  });
}

/** Admin veto for the queued change. */
export function cancelConfigUpdateIx(
  admin: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(admin, false, true),
      meta(configPdaOf(programId)),
      meta(pendingConfigPda(programId), true),
    ],
    data: Buffer.from(discriminator("global", "cancel_config_update")),
  });
}

// ───────────── v2: fee sweep + account migration ─────────────

/**
 * PERMISSIONLESS: moves a curve's accrued protocol fees (trade + launch) to the
 * Treasury. Any fee payer may send it (e.g. a crank batching many curves).
 */
export function sweepProtocolFeesIx(
  mint: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(curvePdaOf(mint, programId), true), meta(treasuryPdaOf(programId), true)],
    data: Buffer.from(discriminator("global", "sweep_protocol_fees")),
  });
}

/** PERMISSIONLESS, idempotent: grows v1 Config (+ PendingConfig) to v2. Payer funds rent. */
export function migrateConfigIx(
  payer: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(payer, true, true),
      meta(configPdaOf(programId), true),
      meta(pendingConfigPda(programId), true),
      meta(SystemProgram.programId),
    ],
    data: Buffer.from(discriminator("global", "migrate_config")),
  });
}

/** PERMISSIONLESS, idempotent: grows a v1 BondingCurve to v2. Payer funds rent. */
export function migrateCurveIx(
  payer: PublicKey,
  mint: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(payer, true, true),
      meta(mint),
      meta(curvePdaOf(mint, programId), true),
      meta(SystemProgram.programId),
    ],
    data: Buffer.from(discriminator("global", "migrate_curve")),
  });
}

// ───────────── admin transfer ─────────────

/** Two-step admin transfer, step 1 (current admin). Immediate; not timelocked. */
export function proposeAdminIx(
  admin: PublicKey,
  newAdmin: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(admin, false, true), meta(configPdaOf(programId), true)],
    data: Buffer.concat([
      Buffer.from(discriminator("global", "propose_admin")),
      new W().pk(newAdmin).done(),
    ]),
  });
}

/**
 * Two-step admin transfer, step 2: must be signed by Config.pending_admin. For a
 * Squads vault this instruction goes into a multisig proposal (the vault signs on
 * execution), it cannot be sent directly.
 */
export function acceptAdminIx(
  pendingAdmin: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(pendingAdmin, false, true), meta(configPdaOf(programId), true)],
    data: Buffer.from(discriminator("global", "accept_admin")),
  });
}

// ───────────── fees ─────────────

export function withdrawProtocolFeesIx(
  admin: PublicKey,
  feeRecipient: PublicKey,
  amount: bigint,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(admin, false, true),
      meta(configPdaOf(programId)),
      meta(treasuryPdaOf(programId), true),
      meta(feeRecipient, true),
    ],
    data: Buffer.concat([
      Buffer.from(discriminator("global", "withdraw_protocol_fees")),
      new W().u64(amount).done(),
    ]),
  });
}

export function claimCreatorFeesIx(
  creator: PublicKey,
  mint: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(creator, true, true), meta(curvePdaOf(mint, programId), true)],
    data: Buffer.from(discriminator("global", "claim_creator_fees")),
  });
}

// ───────────── graduation ─────────────

export interface GraduationAccounts {
  /** `graduationPayerPda`: pays for the pool, never the pool's recorded creator. */
  poolCreator: PublicKey;
  /** deep-amm Permission of `poolCreator`; graduation fails until the AMM admin creates it. */
  permission: PublicKey;
  poolState: PublicKey;
  lpMint: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  observation: PublicKey;
  creatorToken: PublicKey;
  creatorWsol: PublicKey;
  creatorLp: PublicKey;
}

/** Every address `graduate` touches for `mint`. `poolState` is where the Raydium pool will live. */
export function graduationAccounts(
  mint: PublicKey,
  programId = DEEP_CURVE_PROGRAM_ID,
  cpSwap = DEEP_AMM_PROGRAM_ID,
): GraduationAccounts {
  const poolCreator = graduationPayerPda(programId);
  const poolState = graduationPoolPda(mint, programId);
  const lpMint = cpmmLpMint(cpSwap, poolState);
  const [m0, m1] = sortMints(mint, NATIVE_MINT);
  return {
    poolCreator,
    permission: deepAmmPermissionPda(poolCreator, cpSwap),
    poolState,
    lpMint,
    token0Vault: cpmmVault(cpSwap, poolState, m0),
    token1Vault: cpmmVault(cpSwap, poolState, m1),
    observation: cpmmObservation(cpSwap, poolState),
    creatorToken: getAssociatedTokenAddressSync(mint, poolCreator, true),
    creatorWsol: getAssociatedTokenAddressSync(NATIVE_MINT, poolCreator, true),
    creatorLp: getAssociatedTokenAddressSync(lpMint, poolCreator, true),
  };
}

export interface GraduateArgs {
  migrationAuthority: PublicKey;
  mint: PublicKey;
  /**
   * The token's creator (`BondingCurve.creator`; the program rejects any other key). It is
   * recorded as the DeepSwap pool's creator, which lets them collect the creator fee.
   */
  creator: PublicKey;
  /** Config.raydium_amm_config */
  ammConfig: PublicKey;
  programId?: PublicKey;
  /** Defaults to deep-amm. */
  cpSwapProgramId?: PublicKey;
  /** deep-amm's build-time create-pool fee WSOL account (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). */
  createPoolFeeReceiver?: PublicKey;
}

export function graduateIx(a: GraduateArgs): TransactionInstruction {
  const pid = a.programId ?? DEEP_CURVE_PROGRAM_ID;
  const cp = a.cpSwapProgramId ?? DEEP_AMM_PROGRAM_ID;
  const feeReceiver = a.createPoolFeeReceiver ?? DEEP_AMM_CREATE_POOL_FEE_RECEIVER.devnet;
  if (!feeReceiver)
    throw new Error("graduateIx: pass createPoolFeeReceiver (deep-amm's build-time fee account)");
  const g = graduationAccounts(a.mint, pid, cp);
  const curve = curvePdaOf(a.mint, pid);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      meta(a.migrationAuthority, true, true),
      meta(configPdaOf(pid)),
      meta(treasuryPdaOf(pid), true),
      meta(a.mint, true),
      meta(curve, true),
      meta(getAssociatedTokenAddressSync(a.mint, curve, true), true),
      meta(a.creator),
      meta(g.poolCreator, true),
      meta(g.creatorToken, true),
      meta(NATIVE_MINT),
      meta(g.creatorWsol, true),
      meta(g.creatorLp, true),
      meta(g.poolState, true),
      meta(a.ammConfig),
      meta(g.permission),
      meta(cpmmAuthority(cp)),
      meta(g.lpMint, true),
      meta(g.token0Vault, true),
      meta(g.token1Vault, true),
      meta(feeReceiver, true),
      meta(g.observation, true),
      meta(cp),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
    ],
    data: Buffer.from(discriminator("global", "graduate")),
  });
}

/** graduate plus the compute budget it needs. */
export function graduateIxs(a: GraduateArgs): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: GRADUATE_COMPUTE_UNITS }),
    graduateIx(a),
  ];
}
