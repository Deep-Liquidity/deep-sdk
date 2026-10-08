import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type CurveState, type FeeConfigV1, type FeeSchedule, type RewardModel } from "@deepliquidity/curve-math";
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
export * from "./builder.js";
export * from "./splitter.js";
export * from "./merkle.js";
export * from "./rewards.js";
export * from "./rewards-verify.js";
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
    /**
     * DEEP V1 reward model: 0 Standard (default), 1 Creator, 2 Holder (`REWARD_MODEL`). Chosen
     * here together with `rewardBps`, stored on the curve and never changed afterwards;
     * graduation carries both into the token's DeepSwap pool.
     */
    rewardModel?: RewardModel;
    /**
     * The token's reward rate, bps, charged on both sides of every trade on top of DEEP's
     * protocol fee: on the curve and, after graduation, in the DeepSwap pool. 0 for Standard
     * (the default); 1..=500 (`MAX_REWARD_BPS`, 5%) for Creator (paid to the creator) and
     * Holder (paid to the token's holders). The program also rejects a rate above the Config's
     * current maximum (`maxRewardBps`) and one that pushes a side above 10% in total.
     */
    rewardBps?: number;
    /**
     * Optional, for a clearer error before sending: the decoded Config. With it the builder
     * applies the two checks that depend on it, `Config.maxRewardBps` (RewardRateAboveMax,
     * 6040) and the 10% total per side with the Config's protocol rates (InvalidFee, 6009).
     */
    config?: Pick<ConfigAccount, "maxRewardBps" | "protocolFeeBps" | "sellProtocolFeeBps">;
    /**
     * The most the creator agrees to pay as launch fee, lamports (u64). The fee is set in USD
     * and converted at the Pyth SOL/USD price inside the instruction; above this limit the
     * transaction fails (LaunchFeeAboveMax, 6041) and nothing is charged. Pass the fee quoted
     * to the user plus a small tolerance: `launchFeeLimitLamports(quoteLaunchFeeLamports(...))`.
     * Not read when the Config's launch fee is 0.
     */
    maxLaunchFeeLamports: bigint;
    programId?: PublicKey;
}
/** Default tolerance on top of the quoted launch fee: 2% (the price moves between quote and landing). */
export declare const LAUNCH_FEE_TOLERANCE_BPS = 200n;
/**
 * `maxLaunchFeeLamports` for `createTokenIx`: the quoted fee plus `toleranceBps` (default 2%),
 * rounded up. A quote of 0 (no launch fee) gives 0.
 */
export declare function launchFeeLimitLamports(quotedLamports: bigint, toleranceBps?: bigint): bigint;
/**
 * The checks `create_token` makes on the reward terms, as an error message or null: Standard
 * takes no rate, Creator / Holder 1..=500 bps; with `config`, also the admin's current
 * maximum and the 10% total cap per side.
 */
export declare function validateLaunchTerms(rewardModel: number, rewardBps: number, config?: Pick<ConfigAccount, "maxRewardBps" | "protocolFeeBps" | "sellProtocolFeeBps">): string | null;
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
    /** The stored field behind `rewardBps` (its name is kept from the v1/v2 layout). */
    creatorFeeBps: number;
    /**
     * The token's reward rate, bps, charged on both sides on top of the protocol fee: chosen
     * by its creator at launch, immutable, 0 for Standard. Alias of `creatorFeeBps` (bytes
     * 122..124). Where it goes is `rewardModel`. Graduation carries it into the DeepSwap pool
     * as `rewardBps * 100` per 1e6.
     */
    rewardBps: number;
    migrationFeeBps: number;
    creatorFeesUnclaimed: bigint;
    graduated: boolean;
    createdAt: bigint;
    bump: number;
    /** deep-amm pool created at graduation; PublicKey.default until graduated. */
    pool: PublicKey;
    /** v2: protocol fees (trade + launch) held on the curve until swept. 0n for v1 accounts. */
    protocolFeesUnclaimed: bigint;
    /**
     * v3 (DEEP V1): protocol fee on SELLS; `protocolFeeBps` is the BUY rate. For a v1/v2 account
     * it is `protocolFeeBps` (what `migrate_curve` writes).
     */
    sellProtocolFeeBps: number;
    /**
     * v3: 0 Standard, 1 Creator, 2 Holder. `rewardBps` is this token's reward rate on both
     * sides (to the creator for Standard / Creator, to the holder vault for Holder). For a v1/v2
     * account: Creator when it charges a creator fee, else Standard (what `migrate_curve` writes).
     * The raw byte: the program only ever writes 0, 1 or 2 (`curveFees` rejects anything else).
     */
    rewardModel: number;
    /** v3: Holder reward fees held on the curve until `sweepHolderFeesIx`. 0n before v3. */
    holderFeesUnclaimed: bigint;
}
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateCurveIx). */
export declare const BONDING_CURVE_V1_SIZE: number;
/** v2 layout (+u64 protocol_fees_unclaimed; devnet before DEEP V1 Phase 2): 185. */
export declare const BONDING_CURVE_V2_SIZE: number;
/**
 * Byte size of BondingCurve v3 including the 8-byte discriminator (196):
 * + u16 sell_protocol_fee_bps, u8 reward_model, u64 holder_fees_unclaimed.
 */
export declare const BONDING_CURVE_SIZE: number;
/** Offset of `protocol_fees_unclaimed` (u64) in a v2/v3 BondingCurve account. */
export declare const BONDING_CURVE_PROTOCOL_FEES_OFFSET: number;
/** Offset of `reward_model` (u8) in a v3 BondingCurve account (for memcmp filters). */
export declare const BONDING_CURVE_REWARD_MODEL_OFFSET: number;
/** The fee terms a curve trades at (`quoteBuyV1` / `quoteSellV1` in @deep/curve-math). */
export declare function curveFees(curve: BondingCurveAccount): FeeConfigV1;
/**
 * The curve's total fee per side, bps: buy = `protocolFeeBps + rewardBps`,
 * sell = `sellProtocolFeeBps + rewardBps`.
 */
export declare function curveTotalFeeBps(curve: Pick<BondingCurveAccount, "protocolFeeBps" | "sellProtocolFeeBps" | "rewardBps">): {
    buy: number;
    sell: number;
};
/** Accepts v1 (177 B), v2 (185 B) (neither migrated yet) and v3 (196 B) accounts. */
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
    /**
     * v3 (DEEP V1): protocol fee on SELLS; `protocolFeeBps` is the BUY rate. For a v1/v2 account
     * it is `protocolFeeBps` (what `migrate_config` writes).
     */
    sellProtocolFeeBps: number;
    /**
     * v3: the admin's CURRENT maximum reward rate a creator may choose for a NEW launch, bps
     * (at most 500). Never a token's rate by itself; tokens already launched keep theirs.
     * 0 on a v1/v2 account (`migrate_config` then writes 500).
     */
    maxRewardBps: number;
    /** v3: reserved (stored, read by no instruction). */
    reservedBps: number;
}
/** v1 layout (deployed on devnet before the v2 upgrade; migrate with migrateConfigIx). */
export declare const CONFIG_V1_SIZE: number;
/** v2 layout (+u16 launch_fee_usd_cents; devnet before DEEP V1 Phase 2). */
export declare const CONFIG_V2_SIZE: number;
/** Byte size of Config v3 (+3 × u16: sell protocol fee, max reward rate, reserved). */
export declare const CONFIG_SIZE: number;
/**
 * The Config's fee rates as @deep/curve-math's `FeeSchedule`: what a launch is checked
 * against (`snapshotFees(schedule, rewardModel, rewardBps)`), and the Config's own cap.
 */
export declare function configFeeSchedule(c: ConfigAccount): FeeSchedule;
/** Accepts v1 (213 B), v2 (215 B) and v3 (221 B) accounts. */
export declare function decodeConfig(data: Uint8Array): ConfigAccount;
