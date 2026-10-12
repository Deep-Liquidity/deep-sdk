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
import {
  addExtraAccountMetasForExecute,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  PublicKey,
  TransactionInstruction,
  type AccountInfo,
  type AccountMeta,
  type Commitment,
  type Connection,
} from "@solana/web3.js";

/** The hook program of a mint account, or null (legacy SPL Token, no hook, or a null hook). */
export function transferHookProgramOf(
  mint: PublicKey,
  account: Pick<AccountInfo<Buffer>, "owner" | "data">,
): PublicKey | null {
  if (!account.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  const m = unpackMint(mint, account as AccountInfo<Buffer>, TOKEN_2022_PROGRAM_ID);
  const hook = getTransferHook(m);
  if (!hook || hook.programId.equals(PublicKey.default)) return null;
  return hook.programId;
}

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
export async function resolveTransferHookAccounts(
  connection: Connection,
  transfers: HookTransfer[],
  commitment?: Commitment,
): Promise<AccountMeta[]> {
  const mints = [...new Map(transfers.map((t) => [t.mint.toBase58(), t.mint])).values()];
  const infos = await connection.getMultipleAccountsInfo(mints, commitment);
  const hookOf = new Map<string, PublicKey>();
  mints.forEach((m, i) => {
    const info = infos[i];
    const hook = info ? transferHookProgramOf(m, info) : null;
    if (hook) hookOf.set(m.toBase58(), hook);
  });
  const metas: AccountMeta[] = [];
  for (const t of transfers) {
    const hook = hookOf.get(t.mint.toBase58());
    if (!hook) continue;
    // A throwaway TransferChecked-shaped instruction: spl-token appends the resolved extra
    // accounts, the hook program and the validation account after its first four keys.
    const ix = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: t.source, isSigner: false, isWritable: true },
        { pubkey: t.mint, isSigner: false, isWritable: false },
        { pubkey: t.destination, isSigner: false, isWritable: true },
        { pubkey: t.authority, isSigner: true, isWritable: false },
      ],
      data: Buffer.alloc(0),
    });
    await addExtraAccountMetasForExecute(
      connection,
      ix,
      hook,
      t.source,
      t.mint,
      t.destination,
      t.authority,
      t.amount ?? 0n,
      commitment,
    );
    metas.push(...ix.keys.slice(4));
  }
  return mergeHookAccounts(metas);
}

/** Merges account lists by address: writable if any entry is, never a signer. */
export function mergeHookAccounts(...lists: AccountMeta[][]): AccountMeta[] {
  const out = new Map<string, AccountMeta>();
  for (const m of lists.flat()) {
    const k = m.pubkey.toBase58();
    const prev = out.get(k);
    out.set(k, {
      pubkey: m.pubkey,
      isSigner: false,
      isWritable: (prev?.isWritable ?? false) || m.isWritable,
    });
  }
  return [...out.values()];
}

/** Appends `hookAccounts` to an instruction's keys (a no-op without them). */
export function withHookAccounts(
  ix: TransactionInstruction,
  hookAccounts?: AccountMeta[],
): TransactionInstruction {
  if (hookAccounts?.length) ix.keys.push(...hookAccounts);
  return ix;
}
