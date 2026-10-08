<p align="center">
  <a href="https://deepliquidity.fun"><img src="./assets/deep-og.png" alt="DEEP — Launch DEEP." width="100%" /></a>
</p>

<h3 align="center">The TypeScript SDK for DEEP: a Solana launchpad and DEX in one.</h3>

<p align="center">
  <a href="https://deepliquidity.fun"><img alt="App" src="https://img.shields.io/badge/App-mainnet-00F0FF?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="./docs/INTEGRATORS.md"><img alt="Integration guide" src="https://img.shields.io/badge/Guide-integrators-AEC6FF?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="https://api.deepliquidity.fun/v1/openapi.json"><img alt="API" src="https://img.shields.io/badge/API-OpenAPI%203.1-34F6A8?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="https://x.com/LaunchOnDL"><img alt="X @LaunchOnDL" src="https://img.shields.io/badge/X-%40LaunchOnDL-DDE3EC?style=for-the-badge&logo=x&logoColor=white&labelColor=0E141A" /></a>
  <a href="https://t.me/LaunchOnDL"><img alt="Telegram @LaunchOnDL" src="https://img.shields.io/badge/Telegram-%40LaunchOnDL-34F6A8?style=for-the-badge&logo=telegram&logoColor=white&labelColor=0E141A" /></a>
</p>

---

DEEP runs three Solana programs. **deep-curve** is the launchpad: every token starts on a bonding
curve and graduates when the curve sells out. **DeepSwap** (deep-amm) is DEEP's own
constant-product AMM: graduation seeds a pool there and burns its LP, and anyone can open pools
for any two tokens. **deep-rewards** pays a token's Holder Rewards to its holders. This repository
has everything a wallet, trading terminal, bot or aggregator needs to support them.

## Packages

| Package | What it does |
| --- | --- |
| [`@deepliquidity/sdk`](./packages/sdk) | PDAs, instruction builders (create, buy, sell, claim, swap, add/remove liquidity, create pool, claim holder rewards), account and event decoders, Token-2022 aware quotes, and the program IDLs |
| [`@deepliquidity/curve-math`](./packages/curve-math) | The bonding-curve and fee maths in integer `bigint`, bit-for-bit identical to the on-chain program |
| [`@deepliquidity/shared-types`](./packages/shared-types) | Types for the public DEEP API (tokens, trades, candles, pools, pairs, rewards, stocks) |

Each package ships ESM with TypeScript declarations, works in Node ≥ 22 and in browser bundles,
and has its readable source in `src/`.

## Features

- 🚀 **Launchpad**: detect new launches, read curve progress, quote and build buys and sells with
  slippage and deadlines, follow a token to graduation and its DeepSwap pool.
- 🔁 **DEX**: quote and build swaps on any DeepSwap pool, including Token-2022 transfer fees and
  ScaledUiAmount multipliers; add and remove liquidity; create pools.
- 💸 **Fees, exactly**: DEEP's per-side fee on the curve and on DeepSwap, each token's and each
  pool's own reward model (Standard, Creator Rewards or Holder Rewards) and rate, the LP share
  and the USD launch fee priced from Pyth, with the programs' own rounding.
- 🎁 **Holder Rewards**: read a token's reward rounds, verify a Merkle proof offline and build
  the claim.
- 📡 **Events**: decode `TokenCreated`, `Trade`, `Graduated` and DeepSwap `SwapEvent` straight
  from transaction logs.
- 🧾 **IDLs**: `@deepliquidity/sdk/idl/deep_curve.json`, `deep_amm.json` and `deep_rewards.json`.

## Quick start

```ts
import { quoteBuy } from "@deepliquidity/curve-math";
import { curvePda, decodeBondingCurve, DEEP_CURVE_PROGRAM_ID } from "@deepliquidity/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const mint = new PublicKey("<token mint>");
const curve = decodeBondingCurve((await conn.getAccountInfo(curvePda(mint)))!.data);
console.log(DEEP_CURVE_PROGRAM_ID.toBase58(), curve.state);
```

More in [`packages/sdk/examples`](./packages/sdk/examples): watch launches live, read a curve,
quote and buy, sell, swap on DeepSwap, add and remove liquidity, claim creator fees. Every
example builds real transactions and **simulates** them by default; none of them reads a
keypair.

## Programs

The program ids are the same on mainnet and devnet.

| Program | Address |
| --- | --- |
| deep-curve | `7czURwVLkQpcF1HVhhZU5GGzvPA8YniogZY1BhZHCDtA` |
| DeepSwap (deep-amm) | `HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP` |
| deep-rewards | `4z2KpxUcdNFXFpzxKtcmTv6aDMqE4CMLCdbYExLYeDE2` |

Account layouts with byte offsets, PDA seeds, events, error codes, compute budgets and the
differences from pump.fun and Raydium CPMM are in the **[integration guide](./docs/INTEGRATORS.md)**.
The public HTTP API is described at
[`api.deepliquidity.fun/v1/openapi.json`](https://api.deepliquidity.fun/v1/openapi.json).

## Install

```bash
npm install @deepliquidity/sdk @deepliquidity/curve-math @solana/web3.js
npm install @deepliquidity/shared-types   # optional: types for the DEEP HTTP API
```

| Package | npm |
| --- | --- |
| `@deepliquidity/sdk` | [![npm](https://img.shields.io/npm/v/@deepliquidity/sdk?color=00F0FF&labelColor=0E141A)](https://www.npmjs.com/package/@deepliquidity/sdk) |
| `@deepliquidity/curve-math` | [![npm](https://img.shields.io/npm/v/@deepliquidity/curve-math?color=00F0FF&labelColor=0E141A)](https://www.npmjs.com/package/@deepliquidity/curve-math) |
| `@deepliquidity/shared-types` | [![npm](https://img.shields.io/npm/v/@deepliquidity/shared-types?color=00F0FF&labelColor=0E141A)](https://www.npmjs.com/package/@deepliquidity/shared-types) |

## Status

DEEP is live on **Solana mainnet** since 8 October 2026, and on devnet for testing.
Nothing in these packages sends a transaction on its own.

## License

MIT, except code ported from Raydium cp-swap, which is Apache-2.0 (see [`NOTICE`](./NOTICE) and
[`LICENSE-APACHE`](./LICENSE-APACHE)).

## Links

[Website and app](https://deepliquidity.fun) · [Docs](https://docs.deepliquidity.fun/docs) · [Blog](https://blog.deepliquidity.fun) · [Status](https://status.deepliquidity.fun) · [X](https://x.com/LaunchOnDL) · [Telegram](https://t.me/LaunchOnDL)
