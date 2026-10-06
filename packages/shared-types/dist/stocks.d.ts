export type StockCluster = "devnet" | "mainnet";
export interface StockIssuer {
    /** Display name. */
    name: string;
    /** What the token is, in the issuer's own terms. */
    structure: string;
    /** Who may hold it according to the issuer (not a DEEP statement). */
    eligibility: string;
    /** Issuer documentation. */
    url?: string;
}
export interface StockListing {
    mint: string;
    /** The token's symbol as its mint metadata states it. */
    symbol: string;
    /** Underlying ticker, e.g. "TSLA". */
    underlying: string;
    /** Underlying company / fund name. */
    company: string;
    issuer: StockIssuer;
    /** Pyth "Equity.US.<X>/USD" feed id (hex) for the reference price. */
    pythFeedId?: string;
    /** Its push-oracle PriceUpdateV2 account (shard 0), read over RPC. Never Hermes. */
    pythAccount?: string;
    /** DEEP's devnet TEST stock: no value, not a security. */
    test: boolean;
}
export interface StockQuote {
    mint: string;
    symbol: string;
    /** DEEP's own devnet test quote token (no value). */
    test: boolean;
}
export declare const STOCK_REGISTRY: Record<StockCluster, readonly StockListing[]>;
/** Quote tokens stock pairs are priced in. */
export declare const STOCK_QUOTES: Record<StockCluster, readonly StockQuote[]>;
/** "devnet" | "mainnet" for a cluster name; null for localnet or anything unknown. */
export declare function stockCluster(cluster: string): StockCluster | null;
export declare function stockListing(cluster: string, mint: string): StockListing | undefined;
export declare function stockQuote(cluster: string, mint: string): StockQuote | undefined;
/**
 * `release/legal-signoff.json`, written by the owner after counsel's review (template:
 * `release/legal-signoff.template.json`). Engineering never fills it in.
 */
export interface LegalSignoff {
    scope: "stock-pairs";
    status: "approved";
    /** Counsel (person and firm) who reviewed stock pairs. */
    reviewer: string;
    /** YYYY-MM-DD */
    reviewDate: string;
    /** The owner who recorded the decision. */
    approvedBy: string;
    /** ISO 3166-1 alpha-2 codes that must not reach stock routes. Decided by counsel. */
    jurisdictionsExcluded: string[];
    /** Where the hard block runs, and the request header the edge sets with the country. */
    geoBlocking: {
        layer: "cloudflare" | "caddy";
        countryHeader: string;
    };
    /** Issuers whose tokens the review covers (StockIssuer.name). */
    issuers: string[];
    /** Version or URL of the Terms that cover stock pairs. */
    terms: string;
}
export type SignoffCheck = {
    ok: true;
    signoff: LegalSignoff;
} | {
    ok: false;
    errors: string[];
};
/** Validates a parsed sign-off file. A template or partial file is never accepted. */
export declare function validateLegalSignoff(x: unknown): SignoffCheck;
export interface StocksGate {
    /** Stock pairs are shown (and tradable) in this build/deployment. */
    enabled: boolean;
    /** "test": devnet TEST stocks; "live": real issuer mints on mainnet. */
    mode: "test" | "live" | "off";
    reason: string;
}
/**
 * Whether stock pairs are on. Devnet: always (TEST stocks). Mainnet: only when the build or
 * deployment flag is "on" AND a valid legal sign-off is recorded. Anything else: off.
 */
export declare function stocksGate(a: {
    cluster: string;
    /** VITE_STOCKS_MAINNET (web) / STOCKS_MAINNET (API). */
    mainnetFlag?: string | null;
    /** Parsed release/legal-signoff.json, or null when absent. */
    signoff?: unknown;
}): StocksGate;
