# @deepliquidity/sdk

TypeScript client for **DEEP** on Solana: the **deep-curve** launchpad (bonding curves) and
**DeepSwap** (the deep-amm constant-product AMM that graduated tokens move to). PDAs, instruction
builders, account and event decoders, integer quotes that match the programs exactly, and the
programs' Anchor IDLs.

> **Status.** The programs run on **devnet**. They are **not deployed on mainnet** and have **not
> been audited**. Nothing in this package sends transactions by itself.

The full integration guide (account layouts with offsets, events, fee maths, error codes,
compute budgets, differences from pump.fun and Raydium CPMM) is [`docs/INTEGRATORS.md`](../../docs/INTEGRATORS.md) and the "Integrate" section of the DEEP docs.

## Install

```bash
npm install @deepliquidity/sdk @deepliquidity/curve-math @solana/web3.js
```

ESM only, with TypeScript declarations. Works in Node ≥ 22 and in browser bundles: the package
imports `Buffer` from the `buffer` package and never relies on a global `Buffer`.

## Program ids

```ts
import { DEEP_CURVE_PROGRAM_ID, DEEP_AMM_PROGRAM_ID } from "@deepliquidity/sdk";
// deep-curve 7czURwVLkQpcF1HVhhZU5GGzvPA8YniogZY1BhZHCDtA (devnet)
// deep-amm   HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP (devnet)
```

## Quick start: quote and build a curve buy

```ts
import { quoteBuy } from "@deepliquidity/curve-math";
import { applySlippage, buyIx, curvePda, decodeBondingCurve } from "@deepliquidity/sdk";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const mint = new PublicKey("<mint>");
const user = new PublicKey("<wallet>");

const curve = decodeBondingCurve((await conn.getAccountInfo(curvePda(mint)))!.data);
const fees = {
  protocolFeeBps: BigInt(curve.protocolFeeBps),
  creatorFeeBps: BigInt(curve.creatorFeeBps),
};
const q = quoteBuy(curve.state, 100_000_000n, fees); // 0.1 SOL in, fees included
const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
  buyIx({
    user,
    mint,
    amount: 100_000_000n,
    minOut: applySlippage(q.tokensOut, 100), // 1% slippage floor
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  }),
);
// sign with the user's wallet and send
```

## Quick start: swap on a DeepSwap pool

```ts
import {
  cpmmDirection,
  cpmmReserves,
  cpmmSwapBaseInputIx,
  decodeCpmmAmmConfig,
  decodeCpmmPoolState,
  DEEP_AMM_PROGRAM_ID,
  graduationPoolPda,
  NATIVE_MINT,
  quoteCpmmSwapBaseInput,
} from "@deepliquidity/sdk";

const poolId = graduationPoolPda(mint); // the pool a token graduated into
const pool = decodeCpmmPoolState((await conn.getAccountInfo(poolId))!.data);
const amm = decodeCpmmAmmConfig((await conn.getAccountInfo(pool.ammConfig))!.data);
const bal = async (k: PublicKey) => BigInt((await conn.getTokenAccountBalance(k)).value.amount);
const [r0, r1] = cpmmReserves(pool, await bal(pool.token0Vault), await bal(pool.token1Vault));
const { zeroForOne, creatorFeeOnInput } = cpmmDirection(pool, NATIVE_MINT);
const q = quoteCpmmSwapBaseInput({
  amountIn: 10_000_000n,
  inputReserve: zeroForOne ? r0 : r1,
  outputReserve: zeroForOne ? r1 : r0,
  config: amm,
  creatorFeeEnabled: pool.enableCreatorFee,
  creatorFeeOnInput,
});
const ix = cpmmSwapBaseInputIx({
  programId: DEEP_AMM_PROGRAM_ID,
  payer: user,
  poolId,
  pool,
  inputMint: NATIVE_MINT,
  amountIn: 10_000_000n,
  minimumAmountOut: (q.amountOut * 99n) / 100n,
}); // wrap SOL into the user's WSOL account first; see examples/deepswap-swap.ts
```

## Events

```ts
import { parseEventsFromLogs, parseFeeEventsFromLogs, parseAmmSwapEvents } from "@deepliquidity/sdk";

conn.onLogs(DEEP_CURVE_PROGRAM_ID, (l) => {
  for (const { event } of parseEventsFromLogs(l.logs)) console.log(event.name, event);
});
conn.onLogs(DEEP_AMM_PROGRAM_ID, (l) => console.log(parseAmmSwapEvents(l.logs)));
```

`parseEventsFromLogs` only accepts `Program data:` lines emitted by the program itself (it tracks
the invoke stack), so another program cannot spoof DEEP events.

## IDLs

```ts
import curveIdl from "@deepliquidity/sdk/idl/deep_curve.json" with { type: "json" };
import ammIdl from "@deepliquidity/sdk/idl/deep_amm.json" with { type: "json" };
```

Anchor IDL spec 0.1.0. The SDK's decoders are tested field by field against these files, and
the files against the live devnet accounts.

## Examples

`examples/` builds real transactions and **simulates** them on devnet (`sigVerify: false`):
nothing is signed or sent, and no keypair is ever read. Pass `--payer <public key>` to choose
whose account the simulation runs as.

| file                    | what it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `read-curve.ts`         | Config, curve state, price, progress, completion, graduation pool |
| `watch-launches.ts`     | `onLogs` on both programs; launches, trades, graduation, swaps    |
| `quote-and-buy.ts`      | quote + `buy`, checks the TradeEvent against the quote            |
| `sell.ts`               | quote + `sell`                                                    |
| `deepswap-swap.ts`      | DeepSwap `swap_base_input` with wrap/unwrap (buy, or round trip)  |
| `deepswap-liquidity.ts` | `deposit` and `withdraw` with exact LP maths                      |
| `claim-creator-fees.ts` | curve `claim_creator_fees` and DeepSwap creator-fee collection    |

```bash
npx tsx examples/read-curve.ts --rpc https://api.devnet.solana.com
```

## Licence

`MIT AND Apache-2.0`: the cp-swap ports listed in `NOTICE` are Apache-2.0 (`LICENSE-APACHE`),
everything else is MIT (`LICENSE`).
