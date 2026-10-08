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
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction, } from "@solana/web3.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";
export { BUILDER_SPLIT_BPS, DEFAULT_MIN_DISTRIBUTE_LAMPORTS, MAX_MIN_DISTRIBUTE_LAMPORTS, MAX_SPLIT_DESTINATIONS, SPLIT_BPS_DENOMINATOR, splitRound, } from "@deepliquidity/curve-math";
const enc = new TextEncoder();
const pda = (seed, programId) => PublicKey.findProgramAddressSync([enc.encode(seed)], programId)[0];
/** System-owned, data-less PDA that receives all DEEP revenue. */
export function feeVaultPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda("fee_vault", programId);
}
/** The vault's WSOL ATA: DeepSwap protocol fees and the create-pool fee arrive here. */
export function feeVaultWsolAta(programId = DEEP_CURVE_PROGRAM_ID) {
    return getAssociatedTokenAddressSync(NATIVE_MINT, feeVaultPda(programId), true);
}
export function splitterPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda("splitter", programId);
}
export function pendingSplitterPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda("pending_splitter", programId);
}
/** Temporary WSOL account `distribute` creates and closes to unwrap the vault's WSOL. */
export function wsolUnwrapPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda("wsol_unwrap", programId);
}
/**
 * The fee vault of deep-curve 7czUR…CDtA, the same on every cluster (one program id). deep-amm
 * compiles it in (env DEEP_FEE_VAULT) as the only possible AmmConfig protocol owner, and its
 * WSOL ATA as the create-pool fee receiver (DEEP_AMM_CREATE_POOL_FEE_RECEIVER).
 */
export const DEEP_FEE_VAULT = new PublicKey("8a2XakVBzdMRJ6gMY6u8mvebzJGgbmG6nVBVPB8uwBVZ");
export const DEEP_FEE_VAULT_WSOL = new PublicKey("EcnANJ5kYr7a8LpiH4ETkSGD3r7SDdicUn9ttf5MWCir");
/** deep-curve DeepError codes appended for the splitter (6029..). */
export const SPLITTER_ERRORS = {
    InvalidBuilder: 6027,
    BuilderNotRentExempt: 6028,
    InvalidSplitterParams: 6029,
    SplitterUpdatePending: 6030,
    NoPendingSplitterUpdate: 6031,
    BelowMinDistribute: 6032,
    InvalidDestination: 6033,
    DestinationHasOwed: 6034,
    InvalidFeeVault: 6035,
    InvalidVaultToken: 6036,
};
/**
 * Addresses the program refuses as a 90% destination (deep-curve `never_a_destination`), in
 * its order: nobody could ever sign for what they receive. The zero key (also the system
 * program id), the fee vault and its WSOL account, the splitter config and its pending change,
 * Config and PendingConfig, the temporary unwrap account, the legacy treasury, the graduation
 * pool payer, the three DEEP programs, the two token programs, the ATA program and the WSOL
 * mint.
 */
export function neverADestination(programId = DEEP_CURVE_PROGRAM_ID) {
    const vault = feeVaultPda(programId);
    return [
        PublicKey.default,
        vault,
        getAssociatedTokenAddressSync(NATIVE_MINT, vault, true),
        splitterPda(programId),
        pendingSplitterPda(programId),
        pda("config", programId),
        pda("pending_config", programId),
        wsolUnwrapPda(programId),
        pda("treasury", programId),
        pda("pool_creator", programId),
        programId,
        new PublicKey("HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP"),
        new PublicKey("4z2KpxUcdNFXFpzxKtcmTv6aDMqE4CMLCdbYExLYeDE2"),
        TOKEN_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        NATIVE_MINT,
    ];
}
/** Client-side mirror of SplitterParams::validate (the program re-checks everything). */
export function validateSplitterParams(p, opts = {}) {
    const pid = opts.programId ?? DEEP_CURVE_PROGRAM_ID;
    const n = p.destinations.length;
    if (n < 1 || n > 8)
        return "1 to 8 destinations";
    if (p.minDistributeLamports <= 0n || p.minDistributeLamports > 10000000000n)
        return "minimum distribute amount must be 1 lamport to 10 SOL";
    const forbidden = [...neverADestination(pid), ...(opts.builder ? [opts.builder] : [])];
    let sum = 0;
    const seen = new Set();
    for (const d of p.destinations) {
        if (!Number.isInteger(d.bps) || d.bps <= 0 || d.bps > 10_000)
            return "bps must be 1..10000";
        sum += d.bps;
        if (forbidden.some((f) => f.equals(d.wallet)))
            return `${d.wallet.toBase58()} cannot be a destination (the builder, the zero key, a deep-curve account or PDA, or a program nobody can sign for)`;
        if (seen.has(d.wallet.toBase58()))
            return "duplicate destination";
        seen.add(d.wallet.toBase58());
    }
    if (sum !== 10_000)
        return `bps sum to ${sum}, must be exactly 10000`;
    return null;
}
/** Borsh SplitterParams: Vec<{ wallet, bps: u16 }> then min_distribute_lamports: u64. */
export function encodeSplitterParams(p) {
    const out = Buffer.alloc(4 + p.destinations.length * 34 + 8);
    out.writeUInt32LE(p.destinations.length, 0);
    p.destinations.forEach((d, i) => {
        out.set(d.wallet.toBytes(), 4 + i * 34);
        out.writeUInt16LE(d.bps, 4 + i * 34 + 32);
    });
    out.writeBigUInt64LE(p.minDistributeLamports, 4 + p.destinations.length * 34);
    return out;
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({
    pubkey,
    isSigner,
    isWritable,
});
const configPdaOf = (pid) => pda("config", pid);
/** One-time (Config.admin): SplitterConfig + vault rent + the vault's WSOL ATA. */
export function initializeSplitterIx(admin, params, programId = DEEP_CURVE_PROGRAM_ID) {
    const vault = feeVaultPda(programId);
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, true, true),
            meta(configPdaOf(programId)),
            meta(splitterPda(programId), true),
            meta(vault, true),
            meta(getAssociatedTokenAddressSync(NATIVE_MINT, vault, true), true),
            meta(NATIVE_MINT),
            meta(TOKEN_PROGRAM_ID),
            meta(ASSOCIATED_TOKEN_PROGRAM_ID),
            meta(SystemProgram.programId),
        ],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "initialize_splitter")),
            encodeSplitterParams(params),
        ]),
    });
}
/** Timelocked destination change, step 1 (admin). eta = now + Config.timelock_seconds. */
export function queueSplitterUpdateIx(admin, params, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, true, true),
            meta(configPdaOf(programId)),
            meta(splitterPda(programId)),
            meta(pendingSplitterPda(programId), true),
            meta(SystemProgram.programId),
        ],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "queue_splitter_update")),
            encodeSplitterParams(params),
        ]),
    });
}
/** Step 2, PERMISSIONLESS once eta has passed (within the 14-day grace window). */
export function applySplitterUpdateIx(programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(splitterPda(programId), true), meta(pendingSplitterPda(programId), true)],
        data: Buffer.from(discriminator("global", "apply_splitter_update")),
    });
}
/** Admin veto of the queued change. */
export function cancelSplitterUpdateIx(admin, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, false, true),
            meta(configPdaOf(programId)),
            meta(pendingSplitterPda(programId), true),
        ],
        data: Buffer.from(discriminator("global", "cancel_splitter_update")),
    });
}
/**
 * PERMISSIONLESS `distribute`. `payer` (signer, writable) is whoever sends it: when the vault
 * holds WSOL it fronts the rent of the temporary unwrap account (0.00203928 SOL) and gets
 * exactly that back in the same instruction, so the vault needs no spare lamports; it pays
 * and receives nothing else. `builder` is the deployed build's DEEP_BUILDER_WALLET (any other
 * key fails InvalidBuilder); `destinations` are the SplitterConfig's wallets in config order
 * (read them with `decodeSplitterConfig`). Request ~120k CU for 8 destinations with WSOL to
 * unwrap (DISTRIBUTE_COMPUTE_UNITS).
 */
export function distributeIx(a) {
    const pid = a.programId ?? DEEP_CURVE_PROGRAM_ID;
    const vault = feeVaultPda(pid);
    return new TransactionInstruction({
        programId: pid,
        keys: [
            meta(a.payer, true, true),
            meta(splitterPda(pid), true),
            meta(vault, true),
            meta(getAssociatedTokenAddressSync(NATIVE_MINT, vault, true), true),
            meta(wsolUnwrapPda(pid), true),
            meta(NATIVE_MINT),
            meta(a.builder, true),
            meta(TOKEN_PROGRAM_ID),
            meta(SystemProgram.programId),
            ...a.destinations.map((d) => meta(d, true)),
        ],
        data: Buffer.from(discriminator("global", "distribute")),
    });
}
export const DISTRIBUTE_COMPUTE_UNITS = 200_000;
/**
 * Admin: move a NON-WSOL token (SPL Token or Token-2022) out of the vault's ATA (legacy
 * token-side DeepSwap protocol fees) to `recipientToken`, a token account owned by
 * Config.fee_recipient. Outside the split (docs/V1_FEES.md Q12).
 */
export function withdrawVaultTokensIx(a) {
    const pid = a.programId ?? DEEP_CURVE_PROGRAM_ID;
    const tp = a.tokenProgram ?? TOKEN_PROGRAM_ID;
    const vault = feeVaultPda(pid);
    const data = Buffer.alloc(16);
    data.set(discriminator("global", "withdraw_vault_tokens"), 0);
    data.writeBigUInt64LE(a.amount, 8);
    return new TransactionInstruction({
        programId: pid,
        keys: [
            meta(a.admin, false, true),
            meta(configPdaOf(pid)),
            meta(splitterPda(pid)),
            meta(vault),
            meta(a.mint),
            meta(getAssociatedTokenAddressSync(a.mint, vault, true, tp), true),
            meta(a.recipientToken, true),
            meta(tp),
        ],
        data,
    });
}
/** 8 + 3 + 8·50 + 16 + 7·8 + 56. */
export const SPLITTER_CONFIG_SIZE = 539;
export function decodeSplitterConfig(data) {
    if (data.length < SPLITTER_CONFIG_SIZE)
        throw new Error("account too small for SplitterConfig");
    const disc = discriminator("account", "SplitterConfig");
    for (let i = 0; i < 8; i++)
        if (data[i] !== disc[i])
            throw new Error("not a SplitterConfig account");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const bump = data[8];
    const vaultBump = data[9];
    const count = data[10];
    if (count > 8)
        throw new Error("SplitterConfig: bad destination count");
    const destinations = [];
    for (let i = 0; i < count; i++) {
        const o = 11 + i * 50;
        destinations.push({
            wallet: new PublicKey(data.slice(o, o + 32)),
            bps: v.getUint16(o + 32, true),
            owed: v.getBigUint64(o + 34, true),
            paidTotal: v.getBigUint64(o + 42, true),
        });
    }
    let o = 11 + 8 * 50;
    const lo = v.getBigUint64(o, true);
    const hi = v.getBigUint64(o + 8, true);
    o += 16;
    const u64 = () => {
        const x = v.getBigUint64(o, true);
        o += 8;
        return x;
    };
    const builderPaidTotal = u64();
    const retained = u64();
    const minDistributeLamports = u64();
    const distributions = u64();
    const lastDistributeAt = v.getBigInt64(o, true);
    o += 8;
    return {
        bump,
        vaultBump,
        destinations,
        baseTotal: (hi << 64n) | lo,
        builderPaidTotal,
        retained,
        minDistributeLamports,
        distributions,
        lastDistributeAt,
        destinationsPaidTotal: u64(),
        builderOwed: u64(),
    };
}
export function decodePendingSplitterUpdate(data) {
    const disc = discriminator("account", "PendingSplitterUpdate");
    if (data.length < 8 + 1 + 16 + 4 + 8)
        throw new Error("account too small");
    for (let i = 0; i < 8; i++)
        if (data[i] !== disc[i])
            throw new Error("not a PendingSplitterUpdate account");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = v.getUint32(25, true);
    if (n > 8)
        throw new Error("PendingSplitterUpdate: bad destination count");
    const destinations = [];
    for (let i = 0; i < n; i++) {
        const o = 29 + i * 34;
        destinations.push({
            wallet: new PublicKey(data.slice(o, o + 32)),
            bps: v.getUint16(o + 32, true),
        });
    }
    return {
        active: data[8] === 1,
        eta: v.getBigInt64(9, true),
        queuedAt: v.getBigInt64(17, true),
        params: { destinations, minDistributeLamports: v.getBigUint64(29 + n * 34, true) },
    };
}
// ───────────── schedule ─────────────
/**
 * The owner's auto-send schedule (2026-10-06): `distribute` at 00:00 and 12:00
 * America/Los_Angeles, DST-aware. Returns the next such instant strictly after `now`.
 * Pure (Intl only), so the keeper, API and UI agree.
 */
export function nextDistributionAt(now, timeZone = "America/Los_Angeles") {
    const hours = [0, 12];
    // Walk forward hour by hour (at most 13 steps + DST slack) to the next local 00:00 / 12:00.
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hourCycle: "h23",
    });
    const local = (d) => {
        const parts = fmt.formatToParts(d);
        const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
        return { h: get("hour"), m: get("minute"), s: get("second") };
    };
    // Start at the next whole minute boundary after `now`, aligned to the local hour.
    const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
    const l = local(start);
    let t = new Date(start.getTime() - l.m * 60_000 - l.s * 1000);
    if (t.getTime() <= now.getTime())
        t = new Date(t.getTime() + 3_600_000);
    for (let i = 0; i < 30; i++) {
        const x = local(t);
        if (x.m === 0 && hours.includes(x.h) && t.getTime() > now.getTime())
            return t;
        t = new Date(t.getTime() + 3_600_000);
    }
    throw new Error("nextDistributionAt: no slot found");
}
//# sourceMappingURL=splitter.js.map