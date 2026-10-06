/**
 * Decoders for deep-curve Anchor events. `emit!` writes
 * `Program data: <base64(discriminator ‖ borsh(event))>` to the transaction logs.
 * Layouts must match the `#[event]` structs in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import { type ConfigParamsData } from "./config.js";
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
export type DeepEvent = PoolSwapEvent | TokenCreatedEvent | TradeEventData | CurveCompletedEvent | CreatorFeesClaimedEvent | GraduatedEvent | PauseChangedEvent | ProtocolFeesWithdrawnEvent | ConfigUpdateQueuedEvent | ConfigUpdateCancelledEvent | ConfigUpdatedEvent;
/** Decode one event payload (discriminator included). Returns null for unknown events. */
export declare function decodeEvent(data: Uint8Array): DeepEvent | null;
/**
 * Extract deep-curve events from a transaction's log messages. Tracks the invoke
 * stack so `Program data:` lines emitted by OTHER programs (spoofing) are ignored.
 * `index` is the event's ordinal within the transaction, for idempotent storage.
 */
export declare function parseEventsFromLogs(logs: readonly string[], programId?: PublicKey): {
    index: number;
    event: DeepEvent;
}[];
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
/** Decode a LaunchFeeCharged or ProtocolFeesSwept payload (discriminator included), else null. */
export declare function decodeFeeEvent(data: Uint8Array): FeeEvent | null;
/** LaunchFeeCharged / ProtocolFeesSwept emitted by `programId` itself (same spoofing rules). */
export declare function parseFeeEventsFromLogs(logs: readonly string[], programId?: PublicKey): FeeEvent[];
