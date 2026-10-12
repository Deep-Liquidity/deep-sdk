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
import { SystemProgram } from "@solana/web3.js";
/** Highest integrator fee the helpers accept: 10% (DEEP's own per-side hard cap). */
export const MAX_INTEGRATOR_FEE_BPS = 1_000;
export class IntegratorFeeError extends Error {
    constructor(message) {
        super(message);
        this.name = "IntegratorFeeError";
    }
}
function checkBps(bps) {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_INTEGRATOR_FEE_BPS)
        throw new IntegratorFeeError(`integrator fee must be 0–${MAX_INTEGRATOR_FEE_BPS} bps`);
}
/** ceil(solAmount × bps / 10 000) lamports. */
export function integratorFeeLamports(solAmount, bps) {
    checkBps(bps);
    if (solAmount < 0n)
        throw new IntegratorFeeError("amount must not be negative");
    if (bps === 0 || solAmount === 0n)
        return 0n;
    const n = solAmount * BigInt(bps);
    return (n + 9999n) / 10000n;
}
/** The fee transfer. Add it to the same transaction as the trade (after it is fine). */
export function integratorFeeIx(a) {
    if (a.lamports <= 0n)
        throw new IntegratorFeeError("fee must be positive");
    return SystemProgram.transfer({
        fromPubkey: a.payer,
        toPubkey: a.feeWallet,
        lamports: a.lamports,
    });
}
/**
 * Why `feeWallet` cannot receive `lamports` safely, or null when it can. A fee wallet must be
 * a plain system account (a wallet): SOL sent to a token account, a program or a
 * program-owned account could never be moved again. A wallet that does not exist yet must
 * receive at least the rent minimum in its first transfer, or the transaction fails.
 */
export function checkFeeWallet(info, lamports, rentMinLamports) {
    if (info === null) {
        if (lamports < rentMinLamports)
            return `The fee wallet has never been funded: its first transfer must be at least ${rentMinLamports} lamports (rent minimum). Fund it once first.`;
        return null;
    }
    if (!info.owner.equals(SystemProgram.programId) || info.data.length !== 0)
        return "The fee wallet is a token account, a program or a program-owned account: SOL sent there could never be moved again. Use a wallet address.";
    return null;
}
function minAfterSlippage(expected, slippageBps) {
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000)
        throw new RangeError("slippage must be 0–5000 bps");
    return (expected * BigInt(10_000 - slippageBps)) / 10000n;
}
const isPool = (q) => "tradeFee" in q;
/**
 * A buy (SOL in) with your fee on top. `venue` is the curve's `quoteBuyV1(...)` or a DeepSwap
 * `quoteDeepSwapExactIn(...)` whose input is SOL.
 */
export function quoteBuyWithIntegratorFee(venue, slippageBps, bps) {
    if (isPool(venue)) {
        const integratorFee = integratorFeeLamports(venue.amountIn, bps);
        return {
            solIn: venue.amountIn,
            tokensOut: venue.amountOut,
            minTokensOut: minAfterSlippage(venue.amountOut, slippageBps),
            venueFee: venue.tradeFee + venue.rewardFee,
            deepFee: venue.protocolFee,
            rewardFee: venue.rewardFee,
            integratorFee,
            solTotal: venue.amountIn + integratorFee,
        };
    }
    const integratorFee = integratorFeeLamports(venue.solIn, bps);
    return {
        solIn: venue.solIn,
        tokensOut: venue.tokensOut,
        minTokensOut: minAfterSlippage(venue.tokensOut, slippageBps),
        venueFee: venue.fees.total,
        deepFee: venue.fees.protocol,
        rewardFee: venue.fees.creator,
        integratorFee,
        solTotal: venue.solIn + integratorFee,
    };
}
/**
 * A sell (SOL out) with your fee taken from the guaranteed minimum. `venue` is the curve's
 * `quoteSellV1(...)` or a DeepSwap `quoteDeepSwapExactIn(...)` whose output is SOL. Throws
 * IntegratorFeeError when the minimum would not cover the fee.
 */
export function quoteSellWithIntegratorFee(venue, slippageBps, bps) {
    const pool = isPool(venue);
    const solOut = pool ? venue.amountOut : venue.solOut;
    const minSolOut = minAfterSlippage(solOut, slippageBps);
    const integratorFee = integratorFeeLamports(solOut, bps);
    if (minSolOut <= integratorFee)
        throw new IntegratorFeeError("Amount too small: the minimum received would not cover the fee");
    return {
        solOut,
        minSolOut,
        minReceived: minSolOut - integratorFee,
        venueFee: pool ? venue.tradeFee + venue.rewardFee : venue.fees.total,
        deepFee: pool ? venue.protocolFee : venue.fees.protocol,
        rewardFee: pool ? venue.rewardFee : venue.fees.creator,
        integratorFee,
    };
}
//# sourceMappingURL=integrator-fee.js.map