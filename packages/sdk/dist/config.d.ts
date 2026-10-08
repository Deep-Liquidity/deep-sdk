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
    /**
     * v3 (DEEP V1): protocol fee on SELLS; `protocolFeeBps` is the BUY rate. Read from v1/v2
     * params it is `protocolFeeBps` (what `migrate_config` writes).
     */
    sellProtocolFeeBps: number;
    /** v3: the maximum reward rate a creator may choose for a new launch, bps, at most 500 (0 when read from v1/v2 params). */
    maxRewardBps: number;
    /** v3: reserved, unused (0 when read from v1/v2 params). */
    reservedBps: number;
}
/** v1: 32+32 + 3·2 + 4·8 + 1 + 32 + 4 */
export declare const CONFIG_PARAMS_V1_SIZE = 139;
/** v2: + u16 launch_fee_usd_cents */
export declare const CONFIG_PARAMS_V2_SIZE = 141;
/** v3: + u16 sell_protocol_fee_bps, u16 creator_reward_bps, u16 holder_reward_bps */
export declare const CONFIG_PARAMS_SIZE = 147;
/** Layout version of a borsh `ConfigParams`. */
export type ConfigParamsVersion = 1 | 2 | 3;
/**
 * Reads borsh ConfigParams starting at `offset`. `version` is the layout to read (default 3,
 * the current one); `true` / `false` are the pre-v3 spelling of 1 / 3.
 */
export declare function readConfigParams(data: Uint8Array, offset?: number, version?: ConfigParamsVersion | boolean): ConfigParamsData;
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
export declare const PENDING_CONFIG_V2_SIZE: number;
export declare const PENDING_CONFIG_SIZE: number;
/** Accepts v1 (165 B), v2 (167 B) and v3 (173 B) accounts. */
export declare function decodePendingConfig(data: Uint8Array): PendingConfigAccount;
