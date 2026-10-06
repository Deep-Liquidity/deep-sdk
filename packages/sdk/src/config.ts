/**
 * Config timelock types: ConfigParams (borsh) and the PendingConfig PDA.
 * Layout mirrors `ConfigParams` / `PendingConfig` in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "./constants.js";

export interface ConfigParamsData {
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
  timelockSeconds: number;
  /** v2 (0 when read from a v1 account). */
  launchFeeUsdCents: number;
}

/** v1: 32+32 + 3·2 + 4·8 + 1 + 32 + 4 */
export const CONFIG_PARAMS_V1_SIZE = 139;
/** v2: + u16 launch_fee_usd_cents */
export const CONFIG_PARAMS_SIZE = 141;

/** Reads borsh ConfigParams starting at `offset`. */
export function readConfigParams(data: Uint8Array, offset = 0, v1 = false): ConfigParamsData {
  if (data.length < offset + (v1 ? CONFIG_PARAMS_V1_SIZE : CONFIG_PARAMS_SIZE))
    throw new RangeError("ConfigParams truncated");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = offset;
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
  const feeRecipient = pk();
  const migrationAuthority = pk();
  const protocolFeeBps = u16();
  const creatorFeeBps = u16();
  const migrationFeeBps = u16();
  const initialVirtualSol = u64();
  const initialVirtualToken = u64();
  const curveSupply = u64();
  const tokenTotalSupply = u64();
  const decimals = data[o++]!;
  const raydiumAmmConfig = pk();
  const timelockSeconds = v.getUint32(o, true);
  o += 4;
  const launchFeeUsdCents = v1 ? 0 : v.getUint16(o, true);
  return {
    feeRecipient,
    migrationAuthority,
    protocolFeeBps,
    creatorFeeBps,
    migrationFeeBps,
    initialVirtualSol,
    initialVirtualToken,
    curveSupply,
    tokenTotalSupply,
    decimals,
    raydiumAmmConfig,
    timelockSeconds,
    launchFeeUsdCents,
  };
}

export interface PendingConfigAccount {
  active: boolean;
  /** Earliest unix time apply_config_update succeeds. */
  eta: bigint;
  queuedAt: bigint;
  params: ConfigParamsData;
  bump: number;
}

/** disc(8) | active u8 | eta i64 | queued_at i64 | ConfigParams | bump u8 */
export const PENDING_CONFIG_V1_SIZE = 8 + 1 + 8 + 8 + CONFIG_PARAMS_V1_SIZE + 1; // 165
export const PENDING_CONFIG_SIZE = 8 + 1 + 8 + 8 + CONFIG_PARAMS_SIZE + 1; // 167

/** Accepts v1 (165 B) and v2 (167 B) accounts. */
export function decodePendingConfig(data: Uint8Array): PendingConfigAccount {
  if (data.length < PENDING_CONFIG_V1_SIZE) throw new Error("account too small for PendingConfig");
  const v1 = data.length < PENDING_CONFIG_SIZE;
  const d = discriminator("account", "PendingConfig");
  for (let i = 0; i < 8; i++) if (data[i] !== d[i]) throw new Error("not a PendingConfig account");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    active: data[8] === 1,
    eta: v.getBigInt64(9, true),
    queuedAt: v.getBigInt64(17, true),
    params: readConfigParams(data, 25, v1),
    bump: data[25 + (v1 ? CONFIG_PARAMS_V1_SIZE : CONFIG_PARAMS_SIZE)]!,
  };
}
