/**
 * deep-rewards: DEEP Holder Rewards (programs/deep-rewards; docs/V1_FEES.md section 4).
 *
 * One Distributor per (token mint, reward asset). The reward asset is the pool's paired asset:
 * native SOL (reward mint = the WSOL mint) or an SPL / Token-2022 quote mint. Funds sit under
 * the system-owned PDA ["holder_vault", mint] (lamports for SOL, its ATAs for tokens). Holders
 * claim `cumulative − claimed` with a proof against the active root; in AUTO-SEND mode a
 * permissionless crank may push once the unclaimed amount is worth at least the threshold.
 *
 * Account order mirrors the `#[derive(Accounts)]` structs in programs/deep-rewards/src/lib.rs
 * (pinned by test/rewards.test.ts against idl/deep_rewards.json).
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction, } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { PYTH_SOL_USD_PRICE_UPDATE } from "./pyth.js";
/** deep-rewards program id (devnet/localnet keypair; not deployed until the rollout runs). */
export const DEEP_REWARDS_PROGRAM_ID = new PublicKey("4z2KpxUcdNFXFpzxKtcmTv6aDMqE4CMLCdbYExLYeDE2");
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const REWARDS_PAYOUT_MODE = { claim: 0, autoSend: 1 };
export const DEFAULT_PUSH_MIN_USD_MICROS = 20000000n;
export const DEFAULT_MIN_HOLDING_USD_MICROS = 10000000n;
export const MAX_STABLE_MINTS = 4;
/**
 * On-chain lower bound for the root delay (every cluster): roots and settings changes wait at
 * least 12 h (was 1 h), long enough for a person holding the guardian key to see a bad root
 * and veto it.
 */
export const MIN_ROOT_DELAY_SECONDS = 12 * 3600;
/** The root delay mainnet starts with: 24 h. */
export const MAINNET_ROOT_DELAY_SECONDS = 24 * 3600;
/** RewardsError codes (append-only in the program). */
export const REWARDS_ERRORS = {
    Unauthorized: 6000,
    InvalidParams: 6001,
    Paused: 6002,
    InvalidMint: 6003,
    UnsupportedRewardMint: 6004,
    NotSolDistributor: 6005,
    NotTokenDistributor: 6006,
    InvalidVault: 6007,
    NoRoot: 6008,
    ProofTooLong: 6009,
    InvalidProof: 6010,
    NothingToClaim: 6011,
    ExceedsMaxTotal: 6012,
    RootNotMonotonic: 6013,
    RootUnfunded: 6014,
    StaleSnapshot: 6015,
    NoPendingRoot: 6016,
    RootNotReady: 6017,
    PushDisabled: 6018,
    BelowPushThreshold: 6019,
    PushUnsupportedAsset: 6020,
    RecipientNotEligible: 6021,
    RecipientFrozen: 6022,
    PriceInvalid: 6023,
    Overflow: 6024,
    ZeroAmount: 6025,
    InvalidClaimStatus: 6026,
    VaultShort: 6027,
    ConfigUpdatePending: 6028,
    NoPendingConfigUpdate: 6029,
    ConfigUpdateNotReady: 6030,
    ConfigUpdateExpired: 6031,
    NotStray: 6032,
    /** PendingRewardsConfig is still in the pre-guardian layout: send `rewardsMigrateConfigIx` first. */
    ConfigNotMigrated: 6033,
};
// ───────────── PDAs ─────────────
const enc = new TextEncoder();
export function rewardsConfigPda(programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("rewards_config")], programId)[0];
}
/** The queued settings change (queue_config_update → apply_config_update after the delay). */
export function pendingRewardsConfigPda(programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("pending_rewards_config")], programId)[0];
}
/**
 * The per-token holder vault: a system-owned, data-less PDA. SOL rewards are its lamports;
 * token rewards sit in its ATAs. THIS is the deposit address for Phase 2–3 (see V1_FEES.md 4.5).
 */
export function holderVaultPda(mint, programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("holder_vault"), mint.toBytes()], programId)[0];
}
/** ATA(rewardMint, holder vault): the token vault (for SOL, the WSOL ATA that gets unwrapped). */
export function holderVaultTokenAccount(mint, rewardMint, rewardTokenProgram = TOKEN_PROGRAM_ID, programId = DEEP_REWARDS_PROGRAM_ID) {
    return getAssociatedTokenAddressSync(rewardMint, holderVaultPda(mint, programId), true, rewardTokenProgram);
}
export function distributorPda(mint, rewardMint, programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("distributor"), mint.toBytes(), rewardMint.toBytes()], programId)[0];
}
export function claimStatusPda(distributor, claimant, programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("claim"), distributor.toBytes(), claimant.toBytes()], programId)[0];
}
export function rewardsWsolUnwrapPda(distributor, programId = DEEP_REWARDS_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([enc.encode("wsol_unwrap"), distributor.toBytes()], programId)[0];
}
export const isSolReward = (rewardMint) => rewardMint.equals(NATIVE_MINT);
// ───────────── borsh ─────────────
class W {
    parts = [];
    bytes(b) {
        this.parts.push(b);
        return this;
    }
    u8(v) {
        if (!Number.isInteger(v) || v < 0 || v > 255)
            throw new RangeError("u8 out of range");
        return this.bytes(Uint8Array.of(v));
    }
    bool(v) {
        return this.u8(v ? 1 : 0);
    }
    u32(v) {
        if (!Number.isInteger(v) || v < 0 || v > 0xffffffff)
            throw new RangeError("u32 out of range");
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v, true);
        return this.bytes(b);
    }
    u64(v) {
        if (v < 0n || v >= 1n << 64n)
            throw new RangeError("u64 out of range");
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigUint64(0, v, true);
        return this.bytes(b);
    }
    key(k) {
        return this.bytes(k.toBytes());
    }
    hash32(h) {
        if (h.length !== 32)
            throw new RangeError("expected 32 bytes");
        return this.bytes(h);
    }
    done() {
        return Buffer.concat(this.parts.map((p) => Buffer.from(p)));
    }
}
const ix = (name) => new W().bytes(discriminator("global", name));
const m = (pubkey, isSigner, isWritable) => ({
    pubkey,
    isSigner,
    isWritable,
});
const make = (keys, data, programId) => new TransactionInstruction({ programId, keys, data });
/**
 * Defaults: CLAIM mode, 12 h root delay (the on-chain minimum, every cluster), $20 push, $10
 * minimum, Pyth age 600 s (devnet; use 120 on mainnet). `strayRecipient` and `guardian` have
 * no default: on a test cluster pass the admin for both.
 */
export function defaultRewardsConfigParams(rootAuthority, strayRecipient, guardian, stableMints = []) {
    return {
        rootAuthority,
        strayRecipient,
        guardian,
        payoutMode: REWARDS_PAYOUT_MODE.claim,
        rootDelaySeconds: MIN_ROOT_DELAY_SECONDS,
        maxProofLen: 24,
        pushMinUsdMicros: DEFAULT_PUSH_MIN_USD_MICROS,
        minHoldingUsdMicros: DEFAULT_MIN_HOLDING_USD_MICROS,
        maxPriceAgeSeconds: 600,
        solUsdPriceUpdate: PYTH_SOL_USD_PRICE_UPDATE,
        stableMints,
    };
}
function writeParams(w, p) {
    if (p.stableMints.length > MAX_STABLE_MINTS)
        throw new RangeError("too many stable mints");
    w.key(p.rootAuthority)
        .u8(p.payoutMode)
        .u32(p.rootDelaySeconds)
        .u8(p.maxProofLen)
        .u64(p.pushMinUsdMicros)
        .u64(p.minHoldingUsdMicros)
        .u32(p.maxPriceAgeSeconds)
        .key(p.solUsdPriceUpdate)
        .u32(p.stableMints.length);
    for (const s of p.stableMints)
        w.key(s);
    return w.key(p.strayRecipient).key(p.guardian);
}
export function rewardsInitializeIx(admin, params, programId = DEEP_REWARDS_PROGRAM_ID) {
    const programData = PublicKey.findProgramAddressSync([programId.toBytes()], BPF_LOADER_UPGRADEABLE)[0];
    return make([
        m(admin, true, true),
        m(rewardsConfigPda(programId), false, true),
        m(pendingRewardsConfigPda(programId), false, true),
        m(programId, false, false),
        m(programData, false, false),
        m(SystemProgram.programId, false, false),
    ], writeParams(ix("initialize"), params).done(), programId);
}
const adminKeys = (admin, programId) => [
    m(admin, true, false),
    m(rewardsConfigPda(programId), false, true),
];
/** The current settings as params (to queue a change of one field). */
export function rewardsParamsFromConfig(c) {
    return {
        rootAuthority: c.rootAuthority,
        payoutMode: c.payoutMode,
        rootDelaySeconds: c.rootDelaySeconds,
        maxProofLen: c.maxProofLen,
        pushMinUsdMicros: c.pushMinUsdMicros,
        minHoldingUsdMicros: c.minHoldingUsdMicros,
        maxPriceAgeSeconds: c.maxPriceAgeSeconds,
        solUsdPriceUpdate: c.solUsdPriceUpdate,
        stableMints: c.stableMints,
        strayRecipient: c.strayRecipient,
        guardian: c.guardian,
    };
}
/**
 * Admin, step 1 of every settings change (root authority, payout mode, delay, thresholds,
 * stablecoins, stray recipient). Applicable by anyone after `config.rootDelaySeconds`.
 */
export function rewardsQueueConfigUpdateIx(admin, params, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([
        m(admin, true, false),
        m(rewardsConfigPda(programId), false, false),
        m(pendingRewardsConfigPda(programId), false, true),
    ], writeParams(ix("queue_config_update"), params).done(), programId);
}
/** Admin: queue a payout-mode change (CLAIM / AUTO-SEND), keeping every other setting. */
export function rewardsQueuePayoutModeIx(admin, current, mode, programId = DEEP_REWARDS_PROGRAM_ID) {
    return rewardsQueueConfigUpdateIx(admin, { ...rewardsParamsFromConfig(current), payoutMode: REWARDS_PAYOUT_MODE[mode] }, programId);
}
/** Permissionless, after the queued change's eta. */
export function rewardsApplyConfigUpdateIx(programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([
        m(rewardsConfigPda(programId), false, true),
        m(pendingRewardsConfigPda(programId), false, true),
    ], ix("apply_config_update").done(), programId);
}
export function rewardsCancelConfigUpdateIx(admin, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([
        m(admin, true, false),
        m(rewardsConfigPda(programId), false, false),
        m(pendingRewardsConfigPda(programId), false, true),
    ], ix("cancel_config_update").done(), programId);
}
/**
 * Permissionless: moves a NON-reward token held by the holder vault (e.g. the rewarded token
 * itself) to the stray recipient's ATA and closes the emptied vault account (rent to the stray
 * recipient). The program refuses SOL/WSOL, configured stablecoins and any mint with a
 * distributor for `mint`.
 */
export function rewardsRecoverStrayIx(cranker, mint, strayMint, strayRecipient, opts = {}) {
    const programId = opts.programId ?? DEEP_REWARDS_PROGRAM_ID;
    const tokenProgram = opts.tokenProgram ?? TOKEN_PROGRAM_ID;
    const holderVault = holderVaultPda(mint, programId);
    return make([
        m(cranker, true, true),
        m(rewardsConfigPda(programId), false, false),
        m(mint, false, false),
        m(holderVault, false, false),
        m(distributorPda(mint, strayMint, programId), false, false),
        m(strayMint, false, false),
        m(opts.vaultToken ??
            getAssociatedTokenAddressSync(strayMint, holderVault, true, tokenProgram), false, true),
        m(strayRecipient, false, true),
        m(getAssociatedTokenAddressSync(strayMint, strayRecipient, true, tokenProgram), false, true),
        m(tokenProgram, false, false),
        m(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
        m(SystemProgram.programId, false, false),
    ], ix("recover_stray").done(), programId);
}
/**
 * `set_paused`: signed by the admin OR the guardian (`RewardsConfig.guardian`). Pauses (or
 * resumes) root publication and pushes; claims are never paused.
 */
export function rewardsSetPausedIx(authority, paused, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make(adminKeys(authority, programId), ix("set_paused").bool(paused).done(), programId);
}
/**
 * PERMISSIONLESS, idempotent `migrate_config`: brings a deep-rewards deployed before the
 * guardian existed (devnet) to the current rules. Grows PendingRewardsConfig from 280 to 312
 * bytes (`payer` funds the rent difference) and raises a root delay below the 12 h minimum to
 * it. It sets no guardian: the admin does that with a normal settings change, and a change
 * that was queued before the upgrade has to be cancelled and queued again.
 */
export function rewardsMigrateConfigIx(payer, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([
        m(payer, true, true),
        m(rewardsConfigPda(programId), false, true),
        m(pendingRewardsConfigPda(programId), false, true),
        m(SystemProgram.programId, false, false),
    ], ix("migrate_config").done(), programId);
}
export function rewardsProposeAdminIx(admin, newAdmin, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make(adminKeys(admin, programId), ix("propose_admin").key(newAdmin).done(), programId);
}
export function rewardsAcceptAdminIx(newAdmin, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([m(newAdmin, true, false), m(rewardsConfigPda(programId), false, true)], ix("accept_admin").done(), programId);
}
function refs(d, programId) {
    const rewardTokenProgram = d.rewardTokenProgram ?? TOKEN_PROGRAM_ID;
    const holderVault = holderVaultPda(d.mint, programId);
    return {
        rewardTokenProgram,
        holderVault,
        distributor: distributorPda(d.mint, d.rewardMint, programId),
        tokenVault: getAssociatedTokenAddressSync(d.rewardMint, holderVault, true, rewardTokenProgram),
    };
}
/** Admin or root authority. */
export function rewardsInitDistributorIx(authority, d, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    return make([
        m(authority, true, true),
        m(rewardsConfigPda(programId), false, false),
        m(d.mint, false, false),
        m(d.rewardMint, false, false),
        m(r.holderVault, false, true),
        m(r.distributor, false, true),
        m(r.tokenVault, false, true),
        m(r.rewardTokenProgram, false, false),
        m(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
        m(SystemProgram.programId, false, false),
    ], ix("init_distributor").done(), programId);
}
export function rewardsDepositSolIx(depositor, mint, amount, programId = DEEP_REWARDS_PROGRAM_ID) {
    return make([
        m(depositor, true, true),
        m(distributorPda(mint, NATIVE_MINT, programId), false, false),
        m(holderVaultPda(mint, programId), false, true),
        m(SystemProgram.programId, false, false),
    ], ix("deposit_sol").u64(amount).done(), programId);
}
export function rewardsDepositTokenIx(depositor, depositorToken, d, amount, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    return make([
        m(depositor, true, false),
        m(r.distributor, false, false),
        m(d.rewardMint, false, false),
        m(depositorToken, false, true),
        m(r.tokenVault, false, true),
        m(r.rewardTokenProgram, false, false),
    ], ix("deposit_token").u64(amount).done(), programId);
}
/** Permissionless: WSOL in the holder vault's ATA → vault lamports (payer refunded). */
export function rewardsUnwrapWsolIx(payer, mint, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs({ mint, rewardMint: NATIVE_MINT }, programId);
    return make([
        m(payer, true, true),
        m(r.distributor, false, false),
        m(r.holderVault, false, true),
        m(r.tokenVault, false, true),
        m(rewardsWsolUnwrapPda(r.distributor, programId), false, true),
        m(NATIVE_MINT, false, false),
        m(TOKEN_PROGRAM_ID, false, false),
        m(SystemProgram.programId, false, false),
    ], ix("unwrap_wsol").done(), programId);
}
export function rewardsProposeRootIx(rootAuthority, d, a, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    return make([
        m(rootAuthority, true, false),
        m(rewardsConfigPda(programId), false, false),
        m(r.distributor, false, true),
        m(r.holderVault, false, false),
        m(r.tokenVault, false, false),
    ], ix("propose_root")
        .hash32(a.root)
        .u64(a.maxTotalClaim)
        .u64(a.snapshotSlot)
        .hash32(a.dataHash)
        .done(), programId);
}
export function rewardsActivateRootIx(d, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    return make([m(r.distributor, false, true), m(r.holderVault, false, false), m(r.tokenVault, false, false)], ix("activate_root").done(), programId);
}
/**
 * `veto_root`: signed by the admin OR the guardian (`RewardsConfig.guardian`). Discards the
 * pending root; moves no funds, the active root stays.
 */
export function rewardsVetoRootIx(authority, d, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    return make([
        m(authority, true, false),
        m(rewardsConfigPda(programId), false, false),
        m(r.distributor, false, true),
    ], ix("veto_root").done(), programId);
}
function claimData(name, cumulative, proof) {
    const w = ix(name).u64(cumulative).u32(proof.length);
    for (const p of proof)
        w.hash32(p);
    return w.done();
}
/**
 * The claimant's own claim (signer = claimant). For a token reward, `claimantToken` defaults
 * to the claimant's ATA; prepend `createAssociatedTokenAccountIdempotentInstruction` if it may
 * not exist (see `rewardsClaimIxs`).
 */
export function rewardsClaimIx(claimant, d, cumulative, proof, claimantToken, programId = DEEP_REWARDS_PROGRAM_ID) {
    const r = refs(d, programId);
    const status = claimStatusPda(r.distributor, claimant, programId);
    if (isSolReward(d.rewardMint)) {
        return make([
            m(claimant, true, true),
            m(rewardsConfigPda(programId), false, false),
            m(r.distributor, false, true),
            m(r.holderVault, false, true),
            m(status, false, true),
            m(SystemProgram.programId, false, false),
        ], claimData("claim_sol", cumulative, proof), programId);
    }
    const to = claimantToken ??
        getAssociatedTokenAddressSync(d.rewardMint, claimant, true, r.rewardTokenProgram);
    return make([
        m(claimant, true, true),
        m(rewardsConfigPda(programId), false, false),
        m(r.distributor, false, true),
        m(r.holderVault, false, false),
        m(d.rewardMint, false, false),
        m(r.tokenVault, false, true),
        m(to, false, true),
        m(status, false, true),
        m(r.rewardTokenProgram, false, false),
        m(SystemProgram.programId, false, false),
    ], claimData("claim_token", cumulative, proof), programId);
}
/** AUTO-SEND crank (payout mode AUTO-SEND only; permissionless). */
export function rewardsPushIx(cranker, claimant, d, cumulative, proof, opts = {}) {
    const programId = opts.programId ?? DEEP_REWARDS_PROGRAM_ID;
    const r = refs(d, programId);
    const status = claimStatusPda(r.distributor, claimant, programId);
    if (isSolReward(d.rewardMint)) {
        return make([
            m(cranker, true, true),
            m(rewardsConfigPda(programId), false, false),
            m(r.distributor, false, true),
            m(r.holderVault, false, true),
            m(claimant, false, true),
            m(status, false, true),
            m(opts.priceUpdate ?? PYTH_SOL_USD_PRICE_UPDATE, false, false),
            m(SystemProgram.programId, false, false),
        ], claimData("push_sol", cumulative, proof), programId);
    }
    return make([
        m(cranker, true, true),
        m(rewardsConfigPda(programId), false, false),
        m(r.distributor, false, true),
        m(r.holderVault, false, false),
        m(d.rewardMint, false, false),
        m(r.tokenVault, false, true),
        m(claimant, false, false),
        m(getAssociatedTokenAddressSync(d.rewardMint, claimant, true, r.rewardTokenProgram), false, true),
        m(status, false, true),
        m(r.rewardTokenProgram, false, false),
        m(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
        m(SystemProgram.programId, false, false),
    ], claimData("push_token", cumulative, proof), programId);
}
// ───────────── decoders ─────────────
export const REWARDS_CONFIG_SIZE = 390;
/** PendingRewardsConfig since the guardian was added to its params. */
export const PENDING_REWARDS_CONFIG_SIZE = 312;
/** PendingRewardsConfig before that (devnet until `migrate_config` runs). */
export const PENDING_REWARDS_CONFIG_V1_SIZE = 280;
export const DISTRIBUTOR_SIZE = 465;
export const CLAIM_STATUS_SIZE = 122;
class R {
    d;
    o = 8;
    constructor(d) {
        this.d = d;
    }
    v() {
        return new DataView(this.d.buffer, this.d.byteOffset, this.d.byteLength);
    }
    u8() {
        return this.d[this.o++];
    }
    bool() {
        return this.u8() !== 0;
    }
    u32() {
        const x = this.v().getUint32(this.o, true);
        this.o += 4;
        return x;
    }
    u64() {
        const x = this.v().getBigUint64(this.o, true);
        this.o += 8;
        return x;
    }
    i64() {
        const x = this.v().getBigInt64(this.o, true);
        this.o += 8;
        return x;
    }
    key() {
        const k = new PublicKey(this.d.slice(this.o, this.o + 32));
        this.o += 32;
        return k;
    }
    h32() {
        const h = this.d.slice(this.o, this.o + 32);
        this.o += 32;
        return h;
    }
}
function checkDisc(data, name, size) {
    const disc = discriminator("account", name);
    if (data.length < size || !disc.every((b, i) => data[i] === b))
        throw new Error(`not a ${name} account`);
}
/** True when a RewardsConfig has a guardian (a non-zero key). */
export const rewardsHasGuardian = (c) => !c.guardian.equals(PublicKey.default);
export function decodeRewardsConfig(data) {
    checkDisc(data, "RewardsConfig", REWARDS_CONFIG_SIZE);
    const r = new R(data);
    const c = {
        version: r.u8(),
        bump: r.u8(),
        admin: r.key(),
        pendingAdmin: r.key(),
        rootAuthority: r.key(),
        payoutMode: r.u8(),
        paused: r.bool(),
        rootDelaySeconds: r.u32(),
        maxProofLen: r.u8(),
        pushMinUsdMicros: r.u64(),
        minHoldingUsdMicros: r.u64(),
        maxPriceAgeSeconds: r.u32(),
        solUsdPriceUpdate: r.key(),
    };
    const count = Math.min(r.u8(), MAX_STABLE_MINTS);
    const all = Array.from({ length: MAX_STABLE_MINTS }, () => r.key());
    // the guardian took the first 32 of the 64 reserved bytes: same account size
    return { ...c, stableMints: all.slice(0, count), strayRecipient: r.key(), guardian: r.key() };
}
/**
 * Decodes a PendingRewardsConfig in the current layout (312 bytes) or the one before the
 * guardian (280 bytes, devnet until `migrate_config`): there `params.guardian` is the zero key.
 */
export function decodePendingRewardsConfig(data) {
    checkDisc(data, "PendingRewardsConfig", PENDING_REWARDS_CONFIG_V1_SIZE);
    const v1 = data.length < PENDING_REWARDS_CONFIG_SIZE;
    const r = new R(data);
    const head = { bump: r.u8(), active: r.bool(), eta: r.i64(), queuedAt: r.i64() };
    const p = {
        rootAuthority: r.key(),
        payoutMode: r.u8(),
        rootDelaySeconds: r.u32(),
        maxProofLen: r.u8(),
        pushMinUsdMicros: r.u64(),
        minHoldingUsdMicros: r.u64(),
        maxPriceAgeSeconds: r.u32(),
        solUsdPriceUpdate: r.key(),
    };
    const n = r.u32();
    if (n > MAX_STABLE_MINTS)
        throw new Error("bad PendingRewardsConfig");
    const stableMints = Array.from({ length: n }, () => r.key());
    const strayRecipient = r.key();
    const guardian = v1 ? PublicKey.default : r.key();
    return { ...head, params: { ...p, stableMints, strayRecipient, guardian } };
}
export function decodeDistributor(data) {
    checkDisc(data, "Distributor", DISTRIBUTOR_SIZE);
    const r = new R(data);
    return {
        version: r.u8(),
        bump: r.u8(),
        vaultBump: r.u8(),
        mint: r.key(),
        rewardMint: r.key(),
        rewardTokenProgram: r.key(),
        rewardDecimals: r.u8(),
        holderVault: r.key(),
        tokenVault: r.key(),
        vaultReserve: r.u64(),
        round: r.u32(),
        root: r.h32(),
        maxTotalClaim: r.u64(),
        totalClaimed: r.u64(),
        snapshotSlot: r.u64(),
        dataHash: r.h32(),
        activatedAt: r.i64(),
        hasPending: r.bool(),
        pendingRoot: r.h32(),
        pendingMaxTotalClaim: r.u64(),
        pendingSnapshotSlot: r.u64(),
        pendingDataHash: r.h32(),
        pendingEta: r.i64(),
        createdBy: r.key(),
    };
}
export function decodeClaimStatus(data) {
    checkDisc(data, "ClaimStatus", CLAIM_STATUS_SIZE);
    const r = new R(data);
    return {
        version: r.u8(),
        bump: r.u8(),
        distributor: r.key(),
        claimant: r.key(),
        payer: r.key(),
        claimed: r.u64(),
        lastClaimAt: r.i64(),
    };
}
/**
 * What the vault can still pay (SOL: lamports above the reserve; token: the ATA balance) and
 * the part no root has allocated yet (new deposits + carried rounding dust).
 */
export function distributorFunds(d, vaultLamports, tokenVaultAmount) {
    const available = isSolReward(d.rewardMint)
        ? vaultLamports > d.vaultReserve
            ? vaultLamports - d.vaultReserve
            : 0n
        : tokenVaultAmount;
    const outstanding = d.maxTotalClaim - d.totalClaimed;
    const unallocated = available > outstanding ? available - outstanding : 0n;
    return { available, outstanding, unallocated };
}
/**
 * Pro-rata: floor(pool · w / Σw) per wallet; the remainder is carried forward (it remains in
 * the vault and is part of the next round's pool). Previous cumulatives never decrease.
 */
export function allocateRewardRound(input) {
    if (input.pool < 0n)
        throw new RangeError("negative pool");
    let total = 0n;
    for (const [w, v] of input.weights) {
        if (v < 0n)
            throw new RangeError(`negative weight for ${w}`);
        total += v;
    }
    const cumulative = new Map(input.previous);
    const allocated = new Map();
    let allocatedTotal = 0n;
    if (total > 0n && input.pool > 0n) {
        for (const [w, v] of input.weights) {
            const a = (input.pool * v) / total;
            if (a === 0n)
                continue;
            allocated.set(w, a);
            allocatedTotal += a;
            cumulative.set(w, (cumulative.get(w) ?? 0n) + a);
        }
    }
    return { cumulative, allocated, allocatedTotal, dust: input.pool - allocatedTotal };
}
/** USD micro-dollars of `lamports` at a Pyth price (price · 10^expo USD/SOL), floored. */
export function lamportsUsdMicros(lamports, price, exponent) {
    if (price <= 0n)
        throw new RangeError("price must be > 0");
    const pow = 10n ** BigInt(Math.abs(exponent));
    return exponent <= 0 ? (lamports * price) / (pow * 1000n) : (lamports * price * pow) / 1000n;
}
/** USD micro-dollars of `amount` of a USD stablecoin at face value, floored. */
export function stableUsdMicros(amount, decimals) {
    return (amount * 1000000n) / 10n ** BigInt(decimals);
}
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/**
 * Aggregates balances per owner and drops owners who cannot claim or hold too little. Their
 * share is not set aside: weights only contain real holders, so the whole pool goes to them.
 */
export function eligibleWeights(holdings, opts) {
    const onCurve = opts.isOnCurve ?? ((o) => PublicKey.isOnCurve(new PublicKey(o)));
    const byOwner = new Map();
    for (const h of holdings) {
        if (h.amount <= 0n)
            continue;
        byOwner.set(h.owner, (byOwner.get(h.owner) ?? 0n) + h.amount);
    }
    const weights = new Map();
    const excluded = new Map();
    for (const [owner, amount] of byOwner) {
        const prog = opts.ownerPrograms?.get(owner);
        if (opts.excludedOwners.has(owner))
            excluded.set(owner, "excluded");
        else if (prog && prog !== SYSTEM_PROGRAM && !opts.allowOffCurve.has(owner))
            excluded.set(owner, "program_owned");
        else if (!onCurve(owner) && !opts.allowOffCurve.has(owner))
            excluded.set(owner, "off_curve");
        else if (amount < opts.minAmount)
            excluded.set(owner, "below_minimum");
        else
            weights.set(owner, amount);
    }
    return { weights, excluded };
}
/** A queued settings change must be applied within this window after its eta (program constant). */
export const REWARDS_CONFIG_UPDATE_GRACE_SECONDS = 14 * 24 * 3600;
//# sourceMappingURL=rewards.js.map