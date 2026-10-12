export const REWARD_MODEL_IDS = ["standard", "creator", "holder"];
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h", "7d"];
export * from "./stocks.js";
export * from "./rewards.js";
/**
 * Every token launched on DEEP gets a mint address that ends in this (base58, exact case)
 * whenever a pre-ground keypair is available. The one place the suffix is written.
 */
export const VANITY_MINT_SUFFIX = "deep";
/**
 * DEEP's own token per cluster (owner decision 2026-10-12: the mainnet DEEP token, mint
 * `DpyVL7crxmDAgKuCZ6heGVkPzGAWyx7fkRDRrASadeep`). The app and the bots label it "Official DEEP
 * token"; nothing else is ever labelled official. Devnet has none.
 */
export const OFFICIAL_TOKEN_MINTS = {
    "mainnet-beta": ["DpyVL7crxmDAgKuCZ6heGVkPzGAWyx7fkRDRrASadeep"],
    devnet: [],
};
export function isOfficialToken(cluster, mint) {
    const list = OFFICIAL_TOKEN_MINTS[cluster];
    return !!list && list.includes(mint);
}
//# sourceMappingURL=index.js.map