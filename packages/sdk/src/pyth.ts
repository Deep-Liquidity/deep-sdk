/**
 * Pyth SOL/USD (sponsored PriceUpdateV2 push feed) — decoder + launch-fee quote.
 * Mirrors programs/deep-curve/src/pyth.rs exactly (shared vectors:
 * fixtures/launch-fee-vectors.json, checked by both test suites).
 */
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "./constants.js";

export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);
/** Sponsored SOL/USD PriceUpdateV2 (shard 0) — same address on devnet and mainnet. */
export const PYTH_SOL_USD_PRICE_UPDATE = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
);
export const PYTH_SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/**
 * deep-curve's maximum Pyth price age in its default build, seconds (pyth.rs
 * DEFAULT_MAX_PRICE_AGE_SECONDS). Mainnet, localnet and tests use it. Also the default of
 * `validatePriceUpdate`, so a caller that does not pass the cluster's value is stricter,
 * never looser, than the program.
 */
export const PYTH_MAX_PRICE_AGE_SECONDS = 120n;
/**
 * The same limit in deep-curve's DEVNET build (Cargo feature `devnet`, pyth.rs
 * DEVNET_MAX_PRICE_AGE_SECONDS): Pyth refreshes the sponsored devnet account only about every
 * 5 minutes. Owner decision 2026-10-06.
 */
export const PYTH_DEVNET_MAX_PRICE_AGE_SECONDS = 600n;
/**
 * The program's maximum price age on `cluster`: 600 s on devnet (the devnet release is built
 * with the `devnet` feature), 120 s everywhere else, mainnet included. Pass it to
 * `validatePriceUpdate` for any pre-check of what `create_token` will accept. Until the devnet
 * program is upgraded to a `devnet` build it still enforces 120 s there.
 */
export function pythMaxPriceAgeSeconds(cluster: string): bigint {
  return cluster === "devnet" ? PYTH_DEVNET_MAX_PRICE_AGE_SECONDS : PYTH_MAX_PRICE_AGE_SECONDS;
}
/**
 * Logged by a devnet deep-curve build when it charges a launch fee; the bytes only exist in a
 * binary built with the `devnet` feature (pyth.rs DEVNET_BUILD_MARKER). mainnet-preflight
 * FAILs on a program that contains it.
 */
export const DEEP_CURVE_DEVNET_BUILD_MARKER = "DEEP devnet build: Pyth max price age 600 s";
export const PYTH_MAX_CONF_BPS = 200n;
/** On-chain cap for Config.launch_fee_usd_cents. */
export const MAX_LAUNCH_FEE_USD_CENTS = 2_000;

export interface PriceUpdate {
  feedId: string;
  fullyVerified: boolean;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
}

export function decodePriceUpdateV2(data: Uint8Array): PriceUpdate {
  const d = discriminator("account", "PriceUpdateV2");
  for (let i = 0; i < 8; i++) if (data[i] !== d[i]) throw new Error("not a PriceUpdateV2 account");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8 + 32;
  const tag = data[o];
  if (tag !== 0 && tag !== 1) throw new Error("bad verification level");
  o += tag === 0 ? 2 : 1;
  if (data.length < o + 32 + 28) throw new Error("PriceUpdateV2 truncated");
  const feedId = Buffer.from(data.subarray(o, o + 32)).toString("hex");
  o += 32;
  return {
    feedId,
    fullyVerified: tag === 1,
    price: v.getBigInt64(o, true),
    conf: v.getBigUint64(o + 8, true),
    exponent: v.getInt32(o + 16, true),
    publishTime: v.getBigInt64(o + 20, true),
  };
}

/**
 * The program's checks; returns the first failure's error name or null. `maxAgeSeconds`
 * defaults to the default (mainnet) build's 120 s; pass `pythMaxPriceAgeSeconds(cluster)`.
 */
export function validatePriceUpdate(
  p: PriceUpdate,
  nowSec: bigint,
  maxAgeSeconds: bigint = PYTH_MAX_PRICE_AGE_SECONDS,
): string | null {
  if (p.feedId !== PYTH_SOL_USD_FEED_ID) return "PriceFeedInvalid";
  if (!p.fullyVerified) return "PriceNotFullyVerified";
  if (nowSec - p.publishTime > maxAgeSeconds) return "PriceStale";
  if (p.price <= 0n) return "PriceNonPositive";
  if (p.conf * 10_000n > p.price * PYTH_MAX_CONF_BPS) return "PriceConfidenceTooWide";
  return null;
}

/**
 * Lamports the program charges for `usdCents` at this price, rounded UP:
 * `usdCents · 10^7 · 10^-expo / price` (expo ≤ 0), or `usdCents · 10^7 / (price · 10^expo)`.
 */
export function quoteLaunchFeeLamports(
  priceUpdate: Pick<PriceUpdate, "price" | "exponent">,
  usdCents: number,
): bigint {
  if (!Number.isInteger(usdCents) || usdCents < 0 || usdCents > 0xffff)
    throw new RangeError("usdCents must be a u16");
  const { price, exponent } = priceUpdate;
  if (price <= 0n) throw new RangeError("PriceNonPositive");
  if (!Number.isInteger(exponent) || exponent < -18 || exponent > 18)
    throw new RangeError("unsupported exponent");
  const pow = 10n ** BigInt(Math.abs(exponent));
  const cents = BigInt(usdCents);
  const [num, den] =
    exponent <= 0 ? [cents * 10_000_000n * pow, price] : [cents * 10_000_000n, price * pow];
  const fee = (num + den - 1n) / den;
  if (fee >= 1n << 64n) throw new RangeError("fee overflows u64");
  return fee;
}

/**
 * A Pyth fixed-point value (`price` or `conf` with `exponent`) as a JS number, for display
 * only (USD estimates). Never use it for amounts the program checks: use the bigint fields.
 */
export function pythToNumber(value: bigint, exponent: number): number {
  return Number(value) * 10 ** exponent;
}

/** Pyth push-oracle program (sponsored PriceUpdateV2 feeds; same id on devnet and mainnet). */
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT",
);

/**
 * The push-oracle PriceUpdateV2 account of any Pyth feed id (hex, with or without 0x),
 * shard 0 by default: seeds [shard u16 LE, feed id]. For SOL/USD this is
 * PYTH_SOL_USD_PRICE_UPDATE. Whether the account exists, and how fresh it is, differs per
 * feed and cluster: only sponsored feeds are updated continuously.
 */
export function pythPushFeedAccount(feedIdHex: string, shard = 0): PublicKey {
  const id = feedIdHex.replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/i.test(id)) throw new Error(`bad Pyth feed id ${feedIdHex}`);
  const s = new Uint8Array(2);
  new DataView(s.buffer).setUint16(0, shard, true);
  return PublicKey.findProgramAddressSync(
    [s, Uint8Array.from(Buffer.from(id, "hex"))],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  )[0];
}
