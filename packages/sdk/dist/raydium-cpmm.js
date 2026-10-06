/**
 * Raydium CPMM (cp-swap) client, written from the program source
 * (github.com/raydium-io/raydium-cp-swap, Apache-2.0). We deliberately do NOT
 * depend on @raydium-io/raydium-sdk-v2, which is GPL-3.0.
 *
 * Layouts/seeds verified against programs/cp-swap/src at repo HEAD (2026-10).
 * The quote mirrors CurveCalculator::swap_base_input exactly (integer math).
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { discriminator } from "./constants.js";
export const CPMM_PROGRAM_ID = {
    devnet: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
    mainnet: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
};
/**
 * DeepSwap's own CPMM (programs/deep-amm, a fork of raydium-cp-swap): same layouts,
 * seeds and instructions as cp-swap, so every helper in this file works with it by
 * passing this program id. Same id on every cluster.
 */
export const DEEP_AMM_PROGRAM_ID = new PublicKey("HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP");
/**
 * deep-amm's create-pool-fee WSOL account is fixed at BUILD time
 * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). Fill these in per cluster once deep-amm is
 * deployed; until then callers must pass it explicitly (graduateIx throws).
 */
export const DEEP_AMM_CREATE_POOL_FEE_RECEIVER = {
    devnet: null,
    mainnet: null,
};
export const CPMM_FEE_DENOMINATOR = 1000000n;
const enc = new TextEncoder();
const seed = (s) => enc.encode(s);
// ───────────── PDAs ─────────────
/** Raydium requires mint0 < mint1 by raw bytes. */
export function sortMints(a, b) {
    return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
}
export function cpmmAuthority(programId) {
    return PublicKey.findProgramAddressSync([seed("vault_and_lp_mint_auth_seed")], programId)[0];
}
export function cpmmPoolPda(programId, ammConfig, mintA, mintB) {
    const [m0, m1] = sortMints(mintA, mintB);
    return PublicKey.findProgramAddressSync([seed("pool"), ammConfig.toBuffer(), m0.toBuffer(), m1.toBuffer()], programId)[0];
}
export function cpmmLpMint(programId, pool) {
    return PublicKey.findProgramAddressSync([seed("pool_lp_mint"), pool.toBuffer()], programId)[0];
}
export function cpmmVault(programId, pool, mint) {
    return PublicKey.findProgramAddressSync([seed("pool_vault"), pool.toBuffer(), mint.toBuffer()], programId)[0];
}
export function cpmmObservation(programId, pool) {
    return PublicKey.findProgramAddressSync([seed("observation"), pool.toBuffer()], programId)[0];
}
/** 8 + 10·32 + 5 + 7·8 + 2 + 6 + 2·8 + 28·8 */
export const CPMM_POOL_STATE_SIZE = 637;
function reader(data) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 8;
    return {
        pk: () => {
            const k = new PublicKey(data.slice(o, o + 32));
            o += 32;
            return k;
        },
        u8: () => data[o++],
        u16: () => {
            const x = v.getUint16(o, true);
            o += 2;
            return x;
        },
        u64: () => {
            const x = v.getBigUint64(o, true);
            o += 8;
            return x;
        },
        skip: (n) => {
            o += n;
        },
    };
}
function checkDisc(data, name, minSize) {
    if (data.length < minSize)
        throw new Error(`${name}: account too small`);
    const d = discriminator("account", name);
    for (let i = 0; i < 8; i++)
        if (data[i] !== d[i])
            throw new Error(`not a ${name} account`);
}
export function decodeCpmmPoolState(data) {
    checkDisc(data, "PoolState", CPMM_POOL_STATE_SIZE);
    const r = reader(data);
    const s = {
        ammConfig: r.pk(),
        poolCreator: r.pk(),
        token0Vault: r.pk(),
        token1Vault: r.pk(),
        lpMint: r.pk(),
        token0Mint: r.pk(),
        token1Mint: r.pk(),
        token0Program: r.pk(),
        token1Program: r.pk(),
        observationKey: r.pk(),
        authBump: r.u8(),
        status: r.u8(),
        lpMintDecimals: r.u8(),
        mint0Decimals: r.u8(),
        mint1Decimals: r.u8(),
        lpSupply: r.u64(),
        protocolFeesToken0: r.u64(),
        protocolFeesToken1: r.u64(),
        fundFeesToken0: r.u64(),
        fundFeesToken1: r.u64(),
        openTime: r.u64(),
        recentEpoch: r.u64(),
        creatorFeeOn: r.u8(),
        enableCreatorFee: r.u8() === 1,
        creatorFeesToken0: 0n,
        creatorFeesToken1: 0n,
    };
    r.skip(6);
    s.creatorFeesToken0 = r.u64();
    s.creatorFeesToken1 = r.u64();
    return s;
}
export function decodeCpmmAmmConfig(data) {
    checkDisc(data, "AmmConfig", 8 + 1 + 1 + 2 + 8 * 4 + 64 + 8);
    const r = reader(data);
    return {
        bump: r.u8(),
        disableCreatePool: r.u8() === 1,
        index: r.u16(),
        tradeFeeRate: r.u64(),
        protocolFeeRate: r.u64(),
        fundFeeRate: r.u64(),
        createPoolFee: r.u64(),
        protocolOwner: r.pk(),
        fundOwner: r.pk(),
        creatorFeeRate: r.u64(),
        // carved out of the account's zero padding (deep-amm states/config.rs)
        creatorFeeShareRate: data.length >= 124 ? r.u64() : 0n,
    };
}
/** Tradable reserves = vault balance minus accrued, unclaimed fees. */
export function cpmmReserves(pool, vault0, vault1) {
    const f0 = pool.protocolFeesToken0 + pool.fundFeesToken0 + pool.creatorFeesToken0;
    const f1 = pool.protocolFeesToken1 + pool.fundFeesToken1 + pool.creatorFeesToken1;
    if (f0 > vault0 || f1 > vault1)
        throw new Error("pool fees exceed vault balance");
    return [vault0 - f0, vault1 - f1];
}
/** `Fees::creator_fee_shared_amount` + `split_creator_fee_shared_amount`: the protocol's
 * share rounds DOWN, so the odd unit stays with the creator. */
export function splitCreatorFee(creatorFee, shareRate) {
    if (creatorFee < 0n)
        throw new RangeError("creatorFee must be >= 0");
    if (shareRate < 0n || shareRate > CPMM_FEE_DENOMINATOR)
        throw new RangeError("shareRate must be within 0..=1_000_000");
    const protocol = (creatorFee * shareRate) / CPMM_FEE_DENOMINATOR;
    return { creator: creatorFee - protocol, protocol };
}
/**
 * The total fee rate a swap on `pool` pays (per 1e6): the trade fee, plus the creator fee
 * when the pool has it enabled. Presentation only: amounts come from the quote, because
 * the two fees can be charged on different sides of the swap.
 */
export function cpmmTotalFeeRate(config, pool) {
    return config.tradeFeeRate + (pool.enableCreatorFee ? config.creatorFeeRate : 0n);
}
export const cpmmSwapEnabled = (pool, nowSec) => (pool.status & 4) === 0 && nowSec >= pool.openTime;
// ───────────── quote (mirrors CurveCalculator::swap_base_input) ─────────────
const ceilDiv = (a, n, d) => (a * n + d - 1n) / d;
const floorDiv = (a, n, d) => (a * n) / d;
export function quoteCpmmSwapBaseInput(args) {
    const { amountIn: x, inputReserve: X, outputReserve: Y, config } = args;
    if (x <= 0n)
        throw new RangeError("amountIn must be > 0");
    if (X <= 0n || Y <= 0n)
        throw new RangeError("empty pool");
    const tr = config.tradeFeeRate;
    const cr = args.creatorFeeEnabled ? config.creatorFeeRate : 0n;
    const D = CPMM_FEE_DENOMINATOR;
    let creatorFee = 0n;
    let tradeFee;
    let inLessFees;
    if (args.creatorFeeOnInput) {
        const total = ceilDiv(x, tr + cr, D);
        creatorFee = tr + cr === 0n ? 0n : floorDiv(total, cr, tr + cr);
        tradeFee = total - creatorFee;
        inLessFees = x - total;
    }
    else {
        tradeFee = ceilDiv(x, tr, D);
        inLessFees = x - tradeFee;
    }
    const swapped = (inLessFees * Y) / (X + inLessFees);
    let out = swapped;
    if (!args.creatorFeeOnInput) {
        creatorFee = ceilDiv(swapped, cr, D);
        out = swapped - creatorFee;
    }
    const spot = (inLessFees * Y) / X;
    const impact = spot === 0n ? 0n : ((spot - swapped) * 10000n) / spot;
    return { amountIn: x, amountOut: out, tradeFee, creatorFee, priceImpactBps: impact };
}
/** Which side is input, and whether the creator fee is charged on it. */
export function cpmmDirection(pool, inputMint) {
    const zeroForOne = inputMint.equals(pool.token0Mint);
    if (!zeroForOne && !inputMint.equals(pool.token1Mint))
        throw new Error("mint not in pool");
    const creatorFeeOnInput = pool.creatorFeeOn === 0 ||
        (pool.creatorFeeOn === 1 && zeroForOne) ||
        (pool.creatorFeeOn === 2 && !zeroForOne);
    return { zeroForOne, creatorFeeOnInput };
}
export function cpmmSwapBaseInputIx(a) {
    const { zeroForOne } = cpmmDirection(a.pool, a.inputMint);
    const p = a.pool;
    const [inMint, outMint] = zeroForOne
        ? [p.token0Mint, p.token1Mint]
        : [p.token1Mint, p.token0Mint];
    const [inVault, outVault] = zeroForOne
        ? [p.token0Vault, p.token1Vault]
        : [p.token1Vault, p.token0Vault];
    const [inProg, outProg] = zeroForOne
        ? [p.token0Program, p.token1Program]
        : [p.token1Program, p.token0Program];
    const inAta = a.inputTokenAccount ?? getAssociatedTokenAddressSync(inMint, a.payer, false, inProg);
    const outAta = a.outputTokenAccount ?? getAssociatedTokenAddressSync(outMint, a.payer, false, outProg);
    const data = Buffer.alloc(8 + 16);
    data.set(discriminator("global", "swap_base_input"), 0);
    data.writeBigUInt64LE(a.amountIn, 8);
    data.writeBigUInt64LE(a.minimumAmountOut, 16);
    return new TransactionInstruction({
        programId: a.programId,
        keys: [
            { pubkey: a.payer, isSigner: true, isWritable: false },
            { pubkey: cpmmAuthority(a.programId), isSigner: false, isWritable: false },
            { pubkey: p.ammConfig, isSigner: false, isWritable: false },
            { pubkey: a.poolId, isSigner: false, isWritable: true },
            { pubkey: inAta, isSigner: false, isWritable: true },
            { pubkey: outAta, isSigner: false, isWritable: true },
            { pubkey: inVault, isSigner: false, isWritable: true },
            { pubkey: outVault, isSigner: false, isWritable: true },
            { pubkey: inProg, isSigner: false, isWritable: false },
            { pubkey: outProg, isSigner: false, isWritable: false },
            { pubkey: inMint, isSigner: false, isWritable: false },
            { pubkey: outMint, isSigner: false, isWritable: false },
            { pubkey: p.observationKey, isSigner: false, isWritable: true },
        ],
        data,
    });
}
export { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID };
//# sourceMappingURL=raydium-cpmm.js.map