import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type CpmmPoolState } from "./raydium-cpmm.js";
/**
 * DEEP's DeepSwap fee policy (CLAUDE.md): a 0.30% pool trade fee with 1/3 of it to the
 * DEEP treasury, plus, on pools created by graduation, a 0.30% creator fee of which half
 * goes to the token's creator and half to DEEP. Rates are in millionths
 * (CPMM_FEE_DENOMINATOR). `protocolFeeRate` is a share OF the trade fee, so 333_333 / 1e6
 * of 0.30% is ~0.10% of volume; `creatorFeeShareRate` is the share OF the creator fee the
 * protocol keeps. These are the policy targets: the live values are whatever the AmmConfig
 * holds (the deep-amm admin changes them with `update_amm_config`), so read the chain.
 */
export declare const DEEP_AMM_FEES: {
    readonly tradeFeeRate: 3000n;
    readonly protocolFeeRate: 333333n;
    readonly fundFeeRate: 0n;
    readonly creatorFeeRate: 3000n;
    readonly creatorFeeShareRate: 500000n;
};
export declare function deepAmmConfigPda(index?: number, programId?: PublicKey): PublicKey;
export interface CreateAmmConfigArgs {
    /** deep-amm's build-time admin (DEEP_AMM_ADMIN); signs and pays rent. */
    admin: PublicKey;
    index?: number;
    tradeFeeRate?: bigint;
    protocolFeeRate?: bigint;
    fundFeeRate?: bigint;
    /** Lamports charged to whoever creates a pool (paid into the create-pool fee account). */
    createPoolFee: bigint;
    creatorFeeRate?: bigint;
    programId?: PublicKey;
}
export declare function deepAmmCreateConfigIx(a: CreateAmmConfigArgs): TransactionInstruction;
/** update_amm_config `param` codes (programs/deep-amm/src/instructions/admin/update_config.rs). */
export declare const DEEP_AMM_CONFIG_PARAM: {
    readonly tradeFeeRate: 0;
    readonly protocolFeeRate: 1;
    readonly fundFeeRate: 2;
    readonly createPoolFee: 5;
    readonly disableCreatePool: 6;
    /** Add-on to the trade fee on pools with the creator fee enabled; trade + creator < 1e6. */
    readonly creatorFeeRate: 7;
    /** Share of the creator fee the protocol keeps; 0..=1e6. */
    readonly creatorFeeShareRate: 8;
};
/**
 * deep-amm `update_amm_config(param, value)`, signed by the build-time admin. Takes effect
 * at once (no timelock: KNOWN_ISSUES DA-1), so on mainnet it must go through the Squads vault.
 */
export declare function deepAmmUpdateConfigIx(a: {
    admin: PublicKey;
    param: number;
    value: bigint;
    index?: number;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * The per-mint allow entry (`SupportMintAssociated`). deep-amm accepts SPL Token mints and
 * Token-2022 mints whose extensions are all in its built-in list; any other Token-2022 mint
 * (permanent delegate, pausable, transfer hook, default account state, …) can only be pooled
 * once the admin has created this account for it, and pool creation must pass it as a
 * remaining account.
 */
export declare function deepAmmSupportMintPda(mint: PublicKey, programId?: PublicKey): PublicKey;
/**
 * Enables a Token-2022 mint for pool creation (admin only; the mint must be owned by
 * Token-2022). Takes effect at once and exposes pools to whatever the mint's issuer can do
 * (freeze, pause, seize, hook), so on mainnet it must go through the Squads vault.
 */
export declare const deepAmmCreateSupportMintIx: (a: {
    admin: PublicKey;
    mint: PublicKey;
    programId?: PublicKey;
}) => TransactionInstruction;
/** Removes the allow entry: no NEW pools for the mint. Existing pools keep working. */
export declare const deepAmmCloseSupportMintIx: (a: {
    admin: PublicKey;
    mint: PublicKey;
    programId?: PublicKey;
}) => TransactionInstruction;
/** The pool fields `collect_protocol_fee` needs (a decoded PoolState has them all). */
export type CollectFeePool = Pick<CpmmPoolState, "ammConfig" | "token0Vault" | "token1Vault" | "token0Mint" | "token1Mint" | "token0Program" | "token1Program">;
/**
 * deep-amm `collect_protocol_fee(amount_0_requested, amount_1_requested)`. The signer must be
 * the pool's `AmmConfig.protocol_owner` or the build-time admin (on mainnet: the Squads
 * vault, so a server key cannot send it there: KNOWN_ISSUES DA-3). The program pays out
 * min(requested, accrued) per side, so the default (u64::MAX) collects everything.
 */
export declare function deepAmmCollectProtocolFeeIx(a: {
    owner: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    /** Token accounts for token_0 / token_1 that receive the fees. */
    recipientToken0: PublicKey;
    recipientToken1: PublicKey;
    amount0?: bigint;
    amount1?: bigint;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_protocol_fee` into the owner's associated token accounts, creating them first if
 * missing (the owner pays their rent). The SOL side arrives as WSOL in the owner's WSOL ATA.
 */
export declare function deepAmmCollectProtocolFeeIxs(a: {
    owner: PublicKey;
    pool: PublicKey;
    poolState: CollectFeePool;
    programId?: PublicKey;
}): TransactionInstruction[];
/**
 * deep-amm `Permission` PDA of `authority`: seeds ["permission", authority]. A payer needs
 * one to call `initialize_with_permission`, the only instruction that creates a pool with
 * the creator fee enabled. deep-curve's graduation payer (`graduationPayerPda`) is the one
 * DEEP authorizes.
 */
export declare function deepAmmPermissionPda(authority: PublicKey, programId?: PublicKey): PublicKey;
/**
 * deep-amm `create_permission_pda`: the build-time admin authorizes `authority` to create
 * creator-fee pools (admin signs and pays the rent). Takes effect at once and anything the
 * authority creates afterwards charges the AmmConfig's creator fee, so on mainnet it must
 * go through the Squads vault. `close_permission_pda` revokes it.
 */
export declare function deepAmmCreatePermissionIx(a: {
    admin: PublicKey;
    authority: PublicKey;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * The optional per-creator override of `AmmConfig.creator_fee_share_rate`: seeds
 * ["creator_fee_share", creator, amm_config]. The collect instructions always take this
 * address; when the account does not exist the AmmConfig's rate applies.
 */
export declare function deepAmmCreatorFeeSharePda(creator: PublicKey, ammConfig: PublicKey, programId?: PublicKey): PublicKey;
/** `CreatorFeeShare.share_rate` from account data (8 disc + 1 bump + 32 creator + 32 config + u64). */
export declare function decodeCreatorFeeShareRate(data: Uint8Array): bigint;
/**
 * `resolve_creator_fee_share_rate`: the override account's rate when it exists and is owned
 * by the AMM program, otherwise the AmmConfig's.
 */
export declare function resolveCreatorFeeShareRate(config: {
    creatorFeeShareRate: bigint;
}, override: {
    owner: PublicKey;
    data: Uint8Array;
} | null | undefined, programId?: PublicKey): bigint;
/** The pool fields the creator-fee collect instructions need (a decoded PoolState has them all). */
export type CollectCreatorFeePool = CollectFeePool & Pick<CpmmPoolState, "poolCreator">;
/**
 * deep-amm `collect_creator_fee`, signed by the pool's recorded creator. Pays the creator
 * their part of BOTH sides' accrued creator fee into their associated token accounts (the
 * program creates them if missing, the creator pays that rent) and books the protocol's
 * share as protocol fee on the pool, where `collect_protocol_fee` picks it up. On a
 * graduation pool the fee is all WSOL, so it lands in the creator's WSOL account. Fails
 * with NoFeeCollect (6014) when nothing has accrued.
 */
export declare function deepAmmCollectCreatorFeeIx(a: {
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * deep-amm `collect_creator_fee_permissionless`: the same settlement, triggered by anyone.
 * The creator's part still goes to the CREATOR's associated token accounts; `payer` only
 * signs and pays the rent of any of those two accounts that does not exist yet (about
 * 0.002 SOL each). This is how DEEP's share gets booked when a creator never collects.
 */
export declare function deepAmmCollectCreatorFeePermissionlessIx(a: {
    payer: PublicKey;
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    programId?: PublicKey;
}): TransactionInstruction;
/**
 * `collect_creator_fee` for the creator's wallet. With `unwrapSol` (and a WSOL side) it
 * then closes the creator's WSOL account so the fee arrives as SOL: that unwraps the
 * account's WHOLE balance, including WSOL the creator already held there.
 */
export declare function deepAmmCollectCreatorFeeIxs(a: {
    pool: PublicKey;
    poolState: CollectCreatorFeePool;
    unwrapSol?: boolean;
    programId?: PublicKey;
}): TransactionInstruction[];
