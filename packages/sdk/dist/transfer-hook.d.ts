/**
 * Token-2022 transfer hooks for DeepSwap (deep-amm forwards them; docs/STOCK_PAIRS.md).
 *
 * A mint with an active TransferHook extension runs its hook program on every transfer. deep-amm
 * appends the instruction's remaining accounts to each `TransferChecked` it makes, so a client
 * passes the hook's accounts there: the hook program, its `["extra-account-metas", mint]`
 * validation account and the extra accounts that account lists. `resolveTransferHookAccounts`
 * reads them from chain; builders take them as `hookAccounts` and append them last.
 *
 * Mints without a hook need nothing: every builder works exactly as before without
 * `hookAccounts`.
 */
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, type AccountInfo, type AccountMeta, type Commitment, type Connection } from "@solana/web3.js";
/** The hook program of a mint account, or null (legacy SPL Token, no hook, or a null hook). */
export declare function transferHookProgramOf(mint: PublicKey, account: Pick<AccountInfo<Buffer>, "owner" | "data">): PublicKey | null;
/** One transfer deep-amm will make: its source, destination and signing authority. */
export interface HookTransfer {
    mint: PublicKey;
    source: PublicKey;
    destination: PublicKey;
    authority: PublicKey;
    /** The amount, for hooks whose extra accounts depend on it (most do not). */
    amount?: bigint;
}
/**
 * The accounts to pass as `hookAccounts` for the given transfers: for each mint with an active
 * hook, the hook program, its validation account and the extra accounts it resolves to (read
 * from chain). Empty when no mint has a hook. Duplicates are merged (writable wins); signer
 * flags are never set (deep-amm passes them on as non-signers).
 */
export declare function resolveTransferHookAccounts(connection: Connection, transfers: HookTransfer[], commitment?: Commitment): Promise<AccountMeta[]>;
/** Merges account lists by address: writable if any entry is, never a signer. */
export declare function mergeHookAccounts(...lists: AccountMeta[][]): AccountMeta[];
/** Appends `hookAccounts` to an instruction's keys (a no-op without them). */
export declare function withHookAccounts(ix: TransactionInstruction, hookAccounts?: AccountMeta[]): TransactionInstruction;
