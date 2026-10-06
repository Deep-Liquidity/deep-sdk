/**
 * DeepSwap AMM (programs/deep-amm) admin helpers. Pool-level reads, quotes and swaps
 * live in raydium-cpmm.ts: deep-amm keeps cp-swap's layouts, so those helpers work
 * here by passing DEEP_AMM_PROGRAM_ID.
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { CPMM_FEE_DENOMINATOR, cpmmAuthority, DEEP_AMM_PROGRAM_ID, } from "./raydium-cpmm.js";
/**
 * DEEP's DeepSwap fee policy (CLAUDE.md): a 0.30% pool trade fee with 1/3 of it to the
 * DEEP treasury, plus, on pools created by graduation, a 0.30% creator fee of which half
 * goes to the token's creator and half to DEEP. Rates are in millionths
 * (CPMM_FEE_DENOMINATOR). `protocolFeeRate` is a share OF the trade fee, so 333_333 / 1e6
 * of 0.30% is ~0.10% of volume; `creatorFeeShareRate` is the share OF the creator fee the
 * protocol keeps. These are the policy targets: the live values are whatever the AmmConfig
 * holds (the deep-amm admin changes them with `update_amm_config`), so read the chain.
 */
export const DEEP_AMM_FEES = {
    tradeFeeRate: 3000n,
    protocolFeeRate: 333333n,
    fundFeeRate: 0n,
    creatorFeeRate: 3000n,
    creatorFeeShareRate: 500000n,
};
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
/** update_amm_config `param` codes (programs/deep-amm/src/instructions/admin/update_config.rs). */
export const DEEP_AMM_CONFIG_PARAM = {
    tradeFeeRate: 0,
    protocolFeeRate: 1,
    fundFeeRate: 2,
    createPoolFee: 5,
    disableCreatePool: 6,
    /** Add-on to the trade fee on pools with the creator fee enabled; trade + creator < 1e6. */
    creatorFeeRate: 7,
    /** Share of the creator fee the protocol keeps; 0..=1e6. */
    creatorFeeShareRate: 8,
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
 * the pool's `AmmConfig.protocol_owner` or the build-time admin (on mainnet: the Squads
 * vault, so a server key cannot send it there: KNOWN_ISSUES DA-3). The program pays out
 * min(requested, accrued) per side, so the default (u64::MAX) collects everything.
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