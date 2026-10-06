import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
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
 * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). Fill these in per cluster once deep-amm is
 * deployed; until then callers must pass it explicitly (graduateIx throws).
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
}
/** 8 + 10·32 + 5 + 7·8 + 2 + 6 + 2·8 + 28·8 */
export declare const CPMM_POOL_STATE_SIZE = 637;
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
/**
 * The total fee rate a swap on `pool` pays (per 1e6): the trade fee, plus the creator fee
 * when the pool has it enabled. Presentation only: amounts come from the quote, because
 * the two fees can be charged on different sides of the swap.
 */
export declare function cpmmTotalFeeRate(config: Pick<CpmmAmmConfig, "tradeFeeRate" | "creatorFeeRate">, pool: Pick<CpmmPoolState, "enableCreatorFee">): bigint;
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
/** Which side is input, and whether the creator fee is charged on it. */
export declare function cpmmDirection(pool: CpmmPoolState, inputMint: PublicKey): {
    zeroForOne: boolean;
    creatorFeeOnInput: boolean;
};
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
export declare function cpmmSwapBaseInputIx(a: CpmmSwapArgs): TransactionInstruction;
export { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID };
