/**
 * DEEP V1 fee splitter (programs/deep-curve/src/splitter.rs; docs/V1_FEES.md section 1.1).
 *
 * ALL DEEP revenue lands in one program-owned vault, the deep-curve PDA ["fee_vault"]:
 * curve protocol + launch fees (`sweep_protocol_fees`), the migration-fee remainder
 * (`graduate`), DEEP's DeepSwap protocol fees (deep-amm `collect_protocol_fee_to_vault`, into
 * the vault's WSOL ATA) and the DeepSwap create-pool fee (deep-amm's build-time receiver is the
 * vault's WSOL ATA). The permissionless `distribute` pays the builder exactly 10% over time
 * (compiled in, no setter, no delay) and the other 90% to up to 8 destinations by bps; the
 * destinations change only through the deep-curve Config timelock.
 *
 * Account order mirrors the `#[derive(Accounts)]` structs in splitter.rs (pinned by
 * fixtures/ix-vectors.json and programs/deep-curve/tests/ix_vectors.rs).
 */
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
export { BUILDER_SPLIT_BPS, DEFAULT_MIN_DISTRIBUTE_LAMPORTS, MAX_MIN_DISTRIBUTE_LAMPORTS, MAX_SPLIT_DESTINATIONS, SPLIT_BPS_DENOMINATOR, splitRound, type SplitRound, } from "@deepliquidity/curve-math";
/** System-owned, data-less PDA that receives all DEEP revenue. */
export declare function feeVaultPda(programId?: PublicKey): PublicKey;
/** The vault's WSOL ATA: DeepSwap protocol fees and the create-pool fee arrive here. */
export declare function feeVaultWsolAta(programId?: PublicKey): PublicKey;
export declare function splitterPda(programId?: PublicKey): PublicKey;
export declare function pendingSplitterPda(programId?: PublicKey): PublicKey;
/** Temporary WSOL account `distribute` creates and closes to unwrap the vault's WSOL. */
export declare function wsolUnwrapPda(programId?: PublicKey): PublicKey;
/**
 * The fee vault of deep-curve 7czUR…CDtA, the same on every cluster (one program id). deep-amm
 * compiles it in (env DEEP_FEE_VAULT) as the only possible AmmConfig protocol owner, and its
 * WSOL ATA as the create-pool fee receiver (DEEP_AMM_CREATE_POOL_FEE_RECEIVER).
 */
export declare const DEEP_FEE_VAULT: PublicKey;
export declare const DEEP_FEE_VAULT_WSOL: PublicKey;
/** deep-curve DeepError codes appended for the splitter (6029..). */
export declare const SPLITTER_ERRORS: {
    readonly InvalidBuilder: 6027;
    readonly BuilderNotRentExempt: 6028;
    readonly InvalidSplitterParams: 6029;
    readonly SplitterUpdatePending: 6030;
    readonly NoPendingSplitterUpdate: 6031;
    readonly BelowMinDistribute: 6032;
    readonly InvalidDestination: 6033;
    readonly DestinationHasOwed: 6034;
    readonly InvalidFeeVault: 6035;
    readonly InvalidVaultToken: 6036;
};
export interface SplitterDestinationParams {
    wallet: PublicKey;
    /** Share of the 90% remainder, bps of 10_000; all destinations sum to exactly 10_000. */
    bps: number;
}
export interface SplitterParamsArgs {
    destinations: SplitterDestinationParams[];
    minDistributeLamports: bigint;
}
/**
 * Addresses the program refuses as a 90% destination (deep-curve `never_a_destination`), in
 * its order: nobody could ever sign for what they receive. The zero key (also the system
 * program id), the fee vault and its WSOL account, the splitter config and its pending change,
 * Config and PendingConfig, the temporary unwrap account, the legacy treasury, the graduation
 * pool payer, the three DEEP programs, the two token programs, the ATA program and the WSOL
 * mint.
 */
export declare function neverADestination(programId?: PublicKey): PublicKey[];
/** Client-side mirror of SplitterParams::validate (the program re-checks everything). */
export declare function validateSplitterParams(p: SplitterParamsArgs, opts?: {
    builder?: PublicKey;
    programId?: PublicKey;
}): string | null;
/** Borsh SplitterParams: Vec<{ wallet, bps: u16 }> then min_distribute_lamports: u64. */
export declare function encodeSplitterParams(p: SplitterParamsArgs): Buffer;
/** One-time (Config.admin): SplitterConfig + vault rent + the vault's WSOL ATA. */
export declare function initializeSplitterIx(admin: PublicKey, params: SplitterParamsArgs, programId?: PublicKey): TransactionInstruction;
/** Timelocked destination change, step 1 (admin). eta = now + Config.timelock_seconds. */
export declare function queueSplitterUpdateIx(admin: PublicKey, params: SplitterParamsArgs, programId?: PublicKey): TransactionInstruction;
/** Step 2, PERMISSIONLESS once eta has passed (within the 14-day grace window). */
export declare function applySplitterUpdateIx(programId?: PublicKey): TransactionInstruction;
/** Admin veto of the queued change. */
export declare function cancelSplitterUpdateIx(admin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS `distribute`. `payer` (signer, writable) is whoever sends it: when the vault
 * holds WSOL it fronts the rent of the temporary unwrap account (0.00203928 SOL) and gets
 * exactly that back in the same instruction, so the vault needs no spare lamports; it pays
 * and receives nothing else. `builder` is the deployed build's DEEP_BUILDER_WALLET (any other
 * key fails InvalidBuilder); `destinations` are the SplitterConfig's wallets in config order
 * (read them with `decodeSplitterConfig`). Request ~120k CU for 8 destinations with WSOL to
 * unwrap (DISTRIBUTE_COMPUTE_UNITS).
 */
export declare function distributeIx(a: {
    payer: PublicKey;
    builder: PublicKey;
    destinations: readonly PublicKey[];
    programId?: PublicKey;
}): TransactionInstruction;
export declare const DISTRIBUTE_COMPUTE_UNITS = 200000;
/**
 * Admin: move a NON-WSOL token (SPL Token or Token-2022) out of the vault's ATA (legacy
 * token-side DeepSwap protocol fees) to `recipientToken`, a token account owned by
 * Config.fee_recipient. Outside the split (docs/V1_FEES.md Q12).
 */
export declare function withdrawVaultTokensIx(a: {
    admin: PublicKey;
    mint: PublicKey;
    recipientToken: PublicKey;
    amount: bigint;
    /** The mint's token program (default SPL Token). */
    tokenProgram?: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
export interface SplitterDestination {
    wallet: PublicKey;
    bps: number;
    /** Lamports due but unpaid (the wallet would have stayed below rent exemption). */
    owed: bigint;
    /** Lamports paid since the wallet was added. */
    paidTotal: bigint;
}
export interface SplitterConfigAccount {
    bump: number;
    vaultBump: number;
    destinations: SplitterDestination[];
    /** Every lamport of revenue that entered the split. */
    baseTotal: bigint;
    /** Every lamport credited to the builder (= baseTotal / 10, floored); see builderOwed. */
    builderPaidTotal: bigint;
    /** Builder pay credited but not yet transferred (wallet below rent exemption). */
    builderOwed: bigint;
    /** 90%-side rounding dust kept for the next round. */
    retained: bigint;
    minDistributeLamports: bigint;
    distributions: bigint;
    /** Unix seconds of the last distribute; 0 before the first. */
    lastDistributeAt: bigint;
    destinationsPaidTotal: bigint;
}
/** 8 + 3 + 8·50 + 16 + 7·8 + 56. */
export declare const SPLITTER_CONFIG_SIZE = 539;
export declare function decodeSplitterConfig(data: Uint8Array): SplitterConfigAccount;
export interface PendingSplitterUpdateAccount {
    active: boolean;
    eta: bigint;
    queuedAt: bigint;
    params: SplitterParamsArgs;
}
export declare function decodePendingSplitterUpdate(data: Uint8Array): PendingSplitterUpdateAccount;
/**
 * The owner's auto-send schedule (2026-10-06): `distribute` at 00:00 and 12:00
 * America/Los_Angeles, DST-aware. Returns the next such instant strictly after `now`.
 * Pure (Intl only), so the keeper, API and UI agree.
 */
export declare function nextDistributionAt(now: Date, timeZone?: string): Date;
