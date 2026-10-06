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
import { discriminator } from "./constants.js";
export const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const enc = new TextEncoder();
const u64le = (n) => {
    if (n < 0n || n >= 1n << 64n)
        throw new RangeError("u64");
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
};
// ───────────── PDAs ─────────────
/** ["multisig", multisig, "vault", u8 index] */
export function squadsVaultPda(multisig, index = 0, programId = SQUADS_V4_PROGRAM_ID) {
    if (!Number.isInteger(index) || index < 0 || index > 255)
        throw new RangeError("vault index u8");
    return PublicKey.findProgramAddressSync([enc.encode("multisig"), multisig.toBytes(), enc.encode("vault"), Uint8Array.of(index)], programId)[0];
}
/** ["multisig", multisig, "transaction", u64 LE index]: Vault/ConfigTransaction or Batch. */
export function squadsTransactionPda(multisig, index, programId = SQUADS_V4_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("multisig"), multisig.toBytes(), enc.encode("transaction"), u64le(index)], programId)[0];
}
/** ["multisig", multisig, "transaction", u64 LE index, "proposal"] */
export function squadsProposalPda(multisig, index, programId = SQUADS_V4_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([
        enc.encode("multisig"),
        multisig.toBytes(),
        enc.encode("transaction"),
        u64le(index),
        enc.encode("proposal"),
    ], programId)[0];
}
// ───────────── reader ─────────────
class Reader {
    d;
    what;
    o = 0;
    v;
    constructor(d, what) {
        this.d = d;
        this.what = what;
        this.v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    }
    need(n) {
        if (this.o + n > this.d.length)
            throw new RangeError(`${this.what} truncated`);
    }
    u8() {
        this.need(1);
        return this.d[this.o++];
    }
    u16() {
        this.need(2);
        const x = this.v.getUint16(this.o, true);
        this.o += 2;
        return x;
    }
    u32() {
        this.need(4);
        const x = this.v.getUint32(this.o, true);
        this.o += 4;
        return x;
    }
    u64() {
        this.need(8);
        const x = this.v.getBigUint64(this.o, true);
        this.o += 8;
        return x;
    }
    i64() {
        this.need(8);
        const x = this.v.getBigInt64(this.o, true);
        this.o += 8;
        return x;
    }
    pk() {
        this.need(32);
        const k = new PublicKey(this.d.slice(this.o, this.o + 32));
        this.o += 32;
        return k;
    }
    bytes(n) {
        this.need(n);
        const b = this.d.slice(this.o, this.o + n);
        this.o += n;
        return b;
    }
    vec(item) {
        const n = this.u32();
        // every item is at least one byte: rejects absurd lengths before allocating
        this.need(Math.min(n, this.d.length));
        return Array.from({ length: n }, item);
    }
    opt(item) {
        const t = this.u8();
        if (t > 1)
            throw new Error(`${this.what}: bad Option tag ${t}`);
        return t === 1 ? item() : null;
    }
}
function expectDisc(data, name) {
    const d = discriminator("account", name);
    if (data.length < 8)
        throw new Error(`account too small for Squads ${name}`);
    for (let i = 0; i < 8; i++)
        if (data[i] !== d[i])
            throw new Error(`not a Squads ${name}`);
}
// Plain hex (no Buffer): this module is loaded by the web bundle, where Buffer is a polyfill
// that may not exist yet when the SDK is evaluated.
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const discHex = (name) => toHex(discriminator("account", name));
const DISC = {
    Multisig: discHex("Multisig"),
    Proposal: discHex("Proposal"),
    VaultTransaction: discHex("VaultTransaction"),
    ConfigTransaction: discHex("ConfigTransaction"),
    Batch: discHex("Batch"),
};
/** The Squads account type named by the 8-byte Anchor discriminator, or null. */
export function squadsAccountKind(data) {
    if (data.length < 8)
        return null;
    const h = toHex(data.subarray(0, 8));
    for (const [k, v] of Object.entries(DISC))
        if (v === h)
            return k;
    return null;
}
/** Decodes a Squads v4 `Multisig` account. */
export function decodeSquadsMultisig(data) {
    expectDisc(data, "Multisig");
    if (data.length < 8 + 32 + 32 + 2 + 4 + 8 + 8 + 1 + 1 + 4)
        throw new Error("account too small for Squads Multisig");
    const r = new Reader(data, "Squads Multisig");
    r.o = 8;
    const createKey = r.pk();
    const configAuthority = r.pk();
    const threshold = r.u16();
    const timeLock = r.u32();
    const transactionIndex = r.u64();
    const staleTransactionIndex = r.u64();
    const rentCollector = r.opt(() => r.pk());
    r.u8(); // bump
    const n = r.u32();
    if (r.o + n * 33 > data.length)
        throw new Error("Squads Multisig members truncated");
    const members = Array.from({ length: n }, () => ({ key: r.pk(), permissions: r.u8() }));
    return {
        createKey,
        configAuthority,
        threshold,
        timeLock,
        transactionIndex,
        staleTransactionIndex,
        rentCollector,
        members,
    };
}
// ───────────── Proposal ─────────────
/** ProposalStatus variants, in declaration (borsh tag) order. */
export const SQUADS_PROPOSAL_STATUSES = [
    "draft",
    "active",
    "rejected",
    "approved",
    "executing", // deprecated, carries no timestamp
    "executed",
    "cancelled",
];
export function decodeSquadsProposal(data) {
    expectDisc(data, "Proposal");
    const r = new Reader(data, "Squads Proposal");
    r.o = 8;
    const multisig = r.pk();
    const transactionIndex = r.u64();
    const tag = r.u8();
    const status = SQUADS_PROPOSAL_STATUSES[tag];
    if (!status)
        throw new Error(`unknown Squads ProposalStatus ${tag}`);
    const statusTimestamp = status === "executing" ? null : r.i64();
    r.u8(); // bump
    const approved = r.vec(() => r.pk());
    const rejected = r.vec(() => r.pk());
    const cancelled = r.vec(() => r.pk());
    return { multisig, transactionIndex, status, statusTimestamp, approved, rejected, cancelled };
}
/**
 * When an approved proposal's transaction may execute: approval time + the multisig's
 * time_lock (vault_transaction_execute.rs / config_transaction_execute.rs / batch_execute:
 * `now - approved_timestamp >= time_lock`). Null unless the proposal is approved.
 */
export function squadsExecutableAt(p, timeLockSeconds) {
    if (p.status !== "approved" || p.statusTimestamp === null)
        return null;
    return p.statusTimestamp + BigInt(timeLockSeconds);
}
const PERIODS = ["OneTime", "Day", "Week", "Month"];
function readConfigAction(r) {
    const tag = r.u8();
    switch (tag) {
        case 0:
            return { type: "AddMember", newMember: { key: r.pk(), permissions: r.u8() } };
        case 1:
            return { type: "RemoveMember", oldMember: r.pk() };
        case 2:
            return { type: "ChangeThreshold", newThreshold: r.u16() };
        case 3:
            return { type: "SetTimeLock", newTimeLock: r.u32() };
        case 4: {
            const createKey = r.pk();
            const vaultIndex = r.u8();
            const mint = r.pk();
            const amount = r.u64();
            const p = r.u8();
            const period = PERIODS[p];
            if (!period)
                throw new Error(`unknown Squads Period ${p}`);
            const members = r.vec(() => r.pk());
            const destinations = r.vec(() => r.pk());
            return {
                type: "AddSpendingLimit",
                createKey,
                vaultIndex,
                mint,
                amount,
                period,
                members,
                destinations,
            };
        }
        case 5:
            return { type: "RemoveSpendingLimit", spendingLimit: r.pk() };
        case 6:
            return { type: "SetRentCollector", newRentCollector: r.opt(() => r.pk()) };
        default:
            throw new Error(`unknown Squads ConfigAction ${tag}`);
    }
}
/** Decodes the account at a transaction PDA: VaultTransaction, ConfigTransaction or Batch. */
export function decodeSquadsTransaction(data) {
    const kind = squadsAccountKind(data);
    const r = new Reader(data, `Squads ${kind ?? "transaction"}`);
    r.o = 8;
    if (kind === "VaultTransaction") {
        const multisig = r.pk();
        const creator = r.pk();
        const index = r.u64();
        r.u8(); // bump
        const vaultIndex = r.u8();
        r.u8(); // vault_bump
        const ephemeralSignerBumps = Array.from(r.bytes(r.u32()));
        const numSigners = r.u8();
        const numWritableSigners = r.u8();
        const numWritableNonSigners = r.u8();
        const accountKeys = r.vec(() => r.pk());
        const instructions = r.vec(() => ({
            programIdIndex: r.u8(),
            accountIndexes: Array.from(r.bytes(r.u32())),
            data: r.bytes(r.u32()),
        }));
        const addressTableLookups = r.vec(() => ({
            accountKey: r.pk(),
            writableIndexes: Array.from(r.bytes(r.u32())),
            readonlyIndexes: Array.from(r.bytes(r.u32())),
        }));
        return {
            kind: "vault",
            multisig,
            creator,
            index,
            vaultIndex,
            ephemeralSignerBumps,
            message: {
                numSigners,
                numWritableSigners,
                numWritableNonSigners,
                accountKeys,
                instructions,
                addressTableLookups,
            },
        };
    }
    if (kind === "ConfigTransaction") {
        const multisig = r.pk();
        const creator = r.pk();
        const index = r.u64();
        r.u8(); // bump
        const actions = r.vec(() => readConfigAction(r));
        return { kind: "config", multisig, creator, index, actions };
    }
    if (kind === "Batch") {
        const multisig = r.pk();
        const creator = r.pk();
        const index = r.u64();
        r.u8(); // bump
        const vaultIndex = r.u8();
        r.u8(); // vault_bump
        return {
            kind: "batch",
            multisig,
            creator,
            index,
            vaultIndex,
            size: r.u32(),
            executedTransactionIndex: r.u32(),
        };
    }
    throw new Error("not a Squads VaultTransaction, ConfigTransaction or Batch");
}
/** Program ids a vault transaction invokes (static keys only; a lookup-table program id is
 *  reported as "lookup"). */
export function squadsVaultTransactionPrograms(tx) {
    const keys = tx.message.accountKeys;
    return [
        ...new Set(tx.message.instructions.map((ix) => keys[ix.programIdIndex]?.toBase58() ?? "lookup")),
    ];
}
/**
 * A short, human-readable line for alerts: "config: SetTimeLock 172800" or
 * "vault #0: 2 ix → deep-amm, BPFLoaderUpgradeable". `names` maps program ids to labels.
 */
export function summarizeSquadsTransaction(tx, names = {}) {
    if (tx.kind === "config")
        return `config: ${tx.actions
            .map((a) => {
            switch (a.type) {
                case "AddMember":
                    return `AddMember ${a.newMember.key.toBase58()}`;
                case "RemoveMember":
                    return `RemoveMember ${a.oldMember.toBase58()}`;
                case "ChangeThreshold":
                    return `ChangeThreshold ${a.newThreshold}`;
                case "SetTimeLock":
                    return `SetTimeLock ${a.newTimeLock}`;
                case "AddSpendingLimit":
                    return `AddSpendingLimit vault #${a.vaultIndex}`;
                case "RemoveSpendingLimit":
                    return "RemoveSpendingLimit";
                case "SetRentCollector":
                    return `SetRentCollector ${a.newRentCollector?.toBase58() ?? "none"}`;
            }
        })
            .join(", ") || "no actions"}`;
    if (tx.kind === "batch")
        return `batch vault #${tx.vaultIndex}: ${tx.size} transaction(s)`;
    const progs = squadsVaultTransactionPrograms(tx).map((p) => names[p] ?? p);
    return `vault #${tx.vaultIndex}: ${tx.message.instructions.length} ix → ${progs.join(", ")}`;
}
//# sourceMappingURL=squads.js.map