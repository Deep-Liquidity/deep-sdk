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
export type FeeEvent = LaunchFeeChargedEvent | ProtocolFeesSweptEvent | HolderFeesSweptEvent | BuilderFeePaidEvent | RevenueDistributedEvent | SplitterUpdatedEvent | SplitterUpdateQueuedEvent | SplitterUpdateCancelledEvent | VaultTokensWithdrawnEvent;
/** Decode a deep-curve fee/splitter event payload (with discriminator), else null. */
export declare function decodeFeeEvent(data: Uint8Array): FeeEvent | null;
/** deep-curve fee/splitter events emitted by `programId` itself (same spoofing rules). */
export declare function parseFeeEventsFromLogs(logs: readonly string[], programId?: PublicKey): FeeEvent[];
