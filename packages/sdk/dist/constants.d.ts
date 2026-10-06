import { PublicKey } from "@solana/web3.js";
export declare const DEEP_CURVE_PROGRAM_ID: PublicKey;
export declare const TOKEN_METADATA_PROGRAM_ID: PublicKey;
/** Anchor discriminator: first 8 bytes of sha256(`${namespace}:${name}`). */
export declare function discriminator(namespace: "global" | "account" | "event", name: string): Uint8Array;
