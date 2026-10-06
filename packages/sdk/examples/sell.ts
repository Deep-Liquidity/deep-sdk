/**
 * Quote a curve sell, build it and SIMULATE it on devnet. Nothing is signed or sent.
 *
 *   pnpm --filter @deepliquidity/sdk exec tsx examples/sell.ts --mint <mint> \
 *     [--tokens <base units>] [--slippage-bps 100] [--payer <holder public key>] [--rpc <url>]
 *
 * --payer must hold the token. It defaults to a recent buyer (from the TradeEvents in the
 * curve's latest transactions) who still holds some; --tokens defaults to half of that balance.
 */
import { quoteSell } from "@deepliquidity/curve-math";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  applySlippage,
  curvePda,
  decodeBondingCurve,
  decodeTokenAccountAmount,
  parseEventsFromLogs,
  sellIx,
} from "@deepliquidity/sdk";
import { args, devnet, nowSec, simulate, sol } from "./_shared.js";

const a = args({
  mint: { type: "string" },
  tokens: { type: "string" },
  "slippage-bps": { type: "string", default: "100" },
});
if (!a.mint) throw new Error("--mint <mint> is required");
const conn = await devnet(a.rpc);
const mint = new PublicKey(a.mint);

const curve = decodeBondingCurve((await conn.getAccountInfo(curvePda(mint)))!.data);
if (curve.state.complete) throw new Error("curve complete: sell on its DeepSwap pool instead");

let payer: PublicKey;
if (a.payer) payer = new PublicKey(a.payer);
else {
  let found: PublicKey | null = null;
  for (const s of await conn.getSignaturesForAddress(curvePda(mint), { limit: 20 })) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    for (const { event: e } of parseEventsFromLogs(tx?.meta?.logMessages ?? [])) {
      if (e.name !== "TradeEvent" || !e.isBuy) continue;
      const k = new PublicKey(e.trader);
      const acc = await conn.getAccountInfo(getAssociatedTokenAddressSync(mint, k));
      if (acc && decodeTokenAccountAmount(acc.data) > 0n) found = k;
      break;
    }
    if (found) break;
  }
  if (!found) throw new Error("no recent buyer still holds the token: pass --payer");
  payer = found;
}
const ata = getAssociatedTokenAddressSync(mint, payer);
const balance = decodeTokenAccountAmount((await conn.getAccountInfo(ata))!.data);
const tokensIn = a.tokens ? BigInt(a.tokens) : balance / 2n;
console.log(`seller ${payer.toBase58()} holds ${balance} base units; selling ${tokensIn}`);

const fees = {
  protocolFeeBps: BigInt(curve.protocolFeeBps),
  creatorFeeBps: BigInt(curve.creatorFeeBps),
};
const q = quoteSell(curve.state, tokensIn, fees);
const minOut = applySlippage(q.solOut, Number(a["slippage-bps"]));
console.log(
  `quote: curve pays ${sol(q.solFromCurve)}, fees ${q.fees.protocol} + ${q.fees.creator} lamports (taken from the SOL out)`,
);
console.log(`  seller receives ${sol(q.solOut)} (min ${sol(minOut)})`);

const r = await simulate(conn, payer, [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
  sellIx({ user: payer, mint, amount: tokensIn, minOut, deadline: nowSec() + 60n }),
]);
const ev = r.curveEvents.find((e) => e.name === "TradeEvent");
if (ev?.name === "TradeEvent")
  console.log(
    `\nTradeEvent.solAmount ${ev.solAmount} (net to seller) vs quote ${q.solOut} → ` +
      (ev.solAmount === q.solOut ? "EXACT MATCH" : "differs (the curve moved)"),
  );
