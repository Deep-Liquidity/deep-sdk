/**
 * @deepliquidity/sdk — client bindings for programs/deep-curve.
 * Hand-written against the program's account/instruction layout; must be kept in
 * sync with programs/deep-curve/src/lib.rs (layout tests in test/sdk.test.ts).
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, } from "@solana/web3.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator, TOKEN_METADATA_PROGRAM_ID } from "./constants.js";
import { PYTH_SOL_USD_PRICE_UPDATE } from "./pyth.js";
export * from "./constants.js";
export * from "./events.js";
export * from "./raydium-cpmm.js";
export * from "./deep-amm.js";
export * from "./cpmm-liquidity.js";
export * from "./amm-events.js";
export * from "./lifecycle.js";
export * from "./pyth.js";
export * from "./config.js";
export * from "./program-data.js";
export * from "./pairs.js";
export * from "./cpmm-initialize.js";
export * from "./creator-links.js";
export * from "./squads.js";
export * from "./genesis.js";
const enc = new TextEncoder();
// ───────────── PDAs ─────────────
export function configPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("config")], programId)[0];
}
/** Program-owned PDA that accrues protocol trade fees and migration fees. */
export function treasuryPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("treasury")], programId)[0];
}
export function curvePda(mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("curve"), mint.toBytes()], programId)[0];
}
export function vaultAddress(mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return getAssociatedTokenAddressSync(mint, curvePda(mint, programId), true);
}
export function metadataPda(mint) {
    return PublicKey.findProgramAddressSync([enc.encode("metadata"), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()], TOKEN_METADATA_PROGRAM_ID)[0];
}
// ───────────── borsh ─────────────
class Writer {
    parts = [];
    bytes(b) {
        this.parts.push(b);
        return this;
    }
    u64(v) {
        if (v < 0n || v >= 1n << 64n)
            throw new RangeError("u64 out of range");
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigUint64(0, v, true);
        return this.bytes(b);
    }
    i64(v) {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigInt64(0, v, true);
        return this.bytes(b);
    }
    string(s) {
        const data = enc.encode(s);
        const len = new Uint8Array(4);
        new DataView(len.buffer).setUint32(0, data.length, true);
        return this.bytes(len).bytes(data);
    }
    finish() {
        const total = this.parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of this.parts) {
            out.set(p, o);
            o += p.length;
        }
        return Buffer.from(out);
    }
}
// ───────────── instructions ─────────────
export const METADATA_LIMITS = { name: 32, symbol: 10, uri: 200 };
export function validateMetadata(name, symbol, uri) {
    const len = (s) => enc.encode(s).length;
    if (!name.trim())
        return "Name is required";
    if (len(name) > METADATA_LIMITS.name)
        return `Name must be ≤ ${METADATA_LIMITS.name} bytes`;
    if (!symbol.trim())
        return "Symbol is required";
    if (len(symbol) > METADATA_LIMITS.symbol)
        return `Symbol must be ≤ ${METADATA_LIMITS.symbol} bytes`;
    if (len(uri) > METADATA_LIMITS.uri)
        return `Metadata URI must be ≤ ${METADATA_LIMITS.uri} bytes`;
    return null;
}
export function createTokenIx(a) {
    const programId = a.programId ?? DEEP_CURVE_PROGRAM_ID;
    const err = validateMetadata(a.name, a.symbol, a.uri);
    if (err)
        throw new Error(err);
    const curve = curvePda(a.mint, programId);
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.creator, isSigner: true, isWritable: true },
            { pubkey: configPda(programId), isSigner: false, isWritable: false },
            { pubkey: a.mint, isSigner: true, isWritable: true },
            { pubkey: curve, isSigner: false, isWritable: true },
            { pubkey: vaultAddress(a.mint, programId), isSigner: false, isWritable: true },
            { pubkey: metadataPda(a.mint), isSigner: false, isWritable: true },
            // Pyth SOL/USD PriceUpdateV2 (pinned on-chain; read only when the launch fee > 0)
            { pubkey: PYTH_SOL_USD_PRICE_UPDATE, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: new Writer()
            .bytes(discriminator("global", "create_token"))
            .string(a.name)
            .string(a.symbol)
            .string(a.uri)
            .finish(),
    });
}
function tradeIx(name, a) {
    const programId = a.programId ?? DEEP_CURVE_PROGRAM_ID;
    const curve = curvePda(a.mint, programId);
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.user, isSigner: true, isWritable: true },
            { pubkey: configPda(programId), isSigner: false, isWritable: false },
            { pubkey: a.mint, isSigner: false, isWritable: false },
            { pubkey: curve, isSigner: false, isWritable: true },
            { pubkey: vaultAddress(a.mint, programId), isSigner: false, isWritable: true },
            {
                pubkey: getAssociatedTokenAddressSync(a.mint, a.user),
                isSigner: false,
                isWritable: true,
            },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: new Writer()
            .bytes(discriminator("global", name))
            .u64(a.amount)
            .u64(a.minOut)
            .i64(a.deadline)
            .finish(),
    });
}
export const buyIx = (a) => tradeIx("buy", a);
export const sellIx = (a) => tradeIx("sell", a);
/** Emergency pause toggle. Only succeeds when `admin` is Config.admin (enforced on-chain). */
export function setPausedIx(admin, paused, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: false },
            { pubkey: configPda(programId), isSigner: false, isWritable: true },
        ],
        data: new Writer()
            .bytes(discriminator("global", "set_paused"))
            .bytes(new Uint8Array([paused ? 1 : 0]))
            .finish(),
    });
}
/** min-out after applying slippage tolerance (bps). Rounds down. */
export function applySlippage(expected, slippageBps) {
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000)
        throw new RangeError("slippage must be 0–5000 bps");
    return (expected * BigInt(10_000 - slippageBps)) / 10000n;
}
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateCurveIx). */
export const BONDING_CURVE_V1_SIZE = 8 + 32 + 32 + 8 * 6 + 2 * 3 + 8 + 1 + 1 + 8 + 1 + 32;
/** Byte size of BondingCurve v2 including the 8-byte discriminator (185). */
export const BONDING_CURVE_SIZE = BONDING_CURVE_V1_SIZE + 8;
/** Accepts v1 (177 B, not yet migrated) and v2 (185 B) accounts. */
export function decodeBondingCurve(data) {
    if (data.length < BONDING_CURVE_V1_SIZE)
        throw new Error("account too small for BondingCurve");
    const disc = discriminator("account", "BondingCurve");
    for (let i = 0; i < 8; i++)
        if (data[i] !== disc[i])
            throw new Error("not a BondingCurve account");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 8;
    const pk = () => {
        const k = new PublicKey(data.slice(o, o + 32));
        o += 32;
        return k;
    };
    const u64 = () => {
        const x = v.getBigUint64(o, true);
        o += 8;
        return x;
    };
    const u16 = () => {
        const x = v.getUint16(o, true);
        o += 2;
        return x;
    };
    const bool = () => data[o++] === 1;
    const mint = pk();
    const creator = pk();
    const virtualSolReserves = u64();
    const virtualTokenReserves = u64();
    const realSolReserves = u64();
    const realTokenReserves = u64();
    const curveSupply = u64();
    const tokenTotalSupply = u64();
    const protocolFeeBps = u16();
    const creatorFeeBps = u16();
    const migrationFeeBps = u16();
    const creatorFeesUnclaimed = u64();
    const complete = bool();
    const graduated = bool();
    const createdAt = v.getBigInt64(o, true);
    o += 8;
    const bump = data[o++];
    const pool = pk();
    const protocolFeesUnclaimed = data.length >= BONDING_CURVE_SIZE ? u64() : 0n;
    return {
        mint,
        creator,
        state: {
            virtualSolReserves,
            virtualTokenReserves,
            realSolReserves,
            realTokenReserves,
            curveSupply,
            tokenTotalSupply,
            complete,
        },
        protocolFeeBps,
        creatorFeeBps,
        migrationFeeBps,
        creatorFeesUnclaimed,
        graduated,
        createdAt,
        bump,
        pool,
        protocolFeesUnclaimed,
    };
}
/** Byte size of Config including the 8-byte discriminator. */
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateConfigIx). */
export const CONFIG_V1_SIZE = 8 + 32 * 4 + 2 * 3 + 8 * 4 + 1 + 1 + 1 + 32 + 4; // 213
/** Byte size of Config v2 (+u16 launch_fee_usd_cents). */
export const CONFIG_SIZE = CONFIG_V1_SIZE + 2; // 215
/** Accepts v1 (213 B) and v2 (215 B) accounts. */
export function decodeConfig(data) {
    if (data.length < CONFIG_V1_SIZE)
        throw new Error("account too small for Config");
    const disc = discriminator("account", "Config");
    for (let i = 0; i < 8; i++)
        if (data[i] !== disc[i])
            throw new Error("not a Config account");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 8;
    const pk = () => {
        const k = new PublicKey(data.slice(o, o + 32));
        o += 32;
        return k;
    };
    const u16 = () => {
        const x = v.getUint16(o, true);
        o += 2;
        return x;
    };
    const u64 = () => {
        const x = v.getBigUint64(o, true);
        o += 8;
        return x;
    };
    return {
        admin: pk(),
        pendingAdmin: pk(),
        feeRecipient: pk(),
        migrationAuthority: pk(),
        protocolFeeBps: u16(),
        creatorFeeBps: u16(),
        migrationFeeBps: u16(),
        initialVirtualSol: u64(),
        initialVirtualToken: u64(),
        curveSupply: u64(),
        tokenTotalSupply: u64(),
        decimals: data[o++],
        paused: data[o++] === 1,
        bump: data[o++],
        raydiumAmmConfig: pk(),
        timelockSeconds: v.getUint32(o, true),
        launchFeeUsdCents: data.length >= CONFIG_SIZE ? v.getUint16(o + 4, true) : 0,
    };
}
//# sourceMappingURL=index.js.map