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
/**
 * `initialize(init_amount_0, init_amount_1, open_time)`. Under a legacy AmmConfig it opens a
 * legacy pool; under a DEEP V1 config, a V1 STANDARD pool (no reward) whose quote token is
 * `cpmmDefaultQuoteMint`. To choose reward terms or the quote token use `initializeV1Ix`.
 */
export declare function cpmmInitializeIx(a: CpmmInitializeArgs): TransactionInstruction;
/**
 * The quote token of a V1 pool opened without naming one (deep-amm `default_quote_side`): the
 * token every fee is taken in. WSOL when the pair has it, otherwise token 1 (the mint that
 * sorts last).
 */
export declare function cpmmDefaultQuoteMint(mintA: PublicKey, mintB: PublicKey): PublicKey;
/** The reward terms the creator of a V1 pool chooses. Immutable once the pool exists. */
export interface CpmmPoolRewardTerms {
    /** 0 Standard (default), 1 Creator, 2 Holder (`REWARD_MODEL`). */
    rewardModel?: number;
    /**
     * The pool's reward rate in BPS (the same unit as a launch's `rewardBps`), charged on both
     * sides on top of the AmmConfig's rates: 0 for Standard (default), 1..=500 (5%) otherwise.
     * Sent to the program as `rewardBps * 100` per 1e6.
     */
    rewardBps?: number;
    /**
     * The pool's quote token, the one every fee is taken in: one of the two mints. Default
     * `cpmmDefaultQuoteMint`. A pair with WSOL must be quoted in WSOL.
     */
    quoteMint?: PublicKey;
    /**
     * Optional, for a clearer error before sending: the decoded AmmConfig's `maxRewardRate`
     * (per 1e6), the admin's current maximum; the program rejects a rate above it
     * (RewardRateAboveMax, 6025).
     */
    maxRewardRate?: bigint;
    /** Defaults to deep-rewards (the program a Holder pool's vault is derived under). */
    rewardsProgramId?: PublicKey;
}
export interface CpmmV1PoolTerms {
    quoteMint: PublicKey;
    /** The non-quote mint. */
    baseMint: PublicKey;
    /** deep-amm `CreatorFeeOn` tag of the quote side: 1 = token0, 2 = token1. */
    quoteSide: 1 | 2;
    rewardModel: number;
    /** Per 1e6: `rewardBps * 100`. */
    rewardRate: bigint;
    /**
     * Where the pool's reward fees go, recorded as its `poolCreator`. The program derives it,
     * it is never passed: the pool's creator for Standard (never accrues) and Creator, the
     * deep-rewards holder vault of the non-quote token for Holder.
     */
    rewardRecipient: PublicKey;
    /**
     * Holder pools only: the deep-rewards distributor of (`baseMint`, `quoteMint`). It MUST
     * exist already (DEEP's `init_distributor`), or `initialize_v1` fails with
     * HolderRewardsNeedDistributor (6029): the pool's reward fees have no other way out.
     * `initializeV1Ix` passes it as the last remaining account.
     */
    distributor?: PublicKey;
}
/**
 * The Holder recipient of a pool opened with `initialize_v1`: the deep-rewards holder vault
 * of the pool's NON-quote token, `holderVaultPda(baseMint)`.
 */
export declare function cpmmHolderRewardRecipient(baseMint: PublicKey, rewardsProgramId?: PublicKey): PublicKey;
/**
 * Validates a V1 pool's reward terms the way `initialize_v1` does and resolves what it
 * derives. Throws on: an unknown model; a rate that does not fit it (Standard 0, Creator /
 * Holder 1..=500 bps) or is above `maxRewardRate`; a quote that is not one of the mints or is
 * not WSOL on a WSOL pair; a Holder pool not quoted in WSOL (HolderRewardsNeedSolQuote).
 */
export declare function cpmmV1PoolTerms(a: {
    creator: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
} & CpmmPoolRewardTerms): CpmmV1PoolTerms;
export interface InitializeV1Args extends CpmmInitializeArgs, CpmmPoolRewardTerms {
}
/**
 * deep-amm `initialize_v1(init_amount_0, init_amount_1, open_time, creator_fee_on,
 * reward_model, reward_rate)`: permissionless, same accounts as `initialize`. Opens a DEEP V1
 * pool under a V1 AmmConfig (a legacy config is rejected, FeeModelMismatch) with the reward
 * terms its creator chooses, immutable afterwards: `rewardModel` and `rewardBps` (see
 * `CpmmPoolRewardTerms`, `cpmmV1PoolTerms`), and the quote token. The reward recipient is
 * derived by the program: the creator for a Creator pool, `cpmmHolderRewardRecipient` (the
 * holder vault of the non-quote token) for a Holder pool, which must be quoted in SOL and
 * whose (token, SOL) deep-rewards distributor must exist already
 * (HolderRewardsNeedDistributor, 6029; check `cpmmV1PoolTerms(a).distributor` on chain before
 * offering the Holder model for a token).
 */
export declare function initializeV1Ix(a: InitializeV1Args): TransactionInstruction;
