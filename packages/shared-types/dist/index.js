export const REWARD_MODEL_IDS = ["standard", "creator", "holder"];
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h", "7d"];
export * from "./stocks.js";
export * from "./rewards.js";
/** The public projection of a SplitterStatus (no builder, no recipient breakdown). */
export function toPublicSplitter(s) {
    return {
        source: s.source,
        cluster: s.cluster,
        feeVault: s.feeVault,
        feeVaultWsol: s.feeVaultWsol,
        initialized: s.initialized,
        vaultLamports: s.vaultLamports,
        vaultWsol: s.vaultWsol,
        pendingRevenue: s.pendingRevenue,
        minDistributeLamports: s.minDistributeLamports,
        baseTotal: s.baseTotal,
        distributions: s.distributions,
        lastDistributeAt: s.lastDistributeAt,
        nextDistributionAt: s.nextDistributionAt,
        history: s.history.map((h) => ({
            signature: h.signature,
            index: h.index,
            slot: h.slot,
            timestamp: h.timestamp,
            base: h.base,
        })),
    };
}
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