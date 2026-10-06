/**
 * Squads v4 multisig: PDAs and read-only account decoders, hand-written from the program
 * source. We do NOT depend on `@sqds/multisig` or copy Squads code: the repository
 * (github.com/Squads-Protocol/v4) is AGPL-3.0, so the layouts below are re-derived from it.
 * Source: commit af94153ff77a28b6effe46b9c94baaa93742b48c,
 * programs/squads_multisig_program/src/state/
 *   seeds.rs               "multisig" / "transaction" / "proposal" / "vault"
 *   multisig.rs            Multisig
 *   proposal.rs            Proposal, ProposalStatus
 *   vault_transaction.rs   VaultTransaction, VaultTransactionMessage
 *   config_transaction.rs  ConfigTransaction, ConfigAction
 *   batch.rs               Batch
 * and instructions/{vault_transaction_create,proposal_create}.rs for the PDA seeds.
 * Pinned to real devnet accounts in test/squads-accounts.test.ts.
 *
 * Program SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: the same id on devnet and mainnet.
 */
import { PublicKey } from "@solana/web3.js";
export declare const SQUADS_V4_PROGRAM_ID: PublicKey;
/** ["multisig", multisig, "vault", u8 index] */
export declare function squadsVaultPda(multisig: PublicKey, index?: number, programId?: PublicKey): PublicKey;
/** ["multisig", multisig, "transaction", u64 LE index]: Vault/ConfigTransaction or Batch. */
export declare function squadsTransactionPda(multisig: PublicKey, index: bigint, programId?: PublicKey): PublicKey;
/** ["multisig", multisig, "transaction", u64 LE index, "proposal"] */
export declare function squadsProposalPda(multisig: PublicKey, index: bigint, programId?: PublicKey): PublicKey;
declare const DISC: {
    readonly Multisig: string;
    readonly Proposal: string;
    readonly VaultTransaction: string;
    readonly ConfigTransaction: string;
    readonly Batch: string;
};
/** The Squads account type named by the 8-byte Anchor discriminator, or null. */
export declare function squadsAccountKind(data: Uint8Array): keyof typeof DISC | null;
export interface SquadsMultisig {
    createKey: PublicKey;
    /** Default (all-zero) = autonomous: membership changes need a multisig vote. */
    configAuthority: PublicKey;
    threshold: number;
    /** Squads-side delay between approval and execution, seconds. */
    timeLock: number;
    /** Last transaction index (0 = none yet). */
    transactionIndex: bigint;
    /** Transactions up to this index are stale (a config change happened after them). */
    staleTransactionIndex: bigint;
    rentCollector: PublicKey | null;
    members: {
        key: PublicKey;
        permissions: number;
    }[];
}
/** Decodes a Squads v4 `Multisig` account. */
export declare function decodeSquadsMultisig(data: Uint8Array): SquadsMultisig;
/** ProposalStatus variants, in declaration (borsh tag) order. */
export declare const SQUADS_PROPOSAL_STATUSES: readonly ["draft", "active", "rejected", "approved", "executing", "executed", "cancelled"];
export type SquadsProposalStatus = (typeof SQUADS_PROPOSAL_STATUSES)[number];
export interface SquadsProposal {
    multisig: PublicKey;
    transactionIndex: bigint;
    status: SquadsProposalStatus;
    /** Unix seconds the status was entered; null for `executing`. For `approved` this is the
     *  moment the threshold was reached, from which the time lock counts. */
    statusTimestamp: bigint | null;
    approved: PublicKey[];
    rejected: PublicKey[];
    cancelled: PublicKey[];
}
export declare function decodeSquadsProposal(data: Uint8Array): SquadsProposal;
/**
 * When an approved proposal's transaction may execute: approval time + the multisig's
 * time_lock (vault_transaction_execute.rs / config_transaction_execute.rs / batch_execute:
 * `now - approved_timestamp >= time_lock`). Null unless the proposal is approved.
 */
export declare function squadsExecutableAt(p: SquadsProposal, timeLockSeconds: number): bigint | null;
export interface SquadsCompiledInstruction {
    programIdIndex: number;
    accountIndexes: number[];
    data: Uint8Array;
}
export interface SquadsVaultTransaction {
    kind: "vault";
    multisig: PublicKey;
    creator: PublicKey;
    index: bigint;
    vaultIndex: number;
    ephemeralSignerBumps: number[];
    message: {
        numSigners: number;
        numWritableSigners: number;
        numWritableNonSigners: number;
        accountKeys: PublicKey[];
        instructions: SquadsCompiledInstruction[];
        addressTableLookups: {
            accountKey: PublicKey;
            writableIndexes: number[];
            readonlyIndexes: number[];
        }[];
    };
}
export type SquadsConfigAction = {
    type: "AddMember";
    newMember: {
        key: PublicKey;
        permissions: number;
    };
} | {
    type: "RemoveMember";
    oldMember: PublicKey;
} | {
    type: "ChangeThreshold";
    newThreshold: number;
} | {
    type: "SetTimeLock";
    newTimeLock: number;
} | {
    type: "AddSpendingLimit";
    createKey: PublicKey;
    vaultIndex: number;
    mint: PublicKey;
    amount: bigint;
    period: "OneTime" | "Day" | "Week" | "Month";
    members: PublicKey[];
    destinations: PublicKey[];
} | {
    type: "RemoveSpendingLimit";
    spendingLimit: PublicKey;
} | {
    type: "SetRentCollector";
    newRentCollector: PublicKey | null;
};
export interface SquadsConfigTransaction {
    kind: "config";
    multisig: PublicKey;
    creator: PublicKey;
    index: bigint;
    actions: SquadsConfigAction[];
}
export interface SquadsBatch {
    kind: "batch";
    multisig: PublicKey;
    creator: PublicKey;
    index: bigint;
    vaultIndex: number;
    size: number;
    executedTransactionIndex: number;
}
export type SquadsTransaction = SquadsVaultTransaction | SquadsConfigTransaction | SquadsBatch;
/** Decodes the account at a transaction PDA: VaultTransaction, ConfigTransaction or Batch. */
export declare function decodeSquadsTransaction(data: Uint8Array): SquadsTransaction;
/** Program ids a vault transaction invokes (static keys only; a lookup-table program id is
 *  reported as "lookup"). */
export declare function squadsVaultTransactionPrograms(tx: SquadsVaultTransaction): string[];
/**
 * A short, human-readable line for alerts: "config: SetTimeLock 172800" or
 * "vault #0: 2 ix → deep-amm, BPFLoaderUpgradeable". `names` maps program ids to labels.
 */
export declare function summarizeSquadsTransaction(tx: SquadsTransaction, names?: Record<string, string>): string;
export {};
