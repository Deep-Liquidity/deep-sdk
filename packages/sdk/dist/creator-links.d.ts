/**
 * Creator links signed after launch (docs/ARCHITECTURE.md, "Creator link updates").
 *
 * A token's creator can replace the links from its (immutable) metadata JSON by signing a
 * human-readable message with the wallet that created the token. The web app builds the
 * message, the wallet signs its UTF-8 bytes (`signMessage`), and the API rebuilds the same
 * text from the request and verifies the ed25519 signature. Both sides import this module, so
 * the bytes are identical by construction.
 *
 * The link rules here are the launch form's (apps/web/src/lib/links.ts uses them too): a strict
 * https URL of at most 200 characters, and for the named networks only that network's hosts.
 */
/** The four link slots, named as in the API's TokenLinks. */
export type CreatorLinkKind = "twitter" | "telegram" | "website" | "discord";
/** Same shape as TokenLinks in @deepliquidity/shared-types; null = no link. */
export type CreatorLinkSet = Record<CreatorLinkKind, string | null>;
/** Message and display order. */
export declare const CREATOR_LINK_KINDS: CreatorLinkKind[];
export declare const CREATOR_LINK_MAX_LENGTH = 200;
/** Labels used in the signed message (and the UI). */
export declare const CREATOR_LINK_LABELS: Record<CreatorLinkKind, string>;
/** Hosts accepted for the named networks (compared without a leading "www."). */
export declare const CREATOR_LINK_HOSTS: Record<Exclude<CreatorLinkKind, "website">, string[]>;
/** A strict https URL: ≤ 200 chars, a dotted host name, no credentials, port, IP or unsafe characters. */
export declare function strictHttpsUrl(raw: string): URL | null;
/** Whether a parsed URL is a plausible destination for this kind of link. */
export declare function creatorLinkFits(kind: CreatorLinkKind, u: URL): boolean;
/** The link as given if it passes the strict rule for its kind, else null. Never rewrites. */
export declare function checkCreatorLink(kind: CreatorLinkKind, raw: unknown): string | null;
export declare const LINKS_MESSAGE_TITLE = "DEEP \u2014 update token links";
/** How far `issuedAt` may be from the server's clock, either way. */
export declare const LINKS_MESSAGE_MAX_SKEW_MS: number;
/** 16 random bytes as lowercase hex. */
export declare const LINKS_NONCE_RE: RegExp;
export interface LinksMessageInput {
    mint: string;
    /** Cluster name, e.g. "devnet" (the API's SOLANA_CLUSTER, the web's VITE_SOLANA_CLUSTER). */
    cluster: string;
    links: CreatorLinkSet;
    /** Canonical ISO-8601 UTC time (`Date.prototype.toISOString()`). */
    issuedAt: string;
    nonce: string;
}
/** True if `s` is exactly what toISOString() prints for some instant. */
export declare function isCanonicalIso(s: string): boolean;
/** A fresh nonce: 16 bytes from the platform CSPRNG as lowercase hex. */
export declare function newLinksNonce(): string;
/**
 * The exact text a creator signs to set a token's links. Every link must already pass
 * `checkCreatorLink` (so none contains a line break); empty slots read "(none)". Throws on
 * malformed input instead of producing text that the other side could build differently.
 *
 *   DEEP — update token links
 *   Mint: <mint>
 *   Network: <cluster>
 *   X: <url or (none)>
 *   Telegram: <url or (none)>
 *   Website: <url or (none)>
 *   Discord: <url or (none)>
 *   Issued: <ISO time>
 *   Nonce: <32 hex>
 *   Signing does not send a transaction or cost fees.
 */
export declare function buildLinksMessage(m: LinksMessageInput): string;
