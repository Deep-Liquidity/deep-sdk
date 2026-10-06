import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { CurveState } from "@deepliquidity/curve-math";
export * from "./constants.js";
export * from "./events.js";
export * from "./raydium-cpmm.js";
export * from "./deep-amm.js";
export * from "./cpmm-liquidity.js";
export * from "./amm-events.js";
export * from "./lifecycle.js";
export * from "./pyth.js";
export * from "./config.js";
export * from "./program-data.js";
export * from "./pairs.js";
export * from "./cpmm-initialize.js";
export * from "./creator-links.js";
export * from "./squads.js";
export * from "./genesis.js";
export declare function configPda(programId?: PublicKey): PublicKey;
/** Program-owned PDA that accrues protocol trade fees and migration fees. */
export declare function treasuryPda(programId?: PublicKey): PublicKey;
export declare function curvePda(mint: PublicKey, programId?: PublicKey): PublicKey;
export declare function vaultAddress(mint: PublicKey, programId?: PublicKey): PublicKey;
export declare function metadataPda(mint: PublicKey): PublicKey;
export declare const METADATA_LIMITS: {
    readonly name: 32;
    readonly symbol: 10;
    readonly uri: 200;
};
export interface CreateTokenArgs {
    creator: PublicKey;
    mint: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    programId?: PublicKey;
}
export declare function validateMetadata(name: string, symbol: string, uri: string): string | null;
export declare function createTokenIx(a: CreateTokenArgs): TransactionInstruction;
export interface TradeArgs {
    user: PublicKey;
    mint: PublicKey;
    /**
     * @deprecated Ignored. Protocol fees accrue on the curve PDA and are swept to the
     * Treasury by `sweepProtocolFeesIx`; trades take no fee account at all.
     */
    feeRecipient?: PublicKey;
    /** buy: lamports in. sell: token base units in. */
    amount: bigint;
    /** buy: min tokens out. sell: min lamports out. */
    minOut: bigint;
    /** Unix seconds after which the program rejects the trade. */
    deadline: bigint;
    programId?: PublicKey;
}
export declare const buyIx: (a: TradeArgs) => TransactionInstruction;
export declare const sellIx: (a: TradeArgs) => TransactionInstruction;
/** Emergency pause toggle. Only succeeds when `admin` is Config.admin (enforced on-chain). */
export declare function setPausedIx(admin: PublicKey, paused: boolean, programId?: PublicKey): TransactionInstruction;
/** min-out after applying slippage tolerance (bps). Rounds down. */
export declare function applySlippage(expected: bigint, slippageBps: number): bigint;
export interface BondingCurveAccount {
    mint: PublicKey;
    creator: PublicKey;
    state: CurveState;
    protocolFeeBps: number;
    creatorFeeBps: number;
    migrationFeeBps: number;
    creatorFeesUnclaimed: bigint;
    graduated: boolean;
    createdAt: bigint;
    bump: number;
    /** deep-amm pool created at graduation; PublicKey.default until graduated. */
    pool: PublicKey;
    /** v2: protocol fees (trade + launch) held on the curve until swept. 0n for v1 accounts. */
    protocolFeesUnclaimed: bigint;
}
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateCurveIx). */
export declare const BONDING_CURVE_V1_SIZE: number;
/** Byte size of BondingCurve v2 including the 8-byte discriminator (185). */
export declare const BONDING_CURVE_SIZE: number;
/** Accepts v1 (177 B, not yet migrated) and v2 (185 B) accounts. */
export declare function decodeBondingCurve(data: Uint8Array): BondingCurveAccount;
export interface ConfigAccount {
    admin: PublicKey;
    pendingAdmin: PublicKey;
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
    paused: boolean;
    bump: number;
    /** Raydium CPMM AmmConfig used for graduation pools. */
    raydiumAmmConfig: PublicKey;
    /** Delay applied to queued config updates. */
    timelockSeconds: number;
    /** v2: launch fee in US cents (0 for v1 accounts / launch fee off). */
    launchFeeUsdCents: number;
}
/** Byte size of Config including the 8-byte discriminator. */
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateConfigIx). */
export declare const CONFIG_V1_SIZE: number;
/** Byte size of Config v2 (+u16 launch_fee_usd_cents). */
export declare const CONFIG_SIZE: number;
/** Accepts v1 (213 B) and v2 (215 B) accounts. */
export declare function decodeConfig(data: Uint8Array): ConfigAccount;
