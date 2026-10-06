import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type CpmmPoolState } from "./raydium-cpmm.js";
export declare const MEMO_PROGRAM_ID: PublicKey;
/**
 * Tokens that `lpAmount` LP units are worth. `reserve0/1` are the vault balances net of
 * accrued fees (cpmmReserves) and `lpSupply` is the pool account's `lp_supply`.
 * roundUp = true is what a deposit pays; false is what a withdrawal receives.
 */
export declare function cpmmLpToTokens(lpAmount: bigint, lpSupply: bigint, reserve0: bigint, reserve1: bigint, roundUp: boolean): {
    token0: bigint;
    token1: bigint;
};
/** The most LP a deposit of at most `maxAmount` of one side can mint (rounded down). */
export declare function cpmmLpForTokenAmount(maxAmount: bigint, reserve: bigint, lpSupply: bigint): bigint;
export interface CpmmLiquidityArgs {
    programId: PublicKey;
    owner: PublicKey;
    poolId: PublicKey;
    pool: CpmmPoolState;
    lpAmount: bigint;
    /** deposit: maximum token amounts to pay. withdraw: minimum token amounts to receive. */
    limit0: bigint;
    limit1: bigint;
    /** default: the owner's ATAs */
    ownerLpToken?: PublicKey;
    token0Account?: PublicKey;
    token1Account?: PublicKey;
}
/** `deposit(lp_token_amount, maximum_token_0_amount, maximum_token_1_amount)` */
export declare const cpmmDepositIx: (a: CpmmLiquidityArgs) => TransactionInstruction;
/** `withdraw(lp_token_amount, minimum_token_0_amount, minimum_token_1_amount)` */
export declare const cpmmWithdrawIx: (a: CpmmLiquidityArgs) => TransactionInstruction;
