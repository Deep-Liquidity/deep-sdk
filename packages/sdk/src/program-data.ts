/**
 * Read-only decoders for BPF Loader Upgradeable ProgramData and SPL accounts, used by the
 * API's status and pool pages (the ProgramData address is `programDataPda`). No RPC, no keys.
 */
import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";

/** ProgramData header: u32 tag (3) | u64 deploy slot | Option<Pubkey> (1 + 32). */
export const PROGRAMDATA_HEADER_SIZE = 45;

export interface ProgramDataHeader {
  /** Slot of the last deploy/upgrade. */
  slot: bigint;
  /** null when the program is immutable. */
  upgradeAuthority: PublicKey | null;
}

/** Decodes the 45-byte header (a `dataSlice` of the first 45 bytes is enough). */
export function decodeProgramDataHeader(data: Uint8Array): ProgramDataHeader {
  if (data.length < PROGRAMDATA_HEADER_SIZE) throw new Error("ProgramData truncated");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0, true) !== 3) throw new Error("not a ProgramData account");
  const tag = data[12];
  if (tag !== 0 && tag !== 1) throw new Error("bad upgrade-authority option tag");
  return {
    slot: v.getBigUint64(4, true),
    upgradeAuthority: tag === 1 ? new PublicKey(data.subarray(13, 45)) : null,
  };
}

/**
 * `solana-verify get-program-hash` convention (Ellipsis-Labs/solana-verifiable-build
 * `get_binary_hash`): sha256 over ProgramData[45..] with trailing zero bytes removed.
 * Compare with `solana-verify get-executable-hash <file.so>` of the release build.
 */
export function programDataHash(data: Uint8Array): string {
  if (data.length < PROGRAMDATA_HEADER_SIZE) throw new Error("ProgramData truncated");
  const elf = data.subarray(PROGRAMDATA_HEADER_SIZE);
  let end = elf.length;
  while (end > 0 && elf[end - 1] === 0) end--;
  return Buffer.from(sha256(elf.subarray(0, end))).toString("hex");
}

/** SPL Token mint `supply` (u64 at offset 36). Works for Token and Token-2022 mints. */
export function decodeMintSupply(data: Uint8Array): bigint {
  if (data.length < 82) throw new Error("not an SPL mint");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(36, true);
}

/** SPL token account `amount` (u64 at offset 64). */
export function decodeTokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < 72) throw new Error("not an SPL token account");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}
