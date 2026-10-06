/**
 * deep-curve lifecycle/admin instruction builders: initialize_config, the timelocked
 * queue/apply/cancel_config_update,
 * withdraw_protocol_fees, claim_creator_fees, graduate.
 * Account order mirrors the `#[derive(Accounts)]` structs in programs/deep-curve/src/lib.rs
 * (and the Rust LiteSVM test helpers that exercise them).
 */
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
/** Raydium cp-swap's devnet create-pool fee receiver (legacy; graduation now targets deep-amm). */
export declare const CPMM_CREATE_POOL_FEE_RECEIVER_DEVNET: PublicKey;
/** Compute units to request for `graduate` (see docs/PROGRAMS.md for the LiteSVM measurement). */
export declare const GRADUATE_COMPUTE_UNITS = 400000;
/**
 * The deep-curve PDA that pays for and signs pool creation at graduation. ONE address for
 * every token (seed "pool_creator" alone): deep-amm's `initialize_with_permission` needs
 * a Permission account derived from the payer (`deepAmmPermissionPda`), which the deep-amm
 * admin creates once for this address. It replaces the per-mint `poolCreatorPda(mint)` of
 * builds before the DeepSwap creator fee.
 */
export declare function graduationPayerPda(programId?: PublicKey): PublicKey;
/** The deep-curve-owned PDA used as the Raydium pool_state (un-griefable). */
export declare function graduationPoolPda(mint: PublicKey, programId?: PublicKey): PublicKey;
/**
 * True only for the pool deep-curve created when `token` graduated. Anyone can open
 * other pools for the same pair (any price, any AmmConfig), so UIs must not treat those
 * as the token's DEEP market. Pure: needs only the pool address and its two mints.
 */
export declare function isGraduationPool(poolId: PublicKey, mint0: PublicKey, mint1: PublicKey, programId?: PublicKey): boolean;
/** Holds the single queued (timelocked) config change. */
export declare function pendingConfigPda(programId?: PublicKey): PublicKey;
export declare function programDataPda(programId?: PublicKey): PublicKey;
export interface ConfigParamsArgs {
    feeRecipient: PublicKey;
    migrationAuthority: PublicKey;
    protocolFeeBps: number;
    creatorFeeBps: number;
    migrationFeeBps: number;
    initialVirtualSol: bigint;
    initialVirtualToken: bigint;
    curveSupply: bigint;
    tokenTotalSupply: bigint;
    decimals: number;
    raydiumAmmConfig: PublicKey;
    /**
     * Delay (seconds) applied to every later config change; 0..=30 days.
     * Use 0 on localnet/devnet, at least 48h (172_800) on mainnet.
     */
    timelockSeconds: number;
    /** v2: launch fee in US cents, 0..=2000 (on-chain cap). Defaults to 0 (no fee). */
    launchFeeUsdCents?: number;
}
/** Program-side bound (MAX_TIMELOCK_SECONDS) and the recommended mainnet value. */
export declare const MAX_TIMELOCK_SECONDS: number;
export declare const RECOMMENDED_MAINNET_TIMELOCK_SECONDS: number;
export declare function encodeConfigParams(p: ConfigParamsArgs): Buffer;
/** Must be signed by the program's upgrade authority (enforced on-chain via ProgramData). */
export declare function initializeConfigIx(admin: PublicKey, params: ConfigParamsArgs, programId?: PublicKey): TransactionInstruction;
/**
 * Timelocked config change, step 1 (admin only). Takes effect after
 * Config.timelock_seconds via `applyConfigUpdateIx`; only one change can be queued.
 */
export declare function queueConfigUpdateIx(admin: PublicKey, params: ConfigParamsArgs, programId?: PublicKey): TransactionInstruction;
/**
 * Timelocked config change, step 2. Permissionless (no signer in the account list):
 * any fee payer can execute once the queued change's eta has passed.
 */
export declare function applyConfigUpdateIx(programId?: PublicKey): TransactionInstruction;
/** Admin veto for the queued change. */
export declare function cancelConfigUpdateIx(admin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * PERMISSIONLESS: moves a curve's accrued protocol fees (trade + launch) to the
 * Treasury. Any fee payer may send it (e.g. a crank batching many curves).
 */
export declare function sweepProtocolFeesIx(mint: PublicKey, programId?: PublicKey): TransactionInstruction;
/** PERMISSIONLESS, idempotent: grows v1 Config (+ PendingConfig) to v2. Payer funds rent. */
export declare function migrateConfigIx(payer: PublicKey, programId?: PublicKey): TransactionInstruction;
/** PERMISSIONLESS, idempotent: grows a v1 BondingCurve to v2. Payer funds rent. */
export declare function migrateCurveIx(payer: PublicKey, mint: PublicKey, programId?: PublicKey): TransactionInstruction;
/** Two-step admin transfer, step 1 (current admin). Immediate; not timelocked. */
export declare function proposeAdminIx(admin: PublicKey, newAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
/**
 * Two-step admin transfer, step 2: must be signed by Config.pending_admin. For a
 * Squads vault this instruction goes into a multisig proposal (the vault signs on
 * execution), it cannot be sent directly.
 */
export declare function acceptAdminIx(pendingAdmin: PublicKey, programId?: PublicKey): TransactionInstruction;
export declare function withdrawProtocolFeesIx(admin: PublicKey, feeRecipient: PublicKey, amount: bigint, programId?: PublicKey): TransactionInstruction;
export declare function claimCreatorFeesIx(creator: PublicKey, mint: PublicKey, programId?: PublicKey): TransactionInstruction;
export interface GraduationAccounts {
    /** `graduationPayerPda`: pays for the pool, never the pool's recorded creator. */
    poolCreator: PublicKey;
    /** deep-amm Permission of `poolCreator`; graduation fails until the AMM admin creates it. */
    permission: PublicKey;
    poolState: PublicKey;
    lpMint: PublicKey;
    token0Vault: PublicKey;
    token1Vault: PublicKey;
    observation: PublicKey;
    creatorToken: PublicKey;
    creatorWsol: PublicKey;
    creatorLp: PublicKey;
}
/** Every address `graduate` touches for `mint`. `poolState` is where the Raydium pool will live. */
export declare function graduationAccounts(mint: PublicKey, programId?: PublicKey, cpSwap?: PublicKey): GraduationAccounts;
export interface GraduateArgs {
    migrationAuthority: PublicKey;
    mint: PublicKey;
    /**
     * The token's creator (`BondingCurve.creator`; the program rejects any other key). It is
     * recorded as the DeepSwap pool's creator, which lets them collect the creator fee.
     */
    creator: PublicKey;
    /** Config.raydium_amm_config */
    ammConfig: PublicKey;
    programId?: PublicKey;
    /** Defaults to deep-amm. */
    cpSwapProgramId?: PublicKey;
    /** deep-amm's build-time create-pool fee WSOL account (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). */
    createPoolFeeReceiver?: PublicKey;
}
export declare function graduateIx(a: GraduateArgs): TransactionInstruction;
/** graduate plus the compute budget it needs. */
export declare function graduateIxs(a: GraduateArgs): TransactionInstruction[];
