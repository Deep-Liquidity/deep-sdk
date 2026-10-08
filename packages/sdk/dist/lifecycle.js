/**
 * deep-curve lifecycle/admin instruction builders: initialize_config, the timelocked
 * queue/apply/cancel_config_update,
 * withdraw_protocol_fees, claim_creator_fees, graduate.
 * Account order mirrors the `#[derive(Accounts)]` structs in programs/deep-curve/src/lib.rs
 * (and the Rust LiteSVM test helpers that exercise them).
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, } from "@solana/web3.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";
import { deepAmmPermissionPda } from "./deep-amm.js";
import { DEEP_REWARDS_PROGRAM_ID, holderVaultPda } from "./rewards.js";
import { feeVaultPda, feeVaultWsolAta } from "./splitter.js";
import { cpmmAuthority, DEEP_AMM_PROGRAM_ID, cpmmLpMint, cpmmObservation, cpmmVault, sortMints, } from "./raydium-cpmm.js";
const enc = new TextEncoder();
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** Raydium cp-swap's devnet create-pool fee receiver (legacy; graduation now targets deep-amm). */
export const CPMM_CREATE_POOL_FEE_RECEIVER_DEVNET = new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy");
/** Compute units to request for `graduate` (see docs/PROGRAMS.md for the LiteSVM measurement). */
export const GRADUATE_COMPUTE_UNITS = 400_000;
const pda = (seeds, programId) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const configPdaOf = (pid) => pda([enc.encode("config")], pid);
const treasuryPdaOf = (pid) => pda([enc.encode("treasury")], pid);
const curvePdaOf = (mint, pid) => pda([enc.encode("curve"), mint.toBytes()], pid);
/**
 * The deep-curve PDA that pays for and signs pool creation at graduation. ONE address for
 * every token (seed "pool_creator" alone). deep-amm compiles it in
 * (`deep_keys::GRADUATION_PAYER`, `DEEP_GRADUATION_PAYER` below): for this payer
 * `initialize_with_permission[_v1]` needs no Permission account, ignores an AmmConfig's
 * `disable_create_pool`, and its Permission cannot be closed, so no deep-amm admin action can
 * block a graduation.
 */
export function graduationPayerPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda([enc.encode("pool_creator")], programId);
}
/**
 * `graduationPayerPda()` of deep-curve 7czUR…CDtA, the same on every cluster: the address
 * deep-amm compiles in as `deep_keys::GRADUATION_PAYER` (pinned by packages/sdk tests and by
 * programs/deep-curve tests).
 */
export const DEEP_GRADUATION_PAYER = new PublicKey("GwW8P2V5mxfPosGEwtcNuUuzx6FVdzPZrapApn8ufYZF");
/** The deep-curve-owned PDA used as the Raydium pool_state (un-griefable). */
export function graduationPoolPda(mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return pda([enc.encode("raydium_pool"), mint.toBytes()], programId);
}
/**
 * True only for the pool deep-curve created when `token` graduated. Anyone can open
 * other pools for the same pair (any price, any AmmConfig), so UIs must not treat those
 * as the token's DEEP market. Pure: needs only the pool address and its two mints.
 */
export function isGraduationPool(poolId, mint0, mint1, programId = DEEP_CURVE_PROGRAM_ID) {
    const token = mint0.equals(NATIVE_MINT) ? mint1 : mint1.equals(NATIVE_MINT) ? mint0 : null;
    return !!token && graduationPoolPda(token, programId).equals(poolId);
}
/** Holds the single queued (timelocked) config change. */
export function pendingConfigPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda([enc.encode("pending_config")], programId);
}
export function programDataPda(programId = DEEP_CURVE_PROGRAM_ID) {
    return pda([programId.toBytes()], BPF_LOADER_UPGRADEABLE);
}
// ───────────── tiny borsh writer ─────────────
class W {
    b = [];
    raw(x) {
        this.b.push(...x);
        return this;
    }
    pk(k) {
        return this.raw(k.toBytes());
    }
    u8(v) {
        if (!Number.isInteger(v) || v < 0 || v > 255)
            throw new RangeError("u8 out of range");
        this.b.push(v);
        return this;
    }
    u16(v) {
        if (!Number.isInteger(v) || v < 0 || v > 0xffff)
            throw new RangeError("u16 out of range");
        this.b.push(v & 0xff, v >> 8);
        return this;
    }
    u32(v) {
        if (!Number.isInteger(v) || v < 0 || v > 0xffffffff)
            throw new RangeError("u32 out of range");
        this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
        return this;
    }
    u64(v) {
        if (v < 0n || v >= 1n << 64n)
            throw new RangeError("u64 out of range");
        for (let i = 0n; i < 8n; i++)
            this.b.push(Number((v >> (8n * i)) & 0xffn));
        return this;
    }
    done() {
        return Buffer.from(this.b);
    }
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({
    pubkey,
    isSigner,
    isWritable,
});
/** Every `ConfigParamsArgs` field of a decoded Config or queued params, new fields included. */
export function configParamsOf(c) {
    return {
        feeRecipient: c.feeRecipient,
        migrationAuthority: c.migrationAuthority,
        protocolFeeBps: c.protocolFeeBps,
        creatorFeeBps: c.creatorFeeBps,
        migrationFeeBps: c.migrationFeeBps,
        initialVirtualSol: c.initialVirtualSol,
        initialVirtualToken: c.initialVirtualToken,
        curveSupply: c.curveSupply,
        tokenTotalSupply: c.tokenTotalSupply,
        decimals: c.decimals,
        raydiumAmmConfig: c.raydiumAmmConfig,
        timelockSeconds: c.timelockSeconds,
        launchFeeUsdCents: c.launchFeeUsdCents,
        sellProtocolFeeBps: c.sellProtocolFeeBps,
        maxRewardBps: c.maxRewardBps,
        reservedBps: c.reservedBps,
    };
}
/** Program-side bound (MAX_TIMELOCK_SECONDS) and the recommended mainnet value. */
export const MAX_TIMELOCK_SECONDS = 30 * 24 * 3600;
export const RECOMMENDED_MAINNET_TIMELOCK_SECONDS = 48 * 3600;
export function encodeConfigParams(p) {
    return new W()
        .pk(p.feeRecipient)
        .pk(p.migrationAuthority)
        .u16(p.protocolFeeBps)
        .u16(p.creatorFeeBps)
        .u16(p.migrationFeeBps)
        .u64(p.initialVirtualSol)
        .u64(p.initialVirtualToken)
        .u64(p.curveSupply)
        .u64(p.tokenTotalSupply)
        .u8(p.decimals)
        .pk(p.raydiumAmmConfig)
        .u32(p.timelockSeconds)
        .u16(p.launchFeeUsdCents ?? 0)
        .u16(p.sellProtocolFeeBps ?? p.protocolFeeBps)
        .u16(p.maxRewardBps ?? 0)
        .u16(p.reservedBps ?? 0)
        .done();
}
/** Must be signed by the program's upgrade authority (enforced on-chain via ProgramData). */
export function initializeConfigIx(admin, params, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, true, true),
            meta(configPdaOf(programId), true),
            meta(treasuryPdaOf(programId), true),
            meta(programId),
            meta(programDataPda(programId)),
            meta(SystemProgram.programId),
        ],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "initialize_config")),
            encodeConfigParams(params),
        ]),
    });
}
/**
 * Timelocked config change, step 1 (admin only). Takes effect after
 * Config.timelock_seconds via `applyConfigUpdateIx`; only one change can be queued.
 */
export function queueConfigUpdateIx(admin, params, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, true, true),
            meta(configPdaOf(programId)),
            meta(pendingConfigPda(programId), true),
            meta(SystemProgram.programId),
        ],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "queue_config_update")),
            encodeConfigParams(params),
        ]),
    });
}
/**
 * Timelocked config change, step 2. Permissionless (no signer in the account list):
 * any fee payer can execute once the queued change's eta has passed.
 */
export function applyConfigUpdateIx(programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(configPdaOf(programId), true), meta(pendingConfigPda(programId), true)],
        data: Buffer.from(discriminator("global", "apply_config_update")),
    });
}
/** Admin veto for the queued change. */
export function cancelConfigUpdateIx(admin, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, false, true),
            meta(configPdaOf(programId)),
            meta(pendingConfigPda(programId), true),
        ],
        data: Buffer.from(discriminator("global", "cancel_config_update")),
    });
}
// ───────────── v2: fee sweep + account migration ─────────────
/**
 * PERMISSIONLESS: moves a curve's accrued protocol fees (trade + launch) to the DEEP fee vault
 * (DEEP V1), where `distribute` pays the builder 10% and the destinations 90%. Any fee payer may
 * send it (e.g. a crank batching many curves). The vault must already be funded to its rent
 * minimum (`initializeSplitterIx`).
 *
 * Breaking change (V1): the second argument is the program id again; the builder account of
 * the 5/70 build is gone.
 */
export function sweepProtocolFeesIx(mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(curvePdaOf(mint, programId), true), meta(feeVaultPda(programId), true)],
        data: Buffer.from(discriminator("global", "sweep_protocol_fees")),
    });
}
/**
 * PERMISSIONLESS: moves a Holder token's accrued curve reward fees
 * (`BondingCurve.holder_fees_unclaimed`) to its holder vault, the deep-rewards PDA
 * `holderVaultPda(mint)`, from where deep-rewards pays holders. Works before and after
 * graduation. Fails with `ZeroAmount` when nothing accrued (always the case while the curve
 * reward rate is 0), and with `HolderVaultBelowRent` while the vault would end below the 0-byte
 * rent minimum: run deep-rewards `init_distributor` for the mint first (it funds the reserve),
 * or wait until the accrued amount alone covers it. The fees stay on the curve until then.
 */
export function sweepHolderFeesIx(mint, programId = DEEP_CURVE_PROGRAM_ID, rewardsProgramId = DEEP_REWARDS_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(curvePdaOf(mint, programId), true),
            meta(holderVaultPda(mint, rewardsProgramId), true),
        ],
        data: Buffer.from(discriminator("global", "sweep_holder_fees")),
    });
}
/**
 * PERMISSIONLESS, idempotent: grows a v1 / v2 Config (+ PendingConfig) to v3. Payer funds rent.
 * The new sell rate is set to the account's own protocol rate, the reward rates to 0.
 */
export function migrateConfigIx(payer, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(payer, true, true),
            meta(configPdaOf(programId), true),
            meta(pendingConfigPda(programId), true),
            meta(SystemProgram.programId),
        ],
        data: Buffer.from(discriminator("global", "migrate_config")),
    });
}
/**
 * PERMISSIONLESS, idempotent: grows a v1 / v2 BondingCurve to v3. Payer funds rent. The token
 * keeps its economics: sell rate = its protocol rate; reward model = Creator when it charges a
 * creator fee, else Standard.
 */
export function migrateCurveIx(payer, mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(payer, true, true),
            meta(mint),
            meta(curvePdaOf(mint, programId), true),
            meta(SystemProgram.programId),
        ],
        data: Buffer.from(discriminator("global", "migrate_curve")),
    });
}
// ───────────── admin transfer ─────────────
/** Two-step admin transfer, step 1 (current admin). Immediate; not timelocked. */
export function proposeAdminIx(admin, newAdmin, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(admin, false, true), meta(configPdaOf(programId), true)],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "propose_admin")),
            new W().pk(newAdmin).done(),
        ]),
    });
}
/**
 * Two-step admin transfer, step 2: must be signed by Config.pending_admin. For a
 * Squads vault this instruction goes into a multisig proposal (the vault signs on
 * execution), it cannot be sent directly.
 */
export function acceptAdminIx(pendingAdmin, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(pendingAdmin, false, true), meta(configPdaOf(programId), true)],
        data: Buffer.from(discriminator("global", "accept_admin")),
    });
}
// ───────────── fees ─────────────
export function withdrawProtocolFeesIx(admin, feeRecipient, amount, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [
            meta(admin, false, true),
            meta(configPdaOf(programId)),
            meta(treasuryPdaOf(programId), true),
            meta(feeRecipient, true),
        ],
        data: Buffer.concat([
            Buffer.from(discriminator("global", "withdraw_protocol_fees")),
            new W().u64(amount).done(),
        ]),
    });
}
export function claimCreatorFeesIx(creator, mint, programId = DEEP_CURVE_PROGRAM_ID) {
    return new TransactionInstruction({
        programId,
        keys: [meta(creator, true, true), meta(curvePdaOf(mint, programId), true)],
        data: Buffer.from(discriminator("global", "claim_creator_fees")),
    });
}
/** Every address `graduate` touches for `mint`. `poolState` is where the Raydium pool will live. */
export function graduationAccounts(mint, programId = DEEP_CURVE_PROGRAM_ID, cpSwap = DEEP_AMM_PROGRAM_ID) {
    const poolCreator = graduationPayerPda(programId);
    const poolState = graduationPoolPda(mint, programId);
    const lpMint = cpmmLpMint(cpSwap, poolState);
    const [m0, m1] = sortMints(mint, NATIVE_MINT);
    return {
        poolCreator,
        permission: deepAmmPermissionPda(poolCreator, cpSwap),
        poolState,
        lpMint,
        token0Vault: cpmmVault(cpSwap, poolState, m0),
        token1Vault: cpmmVault(cpSwap, poolState, m1),
        observation: cpmmObservation(cpSwap, poolState),
        creatorToken: getAssociatedTokenAddressSync(mint, poolCreator, true),
        creatorWsol: getAssociatedTokenAddressSync(NATIVE_MINT, poolCreator, true),
        creatorLp: getAssociatedTokenAddressSync(lpMint, poolCreator, true),
    };
}
/** `BondingCurve.reward_model` of a Holder token (`REWARD_MODEL.Holder` in @deep/curve-math). */
const REWARD_MODEL_HOLDER = 2;
/**
 * The one address a token's DeepSwap reward fees can go to (deep-curve
 * `reward_recipient_address`): the token's deep-rewards holder vault (`holderVaultPda(mint)`)
 * for a Holder token, the token's creator otherwise. `graduate` requires exactly this account
 * and records it as the pool's `pool_creator`. A Standard pool never accrues a reward; its
 * creator is recorded all the same.
 */
export function rewardRecipientAddress(a) {
    if (a.rewardModel !== 0 && a.rewardModel !== 1 && a.rewardModel !== REWARD_MODEL_HOLDER)
        throw new RangeError("rewardModel must be 0 (Standard), 1 (Creator) or 2 (Holder)");
    return a.rewardModel === REWARD_MODEL_HOLDER
        ? holderVaultPda(a.mint, a.rewardsProgramId ?? DEEP_REWARDS_PROGRAM_ID)
        : a.creator;
}
/**
 * PERMISSIONLESS `graduate`: 24 accounts, no signer. The sender of the transaction pays the
 * network fee only and receives nothing; the pool payer PDA pays the pool costs and the
 * temporary token accounts out of the migration fee, and every remainder goes to the DEEP fee
 * vault. Position of `reward_recipient`: `GRADUATE_REWARD_RECIPIENT_INDEX`.
 */
export const GRADUATE_REWARD_RECIPIENT_INDEX = 5;
export function graduateIx(a) {
    const pid = a.programId ?? DEEP_CURVE_PROGRAM_ID;
    const cp = a.cpSwapProgramId ?? DEEP_AMM_PROGRAM_ID;
    const feeReceiver = a.createPoolFeeReceiver ?? feeVaultWsolAta(pid);
    const g = graduationAccounts(a.mint, pid, cp);
    const curve = curvePdaOf(a.mint, pid);
    const rewardModel = a.rewardModel ?? 0;
    const rewardRecipient = rewardRecipientAddress({
        mint: a.mint,
        creator: a.creator,
        rewardModel,
        rewardsProgramId: a.rewardsProgramId,
    });
    return new TransactionInstruction({
        programId: pid,
        keys: [
            meta(configPdaOf(pid)),
            // The DEEP fee vault: receives everything that is not the pool's or the holders'.
            meta(feeVaultPda(pid), true),
            meta(a.mint, true),
            meta(curve, true),
            meta(getAssociatedTokenAddressSync(a.mint, curve, true), true),
            // reward_recipient (formerly token_creator): recorded as the pool's creator. Writable
            // only for a Holder token, so graduate can sweep the curve's holder fees to the vault
            // (read-only, that sweep is skipped); a creator receives nothing here.
            meta(rewardRecipient, rewardModel === REWARD_MODEL_HOLDER),
            meta(g.poolCreator, true),
            meta(g.creatorToken, true),
            meta(NATIVE_MINT),
            meta(g.creatorWsol, true),
            meta(g.creatorLp, true),
            meta(g.poolState, true),
            meta(a.ammConfig),
            meta(g.permission),
            meta(cpmmAuthority(cp)),
            meta(g.lpMint, true),
            meta(g.token0Vault, true),
            meta(g.token1Vault, true),
            meta(feeReceiver, true),
            meta(g.observation, true),
            meta(cp),
            meta(TOKEN_PROGRAM_ID),
            meta(ASSOCIATED_TOKEN_PROGRAM_ID),
            meta(SystemProgram.programId),
        ],
        data: Buffer.from(discriminator("global", "graduate")),
    });
}
/** graduate plus the compute budget it needs. */
export function graduateIxs(a) {
    return [
        ComputeBudgetProgram.setComputeUnitLimit({ units: GRADUATE_COMPUTE_UNITS }),
        graduateIx(a),
    ];
}
//# sourceMappingURL=lifecycle.js.map