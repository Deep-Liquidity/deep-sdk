# @deepliquidity/shared-types

TypeScript types for the **DEEP** public HTTP API (`/v1`): tokens, trades, candles, pools,
DeepSwap pairs, protocol stats, TVL, stock pairs, SOL price, network and status. Types only, plus
the `TIMEFRAMES` list.

> The DEEP programs run on **mainnet-beta** and **devnet**.

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
