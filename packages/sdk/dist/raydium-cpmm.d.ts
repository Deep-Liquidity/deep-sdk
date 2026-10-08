import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type DeepSwapRates } from "@deepliquidity/curve-math";
export declare const CPMM_PROGRAM_ID: {
    readonly devnet: PublicKey;
    readonly mainnet: PublicKey;
};
/**
 * DeepSwap's own CPMM (programs/deep-amm, a fork of raydium-cp-swap): same layouts,
 * seeds and instructions as cp-swap, so every helper in this file works with it by
 * passing this program id. Same id on every cluster.
 */
export declare const DEEP_AMM_PROGRAM_ID: PublicKey;
/**
 * deep-amm's create-pool-fee WSOL account is fixed at BUILD time
 * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). DEEP V1: on every cluster it is the DEEP fee vault's
 * WSOL ATA (`feeVaultWsolAta()` in splitter.ts), so the create-pool fee is DEEP revenue that
 * goes through the splitter (builder 10%). Builds before V1 used the fee owner's WSOL ATA.
 */
export declare const DEEP_AMM_CREATE_POOL_FEE_RECEIVER: {
    devnet: PublicKey | null;
    mainnet: PublicKey | null;
};
export declare const CPMM_FEE_DENOMINATOR = 1000000n;
/** Raydium requires mint0 < mint1 by raw bytes. */
export declare function sortMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey];
export declare function cpmmAuthority(programId: PublicKey): PublicKey;
export declare function cpmmPoolPda(programId: PublicKey, ammConfig: PublicKey, mintA: PublicKey, mintB: PublicKey): PublicKey;
export declare function cpmmLpMint(programId: PublicKey, pool: PublicKey): PublicKey;
export declare function cpmmVault(programId: PublicKey, pool: PublicKey, mint: PublicKey): PublicKey;
export declare function cpmmObservation(programId: PublicKey, pool: PublicKey): PublicKey;
export interface CpmmPoolState {
    ammConfig: PublicKey;
    /**
     * The pool's recorded creator. On a DEEP V1 pool it is the REWARD RECIPIENT: the only
     * address the pool's reward fees can go to (`collect_creator_fee*`): the token's or pool's
     * creator for a Creator pool, the token's deep-rewards holder vault for a Holder pool.
     */
    poolCreator: PublicKey;
    token0Vault: PublicKey;
    token1Vault: PublicKey;
    lpMint: PublicKey;
    token0Mint: PublicKey;
    token1Mint: PublicKey;
    token0Program: PublicKey;
    token1Program: PublicKey;
    observationKey: PublicKey;
    authBump: number;
    /** bit0 deposit disabled, bit1 withdraw disabled, bit2 swap disabled */
    status: number;
    lpMintDecimals: number;
    mint0Decimals: number;
    mint1Decimals: number;
    lpSupply: bigint;
    protocolFeesToken0: bigint;
    protocolFeesToken1: bigint;
    fundFeesToken0: bigint;
    fundFeesToken1: bigint;
    openTime: bigint;
    recentEpoch: bigint;
    /** 0 both, 1 only token0, 2 only token1 */
    creatorFeeOn: number;
    enableCreatorFee: boolean;
    creatorFeesToken0: bigint;
    creatorFeesToken1: bigint;
    /**
     * DEEP V1: 0 = legacy (upstream fee semantics), 1 = V1 (side-dependent fees taken in the
     * quote token). Set at creation, never changed. A pool created before V1 reads 0.
     */
    feeModel: number;
    /** DEEP V1: 0 Standard, 1 Creator, 2 Holder (`REWARD_MODEL`). 0 on a legacy pool. */
    rewardModel: number;
    /**
     * DEEP V1: the pool's own reward rate, per 1e6, charged on both sides on top of the
     * AmmConfig's LP and protocol rates and paid to `poolCreator`. Chosen by whoever created
     * the token (graduation: the curve's `rewardBps` x 100) or the pool, fixed at creation, at
     * most 50_000 (5%). 0 for a Standard pool. (`PoolState.reward_rate_snapshot`.)
     */
    rewardRate: bigint;
}
/** 8 + 10·32 + 5 + 7·8 + 2 + 6 + 2·8 + 28·8 */
export declare const CPMM_POOL_STATE_SIZE = 637;
/** 8 + 1 + 1 + 2 + 4·8 + 2·32 + 8 + 8 + 14·8 */
export declare const CPMM_AMM_CONFIG_SIZE = 236;
/** `AmmConfig.fee_model` / `PoolState.fee_model` values (deep-amm states/config.rs). */
export declare const DEEP_AMM_FEE_MODEL: {
    readonly legacy: 0;
    readonly v1: 1;
};
/**
 * Byte offsets of the DEEP V1 fields, INCLUDING the 8-byte account discriminator
 * (`POOL_STATE_*_OFFSET` in deep-amm states/pool.rs). They were carved out of the account's
 * zero padding, so the size is unchanged and an older pool reads 0 everywhere.
 */
export declare const CPMM_POOL_STATE_V1_OFFSETS: {
    /** u8 */
    readonly feeModel: 413;
    /** u8 */
    readonly rewardModel: 414;
    /** u64 LE (`reward_rate_snapshot`) */
    readonly rewardRate: 421;
};
/**
 * Byte offsets of the DEEP V1 fields of an AmmConfig, INCLUDING the 8-byte discriminator
 * (`AMM_CONFIG_*_OFFSET` in deep-amm states/config.rs). `feeModel` is a u8, the rates u64 LE.
 */
export declare const CPMM_AMM_CONFIG_V1_OFFSETS: {
    readonly feeModel: 124;
    readonly buyLpFeeRate: 132;
    readonly buyProtocolFeeRate: 140;
    readonly sellLpFeeRate: 148;
    readonly sellProtocolFeeRate: 156;
    readonly maxRewardRate: 164;
};
export declare function decodeCpmmPoolState(data: Uint8Array): CpmmPoolState;
export interface CpmmAmmConfig {
    bump: number;
    disableCreatePool: boolean;
    index: number;
    tradeFeeRate: bigint;
    protocolFeeRate: bigint;
    fundFeeRate: bigint;
    createPoolFee: bigint;
    protocolOwner: PublicKey;
    fundOwner: PublicKey;
    /** Add-on to the trade fee (per 1e6), charged only on pools with `enableCreatorFee`. */
    creatorFeeRate: bigint;
    /**
     * Share of the creator fee the protocol keeps (per 1e6); the pool's creator gets the rest.
     * A per-creator `CreatorFeeShare` account overrides it (`deepAmmCreatorFeeSharePda`).
     */
    creatorFeeShareRate: bigint;
    /**
     * DEEP V1: 0 = legacy (the rates above), 1 = V1 (the six absolute rates below; the legacy
     * rate fields are then only a mirror of the buy side and price nothing). Fixed at creation.
     */
    feeModel: number;
    /**
     * DEEP V1, absolute rates per 1e6. "Buy" = the swap's input is the pool's quote token (SOL
     * on TOKEN/SOL), "sell" = its output is. All 0 on a legacy config.
     */
    buyLpFeeRate: bigint;
    buyProtocolFeeRate: bigint;
    sellLpFeeRate: bigint;
    sellProtocolFeeRate: bigint;
    /**
     * DEEP V1: the admin's CURRENT maximum reward rate (per 1e6, at most 50_000) for pools
     * opened with the permissionless `initialize_v1`. Not a pool's rate: each pool has its own
     * (`CpmmPoolState.rewardRate`), and existing pools keep theirs. 0 on a legacy config.
     */
    maxRewardRate: bigint;
}
export declare function decodeCpmmAmmConfig(data: Uint8Array): CpmmAmmConfig;
/** Tradable reserves = vault balance minus accrued, unclaimed fees. */
export declare function cpmmReserves(pool: CpmmPoolState, vault0: bigint, vault1: bigint): [bigint, bigint];
/** `Fees::creator_fee_shared_amount` + `split_creator_fee_shared_amount`: the protocol's
 * share rounds DOWN, so the odd unit stays with the creator. */
export declare function splitCreatorFee(creatorFee: bigint, shareRate: bigint): {
    creator: bigint;
    protocol: bigint;
};
/** The AmmConfig fields the DEEP V1 fee model prices a swap with. */
export type CpmmV1ConfigRates = Pick<CpmmAmmConfig, "feeModel" | "buyLpFeeRate" | "buyProtocolFeeRate" | "sellLpFeeRate" | "sellProtocolFeeRate">;
/** The PoolState fields the DEEP V1 fee model prices a swap with. */
export type CpmmV1PoolFields = Pick<CpmmPoolState, "feeModel" | "rewardModel" | "rewardRate">;
/**
 * The fee model `pool` is priced with. deep-amm refuses a swap when the pool and its
 * AmmConfig are not of the same model (`FeeModelMismatch`, 6020), and so does this.
 */
export declare function cpmmFeeModel(config: Pick<CpmmAmmConfig, "feeModel">, pool: Pick<CpmmPoolState, "feeModel">): (typeof DEEP_AMM_FEE_MODEL)[keyof typeof DEEP_AMM_FEE_MODEL];
/**
 * The rates (per 1e6) one swap of a V1 pool is charged at (`PoolState::v1_rates`): the LP and
 * protocol rates of that side from the pool's AmmConfig, and the pool's own reward rate (0
 * for a Standard pool), exactly as stored: never clamped. `isBuy`: the swap's input is the
 * pool's quote token (`cpmmDirection(...).creatorFeeOnInput`). Throws unless both the pool
 * and the config are V1, and where the program refuses to price (LP + protocol above 5%, or a
 * reward rate above 5%: neither can be stored).
 */
export declare function deepSwapV1Rates(config: CpmmV1ConfigRates, pool: CpmmV1PoolFields, isBuy: boolean): DeepSwapRates;
/**
 * The total fee rate a swap on `pool` pays (per 1e6). Presentation only: amounts come from
 * the quote.
 *
 * Legacy pool: the trade fee, plus the creator fee when the pool has it enabled (the two can
 * be charged on different sides of the swap). `isBuy` is ignored.
 *
 * DEEP V1 pool (`pool.feeModel === 1`): LP + protocol + reward of ONE side, so pass `isBuy`
 * (the input is the pool's quote token). Without it the result is the HIGHER of the two
 * sides, i.e. the most a swap of this pool pays. A V1 pool needs the V1 fields of both
 * arguments (a decoded PoolState and AmmConfig have them) and throws without them.
 */
export declare function cpmmTotalFeeRate(config: Pick<CpmmAmmConfig, "tradeFeeRate" | "creatorFeeRate"> & Partial<CpmmV1ConfigRates>, pool: Pick<CpmmPoolState, "enableCreatorFee"> & Partial<CpmmV1PoolFields>, isBuy?: boolean): bigint;
/** The per-1e6 fee rates of one side of a pool; `lp + protocol + reward === total`. */
export interface CpmmSideFeeRates {
    /** Stays in the pool for liquidity providers. */
    lp: bigint;
    /** DEEP's part (on a legacy pool: the protocol and fund shares of the trade fee). */
    protocol: bigint;
    /**
     * V1: the pool's own reward rate, 100% its reward recipient's (`poolCreator`). Legacy: the
     * creator fee when the pool has it enabled (shared with DEEP when it is collected).
     */
    reward: bigint;
    total: bigint;
}
/**
 * What a swap of `pool` pays on each side, per 1e6, with its parts. `buy`: the swap's input
 * is the pool's quote token; `sell`: its output is. Presentation only; amounts come from the
 * quotes.
 *
 * DEEP V1 pool: the AmmConfig's LP and protocol rates of the side plus the pool's own reward
 * rate (`deepSwapV1Rates`). Legacy pool: both sides are the same, the trade fee split by the
 * config's protocol and fund shares (floored, the rest is the LPs') plus the creator fee when
 * enabled. Throws when `config` is not of the pool's fee model.
 */
export declare function cpmmPoolFeeRates(config: Pick<CpmmAmmConfig, "tradeFeeRate" | "protocolFeeRate" | "fundFeeRate" | "creatorFeeRate"> & CpmmV1ConfigRates, pool: Pick<CpmmPoolState, "enableCreatorFee"> & CpmmV1PoolFields): {
    buy: CpmmSideFeeRates;
    sell: CpmmSideFeeRates;
};
export declare const cpmmSwapEnabled: (pool: CpmmPoolState, nowSec: bigint) => boolean;
export interface CpmmSwapQuote {
    amountIn: bigint;
    /** What the trader receives, already net of a creator fee charged on the output. */
    amountOut: bigint;
    /** In the INPUT token. Excludes the creator fee. */
    tradeFee: bigint;
    /** In the input token when `creatorFeeOnInput`, otherwise in the OUTPUT token. */
    creatorFee: bigint;
    /** spot-vs-execution, bps, rounded down */
    priceImpactBps: bigint;
}
export declare function quoteCpmmSwapBaseInput(args: {
    amountIn: bigint;
    inputReserve: bigint;
    outputReserve: bigint;
    config: Pick<CpmmAmmConfig, "tradeFeeRate" | "creatorFeeRate">;
    /** pool.enableCreatorFee */
    creatorFeeEnabled: boolean;
    /** see pool.is_creator_fee_on_input(direction) */
    creatorFeeOnInput: boolean;
}): CpmmSwapQuote;
/**
 * Exact output on a LEGACY pool: mirrors `CurveCalculator::swap_base_output`. `amountOut` is
 * what the trader receives; a creator fee charged on the output is added on top of it before
 * the curve. Throws where the program fails: the (gross) output must be less than the output
 * reserve. For a DEEP V1 pool use `quoteDeepSwapExactOut`.
 */
export declare function quoteCpmmSwapBaseOutput(args: {
    amountOut: bigint;
    inputReserve: bigint;
    outputReserve: bigint;
    config: Pick<CpmmAmmConfig, "tradeFeeRate" | "creatorFeeRate">;
    /** pool.enableCreatorFee */
    creatorFeeEnabled: boolean;
    /** see pool.is_creator_fee_on_input(direction) */
    creatorFeeOnInput: boolean;
}): CpmmSwapQuote;
/** Which side is input, and whether the creator fee is charged on it. */
export declare function cpmmDirection(pool: CpmmPoolState, inputMint: PublicKey): {
    zeroForOne: boolean;
    creatorFeeOnInput: boolean;
};
export interface DeepSwapPoolQuoteArgs {
    /** The decoded PoolState. */
    pool: CpmmPoolState;
    /** The decoded AmmConfig at `pool.ammConfig`. Must be of the pool's fee model. */
    config: CpmmAmmConfig;
    /** The mint the trader pays in (one of the pool's two). */
    inputMint: PublicKey;
    /**
     * Exact-in: what the trader pays. Exact-out: what the trader receives. Base units, as the
     * pool sees them: for a Token-2022 mint with a transfer fee, after the fee on the way in
     * and before the fee on the way out (see cpmm-token2022.ts).
     */
    amount: bigint;
    /** Token balances of `pool.token0Vault` / `pool.token1Vault` (accrued fees included). */
    vault0: bigint;
    vault1: bigint;
}
export interface DeepSwapPoolQuote {
    /** The model the swap was priced with: 0 legacy, 1 DEEP V1 (`DEEP_AMM_FEE_MODEL`). */
    feeModel: number;
    /** True when token0 goes in and token1 comes out. */
    zeroForOne: boolean;
    /**
     * V1: true when the input is the pool's quote token (every fee comes off the input), false
     * when the output is (every fee comes off the output). null on a legacy pool.
     */
    isBuy: boolean | null;
    amountIn: bigint;
    /** What the trader receives, net of every fee charged on the output. */
    amountOut: bigint;
    /**
     * The pool fee: `lpFee + protocolFee + fundFee`, in `feeMint`. Legacy: the trade fee
     * (`SwapEvent.trade_fee`). V1: the LP and DEEP parts.
     */
    tradeFee: bigint;
    /** Stays in the pool as reserve (the liquidity providers' part). */
    lpFee: bigint;
    /** DEEP's part, accrued as protocol fee. */
    protocolFee: bigint;
    /** Legacy only (0 on V1, and 0 under every DEEP V1-era config). */
    fundFee: bigint;
    /** The mint `tradeFee` and its parts are in: the input mint (legacy), the quote mint (V1). */
    feeMint: PublicKey;
    /**
     * V1: the reward part, 100% the pool's reward recipient's (0 on a Standard pool). Legacy:
     * the creator fee, charged on top of the trade fee when the pool has it enabled.
     */
    rewardFee: bigint;
    /** The mint `rewardFee` is in. V1: always `feeMint`. Legacy: the input or the output mint. */
    rewardFeeMint: PublicKey;
    /** The pool's tradable reserves (vault minus accrued fees) right after the swap. */
    reserve0After: bigint;
    reserve1After: bigint;
    /** Spot vs execution, bps, rounded down. Presentation only. */
    priceImpactBps: bigint;
}
/**
 * Exact-input quote for any deep-amm pool, priced with the pool's own fee model: a legacy
 * pool with upstream's math (`quoteCpmmSwapBaseInput`), a DEEP V1 pool with the side-dependent
 * V1 math (@deep/curve-math `quoteDeepSwapExactIn`). Returns the amounts, the fee breakdown
 * and the mint each fee is in. Throws when `config` is not of the pool's fee model (the
 * program refuses that swap too), when the mint is not the pool's, and where the math gives
 * up (`CurveMathError` on a V1 pool, `RangeError` on a legacy one). The program's own result
 * is authoritative: send the swap with a slippage bound.
 */
export declare function quoteDeepSwapExactIn(a: DeepSwapPoolQuoteArgs): DeepSwapPoolQuote;
/**
 * Exact-output quote for any deep-amm pool (see `quoteDeepSwapExactIn`): `amount` is what the
 * trader receives, `amountIn` what it costs. On a V1 sell the fee comes off the output, so
 * the pool must hold the GROSS amount: asking for more than it can pay throws.
 */
export declare function quoteDeepSwapExactOut(a: DeepSwapPoolQuoteArgs): DeepSwapPoolQuote;
export interface CpmmSwapArgs {
    programId: PublicKey;
    payer: PublicKey;
    poolId: PublicKey;
    pool: CpmmPoolState;
    inputMint: PublicKey;
    amountIn: bigint;
    minimumAmountOut: bigint;
    /** defaults to the payer's ATAs */
    inputTokenAccount?: PublicKey;
    outputTokenAccount?: PublicKey;
}
type CpmmSwapAccounts = Omit<CpmmSwapArgs, "amountIn" | "minimumAmountOut">;
export interface CpmmSwapOutputArgs extends CpmmSwapAccounts {
    /** The most the trader pays; the swap fails above it (slippage bound). */
    maxAmountIn: bigint;
    /** Exactly what the trader receives. */
    amountOut: bigint;
}
/** `swap_base_input(amount_in, minimum_amount_out)` */
export declare function cpmmSwapBaseInputIx(a: CpmmSwapArgs): TransactionInstruction;
/**
 * `swap_base_output(max_amount_in, amount_out)`: the trader receives exactly `amountOut` and
 * pays at most `maxAmountIn`. Same accounts as `swap_base_input`.
 */
export declare function cpmmSwapBaseOutputIx(a: CpmmSwapOutputArgs): TransactionInstruction;
export { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID };
