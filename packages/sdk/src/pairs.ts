/**
 * DeepSwap pairs: every pool deep-amm owns, for any two mints (SPL Token or Token-2022).
 * Pure decoding only: callers fetch the accounts. Mint parsing uses @solana/spl-token; the
 * two metadata layouts (Token-2022 TokenMetadata extension, Metaplex metadata account) are
 * read by hand because their packages are not dependencies of this SDK.
 */
import { Buffer } from "buffer";
import {
  ExtensionType,
  getExtensionData,
  getExtensionTypes,
  getScaledUiAmountConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey, type GetProgramAccountsFilter } from "@solana/web3.js";
import {
  swapReservesAfter,
  type AmmSwapEventRaw,
  type AmmSwapFeesV1Raw,
  type PoolSwapRates,
} from "./amm-events.js";
import { discriminator } from "./constants.js";
import { DEEP_AMM_FEES } from "./deep-amm.js";

// ───────────── discovery ─────────────

/**
 * getProgramAccounts filter matching every PoolState account of a cp-swap program. Only the
 * discriminator is matched (not the size), so a pool reallocated by a future program version
 * is still found; decodeCpmmPoolState rejects anything too small.
 */
export function cpmmPoolStateFilters(): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: Buffer.from(discriminator("account", "PoolState")).toString("base64"),
        encoding: "base64",
      },
    },
  ];
}

// ───────────── mints ─────────────

export interface OnchainTokenMetadata {
  name: string;
  symbol: string;
  uri: string;
}

export interface MintFacts {
  decimals: number;
  tokenProgram: "spl-token" | "token-2022";
  /** Token-2022 extension names (spl-token `ExtensionType`); empty for SPL Token mints. */
  extensions: string[];
  /** The mint has a freeze authority. */
  freezable: boolean;
  /** ScaledUiAmount multiplier in effect at `nowSec` (1 without the extension). */
  uiMultiplier: number;
  /** Token-2022 TokenMetadata extension stored in the mint, when present and readable. */
  metadata?: OnchainTokenMetadata;
  /**
   * The program a TransferHook extension points at, when one is ACTIVE (non-null). deep-amm
   * does not forward hook accounts, so a pool holding such a mint cannot move it.
   */
  transferHookProgram?: string;
}

/** Strips NUL padding and control characters; trims; caps the length. */
function cleanText(s: string, max: number): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max)
  );
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

/** Reads `count` borsh strings (u32 LE length + UTF-8) starting at `offset`; null if truncated. */
function borshStrings(data: Uint8Array, offset: number, count: number): string[] | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  let o = offset;
  for (let i = 0; i < count; i++) {
    if (o + 4 > data.length) return null;
    const len = v.getUint32(o, true);
    o += 4;
    if (len > 4_096 || o + len > data.length) return null;
    out.push(utf8.decode(data.subarray(o, o + len)));
    o += len;
  }
  return out;
}

function toMetadata(fields: string[] | null): OnchainTokenMetadata | undefined {
  if (!fields) return undefined;
  const symbol = cleanText(fields[1]!, 16);
  if (!symbol) return undefined;
  return { name: cleanText(fields[0]!, 64), symbol, uri: cleanText(fields[2]!, 300) };
}

/**
 * The ScaledUiAmount multiplier in effect at `nowSec`: the pending multiplier once its
 * effective timestamp has passed, otherwise the current one.
 */
export function effectiveUiMultiplier(
  cfg: { multiplier: number; newMultiplier: number; newMultiplierEffectiveTimestamp: bigint },
  nowSec: bigint,
): number {
  const m = nowSec >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * Facts about a mint account owned by SPL Token or Token-2022. Throws when the account is
 * not a mint of either program.
 */
export function decodeMintFacts(
  address: PublicKey,
  account: { data: Uint8Array; owner: PublicKey },
  nowSec: bigint,
): MintFacts {
  const is2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!is2022 && !account.owner.equals(TOKEN_PROGRAM_ID))
    throw new Error(`${address.toBase58()} is not owned by a token program`);
  const data = Buffer.from(account.data.buffer, account.data.byteOffset, account.data.byteLength);
  const mint = unpackMint(
    address,
    { data, owner: account.owner, executable: false, lamports: 0 },
    account.owner,
  );
  const facts: MintFacts = {
    decimals: mint.decimals,
    tokenProgram: is2022 ? "token-2022" : "spl-token",
    extensions: [],
    freezable: mint.freezeAuthority !== null,
    uiMultiplier: 1,
  };
  if (!is2022 || mint.tlvData.length === 0) return facts;
  facts.extensions = getExtensionTypes(mint.tlvData).map(
    (t) => (ExtensionType[t] as string | undefined) ?? `Unknown(${t})`,
  );
  try {
    const scaled = getScaledUiAmountConfig(mint);
    if (scaled) facts.uiMultiplier = effectiveUiMultiplier(scaled, nowSec);
  } catch {
    // unreadable extension payload: the multiplier stays 1
  }
  try {
    const hook = getTransferHook(mint);
    if (hook && !hook.programId.equals(PublicKey.default))
      facts.transferHookProgram = hook.programId.toBase58();
  } catch {
    // unreadable extension payload: treated as no active hook
  }
  try {
    const md = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
    // update_authority (32) + mint (32), then name, symbol, uri
    if (md && md.length >= 64) facts.metadata = toMetadata(borshStrings(md, 64, 3));
  } catch {
    // unreadable metadata: treated as absent
  }
  return facts;
}

/**
 * name / symbol / uri from a Metaplex Token Metadata account (key 4 = MetadataV1), or
 * undefined when it is not one for `mint` or has an empty symbol. The caller checks the
 * account's owner program.
 */
export function decodeMetaplexMetadata(
  data: Uint8Array,
  mint: PublicKey,
): OnchainTokenMetadata | undefined {
  if (data.length < 1 + 32 + 32 + 4 || data[0] !== 4) return undefined;
  const stored = data.subarray(33, 65);
  const want = mint.toBytes();
  for (let i = 0; i < 32; i++) if (stored[i] !== want[i]) return undefined;
  return toMetadata(borshStrings(data, 65, 3));
}

/** "So11…1112": the symbol shown for a mint with no readable metadata. */
export function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

// ───────────── swaps ─────────────

export interface PairSwap {
  /** True when token0 went in and token1 came out. */
  zeroForOne: boolean;
  /** Amounts that moved, base units, without Token-2022 transfer fees. */
  amount0: bigint;
  amount1: bigint;
  /** Trade fee charged on the input token, base units. */
  fee: bigint;
  /** Pool reserves (net of accrued protocol/fund/creator fees) right after the swap. */
  reserve0After: bigint;
  reserve1After: bigint;
  /**
   * DEEP V1 pools only (present when the swap's `SwapFeesV1` was supplied). Then `fee` is NOT
   * necessarily on the input token: every fee of the swap is in the pool's quote token,
   * `fee` is `lpFee + protocolFee`, and on a sell `amount<quote>` is net of all of it.
   */
  v1?: {
    /** True when the input was the pool's quote token (the fee came off the input). */
    isBuy: boolean;
    /** True when the quote token, the one every fee amount is in, is token0. */
    feeOnToken0: boolean;
    /** Stays in the pool for LPs. */
    lpFee: bigint;
    /** DEEP's part. */
    protocolFee: bigint;
    /** The reward recipient's part (0 on a Standard pool), charged on top of `fee`. */
    rewardFee: bigint;
    /** 0 Standard, 1 Creator, 2 Holder. */
    rewardModel: number;
  };
}

/**
 * A SwapEvent in the pool's own token order, with the reserves right after it. Same
 * arithmetic as toPoolSwap (the protocol, fund and creator slices leave the reserves, with
 * the program's floor rounding) but with no SOL assumption. Null when the event's mints are
 * not the pool's or its numbers are inconsistent.
 *
 * DEEP V1 pools: pass the swap's `SwapFeesV1` as `feesV1` (`parseAmmSwapEventsWithSource`
 * pairs them). `rates` is then not used: the DEEP and reward parts leave the reserves on the
 * quote side in both directions, and the result carries the breakdown in `v1`. Null when
 * `feesV1` does not belong to `e`. Without it the legacy arithmetic applies unchanged, which
 * is wrong for a V1 swap.
 */
export function toPairSwap(
  e: AmmSwapEventRaw,
  pool: { token0Mint: PublicKey; token1Mint: PublicKey },
  rates: PoolSwapRates = DEEP_AMM_FEES,
  feesV1?: AmmSwapFeesV1Raw | null,
): PairSwap | null {
  const zeroForOne = e.inputMint.equals(pool.token0Mint) && e.outputMint.equals(pool.token1Mint);
  if (!zeroForOne && !(e.inputMint.equals(pool.token1Mint) && e.outputMint.equals(pool.token0Mint)))
    return null;
  const after = swapReservesAfter(e, rates, feesV1);
  if (!after) return null;
  const [inputAfter, outputAfter] = after;
  return {
    zeroForOne,
    amount0: zeroForOne ? e.inputAmount : e.outputAmount,
    amount1: zeroForOne ? e.outputAmount : e.inputAmount,
    fee: e.tradeFee,
    reserve0After: zeroForOne ? inputAfter : outputAfter,
    reserve1After: zeroForOne ? outputAfter : inputAfter,
    ...(feesV1
      ? {
          v1: {
            isBuy: feesV1.isBuy,
            feeOnToken0: feesV1.quoteMint.equals(pool.token0Mint),
            lpFee: feesV1.lpFee,
            protocolFee: feesV1.protocolFee,
            rewardFee: feesV1.rewardFee,
            rewardModel: feesV1.rewardModel,
          },
        }
      : {}),
  };
}

/** token1 per whole token0 at the given raw reserves. Presentation only, never for amounts. */
export function pairPrice(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number,
): number {
  if (reserve0 === 0n) return 0;
  return (Number(reserve1) / Number(reserve0)) * 10 ** (decimals0 - decimals1);
}
