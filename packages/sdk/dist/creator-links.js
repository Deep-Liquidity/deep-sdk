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
/** Message and display order. */
export const CREATOR_LINK_KINDS = ["twitter", "telegram", "website", "discord"];
export const CREATOR_LINK_MAX_LENGTH = 200;
/** Labels used in the signed message (and the UI). */
export const CREATOR_LINK_LABELS = {
    twitter: "X",
    telegram: "Telegram",
    website: "Website",
    discord: "Discord",
};
/** Hosts accepted for the named networks (compared without a leading "www."). */
export const CREATOR_LINK_HOSTS = {
    twitter: ["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"],
    telegram: ["t.me"],
    discord: ["discord.gg", "discord.com"],
};
const hostOf = (u) => u.hostname.toLowerCase().replace(/^www\./, "");
/** A strict https URL: ≤ 200 chars, a dotted host name, no credentials, port, IP or unsafe characters. */
export function strictHttpsUrl(raw) {
    if (raw.length > CREATOR_LINK_MAX_LENGTH)
        return null;
    // eslint-disable-next-line no-control-regex
    if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(raw) || !/^https:\/\//i.test(raw))
        return null;
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return null;
    }
    if (u.protocol !== "https:" || u.username || u.password || u.port)
        return null;
    if (!u.hostname.includes(".") || u.hostname.startsWith("["))
        return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))
        return null;
    return u;
}
/** Whether a parsed URL is a plausible destination for this kind of link. */
export function creatorLinkFits(kind, u) {
    if (kind === "website")
        return true;
    if (!CREATOR_LINK_HOSTS[kind].includes(hostOf(u)))
        return false;
    const path = u.pathname.replace(/\/+$/, "");
    if (kind === "discord")
        return hostOf(u) === "discord.gg" ? path.length > 1 : /^\/invite\/[^/]+$/i.test(path);
    return path.length > 1; // a profile / channel, not the network's home page
}
/** The link as given if it passes the strict rule for its kind, else null. Never rewrites. */
export function checkCreatorLink(kind, raw) {
    if (typeof raw !== "string")
        return null;
    const u = strictHttpsUrl(raw);
    return u && creatorLinkFits(kind, u) ? raw : null;
}
// ───────────── signed update message ─────────────
export const LINKS_MESSAGE_TITLE = "DEEP — update token links";
/** How far `issuedAt` may be from the server's clock, either way. */
export const LINKS_MESSAGE_MAX_SKEW_MS = 5 * 60_000;
/** 16 random bytes as lowercase hex. */
export const LINKS_NONCE_RE = /^[0-9a-f]{32}$/;
const NONE = "(none)";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CLUSTER_RE = /^[a-z-]{1,32}$/;
/** True if `s` is exactly what toISOString() prints for some instant. */
export function isCanonicalIso(s) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s))
        return false;
    const t = Date.parse(s);
    return Number.isFinite(t) && new Date(t).toISOString() === s;
}
/** A fresh nonce: 16 bytes from the platform CSPRNG as lowercase hex. */
export function newLinksNonce() {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
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
export function buildLinksMessage(m) {
    if (!BASE58_RE.test(m.mint))
        throw new Error("mint must be a base58 address");
    if (!CLUSTER_RE.test(m.cluster))
        throw new Error("cluster must be a cluster name");
    if (!isCanonicalIso(m.issuedAt))
        throw new Error("issuedAt must be a canonical ISO time");
    if (!LINKS_NONCE_RE.test(m.nonce))
        throw new Error("nonce must be 32 lowercase hex characters");
    const lines = [LINKS_MESSAGE_TITLE, `Mint: ${m.mint}`, `Network: ${m.cluster}`];
    for (const k of CREATOR_LINK_KINDS) {
        const v = m.links[k];
        if (v !== null && checkCreatorLink(k, v) === null)
            throw new Error(`${CREATOR_LINK_LABELS[k]} link is not valid`);
        lines.push(`${CREATOR_LINK_LABELS[k]}: ${v ?? NONE}`);
    }
    lines.push(`Issued: ${m.issuedAt}`, `Nonce: ${m.nonce}`, "Signing does not send a transaction or cost fees.");
    return lines.join("\n");
}
//# sourceMappingURL=creator-links.js.map