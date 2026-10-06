import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";

export const DEEP_CURVE_PROGRAM_ID = new PublicKey("7czURwVLkQpcF1HVhhZU5GGzvPA8YniogZY1BhZHCDtA");
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const enc = new TextEncoder();

/** Anchor discriminator: first 8 bytes of sha256(`${namespace}:${name}`). */
export function discriminator(namespace: "global" | "account" | "event", name: string): Uint8Array {
  return sha256(enc.encode(`${namespace}:${name}`)).slice(0, 8);
}
