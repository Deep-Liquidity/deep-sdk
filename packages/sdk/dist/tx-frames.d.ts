/**
 * A confirmed transaction as the RPC records it, independent of its log text: every
 * instruction (top-level and inner) with its place in the call tree, the SOL and token
 * movements those instructions made, and the balances before and after.
 *
 * This is the data the runtime never truncates. It is what `tx-reconstruct.ts` rebuilds
 * events from when the log was cut.
 */
import type { VersionedTransactionResponse } from "@solana/web3.js";
/** One instruction as `getTransaction` (encoding "json") returns it. */
export interface RpcInstruction {
    programIdIndex: number;
    accounts: number[];
    /** base58 (the RPC's form), or the raw bytes. */
    data: string | Uint8Array;
    /** Inner instructions only: 2 when called by the top-level instruction, 3 below that... */
    stackHeight?: number | null;
}
export interface RpcTokenBalance {
    accountIndex: number;
    mint: string;
    uiTokenAmount: {
        amount: string;
    };
}
/** `getTransaction` with encoding "json": the fields used here (others are ignored). */
export interface RpcTransaction {
    slot: number;
    blockTime?: number | null;
    transaction: {
        message: {
            accountKeys: string[];
            instructions: RpcInstruction[];
        };
    };
    meta: {
        err: unknown;
        fee?: number;
        logMessages?: string[] | null;
        innerInstructions?: {
            index: number;
            instructions: RpcInstruction[];
        }[] | null;
        loadedAddresses?: {
            writable: string[];
            readonly: string[];
        } | null;
        preBalances?: number[] | null;
        postBalances?: number[] | null;
        preTokenBalances?: RpcTokenBalance[] | null;
        postTokenBalances?: RpcTokenBalance[] | null;
    } | null;
}
/** The same transaction from `Connection.getTransaction` (web3.js), in the RPC's "json" shape. */
export declare function rpcTransactionFromResponse(tx: VersionedTransactionResponse): RpcTransaction;
/** base58 (Bitcoin alphabet) to bytes. Throws on a character outside the alphabet. */
export declare function decodeBase58(s: string): Uint8Array;
/** Static keys, then the writable and read-only keys loaded from address lookup tables. */
export declare function txAccountKeys(tx: RpcTransaction): string[];
/** One instruction of a transaction, top-level or inner, in execution order. */
export interface TxFrame {
    /** Position in execution order across the whole transaction. */
    index: number;
    /** Index of the top-level instruction this one ran under (its own index if top-level). */
    top: number;
    /** 1 for a top-level instruction, else the node's stack height; 0 when it reported none. */
    depth: number;
    programId: string;
    accounts: string[];
    data: Uint8Array;
    /**
     * `frames.slice(index + 1, end)` are the instructions this one invoked, directly or below.
     * Meaningful only when `descendantsKnown`.
     */
    end: number;
    /** False for an inner instruction of a transaction whose node reported no stack heights. */
    descendantsKnown: boolean;
}
/**
 * Every instruction of the transaction with its call tree, from what the validator recorded
 * (program ids and stack heights), never from log text.
 */
export declare function txFrames(tx: RpcTransaction): TxFrame[];
/** The instructions `frame` invoked, directly or below; null when the node did not say. */
export declare function frameDescendants(frames: readonly TxFrame[], frame: TxFrame): TxFrame[] | null;
export declare const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
export declare const SPL_TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** Lamports one System Program instruction moved. */
export interface LamportMove {
    from: string;
    to: string;
    lamports: bigint;
}
/**
 * The lamports a System Program instruction moved: `Transfer`, `CreateAccount`,
 * `CreateAccountWithSeed`, `TransferWithSeed`, `WithdrawNonceAccount`. Null for every other
 * instruction (they move none). Lamports a program moves by writing its own accounts'
 * balances directly are NOT instructions and never appear here.
 */
export declare function systemLamportMove(f: TxFrame): LamportMove | null;
/** Tokens one SPL Token / Token-2022 instruction moved, minted or burned. */
export interface TokenMove {
    kind: "transfer" | "mint" | "burn";
    /** The token account debited (null for a mint). */
    source: string | null;
    /** The token account credited (null for a burn). */
    destination: string | null;
    amount: bigint;
}
/**
 * The tokens an SPL Token or Token-2022 instruction moved: `Transfer`, `TransferChecked`,
 * `MintTo`, `MintToChecked`, `Burn`, `BurnChecked`. Null for every other instruction.
 * `amount` is the instruction's amount: a Token-2022 transfer fee is not subtracted.
 */
export declare function tokenMove(f: TxFrame): TokenMove | null;
/**
 * True when `f` is a token-program instruction that can change `account`'s token balance in
 * a way `tokenMove` does not report: closing it, `SyncNative` (wrapped SOL), or a Token-2022
 * extension instruction (transfers with a fee, withheld-fee handling). A reader that needs
 * the exact balance of `account` at some point of the transaction must give up on these.
 */
export declare function tokenBalanceOpaque(f: TxFrame, account: string): boolean;
/** An account's lamports before and after the transaction; null when it is not recorded. */
export declare function lamportBalances(tx: RpcTransaction, address: string): {
    pre: bigint;
    post: bigint;
} | null;
/**
 * A token account's balance before and after the transaction; 0 on the side where it was not
 * a token account (created or closed in the transaction). Null when the transaction does not
 * list the address or the node recorded no token balances.
 */
export declare function tokenBalances(tx: RpcTransaction, address: string): {
    pre: bigint;
    post: bigint;
} | null;
/** Net lamports `address` received through System Program instructions in the transaction. */
export declare function systemNetLamports(frames: readonly TxFrame[], address: string): bigint;
