/** Public cluster genesis hashes: tells which cluster an RPC really serves. */
export declare const SOLANA_GENESIS_HASH: {
    readonly devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
};
export type PublicCluster = keyof typeof SOLANA_GENESIS_HASH;
/** "devnet" | "mainnet-beta" for the public clusters, "unknown" otherwise (localnet, testnet). */
export declare function clusterFromGenesisHash(hash: string): PublicCluster | "unknown";
