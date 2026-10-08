/**
 * Creator fees, both venues, SIMULATED on devnet. Nothing is signed or sent.
 *
 *   pnpm --filter @deep/sdk exec tsx examples/claim-creator-fees.ts [--mint <mint>] [--payer <fee payer>] [--rpc <url>]
 *
 * - Bonding curve: `claim_creator_fees` moves BondingCurve.creator_fees_unclaimed (lamports) to
 *   the creator. Signer: the curve's creator.
 * - DeepSwap graduation pool: `collect_creator_fee` pays the creator their share of the pool's
 *   accrued creator fee (as WSOL) and books DEEP's share as protocol fee. Signer: PoolState.pool_creator.
 *   `collect_creator_fee_permissionless` does the same settlement for anyone who pays.
 *
 * The creator's key is only named as a signer: with sigVerify off the RPC does not check
 * signatures, so the simulation shows exactly what the program would do. --payer (fee payer)
 * defaults to a funded devnet key. Without --mint, the curve with the most unclaimed fees is used.
 */
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  claimCreatorFeesIx,
  configPda,
  curvePda,
  decodeBondingCurve,
  decodeConfig,
  decodeCpmmPoolState,
  deepAmmCollectCreatorFeeIx,
  deepAmmCollectCreatorFeePermissionlessIx,
  DEEP_AMM_PROGRAM_ID,
  DEEP_CURVE_PROGRAM_ID,
  discriminator,
  graduationPoolPda,
} from "@deepliquidity/sdk";
import { args, devnet, fundedKey, simulate, sol } from "./_shared.js";

const a = args({ mint: { type: "string" } });
const conn = await devnet(a.rpc);
const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
const payer = a.payer
  ? new PublicKey(a.payer)
  : await fundedKey(conn, [cfg.admin, cfg.migrationAuthority], 10_000_000n);

const curves = a.mint
  ? [decodeBondingCurve((await conn.getAccountInfo(curvePda(new PublicKey(a.mint))))!.data)]
  : (
      await conn.getProgramAccounts(DEEP_CURVE_PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: Buffer.from(discriminator("account", "BondingCurve")).toString("base64"),
              encoding: "base64",
            },
          },
        ],
      })
    )
      .map((x) => decodeBondingCurve(x.account.data))
      .sort((x, y) => Number(y.creatorFeesUnclaimed - x.creatorFeesUnclaimed));

// ── 1. bonding curve ──
const c = curves[0]!;
console.log(
  `curve of ${c.mint.toBase58()}: creator ${c.creator.toBase58()}, unclaimed ${sol(c.creatorFeesUnclaimed)}`,
);
await simulate(conn, payer, [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
  claimCreatorFeesIx(c.creator, c.mint),
]);

// ── 2. DeepSwap graduation pool ──
const graduated = curves.find((x) => x.graduated) ?? null;
if (!graduated)
  console.log("\nno graduated token among the curves read: skipping the DeepSwap part");
else {
  const poolId = graduationPoolPda(graduated.mint);
  const info = await conn.getAccountInfo(poolId);
  if (!info?.owner.equals(DEEP_AMM_PROGRAM_ID))
    console.log(`\n${poolId.toBase58()} is not a DeepSwap pool`);
  else {
    const pool = decodeCpmmPoolState(info.data);
    console.log(
      `\npool ${poolId.toBase58()}: creator fee ${pool.enableCreatorFee ? "on" : "off"}, ` +
        `accrued ${pool.creatorFeesToken0} / ${pool.creatorFeesToken1}, pool_creator ${pool.poolCreator.toBase58()}`,
    );
    if (pool.creatorFeesToken0 === 0n && pool.creatorFeesToken1 === 0n)
      console.log("  nothing accrued: the program is expected to reject with NoFeeCollect (6014)");
    // The signed variant makes the creator pay the rent of their token accounts if missing;
    // when the creator's wallet is empty, show the permissionless one (payer pays that rent).
    const creatorFunded = (await conn.getBalance(pool.poolCreator)) > 5_000_000;
    console.log(
      `  using ${creatorFunded ? "collect_creator_fee (creator signs)" : "collect_creator_fee_permissionless (creator wallet is empty)"}`,
    );
    await simulate(conn, creatorFunded ? pool.poolCreator : payer, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }), // creates up to 2 ATAs
      creatorFunded
        ? deepAmmCollectCreatorFeeIx({ pool: poolId, poolState: pool })
        : deepAmmCollectCreatorFeePermissionlessIx({ payer, pool: poolId, poolState: pool }),
    ]);
  }
}
