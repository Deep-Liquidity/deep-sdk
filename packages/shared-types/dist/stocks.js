// ───────────── Tokenized stock pairs (docs/STOCK_PAIRS.md) ─────────────
//
// A curated, cluster-keyed allowlist: only mints listed here are presented as stocks. Devnet
// lists DEEP's own TEST stocks (no value, not securities). Mainnet lists real issuer mints,
// each verified read-only on mainnet RPC (2026-10-05), and stays OFF until the owner records
// counsel's sign-off (`stocksGate`).
const TEST_ISSUER = {
    name: "DEEP devnet test issuer",
    structure: "Test token created by DEEP on devnet. Not a security, no claim on any share, no value.",
    eligibility: "Devnet testing only.",
};
const XSTOCKS = {
    name: "xStocks (Backed)",
    structure: "Tracker certificate; no shareholder rights.",
    eligibility: "Issuer excludes US persons and residents of Canada, the UK and Australia.",
    url: "https://docs.xstocks.fi/developers",
};
const ONDO = {
    name: "Ondo Global Markets",
    structure: "Note with economic exposure only; no shareholder rights.",
    eligibility: "Issuer excludes US persons; KYC to mint and redeem.",
    url: "https://ondo.finance/ondo-stocks",
};
const FEED = {
    TSLA: {
        pythFeedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
        pythAccount: "E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ",
    },
    NVDA: {
        pythFeedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
        pythAccount: "2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC",
    },
    SPY: {
        pythFeedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
        pythAccount: "9owhtgrdLiUMAH9JKxYFt5pUY4Luy4EzzLhdcWPVuDyy",
    },
};
export const STOCK_REGISTRY = {
    // Created by packages/sdk/scripts/devnet-test-stocks.ts on 2026-10-05.
    devnet: [
        {
            mint: "Hkzvca71JuFQrJnJQfpp79ko49xgx8g6hpuGwdjihtYb",
            symbol: "tTSLA",
            underlying: "TSLA",
            company: "Tesla",
            issuer: TEST_ISSUER,
            ...FEED.TSLA,
            test: true,
        },
        {
            mint: "EBmUwSxuxia4rzfSSUKiqkHb4zraNK26SHfEZitett8Y",
            symbol: "tNVDA",
            underlying: "NVDA",
            company: "NVIDIA",
            issuer: TEST_ISSUER,
            ...FEED.NVDA,
            test: true,
        },
        {
            mint: "D2ijNtVFZdN3LALuCUeWYa9w326UjVAHAjmCXRiuoFa8",
            symbol: "tSPY",
            underlying: "SPY",
            company: "SPDR S&P 500 ETF",
            issuer: TEST_ISSUER,
            ...FEED.SPY,
            test: true,
        },
    ],
    // Verified on mainnet RPC 2026-10-05: Token-2022, freeze authority, TransferHook program null.
    mainnet: [
        {
            mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
            symbol: "TSLAx",
            underlying: "TSLA",
            company: "Tesla",
            issuer: XSTOCKS,
            ...FEED.TSLA,
            test: false,
        },
        {
            mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
            symbol: "NVDAx",
            underlying: "NVDA",
            company: "NVIDIA",
            issuer: XSTOCKS,
            ...FEED.NVDA,
            test: false,
        },
        {
            mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
            symbol: "SPYx",
            underlying: "SPY",
            company: "SPDR S&P 500 ETF",
            issuer: XSTOCKS,
            ...FEED.SPY,
            test: false,
        },
        {
            mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo",
            symbol: "NVDAon",
            underlying: "NVDA",
            company: "NVIDIA",
            issuer: ONDO,
            ...FEED.NVDA,
            test: false,
        },
    ],
};
/** Quote tokens stock pairs are priced in. */
export const STOCK_QUOTES = {
    devnet: [{ mint: "AicW4cTqbzHf9AhRtuq5TpAE263Ybt6WzXxfBUyJT8CZ", symbol: "tUSDC", test: true }],
    mainnet: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", test: false }],
};
/** "devnet" | "mainnet" for a cluster name; null for localnet or anything unknown. */
export function stockCluster(cluster) {
    if (cluster === "devnet")
        return "devnet";
    if (cluster === "mainnet" || cluster === "mainnet-beta")
        return "mainnet";
    return null;
}
export function stockListing(cluster, mint) {
    const c = stockCluster(cluster);
    return c ? STOCK_REGISTRY[c].find((s) => s.mint === mint) : undefined;
}
export function stockQuote(cluster, mint) {
    const c = stockCluster(cluster);
    return c ? STOCK_QUOTES[c].find((q) => q.mint === mint) : undefined;
}
const str = (v) => typeof v === "string" && v.trim().length > 0;
/** Validates a parsed sign-off file. A template or partial file is never accepted. */
export function validateLegalSignoff(x) {
    if (!x || typeof x !== "object")
        return { ok: false, errors: ["no sign-off recorded"] };
    const s = x;
    const errors = [];
    if (s.scope !== "stock-pairs")
        errors.push('scope must be "stock-pairs"');
    if (s.status !== "approved")
        errors.push('status must be "approved" (template not filled in)');
    if (!str(s.reviewer))
        errors.push("reviewer missing");
    if (!str(s.approvedBy))
        errors.push("approvedBy missing");
    if (!str(s.terms))
        errors.push("terms missing");
    if (typeof s.reviewDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.reviewDate))
        errors.push("reviewDate must be YYYY-MM-DD");
    const j = s.jurisdictionsExcluded;
    if (!Array.isArray(j) || j.length === 0 || !j.every((c) => /^[A-Z]{2}$/.test(String(c))))
        errors.push("jurisdictionsExcluded must list ISO 3166-1 alpha-2 codes (decided by counsel)");
    const g = s.geoBlocking;
    if (!g || (g.layer !== "cloudflare" && g.layer !== "caddy") || !str(g.countryHeader))
        errors.push("geoBlocking.layer (cloudflare | caddy) and geoBlocking.countryHeader required");
    if (!Array.isArray(s.issuers) || s.issuers.length === 0 || !s.issuers.every(str))
        errors.push("issuers missing");
    return errors.length ? { ok: false, errors } : { ok: true, signoff: x };
}
/**
 * Whether stock pairs are on. Devnet: always (TEST stocks). Mainnet: only when the build or
 * deployment flag is "on" AND a valid legal sign-off is recorded. Anything else: off.
 */
export function stocksGate(a) {
    const c = stockCluster(a.cluster);
    if (c === "devnet")
        return { enabled: true, mode: "test", reason: "devnet TEST stocks (no value, not securities)" };
    if (c !== "mainnet")
        return { enabled: false, mode: "off", reason: `no stock list for ${a.cluster}` };
    if (a.mainnetFlag !== "on")
        return { enabled: false, mode: "off", reason: "stock pairs are off on mainnet (flag not set)" };
    const v = validateLegalSignoff(a.signoff);
    if (!v.ok)
        return {
            enabled: false,
            mode: "off",
            reason: `stock pairs are off on mainnet: legal sign-off invalid (${v.errors.join("; ")})`,
        };
    return { enabled: true, mode: "live", reason: `legal sign-off ${v.signoff.reviewDate}` };
}
//# sourceMappingURL=stocks.js.map