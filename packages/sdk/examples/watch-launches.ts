/**
 * Detect launches, trades, curve completion, graduation and DeepSwap swaps from chain logs:
 * `onLogs` subscriptions on both programs, decoded with the SDK. Read-only.
 *
 *   pnpm --filter @deepliquidity/sdk exec tsx examples/watch-launches.ts [--seconds 60] [--backfill 10] [--rpc <url>] [--ws <url>]
 *
 * --backfill N first decodes the last N transactions of each program (getSignaturesForAddress +
 * getTransaction), so there is output even when nothing happens during the watch window.
 * Event → meaning:
 *   TokenCreated      new launch (mint, creator, name/symbol/uri, supplies)
 *   LaunchFeeCharged  the launch fee taken in the same create_token (lamports, Pyth price used)
 *   TradeEvent        curve buy/sell with post-trade reserves (progress = sold / curve supply)
 *   CurveCompleted    every curve token sold: trading on the curve is over, `graduate` is next
 *   Graduated         DeepSwap pool created at graduationPoolPda(mint), LP burned
 *   SwapEvent         deep-amm swap; graduation pools are the ones isGraduationPool() accepts
 */
import { PublicKey, type Logs } from "@solana/web3.js";
import {
  DEEP_AMM_PROGRAM_ID,
  DEEP_CURVE_PROGRAM_ID,
  graduationPoolPda,
  NATIVE_MINT,
  parseAmmSwapEvents,
  parseEventsFromLogs,
  parseFeeEventsFromLogs,
  type DeepEvent,
} from "@deepliquidity/sdk";
import { args, devnet } from "./_shared.js";

const a = args({
  seconds: { type: "string", default: "60" },
  backfill: { type: "string", default: "10" },
  ws: { type: "string" },
});
const conn = await devnet(a.rpc);

function describe(e: DeepEvent): string {
  switch (e.name) {
    case "TokenCreated":
      return `NEW LAUNCH ${e.symbol} "${e.tokenName}" mint ${e.mint} by ${e.creator}, uri ${e.uri}`;
    case "TradeEvent": {
      const sold = Number(e.realTokenReserves);
      return (
        `${e.isBuy ? "BUY " : "SELL"} ${e.mint.slice(0, 8)}… ${e.tokenAmount} tokens for ${e.solAmount} lamports ` +
        `(fees ${e.protocolFee}+${e.creatorFee}) · ${sold} tokens left on the curve`
      );
    }
    case "CurveCompleted":
      return `CURVE COMPLETE ${e.mint}: ${e.realSolReserves} lamports raised, graduation next`;
    case "Graduated":
      return (
        `GRADUATED ${e.mint}: DeepSwap pool ${graduationPoolPda(new PublicKey(e.mint)).toBase58()} ` +
        `seeded with ${e.lpSol} lamports + ${e.lpTokens} tokens, ${e.burnedTokens} burned, migration fee ${e.migrationFee}`
      );
    default:
      return `${e.name} ${JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`;
  }
}

function handle(sig: string, logs: readonly string[], source: string) {
  for (const f of parseFeeEventsFromLogs(logs))
    if (f.name === "LaunchFeeCharged")
      console.log(
        `[${source}] ${sig.slice(0, 10)}… launch fee ${f.lamports} lamports ($${(f.usdCents / 100).toFixed(2)})`,
      );
  for (const { event } of parseEventsFromLogs(logs))
    console.log(`[${source}] ${sig.slice(0, 10)}… ${describe(event)}`);
  for (const s of parseAmmSwapEvents(logs)) {
    const solIn = s.inputMint.equals(NATIVE_MINT);
    console.log(
      `[${source}] ${sig.slice(0, 10)}… DEEPSWAP pool ${s.poolId.toBase58().slice(0, 8)}… ` +
        `${s.inputAmount} ${solIn ? "lamports" : s.inputMint.toBase58().slice(0, 6) + "…"} → ` +
        `${s.outputAmount} ${s.outputMint.equals(NATIVE_MINT) ? "lamports" : s.outputMint.toBase58().slice(0, 6) + "…"} ` +
        `(trade fee ${s.tradeFee}, creator fee ${s.creatorFee})`,
    );
  }
}

// 1. Backfill: the last N transactions of each program, oldest first.
for (const program of [DEEP_CURVE_PROGRAM_ID, DEEP_AMM_PROGRAM_ID]) {
  const sigs = await conn.getSignaturesForAddress(program, { limit: Number(a.backfill) });
  for (const s of sigs.reverse()) {
    if (s.err) continue; // failed transactions emit nothing that happened
    await new Promise((r) => setTimeout(r, 400)); // public RPCs rate-limit getTransaction
    const tx = await conn
      .getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
      .catch(
        (e: Error) => (
          console.log(`  skipped ${s.signature.slice(0, 10)}…: ${e.message.slice(0, 60)}`),
          null
        ),
      );
    handle(s.signature, tx?.meta?.logMessages ?? [], `slot ${s.slot}`);
  }
}

// 2. Live: logs subscriptions ("confirmed"). A failed transaction's logs arrive with err set.
const live = a.ws
  ? new (await import("@solana/web3.js")).Connection(conn.rpcEndpoint, { wsEndpoint: a.ws })
  : conn;
const onLogs = (l: Logs) => (l.err ? undefined : handle(l.signature, l.logs, "live"));
const subs = [
  live.onLogs(DEEP_CURVE_PROGRAM_ID, onLogs, "confirmed"),
  live.onLogs(DEEP_AMM_PROGRAM_ID, onLogs, "confirmed"),
];
console.log(`\nwatching deep-curve and deep-amm logs for ${a.seconds}s…`);
await new Promise((r) => setTimeout(r, Number(a.seconds) * 1000));
await Promise.all(subs.map((id) => live.removeOnLogsListener(id)));
console.log("done");
process.exit(0);
