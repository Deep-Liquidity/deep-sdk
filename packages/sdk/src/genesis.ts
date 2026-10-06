/** Public cluster genesis hashes: tells which cluster an RPC really serves. */
export const SOLANA_GENESIS_HASH = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

export type PublicCluster = keyof typeof SOLANA_GENESIS_HASH;

/** "devnet" | "mainnet-beta" for the public clusters, "unknown" otherwise (localnet, testnet). */
export function clusterFromGenesisHash(hash: string): PublicCluster | "unknown" {
  for (const [c, h] of Object.entries(SOLANA_GENESIS_HASH))
    if (h === hash) return c as PublicCluster;
  return "unknown";
}
