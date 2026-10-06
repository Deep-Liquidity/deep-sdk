/**
 * Config timelock types: ConfigParams (borsh) and the PendingConfig PDA.
 * Layout mirrors `ConfigParams` / `PendingConfig` in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
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
export declare const CONFIG_PARAMS_V1_SIZE = 139;
/** v2: + u16 launch_fee_usd_cents */
export declare const CONFIG_PARAMS_SIZE = 141;
/** Reads borsh ConfigParams starting at `offset`. */
export declare function readConfigParams(data: Uint8Array, offset?: number, v1?: boolean): ConfigParamsData;
export interface PendingConfigAccount {
    active: boolean;
    /** Earliest unix time apply_config_update succeeds. */
    eta: bigint;
    queuedAt: bigint;
    params: ConfigParamsData;
    bump: number;
}
/** disc(8) | active u8 | eta i64 | queued_at i64 | ConfigParams | bump u8 */
export declare const PENDING_CONFIG_V1_SIZE: number;
export declare const PENDING_CONFIG_SIZE: number;
/** Accepts v1 (165 B) and v2 (167 B) accounts. */
export declare function decodePendingConfig(data: Uint8Array): PendingConfigAccount;
