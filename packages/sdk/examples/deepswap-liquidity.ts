/**
 * Add and remove DeepSwap liquidity: `deposit` (amounts rounded UP) and `withdraw` (rounded
 * DOWN), with the program's LP math, SIMULATED on devnet in one transaction. Nothing is signed
 * or sent.
 *
 *   pnpm --filter @deep/sdk exec tsx examples/deepswap-liquidity.ts [--mint <graduated mint> | --pool <pool>] \
 *     [--payer <public key>] [--rpc <url>]
 *
 * So that it runs from any funded key, the transaction first buys 0.01 SOL of the token, deposits
 * as much of it as the pool ratio allows (plus the matching SOL), then withdraws the same LP:
 * wrap → swap_base_input → deposit → withdraw → unwrap. Limits are the exact amounts the math
 * predicts (zero slippage), so the simulation only passes if the SDK matches the program.
 * Pools with Token-2022 transfer fees need the transfer-fee helpers too (not handled here).
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  configPda,
  cpmmDepositIx,
  cpmmDirection,
  cpmmLpForTokenAmount,
  cpmmLpToTokens,
  cpmmPoolStateFilters,
  cpmmReserves,
  cpmmSwapBaseInputIx,
  cpmmWithdrawIx,
  decodeConfig,
  decodeCpmmAmmConfig,
  decodeCpmmPoolState,
  decodeTokenAccountAmount,
  DEEP_AMM_PROGRAM_ID,
  graduationPoolPda,
  NATIVE_MINT,
  quoteCpmmSwapBaseInput,
} from "@deepliquidity/sdk";
import { args, devnet, fundedKey, simulate } from "./_shared.js";

const a = args({ mint: { type: "string" }, pool: { type: "string" } });
const conn = await devnet(a.rpc);

let poolId: PublicKey;
if (a.pool) poolId = new PublicKey(a.pool);
else if (a.mint) poolId = graduationPoolPda(new PublicKey(a.mint));
else {
  const all = await conn.getProgramAccounts(DEEP_AMM_PROGRAM_ID, {
    filters: cpmmPoolStateFilters(),
  });
  const sol = all.find((p) => {
    const s = decodeCpmmPoolState(p.account.data);
    return s.token0Mint.equals(NATIVE_MINT) || s.token1Mint.equals(NATIVE_MINT);
  });
  if (!sol) throw new Error("no SOL pool on devnet: pass --pool");
  poolId = sol.pubkey;
}
const info = await conn.getAccountInfo(poolId);
if (!info?.owner.equals(DEEP_AMM_PROGRAM_ID)) throw new Error("not a DeepSwap pool");
const pool = decodeCpmmPoolState(info.data);
const amm = decodeCpmmAmmConfig((await conn.getAccountInfo(pool.ammConfig))!.data);
const solIs0 = pool.token0Mint.equals(NATIVE_MINT);
if (!solIs0 && !pool.token1Mint.equals(NATIVE_MINT))
  throw new Error("this example needs a SOL pool");
const token = solIs0 ? pool.token1Mint : pool.token0Mint;
const [v0, v1] = await Promise.all(
  [pool.token0Vault, pool.token1Vault].map(async (v) =>
    decodeTokenAccountAmount((await conn.getAccountInfo(v))!.data),
  ),
);
let [r0, r1] = cpmmReserves(pool, v0!, v1!);
console.log(`pool ${poolId.toBase58()}: reserves ${r0} / ${r1}, lp_supply ${pool.lpSupply}`);

// 1. Swap 0.01 SOL for the token and move the reserves the way the program does.
const swapIn = 10_000_000n;
const { creatorFeeOnInput } = cpmmDirection(pool, NATIVE_MINT);
const sq = quoteCpmmSwapBaseInput({
  amountIn: swapIn,
  inputReserve: solIs0 ? r0 : r1,
  outputReserve: solIs0 ? r1 : r0,
  config: amm,
  creatorFeeEnabled: pool.enableCreatorFee,
  creatorFeeOnInput,
});
const cut = (rate: bigint) => (sq.tradeFee * rate) / 1_000_000n;
const solAfter =
  (solIs0 ? r0 : r1) +
  swapIn -
  cut(amm.protocolFeeRate) -
  cut(amm.fundFeeRate) -
  (creatorFeeOnInput ? sq.creatorFee : 0n);
const tokAfter = (solIs0 ? r1 : r0) - sq.amountOut - (creatorFeeOnInput ? 0n : sq.creatorFee);
[r0, r1] = solIs0 ? [solAfter, tokAfter] : [tokAfter, solAfter];

// 2. Deposit: the most LP the received tokens allow; the program rounds both amounts UP.
const lp = cpmmLpForTokenAmount(sq.amountOut, tokAfter, pool.lpSupply);
const dep = cpmmLpToTokens(lp, pool.lpSupply, r0, r1, true);
const depSol = solIs0 ? dep.token0 : dep.token1;
console.log(
  `swap ${swapIn} lamports → ${sq.amountOut} tokens; deposit ${lp} LP for ${dep.token0} + ${dep.token1}`,
);

// 3. Withdraw the same LP from the pool after the deposit; the program rounds DOWN.
const wd = cpmmLpToTokens(lp, pool.lpSupply + lp, r0 + dep.token0, r1 + dep.token1, false);
console.log(
  `withdraw ${lp} LP → ${wd.token0} + ${wd.token1} (the rounding keeps ≤ 1 unit per side in the pool)`,
);

const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
const payer = a.payer
  ? new PublicKey(a.payer)
  : await fundedKey(conn, [cfg.admin, cfg.migrationAuthority], 100_000_000n);
const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, payer);
const tok = getAssociatedTokenAddressSync(token, payer);
const lpAta = getAssociatedTokenAddressSync(pool.lpMint, payer); // LP mints use the legacy token program
const common = { programId: DEEP_AMM_PROGRAM_ID, owner: payer, poolId, pool, lpAmount: lp };
await simulate(conn, payer, [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
  createAssociatedTokenAccountIdempotentInstruction(payer, wsol, payer, NATIVE_MINT),
  createAssociatedTokenAccountIdempotentInstruction(payer, tok, payer, token),
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    lpAta,
    payer,
    pool.lpMint,
    TOKEN_PROGRAM_ID,
  ),
  SystemProgram.transfer({ fromPubkey: payer, toPubkey: wsol, lamports: swapIn + depSol }),
  createSyncNativeInstruction(wsol),
  cpmmSwapBaseInputIx({
    programId: DEEP_AMM_PROGRAM_ID,
    payer,
    poolId,
    pool,
    inputMint: NATIVE_MINT,
    amountIn: swapIn,
    minimumAmountOut: sq.amountOut,
  }),
  cpmmDepositIx({ ...common, limit0: dep.token0, limit1: dep.token1 }), // maximum amounts in
  cpmmWithdrawIx({ ...common, limit0: wd.token0, limit1: wd.token1 }), // minimum amounts out
  createCloseAccountInstruction(wsol, payer, payer),
]);
