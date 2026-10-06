import { PublicKey, TransactionInstruction } from "@solana/web3.js";
export * from "./cpmm-token2022.js";
/** LP units the program keeps out of the creator's hands at pool creation (`lock_lp_amount`). */
export declare const CPMM_LOCKED_LP = 100n;
/** Compute unit limit that covers `initialize` (two vaults, LP mint, ATA, observation). */
export declare const CPMM_INITIALIZE_COMPUTE_UNITS = 400000;
/** Floor of the square root, as the program's `U128::integer_sqrt`. */
export declare function isqrt(n: bigint): bigint;
/**
 * LP minted at pool creation from the amounts that ARRIVE in the vaults (after any Token-2022
 * transfer fee): `liquidity = floor(sqrt(vault0 × vault1))`, of which the creator receives
 * `liquidity − 100`. Throws where the program rejects (empty side, or liquidity under 100).
 */
export declare function cpmmInitialLiquidity(vault0: bigint, vault1: bigint): {
    liquidity: bigint;
    creatorLp: bigint;
};
export interface CpmmInitializeArgs {
    /** Defaults to deep-amm. */
    programId?: PublicKey;
    /** Signs, pays rent and the create-pool fee, and receives the LP tokens. */
    creator: PublicKey;
    /** The AmmConfig the pool belongs to (fee rates, create-pool fee). */
    ammConfig: PublicKey;
    /** The pair in any order; the builder sorts it the way the program requires. */
    mintA: PublicKey;
    mintB: PublicKey;
    /** Owner program of each mint (SPL Token or Token-2022), read from chain. */
    tokenProgramA: PublicKey;
    tokenProgramB: PublicKey;
    /** Amount of each token the creator sends, base units. Together they set the price. */
    amountA: bigint;
    amountB: bigint;
    /** Unix seconds from which swaps are allowed; 0 (default) = right away. */
    openTime?: bigint;
    /**
     * The WSOL account the program build names as create-pool fee receiver
     * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). It is fixed at build time, so it is always passed in.
     */
    createPoolFeeReceiver: PublicKey;
    /** Default: the creator's associated token accounts under each mint's own program. */
    creatorTokenA?: PublicKey;
    creatorTokenB?: PublicKey;
    /**
     * `deepAmmSupportMintPda(mint)` for each Token-2022 mint that is on the allow list. Sent as
     * remaining accounts; the program ignores entries that are not an initialized allow entry.
     */
    supportMints?: PublicKey[];
}
export interface CpmmInitializeAccounts {
    token0Mint: PublicKey;
    token1Mint: PublicKey;
    /** True when `mintA` is token 0. */
    aIsToken0: boolean;
    poolState: PublicKey;
    lpMint: PublicKey;
    creatorLpToken: PublicKey;
    token0Vault: PublicKey;
    token1Vault: PublicKey;
    observation: PublicKey;
}
/** Addresses `initialize` creates for a pair under an AmmConfig. */
export declare function cpmmInitializeAccounts(a: {
    programId?: PublicKey;
    creator: PublicKey;
    ammConfig: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
}): CpmmInitializeAccounts;
/** `initialize(init_amount_0, init_amount_1, open_time)` */
export declare function cpmmInitializeIx(a: CpmmInitializeArgs): TransactionInstruction;
