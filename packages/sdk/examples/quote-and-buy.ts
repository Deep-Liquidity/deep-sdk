/**
 * Quote a curve buy with the program's own integer math, build the transaction (compute budget +
 * `buy` with a slippage floor and a deadline), and SIMULATE it on devnet. Nothing is signed or sent.
 *
 *   pnpm --filter @deepliquidity/sdk exec tsx examples/quote-and-buy.ts --mint <mint> \
 *     [--sol 0.01] [--slippage-bps 100] [--payer <public key>] [--rpc <url>]
 *
 * --payer defaults to a funded devnet key read from the deep-curve Config (the admin or the
 * migration authority): any public key with enough devnet SOL works, since nothing is signed.
 */
import { quoteBuy } from "@deepliquidity/curve-math";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  applySlippage,
  buyIx,
  configPda,
  curvePda,
  decodeBondingCurve,
  decodeConfig,
} from "@deepliquidity/sdk";
import { args, devnet, fundedKey, nowSec, simulate, sol } from "./_shared.js";

const a = args({
  mint: { type: "string" },
  sol: { type: "string", default: "0.01" },
  "slippage-bps": { type: "string", default: "100" },
});
if (!a.mint) throw new Error("--mint <mint> is required (examples/read-curve.ts lists curves)");
const conn = await devnet(a.rpc);
const mint = new PublicKey(a.mint);
const solIn = BigInt(Math.round(Number(a.sol) * 1e9));

// 1. Read the curve (fees are snapshotted per curve at launch, so read them from the curve).
const curve = decodeBondingCurve((await conn.getAccountInfo(curvePda(mint)))!.data);
if (curve.state.complete) throw new Error("curve complete: trade on its DeepSwap pool instead");
const fees = {
  protocolFeeBps: BigInt(curve.protocolFeeBps),
  creatorFeeBps: BigInt(curve.creatorFeeBps),
};

// 2. Quote exactly as the program will (fees rounded up, tokens out rounded down).
const q = quoteBuy(curve.state, solIn, fees);
const minOut = applySlippage(q.tokensOut, Number(a["slippage-bps"]));
console.log(`quote for ${sol(solIn)}:`);
console.log(`  charged ${sol(q.solIn)}${q.capped ? " (capped: the buy completes the curve)" : ""}`);
console.log(
  `  fees ${sol(q.fees.total)} = protocol ${q.fees.protocol} + creator ${q.fees.creator} lamports`,
);
console.log(
  `  to the curve ${sol(q.solToCurve)} → ${q.tokensOut} base units out (min ${minOut} at ${a["slippage-bps"]} bps)`,
);

// 3. Build: compute budget + buy (creates the buyer's token ATA if needed, inside the program).
const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
const payer = a.payer
  ? new PublicKey(a.payer)
  : await fundedKey(conn, [cfg.admin, cfg.migrationAuthority], q.solIn + 10_000_000n);
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
  buyIx({ user: payer, mint, amount: solIn, minOut, deadline: nowSec() + 60n }),
];

// 4. Simulate and compare the program's TradeEvent with the quote.
const r = await simulate(conn, payer, ixs);
const ev = r.curveEvents.find((e) => e.name === "TradeEvent");
if (ev?.name === "TradeEvent")
  console.log(
    `\nTradeEvent vs quote: tokens ${ev.tokenAmount} vs ${q.tokensOut}, SOL ${ev.solAmount} vs ${q.solIn}, ` +
      `fees ${ev.protocolFee}+${ev.creatorFee} vs ${q.fees.protocol}+${q.fees.creator} → ` +
      (ev.tokenAmount === q.tokensOut && ev.solAmount === q.solIn
        ? "EXACT MATCH"
        : "differs (the curve moved)"),
  );
