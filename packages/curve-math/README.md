# @deepliquidity/curve-math

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

Integer (BigInt) maths for the **DEEP** bonding curve (the deep-curve Solana program) and
constant-product quotes. It mirrors the program's Rust `math.rs` bit for bit: both test suites run
the same committed vectors. No floating point, no dependencies.

> The DEEP programs run on **mainnet** and **devnet**.

## Install

```bash
npm install @deepliquidity/curve-math
```

ESM only, with TypeScript declarations. Node ≥ 22 or any modern browser bundle.

## Rounding

- amounts paid **out** to the trader round **down**;
- fees and amounts the trader must pay **in** round **up**;
- so the curve invariant `k = virtualSol × virtualToken` never decreases.

## Quick start

```ts
import { quoteBuyV1, quoteSellV1, depthBps, marketCapLamports } from "@deepliquidity/curve-math";

// `state` and `fees` come from the token's BondingCurve account: decode it with the SDK
// (`decodeBondingCurve`, `curveFees`). Every token keeps the rates it was launched with.
const buy = quoteBuyV1(state, 1_000_000_000n, fees); // 1 SOL budget
buy.solIn; // lamports actually charged (less than the budget when the buy completes the curve)
buy.fees; // { total, protocol, creator }: rounded up, on top of what reaches the curve
buy.routing; // who receives the reward part: the creator or the token's holders
buy.tokensOut; // floor(vToken × net / (vSol + net)), capped at the tokens left
buy.next; // the curve state after the trade

const sell = quoteSellV1(state, 1_000_000n, fees);
sell.solOut; // floor(vSol × tokens / (vToken + tokens)) minus fees rounded up

depthBps(state); // curve progress in basis points of the curve supply (rounded down)
marketCapLamports(state); // fully diluted value at the spot price: not liquidity
```

`quoteBuyV1`/`quoteSellV1` throw `CurveMathError` with the program's error names (`ZeroAmount`,
`CurveComplete`, `InsufficientReserves`, `SlippageExceeded`, `InvalidFee`, `InvalidParams`,
`Overflow`) where the program would reject.

## Licence

MIT

## Links

[Website and app](https://deepliquidity.fun) · [Docs](https://docs.deepliquidity.fun/docs) · [Integration guide](https://github.com/Deep-Liquidity/deep-sdk/blob/main/docs/INTEGRATORS.md) · [GitHub](https://github.com/Deep-Liquidity/deep-sdk) · [Blog](https://blog.deepliquidity.fun) · [Status](https://status.deepliquidity.fun) · [X](https://x.com/LaunchOnDL) · [Telegram](https://t.me/LaunchOnDL)
