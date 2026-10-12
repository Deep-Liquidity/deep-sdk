import { PublicKey } from "@solana/web3.js";
import { type ParsedAmmSwap } from "./amm-events.js";
import { type DeepEvent, type FeeEvent } from "./events.js";
import { type RpcTransaction } from "./tx-frames.js";
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
    previousTransaction?(address: string, before: string): Promise<{
        signature: string;
        tx: RpcTransaction;
    } | null>;
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
/**
 * The deep-curve events of one confirmed, successful transaction, complete even when its log
 * was truncated (see the top of this file). `signature` is the transaction's own signature;
 * `reader` is asked only when the log was truncated.
 *
 * Rebuilt today: `TradeEvent` (buy and sell), `CurveCompleted`, `TokenCreated`, `Graduated`
 * with its `ProtocolFeesSwept` / `HolderFeesSwept`, and the presence of `LaunchFeeCharged`.
 * A truncated transaction that lost the event of any other instruction is `unreadable`.
 */
export declare function readCurveTransaction(tx: RpcTransaction, signature: string, reader: ChainReader, programId?: PublicKey): Promise<CurveTxRead>;
/**
 * The DeepSwap `SwapEvent`s (with their `SwapFeesV1`) of one confirmed, successful
 * transaction, complete even when its log was truncated (see the top of this file).
 * `signature` is the transaction's own signature; `reader` is asked only when the log was
 * truncated.
 *
 * Rebuilt today: swaps of DEEP V1 pools whose two tokens have no Token-2022 transfer fee. A
 * truncated transaction that lost the swap of any other pool is `unreadable`.
 */
export declare function readAmmTransaction(tx: RpcTransaction, signature: string, reader: ChainReader, programId?: PublicKey): Promise<AmmTxRead>;
