/**
 * Read a launch's bonding curve straight from chain: state, price, progress, completion and,
 * after graduation, its DeepSwap pool. Read-only.
 *
 *   pnpm --filter @deep/sdk exec tsx examples/read-curve.ts [--mint <mint>] [--rpc <url>]
 *
 * Without --mint it lists every BondingCurve account (getProgramAccounts) and reads the first
 * one still bonding.
 */
import {
  completionState,
  depthBps,
  marketCapLamports,
  quoteBuy,
  tokensSold,
} from "@deepliquidity/curve-math";
import { PublicKey } from "@solana/web3.js";
import {
  configPda,
  cpmmReserves,
  curvePda,
  decodeBondingCurve,
  decodeConfig,
  decodeCpmmPoolState,
  DEEP_AMM_PROGRAM_ID,
  DEEP_CURVE_PROGRAM_ID,
  discriminator,
  graduationPoolPda,
  NATIVE_MINT,
} from "@deepliquidity/sdk";
import { Buffer } from "buffer";
import { args, devnet, sol } from "./_shared.js";

const a = args({ mint: { type: "string" } });
const conn = await devnet(a.rpc);

const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
console.log("deep-curve Config", configPda().toBase58());
console.log(
  `  fees: protocol ${cfg.protocolFeeBps} bps + creator ${cfg.creatorFeeBps} bps per trade, migration ${cfg.migrationFeeBps} bps`,
);
console.log(`  launch fee: ${cfg.launchFeeUsdCents} US cents · paused: ${cfg.paused}`);
console.log(
  `  new curves: virtual ${sol(cfg.initialVirtualSol)} / ${cfg.initialVirtualToken} base units, curve supply ${cfg.curveSupply} of ${cfg.tokenTotalSupply}, ${cfg.decimals} decimals`,
);

let mint: PublicKey;
if (a.mint) mint = new PublicKey(a.mint);
else {
  const all = await conn.getProgramAccounts(DEEP_CURVE_PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(discriminator("account", "BondingCurve")).toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });
  const curves = all.map((x) => decodeBondingCurve(x.account.data));
  console.log(
    `\n${curves.length} curves on devnet: ${curves.filter((c) => !c.state.complete).length} bonding, ` +
      `${curves.filter((c) => c.state.complete && !c.graduated).length} complete (awaiting graduation), ` +
      `${curves.filter((c) => c.graduated).length} graduated`,
  );
  const bonding = curves
    .filter((c) => !c.state.complete)
    .sort((x, y) => Number(x.state.realTokenReserves - y.state.realTokenReserves));
  mint = (bonding[0] ?? curves[0]!).mint;
}

const curveAddr = curvePda(mint);
const c = decodeBondingCurve((await conn.getAccountInfo(curveAddr))!.data);
const s = c.state;
console.log(`\nmint ${mint.toBase58()}  curve ${curveAddr.toBase58()}`);
console.log(
  `  creator ${c.creator.toBase58()}, created ${new Date(Number(c.createdAt) * 1000).toISOString()}`,
);
console.log(
  `  virtual reserves: ${s.virtualSolReserves} lamports / ${s.virtualTokenReserves} base units`,
);
console.log(
  `  real reserves:    ${s.realSolReserves} lamports / ${s.realTokenReserves} base units unsold`,
);
// Spot price in lamports per WHOLE token (display only; quotes use the integer math).
const spot = (Number(s.virtualSolReserves) / Number(s.virtualTokenReserves)) * 10 ** cfg.decimals;
console.log(
  `  spot price: ${spot.toFixed(3)} lamports per token; market cap (FDV) ${sol(marketCapLamports(s))}`,
);
console.log(`  progress: ${tokensSold(s)} / ${s.curveSupply} sold = ${Number(depthBps(s)) / 100}%`);
console.log(
  `  fees snapshotted at launch: protocol ${c.protocolFeeBps} bps, creator ${c.creatorFeeBps} bps`,
);
console.log(
  `  unclaimed: creator ${sol(c.creatorFeesUnclaimed)}, protocol ${sol(c.protocolFeesUnclaimed)}`,
);

if (!s.complete) {
  const fees = { protocolFeeBps: BigInt(c.protocolFeeBps), creatorFeeBps: BigInt(c.creatorFeeBps) };
  // A buy larger than what is left is capped and only charges what completes the curve.
  const q = quoteBuy(s, 1n << 62n, fees);
  console.log(`  SOL to complete the curve: ${sol(q.solIn)} (${sol(q.fees.total)} of it fees)`);
  const end = completionState({
    decimals: cfg.decimals,
    tokenTotalSupply: s.tokenTotalSupply,
    curveSupply: s.curveSupply,
    initialVirtualSol: cfg.initialVirtualSol,
    initialVirtualToken: cfg.initialVirtualToken,
    fees,
    migrationFeeBps: BigInt(c.migrationFeeBps),
  });
  console.log(`  real SOL at completion (from Config defaults): ${sol(end.realSolReserves)}`);
}

const pool = graduationPoolPda(mint);
console.log(
  `\nstatus: ${c.graduated ? "GRADUATED" : s.complete ? "COMPLETE (awaiting graduate)" : "BONDING"}`,
);
console.log(`  DeepSwap pool (deep-curve PDA ["raydium_pool", mint]): ${pool.toBase58()}`);
if (c.graduated) {
  console.log(
    `  BondingCurve.pool = ${c.pool.toBase58()} (${c.pool.equals(pool) ? "matches" : "DIFFERS"})`,
  );
  const info = await conn.getAccountInfo(pool);
  if (info?.owner.equals(DEEP_AMM_PROGRAM_ID)) {
    const p = decodeCpmmPoolState(info.data);
    const [v0, v1] = await Promise.all(
      [p.token0Vault, p.token1Vault].map(async (v) =>
        BigInt((await conn.getTokenAccountBalance(v)).value.amount),
      ),
    );
    const [r0, r1] = cpmmReserves(p, v0!, v1!);
    const solSide = p.token0Mint.equals(NATIVE_MINT) ? 0 : 1;
    console.log(
      `  pool reserves: ${sol(solSide === 0 ? r0 : r1)} + ${solSide === 0 ? r1 : r0} base units; lp_supply ${p.lpSupply}; creator fee ${p.enableCreatorFee ? "on" : "off"}`,
    );
  } else console.log(`  pool account owner: ${info?.owner.toBase58() ?? "none"}`);
}
