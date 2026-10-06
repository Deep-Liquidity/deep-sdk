import { PublicKey } from "@solana/web3.js";
export declare const PYTH_RECEIVER_PROGRAM_ID: PublicKey;
/** Sponsored SOL/USD PriceUpdateV2 (shard 0) — same address on devnet and mainnet. */
export declare const PYTH_SOL_USD_PRICE_UPDATE: PublicKey;
export declare const PYTH_SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/**
 * deep-curve's maximum Pyth price age in its default build, seconds (pyth.rs
 * DEFAULT_MAX_PRICE_AGE_SECONDS). Mainnet, localnet and tests use it. Also the default of
 * `validatePriceUpdate`, so a caller that does not pass the cluster's value is stricter,
 * never looser, than the program.
 */
export declare const PYTH_MAX_PRICE_AGE_SECONDS = 120n;
/**
 * The same limit in deep-curve's DEVNET build (Cargo feature `devnet`, pyth.rs
 * DEVNET_MAX_PRICE_AGE_SECONDS): Pyth refreshes the sponsored devnet account only about every
 * 5 minutes. Owner decision 2026-10-06.
 */
export declare const PYTH_DEVNET_MAX_PRICE_AGE_SECONDS = 600n;
/**
 * The program's maximum price age on `cluster`: 600 s on devnet (the devnet release is built
 * with the `devnet` feature), 120 s everywhere else, mainnet included. Pass it to
 * `validatePriceUpdate` for any pre-check of what `create_token` will accept. Until the devnet
 * program is upgraded to a `devnet` build it still enforces 120 s there.
 */
export declare function pythMaxPriceAgeSeconds(cluster: string): bigint;
/**
 * Logged by a devnet deep-curve build when it charges a launch fee; the bytes only exist in a
 * binary built with the `devnet` feature (pyth.rs DEVNET_BUILD_MARKER). mainnet-preflight
 * FAILs on a program that contains it.
 */
export declare const DEEP_CURVE_DEVNET_BUILD_MARKER = "DEEP devnet build: Pyth max price age 600 s";
export declare const PYTH_MAX_CONF_BPS = 200n;
/** On-chain cap for Config.launch_fee_usd_cents. */
export declare const MAX_LAUNCH_FEE_USD_CENTS = 2000;
export interface PriceUpdate {
    feedId: string;
    fullyVerified: boolean;
    price: bigint;
    conf: bigint;
    exponent: number;
    publishTime: bigint;
}
export declare function decodePriceUpdateV2(data: Uint8Array): PriceUpdate;
/**
 * The program's checks; returns the first failure's error name or null. `maxAgeSeconds`
 * defaults to the default (mainnet) build's 120 s; pass `pythMaxPriceAgeSeconds(cluster)`.
 */
export declare function validatePriceUpdate(p: PriceUpdate, nowSec: bigint, maxAgeSeconds?: bigint): string | null;
/**
 * Lamports the program charges for `usdCents` at this price, rounded UP:
 * `usdCents · 10^7 · 10^-expo / price` (expo ≤ 0), or `usdCents · 10^7 / (price · 10^expo)`.
 */
export declare function quoteLaunchFeeLamports(priceUpdate: Pick<PriceUpdate, "price" | "exponent">, usdCents: number): bigint;
/**
 * A Pyth fixed-point value (`price` or `conf` with `exponent`) as a JS number, for display
 * only (USD estimates). Never use it for amounts the program checks: use the bigint fields.
 */
export declare function pythToNumber(value: bigint, exponent: number): number;
/** Pyth push-oracle program (sponsored PriceUpdateV2 feeds; same id on devnet and mainnet). */
export declare const PYTH_PUSH_ORACLE_PROGRAM_ID: PublicKey;
/**
 * The push-oracle PriceUpdateV2 account of any Pyth feed id (hex, with or without 0x),
 * shard 0 by default: seeds [shard u16 LE, feed id]. For SOL/USD this is
 * PYTH_SOL_USD_PRICE_UPDATE. Whether the account exists, and how fresh it is, differs per
 * feed and cluster: only sponsored feeds are updated continuously.
 */
export declare function pythPushFeedAccount(feedIdHex: string, shard?: number): PublicKey;
