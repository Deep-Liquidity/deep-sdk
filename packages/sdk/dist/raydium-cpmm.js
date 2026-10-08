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
import { deepSwapPoolRates, quoteDeepSwapExactIn as quoteV1ExactIn, quoteDeepSwapExactOut as quoteV1ExactOut, } from "@deepliquidity/curve-math";
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
 * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). DEEP V1: on every cluster it is the DEEP fee vault's
 * WSOL ATA (`feeVaultWsolAta()` in splitter.ts), so the create-pool fee is DEEP revenue that
 * goes through the splitter (builder 10%). Builds before V1 used the fee owner's WSOL ATA.
 */
export const DEEP_AMM_CREATE_POOL_FEE_RECEIVER = {
    devnet: new PublicKey("EcnANJ5kYr7a8LpiH4ETkSGD3r7SDdicUn9ttf5MWCir"),
    mainnet: new PublicKey("EcnANJ5kYr7a8LpiH4ETkSGD3r7SDdicUn9ttf5MWCir"),
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
/** 8 + 1 + 1 + 2 + 4·8 + 2·32 + 8 + 8 + 14·8 */
export const CPMM_AMM_CONFIG_SIZE = 236;
/** `AmmConfig.fee_model` / `PoolState.fee_model` values (deep-amm states/config.rs). */
export const DEEP_AMM_FEE_MODEL = { legacy: 0, v1: 1 };
/**
 * Byte offsets of the DEEP V1 fields, INCLUDING the 8-byte account discriminator
 * (`POOL_STATE_*_OFFSET` in deep-amm states/pool.rs). They were carved out of the account's
 * zero padding, so the size is unchanged and an older pool reads 0 everywhere.
 */
export const CPMM_POOL_STATE_V1_OFFSETS = {
    /** u8 */
    feeModel: 413,
    /** u8 */
    rewardModel: 414,
    /** u64 LE (`reward_rate_snapshot`) */
    rewardRate: 421,
};
/**
 * Byte offsets of the DEEP V1 fields of an AmmConfig, INCLUDING the 8-byte discriminator
 * (`AMM_CONFIG_*_OFFSET` in deep-amm states/config.rs). `feeModel` is a u8, the rates u64 LE.
 */
export const CPMM_AMM_CONFIG_V1_OFFSETS = {
    feeModel: 124,
    buyLpFeeRate: 132,
    buyProtocolFeeRate: 140,
    sellLpFeeRate: 148,
    sellProtocolFeeRate: 156,
    maxRewardRate: 164,
};
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
        feeModel: 0,
        rewardModel: 0,
        rewardRate: 0n,
    };
    r.skip(6);
    s.creatorFeesToken0 = r.u64();
    s.creatorFeesToken1 = r.u64();
    // DEEP V1, carved out of the zero padding (deep-amm states/pool.rs)
    s.feeModel = r.u8();
    s.rewardModel = r.u8();
    r.skip(6);
    s.rewardRate = r.u64();
    return s;
}
export function decodeCpmmAmmConfig(data) {
    checkDisc(data, "AmmConfig", 8 + 1 + 1 + 2 + 8 * 4 + 64 + 8);
    const r = reader(data);
    // DEEP V1 fields, carved out of the zero padding: absent (zero) on a shorter upstream account
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const O = CPMM_AMM_CONFIG_V1_OFFSETS;
    const hasV1 = data.length >= O.maxRewardRate + 8;
    const v1Rate = (o) => (hasV1 ? v.getBigUint64(o, true) : 0n);
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
        feeModel: hasV1 ? data[O.feeModel] : 0,
        buyLpFeeRate: v1Rate(O.buyLpFeeRate),
        buyProtocolFeeRate: v1Rate(O.buyProtocolFeeRate),
        sellLpFeeRate: v1Rate(O.sellLpFeeRate),
        sellProtocolFeeRate: v1Rate(O.sellProtocolFeeRate),
        maxRewardRate: v1Rate(O.maxRewardRate),
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
 * The fee model `pool` is priced with. deep-amm refuses a swap when the pool and its
 * AmmConfig are not of the same model (`FeeModelMismatch`, 6020), and so does this.
 */
export function cpmmFeeModel(config, pool) {
    if (pool.feeModel !== config.feeModel)
        throw new Error(`fee model mismatch: pool ${pool.feeModel}, AmmConfig ${config.feeModel} (wrong config for this pool?)`);
    if (pool.feeModel !== DEEP_AMM_FEE_MODEL.legacy && pool.feeModel !== DEEP_AMM_FEE_MODEL.v1)
        throw new Error(`unknown fee model ${pool.feeModel}`);
    return pool.feeModel;
}
/**
 * The rates (per 1e6) one swap of a V1 pool is charged at (`PoolState::v1_rates`): the LP and
 * protocol rates of that side from the pool's AmmConfig, and the pool's own reward rate (0
 * for a Standard pool), exactly as stored: never clamped. `isBuy`: the swap's input is the
 * pool's quote token (`cpmmDirection(...).creatorFeeOnInput`). Throws unless both the pool
 * and the config are V1, and where the program refuses to price (LP + protocol above 5%, or a
 * reward rate above 5%: neither can be stored).
 */
export function deepSwapV1Rates(config, pool, isBuy) {
    if (cpmmFeeModel(config, pool) !== DEEP_AMM_FEE_MODEL.v1)
        throw new Error("not a V1 pool: a legacy pool is priced with the AmmConfig's legacy rates");
    return deepSwapPoolRates({
        isBuy,
        rewardModel: pool.rewardModel,
        rewardRateSnapshot: pool.rewardRate,
        buyLpFeeRate: config.buyLpFeeRate,
        buyProtocolFeeRate: config.buyProtocolFeeRate,
        sellLpFeeRate: config.sellLpFeeRate,
        sellProtocolFeeRate: config.sellProtocolFeeRate,
    });
}
/**
 * The total fee rate a swap on `pool` pays (per 1e6). Presentation only: amounts come from
 * the quote.
 *
 * Legacy pool: the trade fee, plus the creator fee when the pool has it enabled (the two can
 * be charged on different sides of the swap). `isBuy` is ignored.
 *
 * DEEP V1 pool (`pool.feeModel === 1`): LP + protocol + reward of ONE side, so pass `isBuy`
 * (the input is the pool's quote token). Without it the result is the HIGHER of the two
 * sides, i.e. the most a swap of this pool pays. A V1 pool needs the V1 fields of both
 * arguments (a decoded PoolState and AmmConfig have them) and throws without them.
 */
export function cpmmTotalFeeRate(config, pool, isBuy) {
    const poolModel = pool.feeModel ?? DEEP_AMM_FEE_MODEL.legacy;
    // an argument without the V1 fields is a legacy one: it must not price a V1 counterpart
    const model = cpmmFeeModel({ feeModel: config.feeModel ?? DEEP_AMM_FEE_MODEL.legacy }, { feeModel: poolModel });
    if (model === DEEP_AMM_FEE_MODEL.legacy)
        return config.tradeFeeRate + (pool.enableCreatorFee ? config.creatorFeeRate : 0n);
    const { buyLpFeeRate, buyProtocolFeeRate, sellLpFeeRate, sellProtocolFeeRate } = config;
    const { rewardModel, rewardRate } = pool;
    if (buyLpFeeRate === undefined ||
        buyProtocolFeeRate === undefined ||
        sellLpFeeRate === undefined ||
        sellProtocolFeeRate === undefined ||
        rewardModel === undefined ||
        rewardRate === undefined)
        throw new Error("a V1 pool's fee rate needs the V1 fields of the pool and its AmmConfig");
    const total = (buy) => {
        const r = deepSwapV1Rates({ feeModel: model, buyLpFeeRate, buyProtocolFeeRate, sellLpFeeRate, sellProtocolFeeRate }, { feeModel: model, rewardModel, rewardRate }, buy);
        return r.lpRate + r.protocolRate + r.rewardRate;
    };
    if (isBuy !== undefined)
        return total(isBuy);
    const [buy, sell] = [total(true), total(false)];
    return buy > sell ? buy : sell;
}
/**
 * What a swap of `pool` pays on each side, per 1e6, with its parts. `buy`: the swap's input
 * is the pool's quote token; `sell`: its output is. Presentation only; amounts come from the
 * quotes.
 *
 * DEEP V1 pool: the AmmConfig's LP and protocol rates of the side plus the pool's own reward
 * rate (`deepSwapV1Rates`). Legacy pool: both sides are the same, the trade fee split by the
 * config's protocol and fund shares (floored, the rest is the LPs') plus the creator fee when
 * enabled. Throws when `config` is not of the pool's fee model.
 */
export function cpmmPoolFeeRates(config, pool) {
    if (cpmmFeeModel(config, pool) === DEEP_AMM_FEE_MODEL.v1) {
        const side = (isBuy) => {
            const r = deepSwapV1Rates(config, pool, isBuy);
            return {
                lp: r.lpRate,
                protocol: r.protocolRate,
                reward: r.rewardRate,
                total: r.lpRate + r.protocolRate + r.rewardRate,
            };
        };
        return { buy: side(true), sell: side(false) };
    }
    const protocol = floorDiv(config.tradeFeeRate, config.protocolFeeRate, CPMM_FEE_DENOMINATOR) +
        floorDiv(config.tradeFeeRate, config.fundFeeRate, CPMM_FEE_DENOMINATOR);
    const reward = pool.enableCreatorFee ? config.creatorFeeRate : 0n;
    const side = {
        lp: config.tradeFeeRate - protocol,
        protocol,
        reward,
        total: config.tradeFeeRate + reward,
    };
    return { buy: side, sell: { ...side } };
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
/**
 * Exact output on a LEGACY pool: mirrors `CurveCalculator::swap_base_output`. `amountOut` is
 * what the trader receives; a creator fee charged on the output is added on top of it before
 * the curve. Throws where the program fails: the (gross) output must be less than the output
 * reserve. For a DEEP V1 pool use `quoteDeepSwapExactOut`.
 */
export function quoteCpmmSwapBaseOutput(args) {
    const { amountOut: y, inputReserve: X, outputReserve: Y, config } = args;
    if (y <= 0n)
        throw new RangeError("amountOut must be > 0");
    if (X <= 0n || Y <= 0n)
        throw new RangeError("empty pool");
    const tr = config.tradeFeeRate;
    const cr = args.creatorFeeEnabled ? config.creatorFeeRate : 0n;
    const D = CPMM_FEE_DENOMINATOR;
    if (tr < 0n || cr < 0n || tr + cr >= D)
        throw new RangeError("fee rates out of range");
    // Fees::calculate_pre_fee_amount: ceil(post * 1e6 / (1e6 - rate))
    const preFee = (post, rate) => rate === 0n ? post : (post * D + (D - rate) - 1n) / (D - rate);
    let creatorFee = 0n;
    let actualOut = y;
    if (!args.creatorFeeOnInput) {
        actualOut = preFee(y, cr);
        creatorFee = actualOut - y;
    }
    if (actualOut >= Y)
        throw new RangeError("amountOut is the whole output reserve or more");
    const swapped = (X * actualOut + (Y - actualOut) - 1n) / (Y - actualOut);
    let tradeFee;
    let amountIn;
    if (args.creatorFeeOnInput) {
        amountIn = preFee(swapped, tr + cr);
        const total = amountIn - swapped;
        creatorFee = tr + cr === 0n ? 0n : floorDiv(total, cr, tr + cr);
        tradeFee = total - creatorFee;
    }
    else {
        amountIn = preFee(swapped, tr);
        tradeFee = amountIn - swapped;
    }
    const spot = (swapped * Y) / X;
    const impact = spot === 0n || actualOut >= spot ? 0n : ((spot - actualOut) * 10000n) / spot;
    return { amountIn, amountOut: y, tradeFee, creatorFee, priceImpactBps: impact };
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
function poolQuote(a, exactIn) {
    const { pool, config } = a;
    const model = cpmmFeeModel(config, pool);
    const { zeroForOne, creatorFeeOnInput } = cpmmDirection(pool, a.inputMint);
    const [r0, r1] = cpmmReserves(pool, a.vault0, a.vault1);
    const [X, Y] = zeroForOne ? [r0, r1] : [r1, r0];
    // the program cannot price a pool with an empty side (token_price_x32 divides by each)
    if (X <= 0n || Y <= 0n)
        throw new RangeError("empty pool");
    const [inMint, outMint] = zeroForOne
        ? [pool.token0Mint, pool.token1Mint]
        : [pool.token1Mint, pool.token0Mint];
    const ordered = (inAfter, outAfter) => zeroForOne
        ? { reserve0After: inAfter, reserve1After: outAfter }
        : { reserve0After: outAfter, reserve1After: inAfter };
    if (model === DEEP_AMM_FEE_MODEL.v1) {
        // a V1 pool stores its quote side in creatorFeeOn (1 = token0, 2 = token1), so "the
        // creator fee is on the input" reads "the input is the quote token": a buy
        if (pool.creatorFeeOn !== 1 && pool.creatorFeeOn !== 2)
            throw new Error("V1 pool without a quote side (creatorFeeOn must be 1 or 2)");
        if (a.amount <= 0n)
            throw new RangeError("amount must be > 0");
        const isBuy = creatorFeeOnInput;
        const rates = deepSwapV1Rates(config, pool, isBuy);
        const q = exactIn
            ? quoteV1ExactIn({ amountIn: a.amount, reserveIn: X, reserveOut: Y, rates, isBuy })
            : quoteV1ExactOut({ amountOut: a.amount, reserveIn: X, reserveOut: Y, rates, isBuy });
        const quoteMint = isBuy ? inMint : outMint;
        return {
            feeModel: model,
            zeroForOne,
            isBuy,
            amountIn: q.amountIn,
            amountOut: q.amountOut,
            tradeFee: q.lpFee + q.protocolFee,
            lpFee: q.lpFee,
            protocolFee: q.protocolFee,
            fundFee: 0n,
            feeMint: quoteMint,
            rewardFee: q.rewardFee,
            rewardFeeMint: quoteMint,
            ...ordered(q.reserveInAfter, q.reserveOutAfter),
            priceImpactBps: q.priceImpactBps,
        };
    }
    const args = {
        inputReserve: X,
        outputReserve: Y,
        config,
        creatorFeeEnabled: pool.enableCreatorFee,
        creatorFeeOnInput,
    };
    const q = exactIn
        ? quoteCpmmSwapBaseInput({ ...args, amountIn: a.amount })
        : quoteCpmmSwapBaseOutput({ ...args, amountOut: a.amount });
    // Fees::protocol_fee / fund_fee: floored shares of the trade fee; the rest stays with LPs
    const protocolFee = floorDiv(q.tradeFee, config.protocolFeeRate, CPMM_FEE_DENOMINATOR);
    const fundFee = floorDiv(q.tradeFee, config.fundFeeRate, CPMM_FEE_DENOMINATOR);
    return {
        feeModel: model,
        zeroForOne,
        isBuy: null,
        amountIn: q.amountIn,
        amountOut: q.amountOut,
        tradeFee: q.tradeFee,
        lpFee: q.tradeFee - protocolFee - fundFee,
        protocolFee,
        fundFee,
        feeMint: inMint,
        rewardFee: q.creatorFee,
        rewardFeeMint: creatorFeeOnInput ? inMint : outMint,
        ...ordered(X + q.amountIn - protocolFee - fundFee - (creatorFeeOnInput ? q.creatorFee : 0n), Y - q.amountOut - (creatorFeeOnInput ? 0n : q.creatorFee)),
        priceImpactBps: q.priceImpactBps,
    };
}
/**
 * Exact-input quote for any deep-amm pool, priced with the pool's own fee model: a legacy
 * pool with upstream's math (`quoteCpmmSwapBaseInput`), a DEEP V1 pool with the side-dependent
 * V1 math (@deep/curve-math `quoteDeepSwapExactIn`). Returns the amounts, the fee breakdown
 * and the mint each fee is in. Throws when `config` is not of the pool's fee model (the
 * program refuses that swap too), when the mint is not the pool's, and where the math gives
 * up (`CurveMathError` on a V1 pool, `RangeError` on a legacy one). The program's own result
 * is authoritative: send the swap with a slippage bound.
 */
export function quoteDeepSwapExactIn(a) {
    return poolQuote(a, true);
}
/**
 * Exact-output quote for any deep-amm pool (see `quoteDeepSwapExactIn`): `amount` is what the
 * trader receives, `amountIn` what it costs. On a V1 sell the fee comes off the output, so
 * the pool must hold the GROSS amount: asking for more than it can pay throws.
 */
export function quoteDeepSwapExactOut(a) {
    return poolQuote(a, false);
}
const U64_MAX = (1n << 64n) - 1n;
/** `swap_base_input(amount_in, minimum_amount_out)` */
export function cpmmSwapBaseInputIx(a) {
    return swapIx(a, "swap_base_input", a.amountIn, a.minimumAmountOut);
}
/**
 * `swap_base_output(max_amount_in, amount_out)`: the trader receives exactly `amountOut` and
 * pays at most `maxAmountIn`. Same accounts as `swap_base_input`.
 */
export function cpmmSwapBaseOutputIx(a) {
    if (a.amountOut <= 0n)
        throw new RangeError("amountOut must be > 0");
    for (const v of [a.maxAmountIn, a.amountOut])
        if (v < 0n || v > U64_MAX)
            throw new RangeError("amount out of u64 range");
    return swapIx(a, "swap_base_output", a.maxAmountIn, a.amountOut);
}
function swapIx(a, name, arg0, arg1) {
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
    data.set(discriminator("global", name), 0);
    data.writeBigUInt64LE(arg0, 8);
    data.writeBigUInt64LE(arg1, 16);
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