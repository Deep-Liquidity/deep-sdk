/**
 * Swap on a DeepSwap (deep-amm) pool: read PoolState + AmmConfig + vaults, quote with the
 * program's integer math (trade fee, creator fee, Token-2022 transfer fees), build
 * wrap → swap_base_input → unwrap, and SIMULATE it on devnet. Nothing is signed or sent.
 *
 *   pnpm --filter @deep/sdk exec tsx examples/deepswap-swap.ts [--mint <graduated mint> | --pool <pool>] \
 *     [--side buy|sell] [--amount <input base units>] [--slippage-bps 100] [--payer <public key>] [--rpc <url>]
 *
 * buy = SOL in, sell = token in (pools with WSOL on one side). Without --mint/--pool the first
 * deep-amm pool found on devnet is used. --payer defaults to a funded devnet key; then --side sell
 * runs a round trip in ONE simulated transaction (buy 0.01 SOL, sell exactly what it bought),
 * quoting the second leg against the reserves after the first. With --payer, sell needs a holder.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  getTransferFeeConfig,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  applySlippage,
  configPda,
  cpmmDirection,
  cpmmPoolStateFilters,
  cpmmReserves,
  cpmmSwapBaseInputIx,
  decodeConfig,
  decodeCpmmAmmConfig,
  decodeCpmmPoolState,
  decodeTokenAccountAmount,
  DEEP_AMM_PROGRAM_ID,
  graduationPoolPda,
  isGraduationPool,
  NATIVE_MINT,
  quoteCpmmSwapWithTransferFees,
  type MintTransferFeeConfig,
} from "@deepliquidity/sdk";
import { args, devnet, fundedKey, simulate } from "./_shared.js";

const a = args({
  mint: { type: "string" },
  pool: { type: "string" },
  side: { type: "string", default: "buy" },
  amount: { type: "string" },
  "slippage-bps": { type: "string", default: "100" },
});
const conn = await devnet(a.rpc);

let poolId: PublicKey;
if (a.pool) poolId = new PublicKey(a.pool);
else if (a.mint)
  poolId = graduationPoolPda(new PublicKey(a.mint)); // where graduation put it
else {
  const all = await conn.getProgramAccounts(DEEP_AMM_PROGRAM_ID, {
    filters: cpmmPoolStateFilters(),
    dataSlice: { offset: 0, length: 0 },
  });
  poolId = all[0]!.pubkey;
}
const poolInfo = await conn.getAccountInfo(poolId);
if (!poolInfo?.owner.equals(DEEP_AMM_PROGRAM_ID))
  throw new Error(
    `${poolId.toBase58()} is not a DeepSwap pool (owner ${poolInfo?.owner.toBase58() ?? "none"})`,
  );
const pool = decodeCpmmPoolState(poolInfo.data);
const amm = decodeCpmmAmmConfig((await conn.getAccountInfo(pool.ammConfig))!.data);
if (!pool.token0Mint.equals(NATIVE_MINT) && !pool.token1Mint.equals(NATIVE_MINT))
  throw new Error("this example trades pools with WSOL on one side");
const token = pool.token0Mint.equals(NATIVE_MINT) ? pool.token1Mint : pool.token0Mint;
const tokenProgram = pool.token0Mint.equals(NATIVE_MINT) ? pool.token1Program : pool.token0Program;
const wsolProgram = pool.token0Mint.equals(NATIVE_MINT) ? pool.token0Program : pool.token1Program;
console.log(
  `pool ${poolId.toBase58()} (${isGraduationPool(poolId, pool.token0Mint, pool.token1Mint) ? "graduation pool" : "user pool"})`,
);
console.log(`  token ${token.toBase58()} · AmmConfig ${pool.ammConfig.toBase58()}`);
console.log(
  `  trade fee ${amm.tradeFeeRate}/1e6 (protocol share ${amm.protocolFeeRate}/1e6, fund ${amm.fundFeeRate}/1e6)` +
    ` · creator fee ${pool.enableCreatorFee ? `${amm.creatorFeeRate}/1e6 on token${pool.creatorFeeOn === 1 ? 0 : pool.creatorFeeOn === 2 ? 1 : "0/1"}` : "off"}`,
);

// Reserves = vault balances minus fees accrued in the pool (protocol, fund, creator).
const [v0, v1] = await Promise.all(
  [pool.token0Vault, pool.token1Vault].map(async (v) =>
    decodeTokenAccountAmount((await conn.getAccountInfo(v))!.data),
  ),
);
const [r0, r1] = cpmmReserves(pool, v0!, v1!);

// Token-2022 transfer fees (none for SPL Token mints such as every graduation pool's token).
async function transferFee(
  mint: PublicKey,
  program: PublicKey,
): Promise<MintTransferFeeConfig | null> {
  if (!program.equals(TOKEN_2022_PROGRAM_ID)) return null;
  const m = unpackMint(mint, await conn.getAccountInfo(mint), program);
  return getTransferFeeConfig(m) ?? null;
}
const [fee0, fee1] = await Promise.all([
  transferFee(pool.token0Mint, pool.token0Program),
  transferFee(pool.token1Mint, pool.token1Program),
]);
const epoch = BigInt((await conn.getEpochInfo()).epoch);

/** Quote one swap_base_input leg against reserves [r0, r1]; also returns the reserves after it. */
function leg(inputMint: PublicKey, amountIn: bigint, res: [bigint, bigint]) {
  const { zeroForOne, creatorFeeOnInput } = cpmmDirection(pool, inputMint);
  const [rin, rout] = zeroForOne ? res : [res[1], res[0]];
  const q = quoteCpmmSwapWithTransferFees({
    amountIn,
    inputReserve: rin,
    outputReserve: rout,
    config: amm,
    creatorFeeEnabled: pool.enableCreatorFee,
    creatorFeeOnInput,
    inputFee: zeroForOne ? fee0 : fee1,
    outputFee: zeroForOne ? fee1 : fee0,
    epoch,
  });
  // Protocol + fund slices of the trade fee and the creator fee leave the reserves; the LP
  // share stays (same floor rounding as the program).
  const cut = (rate: bigint) => (q.tradeFee * rate) / 1_000_000n;
  const inAfter =
    rin +
    q.amountInAfterFee -
    cut(amm.protocolFeeRate) -
    cut(amm.fundFeeRate) -
    (creatorFeeOnInput ? q.creatorFee : 0n);
  const outAfter = rout - q.amountOut - (creatorFeeOnInput ? 0n : q.creatorFee);
  const after: [bigint, bigint] = zeroForOne ? [inAfter, outAfter] : [outAfter, inAfter];
  return {
    q,
    creatorFeeOnInput,
    after,
    minOut: applySlippage(q.amountReceived, Number(a["slippage-bps"])),
  };
}

const buyOnly = a.side !== "sell";
// --side sell without --payer: a round trip (buy, then sell exactly what was bought) paid by a
// funded key, so the example runs without anyone's token balance.
const roundTrip = !buyOnly && !a.payer;
const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
const payer = a.payer
  ? new PublicKey(a.payer)
  : await fundedKey(conn, [cfg.admin, cfg.migrationAuthority], 50_000_000n);
const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, payer, false, wsolProgram);
const tokenAta = getAssociatedTokenAddressSync(token, payer, false, tokenProgram);

const legs: { input: PublicKey; amountIn: bigint; l: ReturnType<typeof leg> }[] = [];
let res: [bigint, bigint] = [r0, r1];
if (buyOnly || roundTrip) {
  const amountIn = a.amount && buyOnly ? BigInt(a.amount) : 10_000_000n; // 0.01 SOL
  const l = leg(NATIVE_MINT, amountIn, res);
  legs.push({ input: NATIVE_MINT, amountIn, l });
  res = l.after;
}
if (!buyOnly) {
  const amountIn = roundTrip
    ? legs[0]!.l.q.amountReceived
    : a.amount
      ? BigInt(a.amount)
      : decodeTokenAccountAmount((await conn.getAccountInfo(tokenAta))!.data) / 2n;
  legs.push({ input: token, amountIn, l: leg(token, amountIn, res) });
}
for (const { input, amountIn, l } of legs) {
  const isBuy = input.equals(NATIVE_MINT);
  console.log(`
quote ${isBuy ? "buy" : "sell"} ${amountIn} ${isBuy ? "lamports" : "base units"}:`);
  console.log(
    `  trade fee ${l.q.tradeFee} (input token), creator fee ${l.q.creatorFee} (${l.creatorFeeOnInput ? "input" : "output"} token)`,
  );
  console.log(
    `  transfer fees in/out ${l.q.inputTransferFee}/${l.q.outputTransferFee}; price impact ${l.q.priceImpactBps} bps`,
  );
  console.log(`  out ${l.q.amountReceived} (min ${l.minOut})`);
}

const ixs: TransactionInstruction[] = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 160_000 }),
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    wsolAta,
    payer,
    NATIVE_MINT,
    wsolProgram,
  ),
  createAssociatedTokenAccountIdempotentInstruction(payer, tokenAta, payer, token, tokenProgram),
];
for (const { input, amountIn, l } of legs) {
  const isBuy = input.equals(NATIVE_MINT);
  if (isBuy)
    ixs.push(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: wsolAta, lamports: amountIn }),
      createSyncNativeInstruction(wsolAta, wsolProgram),
    );
  ixs.push(
    cpmmSwapBaseInputIx({
      programId: DEEP_AMM_PROGRAM_ID,
      payer,
      poolId,
      pool,
      inputMint: input,
      amountIn,
      minimumAmountOut: l.minOut,
      inputTokenAccount: isBuy ? wsolAta : tokenAta,
      outputTokenAccount: isBuy ? tokenAta : wsolAta,
    }),
  );
}
// Unwrap: closing the WSOL account returns its lamports as SOL. This closes the WHOLE WSOL
// account, including any WSOL the wallet already held there.
ixs.push(createCloseAccountInstruction(wsolAta, payer, payer, [], wsolProgram));

const r = await simulate(conn, payer, ixs);
r.swaps.forEach((ev, i) => {
  const q = legs[i]?.l.q;
  if (!q) return;
  console.log(
    `
SwapEvent #${i + 1}: output_amount ${ev.outputAmount} vs quote ${q.amountOut}; trade fee ${ev.tradeFee} vs ${q.tradeFee}; ` +
      `creator fee ${ev.creatorFee} vs ${q.creatorFee} → ` +
      (ev.outputAmount === q.amountOut &&
      ev.tradeFee === q.tradeFee &&
      ev.creatorFee === q.creatorFee
        ? "EXACT MATCH"
        : "differs (the pool moved)"),
  );
});
