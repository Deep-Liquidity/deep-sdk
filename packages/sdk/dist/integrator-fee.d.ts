/**
 * Integrator fee: an app built on the SDK charges its own fee on a DEEP trade by adding a SOL
 * transfer to its own wallet to the SAME transaction as the trade, so both succeed or fail
 * together. No program change: deep-curve and deep-amm take no referrer argument, and DEEP's
 * own fees (and the token's reward fee) are charged by the programs exactly as without it.
 *
 * Math (identical to the DEEP trade bot's own fee, apps/trade-bot/src/trade/quote.ts):
 * - fee = ceil(sol × bps / 10 000), integers only, rounded UP;
 * - buy: charged on top of the SOL the trade spends (the curve's `solIn`, or the pool's
 *   `amountIn` of SOL);
 * - sell: computed on the quoted SOL out and taken from the guaranteed minimum (minOut after
 *   slippage), so the trader is shown `minOut − fee` as the least they receive. A sell whose
 *   minimum does not cover the fee is refused.
 */
import { type PublicKey, type TransactionInstruction } from "@solana/web3.js";
/** Highest integrator fee the helpers accept: 10% (DEEP's own per-side hard cap). */
export declare const MAX_INTEGRATOR_FEE_BPS = 1000;
export declare class IntegratorFeeError extends Error {
    constructor(message: string);
}
/** ceil(solAmount × bps / 10 000) lamports. */
export declare function integratorFeeLamports(solAmount: bigint, bps: number): bigint;
/** The fee transfer. Add it to the same transaction as the trade (after it is fine). */
export declare function integratorFeeIx(a: {
    payer: PublicKey;
    feeWallet: PublicKey;
    lamports: bigint;
}): TransactionInstruction;
/**
 * Why `feeWallet` cannot receive `lamports` safely, or null when it can. A fee wallet must be
 * a plain system account (a wallet): SOL sent to a token account, a program or a
 * program-owned account could never be moved again. A wallet that does not exist yet must
 * receive at least the rent minimum in its first transfer, or the transaction fails.
 */
export declare function checkFeeWallet(info: {
    owner: PublicKey;
    data: {
        length: number;
    };
    lamports: number | bigint;
} | null, lamports: bigint, rentMinLamports: bigint): string | null;
/** A curve quote (@deep/curve-math quoteBuyV1 / quoteSellV1) or a DeepSwap quote (quoteDeepSwapExactIn). */
type CurveBuy = {
    solIn: bigint;
    tokensOut: bigint;
    fees: {
        total: bigint;
        protocol: bigint;
        creator: bigint;
    };
};
type CurveSell = {
    solOut: bigint;
    fees: {
        total: bigint;
        protocol: bigint;
        creator: bigint;
    };
};
type PoolQuote = {
    amountIn: bigint;
    amountOut: bigint;
    tradeFee: bigint;
    protocolFee: bigint;
    rewardFee: bigint;
};
/** What the trader is shown, in lamports, read from the venue's own quote. */
export interface IntegratorFeeBreakdown {
    /** The venue's fee in SOL (DEEP's fee + the token's reward fee; on a pool also the LP share). */
    venueFee: bigint;
    /** DEEP's own fee within venueFee. */
    deepFee: bigint;
    /** The token's reward fee (creator or holders) within venueFee. */
    rewardFee: bigint;
    /** Your fee. */
    integratorFee: bigint;
}
export interface BuyWithIntegratorFee extends IntegratorFeeBreakdown {
    /** SOL the trade itself spends (pass this to the buy instruction). */
    solIn: bigint;
    /** Tokens the venue quotes, and the minimum after slippage (pass as minOut). */
    tokensOut: bigint;
    minTokensOut: bigint;
    /** SOL leaving the wallet: solIn + integratorFee (network fee not included). */
    solTotal: bigint;
}
export interface SellWithIntegratorFee extends IntegratorFeeBreakdown {
    /** SOL the venue quotes, and the minimum after slippage (pass as minOut). */
    solOut: bigint;
    minSolOut: bigint;
    /** The least the trader receives: minSolOut − integratorFee. */
    minReceived: bigint;
}
/**
 * A buy (SOL in) with your fee on top. `venue` is the curve's `quoteBuyV1(...)` or a DeepSwap
 * `quoteDeepSwapExactIn(...)` whose input is SOL.
 */
export declare function quoteBuyWithIntegratorFee(venue: CurveBuy | PoolQuote, slippageBps: number, bps: number): BuyWithIntegratorFee;
/**
 * A sell (SOL out) with your fee taken from the guaranteed minimum. `venue` is the curve's
 * `quoteSellV1(...)` or a DeepSwap `quoteDeepSwapExactIn(...)` whose output is SOL. Throws
 * IntegratorFeeError when the minimum would not cover the fee.
 */
export declare function quoteSellWithIntegratorFee(venue: CurveSell | PoolQuote, slippageBps: number, bps: number): SellWithIntegratorFee;
export {};
