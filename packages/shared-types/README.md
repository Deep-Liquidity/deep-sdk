# @deepliquidity/shared-types

<p align="center">
  <a href="https://deepliquidity.fun"><img src="https://raw.githubusercontent.com/Deep-Liquidity/deep-sdk/main/assets/deep-og.png" alt="DEEP — Launch deeper." width="100%" /></a>
</p>

<p align="center">
  <a href="https://deepliquidity.fun"><img alt="App" src="https://img.shields.io/badge/App-mainnet-00F0FF?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="https://github.com/Deep-Liquidity/deep-sdk/blob/main/docs/INTEGRATORS.md"><img alt="Integration guide" src="https://img.shields.io/badge/Guide-integrators-AEC6FF?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="https://api.deepliquidity.fun/v1/openapi.json"><img alt="API" src="https://img.shields.io/badge/API-OpenAPI%203.1-34F6A8?style=for-the-badge&labelColor=0E141A" /></a>
  <a href="https://x.com/LaunchOnDL"><img alt="X @LaunchOnDL" src="https://img.shields.io/badge/X-%40LaunchOnDL-DDE3EC?style=for-the-badge&logo=x&logoColor=white&labelColor=0E141A" /></a>
  <a href="https://t.me/LaunchOnDL"><img alt="Telegram @LaunchOnDL" src="https://img.shields.io/badge/Telegram-%40LaunchOnDL-34F6A8?style=for-the-badge&logo=telegram&logoColor=white&labelColor=0E141A" /></a>
</p>

TypeScript types for the **DEEP** public HTTP API (`/v1`): tokens, trades, candles, pools,
DeepSwap pairs, protocol stats, TVL, stock pairs, SOL price, network and status. Types only, plus
the `TIMEFRAMES` list.

> The DEEP programs run on **mainnet** and **devnet**.

## Install

```bash
npm install @deepliquidity/shared-types
```

## Quick start

```ts
import type { TokenSummary, Trade, PairSummary } from "@deepliquidity/shared-types";

const api = "https://api.deepliquidity.fun";
const tokens = (await (await fetch(`${api}/v1/tokens`)).json()) as TokenSummary[];
const trades = (await (
  await fetch(`${api}/v1/tokens/${tokens[0]!.mint}/trades?limit=20`)
).json()) as Trade[];
```

Amounts (lamports, token base units) are decimal strings of integers; parse them with `BigInt`.
The OpenAPI 3.1 description of every public route is served at `GET /v1/openapi.json`.
Indexed data is a convenience: on-chain state is authoritative.

## Licence

MIT

## Links

[Website and app](https://deepliquidity.fun) · [Docs](https://docs.deepliquidity.fun/docs) · [Integration guide](https://github.com/Deep-Liquidity/deep-sdk/blob/main/docs/INTEGRATORS.md) · [GitHub](https://github.com/Deep-Liquidity/deep-sdk) · [Blog](https://blog.deepliquidity.fun) · [Status](https://status.deepliquidity.fun) · [X](https://x.com/LaunchOnDL) · [Telegram](https://t.me/LaunchOnDL)
