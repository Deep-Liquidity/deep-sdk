# @deepliquidity/curve-math

Integer (BigInt) maths for the **DEEP** bonding curve (the deep-curve Solana program) and
constant-product quotes. It mirrors the program's Rust `math.rs` bit for bit: both test suites run
the same committed vectors. No floating point, no dependencies.

> The DEEP programs run on **devnet**, are **not deployed on mainnet** and have **not been audited**.

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
import { quoteBuy, quoteSell, depthBps, marketCapLamports } from "@deepliquidity/curve-math";

// `state` and the fee rates come from the token's BondingCurve account (decode it with the SDK).
const fees = { protocolFeeBps: 70n, creatorFeeBps: 30n };
const buy = quoteBuy(state, 1_000_000_000n, fees); // 1 SOL budget
buy.solIn; // lamports actually charged (less than the budget when the buy completes the curve)
buy.fees; // { total, protocol, creator }: total = ceil(solIn × 100 / 10_000)
buy.tokensOut; // floor(vToken × net / (vSol + net)), capped at the tokens left
buy.next; // the curve state after the trade

const sell = quoteSell(state, 1_000_000n, fees);
sell.solOut; // floor(vSol × tokens / (vToken + tokens)) minus fees rounded up

depthBps(state); // curve progress in basis points of the curve supply (rounded down)
marketCapLamports(state); // fully diluted value at the spot price: not liquidity
```

`quoteBuy`/`quoteSell` throw `CurveMathError` with the program's error names (`ZeroAmount`,
`CurveComplete`, `InsufficientReserves`, `SlippageExceeded`, `InvalidFee`, `InvalidParams`,
`Overflow`) where the program would reject.

## Licence

MIT
