/**
 * DeepSwap pairs: every pool deep-amm owns, for any two mints (SPL Token or Token-2022).
 * Pure decoding only: callers fetch the accounts. Mint parsing uses @solana/spl-token; the
 * two metadata layouts (Token-2022 TokenMetadata extension, Metaplex metadata account) are
 * read by hand because their packages are not dependencies of this SDK.
 */
import { Buffer } from "buffer";
import { ExtensionType, getExtensionData, getExtensionTypes, getScaledUiAmountConfig, getTransferHook, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint, } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { DEEP_AMM_FEES } from "./deep-amm.js";
import { CPMM_FEE_DENOMINATOR } from "./raydium-cpmm.js";
// ───────────── discovery ─────────────
/**
 * getProgramAccounts filter matching every PoolState account of a cp-swap program. Only the
 * discriminator is matched (not the size), so a pool reallocated by a future program version
 * is still found; decodeCpmmPoolState rejects anything too small.
 */
export function cpmmPoolStateFilters() {
    return [
        {
            memcmp: {
                offset: 0,
                bytes: Buffer.from(discriminator("account", "PoolState")).toString("base64"),
                encoding: "base64",
            },
        },
    ];
}
/** Strips NUL padding and control characters; trims; caps the length. */
function cleanText(s, max) {
    return (s
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max));
}
const utf8 = new TextDecoder("utf-8", { fatal: false });
/** Reads `count` borsh strings (u32 LE length + UTF-8) starting at `offset`; null if truncated. */
function borshStrings(data, offset, count) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = [];
    let o = offset;
    for (let i = 0; i < count; i++) {
        if (o + 4 > data.length)
            return null;
        const len = v.getUint32(o, true);
        o += 4;
        if (len > 4_096 || o + len > data.length)
            return null;
        out.push(utf8.decode(data.subarray(o, o + len)));
        o += len;
    }
    return out;
}
function toMetadata(fields) {
    if (!fields)
        return undefined;
    const symbol = cleanText(fields[1], 16);
    if (!symbol)
        return undefined;
    return { name: cleanText(fields[0], 64), symbol, uri: cleanText(fields[2], 300) };
}
/**
 * The ScaledUiAmount multiplier in effect at `nowSec`: the pending multiplier once its
 * effective timestamp has passed, otherwise the current one.
 */
export function effectiveUiMultiplier(cfg, nowSec) {
    const m = nowSec >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier;
    return Number.isFinite(m) && m > 0 ? m : 1;
}
/**
 * Facts about a mint account owned by SPL Token or Token-2022. Throws when the account is
 * not a mint of either program.
 */
export function decodeMintFacts(address, account, nowSec) {
    const is2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID);
    if (!is2022 && !account.owner.equals(TOKEN_PROGRAM_ID))
        throw new Error(`${address.toBase58()} is not owned by a token program`);
    const data = Buffer.from(account.data.buffer, account.data.byteOffset, account.data.byteLength);
    const mint = unpackMint(address, { data, owner: account.owner, executable: false, lamports: 0 }, account.owner);
    const facts = {
        decimals: mint.decimals,
        tokenProgram: is2022 ? "token-2022" : "spl-token",
        extensions: [],
        freezable: mint.freezeAuthority !== null,
        uiMultiplier: 1,
    };
    if (!is2022 || mint.tlvData.length === 0)
        return facts;
    facts.extensions = getExtensionTypes(mint.tlvData).map((t) => ExtensionType[t] ?? `Unknown(${t})`);
    try {
        const scaled = getScaledUiAmountConfig(mint);
        if (scaled)
            facts.uiMultiplier = effectiveUiMultiplier(scaled, nowSec);
    }
    catch {
        // unreadable extension payload: the multiplier stays 1
    }
    try {
        const hook = getTransferHook(mint);
        if (hook && !hook.programId.equals(PublicKey.default))
            facts.transferHookProgram = hook.programId.toBase58();
    }
    catch {
        // unreadable extension payload: treated as no active hook
    }
    try {
        const md = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
        // update_authority (32) + mint (32), then name, symbol, uri
        if (md && md.length >= 64)
            facts.metadata = toMetadata(borshStrings(md, 64, 3));
    }
    catch {
        // unreadable metadata: treated as absent
    }
    return facts;
}
/**
 * name / symbol / uri from a Metaplex Token Metadata account (key 4 = MetadataV1), or
 * undefined when it is not one for `mint` or has an empty symbol. The caller checks the
 * account's owner program.
 */
export function decodeMetaplexMetadata(data, mint) {
    if (data.length < 1 + 32 + 32 + 4 || data[0] !== 4)
        return undefined;
    const stored = data.subarray(33, 65);
    const want = mint.toBytes();
    for (let i = 0; i < 32; i++)
        if (stored[i] !== want[i])
            return undefined;
    return toMetadata(borshStrings(data, 65, 3));
}
/** "So11…1112": the symbol shown for a mint with no readable metadata. */
export function shortMint(mint) {
    return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}
/**
 * A SwapEvent in the pool's own token order, with the reserves right after it. Same
 * arithmetic as toPoolSwap (the protocol, fund and creator slices leave the reserves, with
 * the program's floor rounding) but with no SOL assumption. Null when the event's mints are
 * not the pool's or its numbers are inconsistent.
 */
export function toPairSwap(e, pool, rates = DEEP_AMM_FEES) {
    const zeroForOne = e.inputMint.equals(pool.token0Mint) && e.outputMint.equals(pool.token1Mint);
    if (!zeroForOne && !(e.inputMint.equals(pool.token1Mint) && e.outputMint.equals(pool.token0Mint)))
        return null;
    const cut = (rate) => (e.tradeFee * rate) / CPMM_FEE_DENOMINATOR;
    const inputAfter = e.inputVaultBefore +
        e.inputAmount -
        cut(rates.protocolFeeRate) -
        cut(rates.fundFeeRate) -
        (e.creatorFeeOnInput ? e.creatorFee : 0n);
    const outputAfter = e.outputVaultBefore - e.outputAmount - (e.creatorFeeOnInput ? 0n : e.creatorFee);
    if (inputAfter < 0n || outputAfter <= 0n)
        return null;
    return {
        zeroForOne,
        amount0: zeroForOne ? e.inputAmount : e.outputAmount,
        amount1: zeroForOne ? e.outputAmount : e.inputAmount,
        fee: e.tradeFee,
        reserve0After: zeroForOne ? inputAfter : outputAfter,
        reserve1After: zeroForOne ? outputAfter : inputAfter,
    };
}
/** token1 per whole token0 at the given raw reserves. Presentation only, never for amounts. */
export function pairPrice(reserve0, reserve1, decimals0, decimals1) {
    if (reserve0 === 0n)
        return 0;
    return (Number(reserve1) / Number(reserve0)) * 10 ** (decimals0 - decimals1);
}
//# sourceMappingURL=pairs.js.map