/**
 * DeepSwap AMM (programs/deep-amm) admin helpers. Pool-level reads, quotes and swaps
 * live in raydium-cpmm.ts: deep-amm keeps cp-swap's layouts, so those helpers work
 * here by passing DEEP_AMM_PROGRAM_ID.
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { DEEPSWAP_MAX_POOL_FEE_RATE, DEEPSWAP_MAX_REWARD_RATE, DEEPSWAP_V1_SCHEDULE, } from "@deepliquidity/curve-math";
import { discriminator } from "./constants.js";
import { distributorPda } from "./rewards.js";
import { CPMM_FEE_DENOMINATOR, cpmmAuthority, cpmmLpMint, cpmmObservation, cpmmPoolPda, cpmmVault, DEEP_AMM_PROGRAM_ID, sortMints, } from "./raydium-cpmm.js";
/**
 * DEEP's DeepSwap fee policy, DEEP V1 Phase 1 (docs/V1_FEES.md): a 0.30% pool trade fee of
 * which 1/3 (`protocolFeeRate` 333_333) is DEEP's protocol fee; the LPs keep 666_667 / 1e6.
 * The protocol fee is collected only into the DEEP fee vault (`protocol_owner` is locked to
 * it), where the splitter pays the builder 10% and the configured destinations 90%. The fund
 * fee is retired (`fundFeeRate` 0, the only value deep-amm accepts). On pools created by
 * graduation there is also a 0.30% creator fee of which half goes to the token's creator and
 * half to DEEP (booked as protocol fee, so it reaches the vault too). Rates are in millionths
 * (CPMM_FEE_DENOMINATOR), protocol and fund rates are shares OF the trade fee,
 * `creatorFeeShareRate` is the share OF the creator fee the protocol keeps. These are the
 * policy targets: the live values are whatever the AmmConfig holds, so read the chain.
 */
export const DEEP_AMM_FEES = {
    tradeFeeRate: 3000n,
    protocolFeeRate: 333333n,
    fundFeeRate: 0n,
    creatorFeeRate: 3000n,
    creatorFeeShareRate: 500000n,
};
/**
 * DEEP V1 DeepSwap fee targets (docs/V1_FEES.md), for an AmmConfig of fee model 1: absolute
 * rates per 1e6 that depend on the side. "Buy" = the swap's input is the pool's quote token
 * (SOL on TOKEN/SOL), "sell" = its output is. LP 0.10% per side (stays in the pool), DEEP
 * 0.25% on a buy and 0.65% on a sell (to the fee vault). On top, a Creator or Holder pool
 * charges its OWN reward rate on both sides, 100% its reward recipient's: the rate the
 * token's creator chose at launch (or the pool's creator, `initializeV1Ix`), fixed for good,
 * at most 5%. Every fee is taken in the quote token and a side never costs more than 10%.
 * These are the policy targets: the live values are whatever the AmmConfig holds, so read
 * the chain (`decodeCpmmAmmConfig`). `DEEP_AMM_FEES` above stays the policy of legacy (fee
 * model 0) configs and their pools.
 */
export const DEEP_AMM_V1_FEES = DEEPSWAP_V1_SCHEDULE;
/**
 * The hard ceiling of a pool's reward rate, per 1e6 (5%; deep-amm `MAX_REWARD_RATE`). Also
 * what `create_amm_config_v1` sets as the config's current maximum (`maxRewardRate`), which
 * the admin can lower with `update_amm_config` param 14.
 */
export const DEEP_AMM_MAX_REWARD_RATE = DEEPSWAP_MAX_REWARD_RATE;
/** deep-amm ErrorCode::FeeRateAboveCap (6019): a side's rates above the 10% hard cap. */
export const DEEP_AMM_ERR_FEE_RATE_ABOVE_CAP = 6019;
/**
 * deep-amm ErrorCode::FeeModelMismatch (6020): the pool and its AmmConfig are not of the same
 * fee model, or the instruction / `update_amm_config` param does not exist for that model.
 */
export const DEEP_AMM_ERR_FEE_MODEL_MISMATCH = 6020;
/** deep-amm ErrorCode::InvalidRewardModel (6021): not 0 (Standard), 1 (Creator) or 2 (Holder). */
export const DEEP_AMM_ERR_INVALID_REWARD_MODEL = 6021;
/** deep-amm ErrorCode::InvalidQuoteSide (6022): a V1 pool's quote must be WSOL when the pair has it. */
export const DEEP_AMM_ERR_INVALID_QUOTE_SIDE = 6022;
/**
 * deep-amm ErrorCode::InvalidRewardRate (6023): a pool's reward rate must be 0 for Standard
 * and 1..=50_000 otherwise; also a config `max_reward_rate` above 50_000.
 */
export const DEEP_AMM_ERR_INVALID_REWARD_RATE = 6023;
/** deep-amm ErrorCode::HolderRewardsNeedSolQuote (6024): `initialize_v1` opens a Holder pool only with a WSOL quote. */
export const DEEP_AMM_ERR_HOLDER_REWARDS_NEED_SOL_QUOTE = 6024;
/** deep-amm ErrorCode::RewardRateAboveMax (6025): `initialize_v1` with a rate above the config's current `max_reward_rate`. */
export const DEEP_AMM_ERR_REWARD_RATE_ABOVE_MAX = 6025;
/** deep-amm ErrorCode::CreatePoolFeeAboveCap (6026): a create-pool fee above `DEEP_AMM_MAX_CREATE_POOL_FEE`. */
export const DEEP_AMM_ERR_CREATE_POOL_FEE_ABOVE_CAP = 6026;
/** deep-amm ErrorCode::GraduationPermissionLocked (6027): the graduation payer's Permission cannot be closed. */
export const DEEP_AMM_ERR_GRADUATION_PERMISSION_LOCKED = 6027;
/** deep-amm ErrorCode::InvalidPoolStatus (6028): a pool status may stop deposits (1) and swaps (4) only; withdrawals cannot be disabled. */
export const DEEP_AMM_ERR_INVALID_POOL_STATUS = 6028;
/**
 * deep-amm ErrorCode::HolderRewardsNeedDistributor (6029): a Holder Rewards pool needs the
 * deep-rewards distributor of (the non-quote token, the quote token) to exist first
 * (`initialize_v1`: always; `initialize_with_permission_v1`: for a quote other than SOL).
 */
export const DEEP_AMM_ERR_HOLDER_REWARDS_NEED_DISTRIBUTOR = 6029;
/**
 * Hard cap of an AmmConfig's create-pool fee (deep-amm `deep_keys::MAX_CREATE_POOL_FEE`):
 * 0.15 SOL, the fee DeepSwap launches with. The admin can lower the fee, never raise it above
 * this, and the program never charges more whatever a config holds, so a pool creator's cost is
 * known in advance.
 */
export const DEEP_AMM_MAX_CREATE_POOL_FEE = 150000000n;
/** What a pool creation is charged for a config's `createPoolFee` (the cap applies when charging too). */
export const deepAmmCreatePoolFeeCharged = (configured) => configured > DEEP_AMM_MAX_CREATE_POOL_FEE ? DEEP_AMM_MAX_CREATE_POOL_FEE : configured;
/**
 * The pool-status bits the admin can set with `update_pool_status`: 1 = deposits disabled,
 * 4 = swaps disabled. Bit 2 (withdrawals) is rejected and `withdraw` ignores it.
 */
export const DEEP_AMM_POOL_STATUS = { depositDisabled: 1, swapDisabled: 4 };
export function deepAmmConfigPda(index = 0, programId = DEEP_AMM_PROGRAM_ID) {
    const idx = Buffer.alloc(2);
    idx.writeUInt16BE(index); // upstream seeds the index big-endian
    return PublicKey.findProgramAddressSync([Buffer.from("amm_config"), idx], programId)[0];
}
const U64_MAX = (1n << 64n) - 1n;
export function deepAmmCreateConfigIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const index = a.index ?? 0;
    const rates = [
        a.tradeFeeRate ?? DEEP_AMM_FEES.tradeFeeRate,
        a.protocolFeeRate ?? DEEP_AMM_FEES.protocolFeeRate,
        a.fundFeeRate ?? DEEP_AMM_FEES.fundFeeRate,
        a.createPoolFee,
        a.creatorFeeRate ?? DEEP_AMM_FEES.creatorFeeRate,
    ];
    for (const [i, v] of rates.entries()) {
        if (v < 0n || v > U64_MAX)
            throw new Error(`create_amm_config arg ${i} out of u64 range`);
    }
    // The asserts create_amm_config makes on-chain, checked early for a clearer error.
    const [trade, protocol, fund, , creator] = rates;
    if (trade + creator >= CPMM_FEE_DENOMINATOR)
        throw new Error("trade + creator fee >= 1_000_000");
    if (protocol + fund > CPMM_FEE_DENOMINATOR)
        throw new Error("protocol + fund fee > 1_000_000");
    const data = Buffer.alloc(8 + 2 + 8 * 5);
    data.set(discriminator("global", "create_amm_config"), 0);
    data.writeUInt16LE(index, 8);
    rates.forEach((v, i) => data.writeBigUInt64LE(v, 10 + i * 8));
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.admin, isSigner: true, isWritable: true },
            { pubkey: deepAmmConfigPda(index, programId), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}
/**
 * The check `create_amm_config_v1` / `update_amm_config` make on a V1 config
 * (`AmmConfig::validate_v1_rates`): on each side LP + protocol must stay within 5%
 * (50_000: the 10% total cap minus the 5% a pool's reward rate may take), and
 * `maxRewardRate`, when given, within 50_000. Throws otherwise.
 */
export function validateDeepAmmV1Rates(s) {
    for (const k of [
        "buyLpFeeRate",
        "buyProtocolFeeRate",
        "sellLpFeeRate",
        "sellProtocolFeeRate",
    ])
        if (s[k] < 0n || s[k] > U64_MAX)
            throw new Error(`${k} out of u64 range`);
    if (s.maxRewardRate !== undefined &&
        (s.maxRewardRate < 0n || s.maxRewardRate > DEEPSWAP_MAX_REWARD_RATE))
        throw new Error("maxRewardRate above the 5% ceiling (50_000)");
    const sides = [
        ["buy", s.buyLpFeeRate + s.buyProtocolFeeRate],
        ["sell", s.sellLpFeeRate + s.sellProtocolFeeRate],
    ];
    for (const [side, base] of sides)
        if (base > DEEPSWAP_MAX_POOL_FEE_RATE)
            throw new Error(`${side} side: lp + protocol rate above 5% (50_000)`);
}
/**
 * deep-amm `create_amm_config_v1(index, create_pool_fee, buy_lp, buy_protocol, sell_lp,
 * sell_protocol)`: creates an AmmConfig of fee model 1 (DEEP V1, side-dependent rates). Same
 * accounts as `create_amm_config`. Rates default to `DEEP_AMM_V1_FEES`. The program sets the
 * config's `max_reward_rate` to the ceiling (50_000); lower it with `update_amm_config` param
 * 14. A config's fee model is fixed at creation; its protocol owner is the DEEP fee vault and
 * it has no fund fee, as every config. Signed by the build-time admin, so on mainnet it goes
 * through the Squads vault.
 */
export function createAmmConfigV1Ix(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    if (!Number.isInteger(a.index) || a.index < 0 || a.index > 0xffff)
        throw new Error("index must be a u16");
    if (a.createPoolFee < 0n || a.createPoolFee > DEEP_AMM_MAX_CREATE_POOL_FEE)
        throw new Error("createPoolFee must be 0..=150_000_000 lamports (the 0.15 SOL hard cap)");
    const s = {
        buyLpFeeRate: a.buyLpFeeRate ?? DEEP_AMM_V1_FEES.buyLpFeeRate,
        buyProtocolFeeRate: a.buyProtocolFeeRate ?? DEEP_AMM_V1_FEES.buyProtocolFeeRate,
        sellLpFeeRate: a.sellLpFeeRate ?? DEEP_AMM_V1_FEES.sellLpFeeRate,
        sellProtocolFeeRate: a.sellProtocolFeeRate ?? DEEP_AMM_V1_FEES.sellProtocolFeeRate,
    };
    validateDeepAmmV1Rates(s);
    const args = [
        a.createPoolFee,
        s.buyLpFeeRate,
        s.buyProtocolFeeRate,
        s.sellLpFeeRate,
        s.sellProtocolFeeRate,
    ];
    const data = Buffer.alloc(8 + 2 + 8 * args.length);
    data.set(discriminator("global", "create_amm_config_v1"), 0);
    data.writeUInt16LE(a.index, 8);
    args.forEach((v, i) => data.writeBigUInt64LE(v, 10 + i * 8));
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.admin, isSigner: true, isWritable: true },
            { pubkey: deepAmmConfigPda(a.index, programId), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}
/**
 * update_amm_config `param` codes (programs/deep-amm/src/instructions/admin/update_config.rs).
 * Each fee model has its own rate params: on a V1 config (fee model 1) 0, 1, 7 and 8 are
 * rejected, on a legacy config 10..=14 are (FeeModelMismatch, 6020). There is no param 9: a
 * config's fee model cannot be changed.
 */
export const DEEP_AMM_CONFIG_PARAM = {
    tradeFeeRate: 0,
    protocolFeeRate: 1,
    /** Locked: only DEEP_AMM_BUILDER_FUND_FEE_RATE (V1: 0) is accepted (BuilderFeeLocked otherwise). */
    fundFeeRate: 2,
    /** Locked (V1): only the DEEP fee vault, passed as `remaining` (ProtocolOwnerLocked). */
    protocolOwner: 3,
    /** Locked: only the build-time builder wallet, passed as `remaining` (BuilderFeeLocked). */
    fundOwner: 4,
    createPoolFee: 5,
    disableCreatePool: 6,
    /** Add-on to the trade fee on pools with the creator fee enabled; trade + creator < 1e6. */
    creatorFeeRate: 7,
    /** Share of the creator fee the protocol keeps; 0..=1e6. */
    creatorFeeShareRate: 8,
    /**
     * V1 configs only, absolute rates per 1e6. After any change each side's lp + protocol must
     * stay within 50_000 (5%; FeeRateAboveCap, 6019).
     */
    buyLpFeeRate: 10,
    buyProtocolFeeRate: 11,
    sellLpFeeRate: 12,
    sellProtocolFeeRate: 13,
    /**
     * V1 configs only: the current maximum reward rate (per 1e6) of pools opened with
     * `initialize_v1`, at most 50_000 (InvalidRewardRate, 6023). Existing pools keep theirs.
     */
    maxRewardRate: 14,
};
/**
 * deep-amm `update_amm_config(param, value)`, signed by the build-time admin. Takes effect
 * at once (no timelock: KNOWN_ISSUES DA-1), so on mainnet it must go through the Squads vault.
 */
export function deepAmmUpdateConfigIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    if (!Number.isInteger(a.param) || a.param < 0 || a.param > 255)
        throw new Error("param must be u8");
    if (a.value < 0n || a.value > U64_MAX)
        throw new Error("value out of u64 range");
    const data = Buffer.alloc(8 + 1 + 8);
    data.set(discriminator("global", "update_amm_config"), 0);
    data.writeUInt8(a.param, 8);
    data.writeBigUInt64LE(a.value, 9);
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.admin, isSigner: true, isWritable: false },
            { pubkey: deepAmmConfigPda(a.index ?? 0, programId), isSigner: false, isWritable: true },
            ...(a.remaining ? [{ pubkey: a.remaining, isSigner: false, isWritable: false }] : []),
        ],
        data,
    });
}
/**
 * The per-mint allow entry (`SupportMintAssociated`). deep-amm accepts SPL Token mints and
 * Token-2022 mints whose extensions are all in its built-in list; any other Token-2022 mint
 * (permanent delegate, pausable, transfer hook, default account state, …) can only be pooled
 * once the admin has created this account for it, and pool creation must pass it as a
 * remaining account.
 */
export function deepAmmSupportMintPda(mint, programId = DEEP_AMM_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([Buffer.from("support_mint"), mint.toBytes()], programId)[0];
}
function supportMintIx(name, a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.admin, isSigner: true, isWritable: true },
            { pubkey: a.mint, isSigner: false, isWritable: false },
            { pubkey: deepAmmSupportMintPda(a.mint, programId), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(discriminator("global", name)),
    });
}
/**
 * Enables a Token-2022 mint for pool creation (admin only; the mint must be owned by
 * Token-2022). Takes effect at once and exposes pools to whatever the mint's issuer can do
 * (freeze, pause, seize, hook), so on mainnet it must go through the Squads vault.
 */
export const deepAmmCreateSupportMintIx = (a) => supportMintIx("create_support_mint_associated", a);
/** Removes the allow entry: no NEW pools for the mint. Existing pools keep working. */
export const deepAmmCloseSupportMintIx = (a) => supportMintIx("close_support_mint_associated", a);
/**
 * deep-amm `collect_protocol_fee(amount_0_requested, amount_1_requested)`. The signer must be
 * the pool's `AmmConfig.protocol_owner`. DEEP V1: the admin bypass is gone and the owner is
 * locked to the fee vault (a PDA without a key), so on a V1 config nobody can sign this; use
 * `deepAmmCollectProtocolFeeToVaultIx`. Kept for configs not yet moved to the vault. The
 * program pays out min(requested, accrued) per side (default u64::MAX: everything).
 */
export function deepAmmCollectProtocolFeeIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const amount0 = a.amount0 ?? U64_MAX;
    const amount1 = a.amount1 ?? U64_MAX;
    for (const v of [amount0, amount1]) {
        if (v < 0n || v > U64_MAX)
            throw new Error("amount out of u64 range");
    }
    const data = Buffer.alloc(8 + 8 + 8);
    data.set(discriminator("global", "collect_protocol_fee"), 0);
    data.writeBigUInt64LE(amount0, 8);
    data.writeBigUInt64LE(amount1, 16);
    const p = a.poolState;
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.owner, isSigner: true, isWritable: false },
            ro(cpmmAuthority(programId)),
            rw(a.pool),
            ro(p.ammConfig),
            rw(p.token0Vault),
            rw(p.token1Vault),
            ro(p.token0Mint),
            ro(p.token1Mint),
            rw(a.recipientToken0),
            rw(a.recipientToken1),
            ro(TOKEN_PROGRAM_ID),
            ro(TOKEN_2022_PROGRAM_ID),
        ],
        data,
    });
}
/**
 * `collect_protocol_fee` into the owner's associated token accounts, creating them first if
 * missing (the owner pays their rent). The SOL side arrives as WSOL in the owner's WSOL ATA.
 */
export function deepAmmCollectProtocolFeeIxs(a) {
    const p = a.poolState;
    const r0 = getAssociatedTokenAddressSync(p.token0Mint, a.owner, true, p.token0Program);
    const r1 = getAssociatedTokenAddressSync(p.token1Mint, a.owner, true, p.token1Program);
    return [
        createAssociatedTokenAccountIdempotentInstruction(a.owner, r0, a.owner, p.token0Mint, p.token0Program),
        createAssociatedTokenAccountIdempotentInstruction(a.owner, r1, a.owner, p.token1Mint, p.token1Program),
        deepAmmCollectProtocolFeeIx({
            owner: a.owner,
            pool: a.pool,
            poolState: p,
            recipientToken0: r0,
            recipientToken1: r1,
            programId: a.programId,
        }),
    ];
}
// ───────────── DEEP V1: protocol fees into the fee vault ─────────────
/**
 * deep-amm `collect_protocol_fee_to_vault` (DEEP V1, PERMISSIONLESS, no signer): moves ALL of a
 * pool's accrued protocol fees to the associated token accounts of the config's protocol owner,
 * which deep-amm locks to the DEEP fee vault. `protocolOwner` defaults to the vault
 * (`DEEP_FEE_VAULT`); the program rejects anything else. A side with accrued fees needs its
 * ATA to exist (see `deepAmmCollectProtocolFeeToVaultIxs`).
 */
export function deepAmmCollectProtocolFeeToVaultIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const p = a.poolState;
    const r0 = getAssociatedTokenAddressSync(p.token0Mint, a.protocolOwner, true, p.token0Program);
    const r1 = getAssociatedTokenAddressSync(p.token1Mint, a.protocolOwner, true, p.token1Program);
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            ro(cpmmAuthority(programId)),
            rw(a.pool),
            ro(p.ammConfig),
            rw(p.token0Vault),
            rw(p.token1Vault),
            ro(p.token0Mint),
            ro(p.token1Mint),
            rw(r0),
            rw(r1),
            ro(TOKEN_PROGRAM_ID),
            ro(TOKEN_2022_PROGRAM_ID),
        ],
        data: Buffer.from(discriminator("global", "collect_protocol_fee_to_vault")),
    });
}
/**
 * `collect_protocol_fee_to_vault`, creating the vault's ATA first for each side that has
 * accrued fees (idempotent; `payer` funds a missing ATA's rent, ~0.002 SOL, once). The WSOL
 * side normally exists already (`initialize_splitter` creates it).
 */
export function deepAmmCollectProtocolFeeToVaultIxs(a) {
    const p = a.poolState;
    const out = [];
    const sides = [
        [p.token0Mint, p.token0Program, p.protocolFeesToken0],
        [p.token1Mint, p.token1Program, p.protocolFeesToken1],
    ];
    for (const [mint, program, amount] of sides) {
        if (amount === 0n)
            continue;
        const ata = getAssociatedTokenAddressSync(mint, a.protocolOwner, true, program);
        out.push(createAssociatedTokenAccountIdempotentInstruction(a.payer, ata, a.protocolOwner, mint, program));
    }
    out.push(deepAmmCollectProtocolFeeToVaultIx(a));
    return out;
}
// ───────────── builder fund fee ─────────────
/**
 * deep-amm `collect_fund_fee(amount_0_requested, amount_1_requested)`: pays the accrued fund
 * fee (the DEEP builder share, 166_667 / 1e6 of every trade fee) out of the pool. Only the
 * build-time builder wallet (`deep_keys::BUILDER`, the only possible `AmmConfig.fund_owner`)
 * can sign it; the deep-amm admin no longer can. Same accounts as `collect_protocol_fee`.
 * The recipients are token accounts the signer chooses; min(requested, accrued) per side.
 */
export function deepAmmCollectFundFeeIx(a) {
    const ix = deepAmmCollectProtocolFeeIx({ ...a, owner: a.builder });
    ix.data.set(discriminator("global", "collect_fund_fee"), 0);
    return ix;
}
/**
 * `collect_fund_fee` into the builder's associated token accounts, created first if missing
 * (the builder pays their rent, so the wallet needs SOL). The SOL side arrives as WSOL.
 *
 * The mainnet builder wallet is a Squads v4 VAULT (a PDA): it cannot sign a transaction
 * itself. These instructions go into a Squads vault-transaction proposal of the builder's own
 * multisig, whose members approve it and whose execution signs as the vault
 * (see `builderCollectFundFeeProposal`). Nothing here sends anything.
 */
export function deepAmmCollectFundFeeIxs(a) {
    const p = a.poolState;
    const r0 = getAssociatedTokenAddressSync(p.token0Mint, a.builder, true, p.token0Program);
    const r1 = getAssociatedTokenAddressSync(p.token1Mint, a.builder, true, p.token1Program);
    return [
        createAssociatedTokenAccountIdempotentInstruction(a.builder, r0, a.builder, p.token0Mint, p.token0Program),
        createAssociatedTokenAccountIdempotentInstruction(a.builder, r1, a.builder, p.token1Mint, p.token1Program),
        deepAmmCollectFundFeeIx({
            builder: a.builder,
            pool: a.pool,
            poolState: p,
            recipientToken0: r0,
            recipientToken1: r1,
            programId: a.programId,
        }),
    ];
}
/**
 * PRINT-ONLY proposal content for the builder's Squads vault: one `collect_fund_fee` (with
 * idempotent ATA creation) per pool that has accrued fund fees. Returns the instructions and a
 * human-readable description; the caller prints them (e.g. as a Squads TX Builder import).
 * The vault (`builder`) is the only signer and the fee payer of the ATA rent.
 */
export function builderCollectFundFeeProposal(a) {
    const due = a.pools.filter((p) => p.poolState.fundFeesToken0 + p.poolState.fundFeesToken1 > 0n);
    const instructions = due.flatMap((p) => deepAmmCollectFundFeeIxs({
        builder: a.builder,
        pool: p.pool,
        poolState: p.poolState,
        programId: a.programId,
    }));
    const description = [
        `DEEP builder: collect DeepSwap fund fees into ${a.builder.toBase58()} (signed by this vault)`,
        ...due.map((p, i) => `${i + 1}. pool ${p.pool.toBase58()}: token_0 ${p.poolState.fundFeesToken0}, token_1 ${p.poolState.fundFeesToken1} (base units, at read time; the program pays what has accrued at execution)`),
    ].join("\n");
    return { instructions, description };
}
// ───────────── permissioned pool creation (creator-fee pools) ─────────────
/**
 * deep-amm `Permission` PDA of `authority`: seeds ["permission", authority]. A payer needs
 * one to call `initialize_with_permission`, the only instruction that creates a pool with
 * the creator fee enabled. deep-curve's graduation payer (`graduationPayerPda`) is the one
 * DEEP authorizes.
 */
export function deepAmmPermissionPda(authority, programId = DEEP_AMM_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([Buffer.from("permission"), authority.toBytes()], programId)[0];
}
/**
 * deep-amm `create_permission_pda`: the build-time admin authorizes `authority` to create
 * creator-fee pools (admin signs and pays the rent). Takes effect at once and anything the
 * authority creates afterwards charges the AmmConfig's creator fee, so on mainnet it must
 * go through the Squads vault. `close_permission_pda` revokes it.
 */
export function deepAmmCreatePermissionIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.admin, isSigner: true, isWritable: true },
            { pubkey: a.authority, isSigner: false, isWritable: false },
            { pubkey: deepAmmPermissionPda(a.authority, programId), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(discriminator("global", "create_permission_pda")),
    });
}
/** deep-amm `CreatorFeeOn` (borsh enum tag): on a V1 pool, the side every fee is taken in. */
export const DEEP_AMM_QUOTE_SIDE = { token0: 1, token1: 2 };
/**
 * deep-amm `initialize_with_permission_v1(init_amount_0, init_amount_1, open_time,
 * creator_fee_on, reward_model, reward_rate)`: creates a DEEP V1 pool (fee model 1) under a
 * V1 AmmConfig. Same accounts as `initialize_with_permission`. The pool takes every fee in
 * `quoteMint`, charges the config's side rates and, on top, its own `rewardRate`, which
 * accrues for `creator`. Only the 5% ceiling applies here, not the config's current maximum.
 * deep-curve's `graduate` is the caller for every launched token; this builder is for a
 * permissioned payer creating one directly. Anyone can open a V1 pool with `initializeV1Ix`.
 *
 * A Holder pool quoted in anything but SOL needs the deep-rewards distributor of (the non-quote
 * token, the quote token) to exist already (HolderRewardsNeedDistributor, 6029); the builder
 * appends it as the last remaining account. A SOL-quoted pool needs none.
 */
export function initializeWithPermissionV1Ix(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const openTime = a.openTime ?? 0n;
    for (const [k, v] of [
        ["amountA", a.amountA],
        ["amountB", a.amountB],
        ["openTime", openTime],
    ])
        if (v < 0n || v > U64_MAX)
            throw new RangeError(`${k} out of u64 range`);
    if (a.amountA === 0n || a.amountB === 0n)
        throw new RangeError("both amounts must be greater than zero");
    if (a.rewardModel !== 0 && a.rewardModel !== 1 && a.rewardModel !== 2)
        throw new RangeError("rewardModel must be 0 (Standard), 1 (Creator) or 2 (Holder)");
    // the program's rule here: within the ceiling, and no rate on a Standard pool
    if (a.rewardRate < 0n || a.rewardRate > DEEPSWAP_MAX_REWARD_RATE)
        throw new RangeError("rewardRate must be 0..=50_000 per 1e6 (5%)");
    if (a.rewardModel === 0 && a.rewardRate !== 0n)
        throw new RangeError("a Standard pool has no reward rate");
    if (a.mintA.equals(a.mintB))
        throw new Error("a pool needs two different mints");
    const [mint0, mint1] = sortMints(a.mintA, a.mintB);
    const aIsToken0 = mint0.equals(a.mintA);
    if (!a.quoteMint.equals(mint0) && !a.quoteMint.equals(mint1))
        throw new Error("quoteMint must be one of the pool's two mints");
    const base = a.quoteMint.equals(mint0) ? mint1 : mint0;
    if (base.equals(NATIVE_MINT))
        throw new Error("a pair with WSOL takes its fees in WSOL: quoteMint must be the WSOL mint");
    const quoteSide = a.quoteMint.equals(mint0)
        ? DEEP_AMM_QUOTE_SIDE.token0
        : DEEP_AMM_QUOTE_SIDE.token1;
    const [amount0, amount1] = aIsToken0 ? [a.amountA, a.amountB] : [a.amountB, a.amountA];
    const [program0, program1] = aIsToken0
        ? [a.tokenProgramA, a.tokenProgramB]
        : [a.tokenProgramB, a.tokenProgramA];
    const ata = (mint, program) => getAssociatedTokenAddressSync(mint, a.payer, true, program);
    const payerA = a.payerTokenA ?? ata(a.mintA, a.tokenProgramA);
    const payerB = a.payerTokenB ?? ata(a.mintB, a.tokenProgramB);
    const [payer0, payer1] = aIsToken0 ? [payerA, payerB] : [payerB, payerA];
    const poolPda = cpmmPoolPda(programId, a.ammConfig, mint0, mint1);
    const poolState = a.poolState ?? poolPda;
    const lpMint = cpmmLpMint(programId, poolState);
    const data = Buffer.alloc(8 + 24 + 1 + 1 + 8);
    data.set(discriminator("global", "initialize_with_permission_v1"), 0);
    data.writeBigUInt64LE(amount0, 8);
    data.writeBigUInt64LE(amount1, 16);
    data.writeBigUInt64LE(openTime, 24);
    data.writeUInt8(quoteSide, 32);
    data.writeUInt8(a.rewardModel, 33);
    data.writeBigUInt64LE(a.rewardRate, 34);
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.payer, isSigner: true, isWritable: true },
            ro(a.creator),
            ro(a.ammConfig),
            ro(cpmmAuthority(programId)),
            { pubkey: poolState, isSigner: !poolState.equals(poolPda), isWritable: true },
            ro(mint0),
            ro(mint1),
            rw(lpMint),
            rw(payer0),
            rw(payer1),
            // LP mints are created under the legacy token program
            rw(getAssociatedTokenAddressSync(lpMint, a.payer, true)),
            rw(cpmmVault(programId, poolState, mint0)),
            rw(cpmmVault(programId, poolState, mint1)),
            rw(a.createPoolFeeReceiver),
            rw(cpmmObservation(programId, poolState)),
            ro(deepAmmPermissionPda(a.payer, programId)),
            ro(TOKEN_PROGRAM_ID),
            ro(program0),
            ro(program1),
            ro(ASSOCIATED_TOKEN_PROGRAM_ID),
            ro(SystemProgram.programId),
            ...(a.supportMints ?? []).map(ro),
            ...(a.rewardModel === 2 && !a.quoteMint.equals(NATIVE_MINT)
                ? [ro(distributorPda(base, a.quoteMint, a.rewardsProgramId))]
                : []),
        ],
        data,
    });
}
// ───────────── creator fee collection ─────────────
/**
 * The optional per-creator override of `AmmConfig.creator_fee_share_rate`: seeds
 * ["creator_fee_share", creator, amm_config]. The collect instructions always take this
 * address; when the account does not exist the AmmConfig's rate applies.
 */
export function deepAmmCreatorFeeSharePda(creator, ammConfig, programId = DEEP_AMM_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([Buffer.from("creator_fee_share"), creator.toBytes(), ammConfig.toBytes()], programId)[0];
}
/** `CreatorFeeShare.share_rate` from account data (8 disc + 1 bump + 32 creator + 32 config + u64). */
export function decodeCreatorFeeShareRate(data) {
    const d = discriminator("account", "CreatorFeeShare");
    if (data.length < 81)
        throw new Error("CreatorFeeShare: account too small");
    for (let i = 0; i < 8; i++)
        if (data[i] !== d[i])
            throw new Error("not a CreatorFeeShare account");
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(73, true);
}
/**
 * `resolve_creator_fee_share_rate`: the override account's rate when it exists and is owned
 * by the AMM program, otherwise the AmmConfig's.
 */
export function resolveCreatorFeeShareRate(config, override, programId = DEEP_AMM_PROGRAM_ID) {
    if (!override || override.data.length === 0 || !override.owner.equals(programId))
        return config.creatorFeeShareRate;
    return decodeCreatorFeeShareRate(override.data);
}
function creatorFeeAccounts(p, programId) {
    return {
        creatorToken0: getAssociatedTokenAddressSync(p.token0Mint, p.poolCreator, true, p.token0Program),
        creatorToken1: getAssociatedTokenAddressSync(p.token1Mint, p.poolCreator, true, p.token1Program),
        creatorFeeShare: deepAmmCreatorFeeSharePda(p.poolCreator, p.ammConfig, programId),
    };
}
/**
 * deep-amm `collect_creator_fee`, signed by the pool's recorded creator. Pays the creator
 * their part of BOTH sides' accrued creator fee into their associated token accounts (the
 * program creates them if missing, the creator pays that rent) and books the protocol's
 * share as protocol fee on the pool, where `collect_protocol_fee` picks it up. On a
 * graduation pool the fee is all WSOL, so it lands in the creator's WSOL account. Fails
 * with NoFeeCollect (6014) when nothing has accrued.
 */
export function deepAmmCollectCreatorFeeIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const p = a.poolState;
    const acc = creatorFeeAccounts(p, programId);
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: p.poolCreator, isSigner: true, isWritable: true },
            ro(cpmmAuthority(programId)),
            rw(a.pool),
            ro(p.ammConfig),
            rw(p.token0Vault),
            rw(p.token1Vault),
            ro(p.token0Mint),
            ro(p.token1Mint),
            rw(acc.creatorToken0),
            rw(acc.creatorToken1),
            ro(p.token0Program),
            ro(p.token1Program),
            ro(ASSOCIATED_TOKEN_PROGRAM_ID),
            ro(SystemProgram.programId),
            ro(acc.creatorFeeShare),
        ],
        data: Buffer.from(discriminator("global", "collect_creator_fee")),
    });
}
/**
 * deep-amm `collect_creator_fee_permissionless`: the same settlement, triggered by anyone.
 * The creator's part still goes to the CREATOR's associated token accounts; `payer` only
 * signs and pays the rent of any of those two accounts that does not exist yet (about
 * 0.002 SOL each). This is how DEEP's share gets booked when a creator never collects.
 */
export function deepAmmCollectCreatorFeePermissionlessIx(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    const p = a.poolState;
    const acc = creatorFeeAccounts(p, programId);
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.payer, isSigner: true, isWritable: true },
            ro(p.poolCreator),
            ro(cpmmAuthority(programId)),
            rw(a.pool),
            rw(p.token0Vault),
            rw(p.token1Vault),
            ro(p.token0Mint),
            ro(p.token1Mint),
            rw(acc.creatorToken0),
            rw(acc.creatorToken1),
            ro(p.token0Program),
            ro(p.token1Program),
            ro(ASSOCIATED_TOKEN_PROGRAM_ID),
            ro(SystemProgram.programId),
            ro(p.ammConfig),
            ro(acc.creatorFeeShare),
        ],
        data: Buffer.from(discriminator("global", "collect_creator_fee_permissionless")),
    });
}
/**
 * `collect_creator_fee` for the creator's wallet. With `unwrapSol` (and a WSOL side) it
 * then closes the creator's WSOL account so the fee arrives as SOL: that unwraps the
 * account's WHOLE balance, including WSOL the creator already held there.
 */
export function deepAmmCollectCreatorFeeIxs(a) {
    const p = a.poolState;
    const ixs = [deepAmmCollectCreatorFeeIx(a)];
    if (a.unwrapSol) {
        const wsolProgram = p.token0Mint.equals(NATIVE_MINT)
            ? p.token0Program
            : p.token1Mint.equals(NATIVE_MINT)
                ? p.token1Program
                : null;
        if (wsolProgram) {
            const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, p.poolCreator, true, wsolProgram);
            ixs.push(createCloseAccountInstruction(wsol, p.poolCreator, p.poolCreator, [], wsolProgram));
        }
    }
    return ixs;
}
//# sourceMappingURL=deep-amm.js.map