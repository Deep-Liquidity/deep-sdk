import { PublicKey } from "@solana/web3.js";
/** ProgramData header: u32 tag (3) | u64 deploy slot | Option<Pubkey> (1 + 32). */
export declare const PROGRAMDATA_HEADER_SIZE = 45;
export interface ProgramDataHeader {
    /** Slot of the last deploy/upgrade. */
    slot: bigint;
    /** null when the program is immutable. */
    upgradeAuthority: PublicKey | null;
}
/** Decodes the 45-byte header (a `dataSlice` of the first 45 bytes is enough). */
export declare function decodeProgramDataHeader(data: Uint8Array): ProgramDataHeader;
/**
 * `solana-verify get-program-hash` convention (Ellipsis-Labs/solana-verifiable-build
 * `get_binary_hash`): sha256 over ProgramData[45..] with trailing zero bytes removed.
 * Compare with `solana-verify get-executable-hash <file.so>` of the release build.
 */
export declare function programDataHash(data: Uint8Array): string;
/** SPL Token mint `supply` (u64 at offset 36). Works for Token and Token-2022 mints. */
export declare function decodeMintSupply(data: Uint8Array): bigint;
/** SPL token account `amount` (u64 at offset 64). */
export declare function decodeTokenAccountAmount(data: Uint8Array): bigint;
