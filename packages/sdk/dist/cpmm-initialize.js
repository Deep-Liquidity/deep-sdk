/**
 * DeepSwap permissionless pool creation: the `initialize` instruction of programs/deep-amm
 * (instructions/initialize.rs), plus the amounts it derives. Anyone can create a pool for any
 * two mints the program supports (see cpmm-token2022.ts `cpmmMintSupported`).
 */
import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { cpmmAuthority, cpmmLpMint, cpmmObservation, cpmmPoolPda, cpmmVault, DEEP_AMM_PROGRAM_ID, sortMints, } from "./raydium-cpmm.js";
export * from "./cpmm-token2022.js";
/** LP units the program keeps out of the creator's hands at pool creation (`lock_lp_amount`). */
export const CPMM_LOCKED_LP = 100n;
/** Compute unit limit that covers `initialize` (two vaults, LP mint, ATA, observation). */
export const CPMM_INITIALIZE_COMPUTE_UNITS = 400_000;
const U64_MAX = (1n << 64n) - 1n;
/** Floor of the square root, as the program's `U128::integer_sqrt`. */
export function isqrt(n) {
    if (n < 0n)
        throw new RangeError("negative");
    if (n < 2n)
        return n;
    let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
    for (;;) {
        const y = (x + n / x) >> 1n;
        if (y >= x)
            return x;
        x = y;
    }
}
/**
 * LP minted at pool creation from the amounts that ARRIVE in the vaults (after any Token-2022
 * transfer fee): `liquidity = floor(sqrt(vault0 × vault1))`, of which the creator receives
 * `liquidity − 100`. Throws where the program rejects (empty side, or liquidity under 100).
 */
export function cpmmInitialLiquidity(vault0, vault1) {
    if (vault0 <= 0n || vault1 <= 0n)
        throw new RangeError("both sides need a non-zero amount");
    const liquidity = isqrt(vault0 * vault1);
    if (liquidity < CPMM_LOCKED_LP)
        throw new RangeError("amounts too small: the first 100 LP units are locked");
    return { liquidity, creatorLp: liquidity - CPMM_LOCKED_LP };
}
/** Addresses `initialize` creates for a pair under an AmmConfig. */
export function cpmmInitializeAccounts(a) {
    const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
    if (a.mintA.equals(a.mintB))
        throw new Error("a pool needs two different mints");
    const [token0Mint, token1Mint] = sortMints(a.mintA, a.mintB);
    const poolState = cpmmPoolPda(programId, a.ammConfig, token0Mint, token1Mint);
    const lpMint = cpmmLpMint(programId, poolState);
    return {
        token0Mint,
        token1Mint,
        aIsToken0: token0Mint.equals(a.mintA),
        poolState,
        lpMint,
        // LP mints are created under the legacy token program.
        creatorLpToken: getAssociatedTokenAddressSync(lpMint, a.creator, true),
        token0Vault: cpmmVault(programId, poolState, token0Mint),
        token1Vault: cpmmVault(programId, poolState, token1Mint),
        observation: cpmmObservation(programId, poolState),
    };
}
/** `initialize(init_amount_0, init_amount_1, open_time)` */
export function cpmmInitializeIx(a) {
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
    const acc = cpmmInitializeAccounts(a);
    const [amount0, amount1] = acc.aIsToken0 ? [a.amountA, a.amountB] : [a.amountB, a.amountA];
    const [program0, program1] = acc.aIsToken0
        ? [a.tokenProgramA, a.tokenProgramB]
        : [a.tokenProgramB, a.tokenProgramA];
    const ata = (mint, program) => getAssociatedTokenAddressSync(mint, a.creator, true, program);
    const creatorA = a.creatorTokenA ?? ata(a.mintA, a.tokenProgramA);
    const creatorB = a.creatorTokenB ?? ata(a.mintB, a.tokenProgramB);
    const [creator0, creator1] = acc.aIsToken0 ? [creatorA, creatorB] : [creatorB, creatorA];
    const data = Buffer.alloc(8 + 24);
    data.set(discriminator("global", "initialize"), 0);
    data.writeBigUInt64LE(amount0, 8);
    data.writeBigUInt64LE(amount1, 16);
    data.writeBigUInt64LE(openTime, 24);
    const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
    const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: a.creator, isSigner: true, isWritable: true },
            ro(a.ammConfig),
            ro(cpmmAuthority(programId)),
            rw(acc.poolState),
            ro(acc.token0Mint),
            ro(acc.token1Mint),
            rw(acc.lpMint),
            rw(creator0),
            rw(creator1),
            rw(acc.creatorLpToken),
            rw(acc.token0Vault),
            rw(acc.token1Vault),
            rw(a.createPoolFeeReceiver),
            rw(acc.observation),
            ro(TOKEN_PROGRAM_ID),
            ro(program0),
            ro(program1),
            ro(ASSOCIATED_TOKEN_PROGRAM_ID),
            ro(SystemProgram.programId),
            ro(SYSVAR_RENT_PUBKEY),
            ...(a.supportMints ?? []).map(ro),
        ],
        data,
    });
}
//# sourceMappingURL=cpmm-initialize.js.map