/**
 * cp-swap / DeepSwap liquidity: deposit and withdraw instruction builders and the program's
 * LP ⇄ token math (programs/deep-amm/src/curve/constant_product.rs
 * `lp_tokens_to_trading_tokens`, instructions/deposit.rs, instructions/withdraw.rs).
 * Integer math only; rounding matches the program (deposit rounds UP, withdraw rounds DOWN).
 */
import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { cpmmAuthority } from "./raydium-cpmm.js";
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/**
 * Tokens that `lpAmount` LP units are worth. `reserve0/1` are the vault balances net of
 * accrued fees (cpmmReserves) and `lpSupply` is the pool account's `lp_supply`.
 * roundUp = true is what a deposit pays; false is what a withdrawal receives.
 */
export function cpmmLpToTokens(lpAmount, lpSupply, reserve0, reserve1, roundUp) {
    if (lpSupply <= 0n)
        throw new RangeError("pool has no LP supply");
    if (lpAmount < 0n)
        throw new RangeError("negative LP amount");
    const part = (reserve) => {
        const q = (lpAmount * reserve) / lpSupply;
        // The program only rounds up a non-zero quotient (a zero amount is rejected later).
        return roundUp && q > 0n && (lpAmount * reserve) % lpSupply > 0n ? q + 1n : q;
    };
    return { token0: part(reserve0), token1: part(reserve1) };
}
/** The most LP a deposit of at most `maxAmount` of one side can mint (rounded down). */
export function cpmmLpForTokenAmount(maxAmount, reserve, lpSupply) {
    if (reserve <= 0n)
        throw new RangeError("pool side has no reserves");
    let lp = (maxAmount * lpSupply) / reserve;
    // Deposits round the token amount up, so step down until it fits.
    while (lp > 0n) {
        const q = (lp * reserve) / lpSupply;
        const need = (lp * reserve) % lpSupply > 0n && q > 0n ? q + 1n : q;
        if (need <= maxAmount)
            break;
        lp -= 1n;
    }
    return lp;
}
function liquidityIx(name, a) {
    const p = a.pool;
    for (const [k, v] of [
        ["lpAmount", a.lpAmount],
        ["limit0", a.limit0],
        ["limit1", a.limit1],
    ])
        if (v < 0n || v >= 1n << 64n)
            throw new RangeError(`${k} out of u64 range`);
    if (a.lpAmount === 0n)
        throw new RangeError("lpAmount must be greater than zero");
    const data = Buffer.alloc(8 + 24);
    data.set(discriminator("global", name), 0);
    data.writeBigUInt64LE(a.lpAmount, 8);
    data.writeBigUInt64LE(a.limit0, 16);
    data.writeBigUInt64LE(a.limit1, 24);
    const ata = (mint, prog) => getAssociatedTokenAddressSync(mint, a.owner, false, prog);
    const keys = [
        { pubkey: a.owner, isSigner: true, isWritable: false },
        { pubkey: cpmmAuthority(a.programId), isSigner: false, isWritable: false },
        { pubkey: a.poolId, isSigner: false, isWritable: true },
        // LP mints are always created under the legacy token program.
        {
            pubkey: a.ownerLpToken ?? getAssociatedTokenAddressSync(p.lpMint, a.owner),
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: a.token0Account ?? ata(p.token0Mint, p.token0Program),
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: a.token1Account ?? ata(p.token1Mint, p.token1Program),
            isSigner: false,
            isWritable: true,
        },
        { pubkey: p.token0Vault, isSigner: false, isWritable: true },
        { pubkey: p.token1Vault, isSigner: false, isWritable: true },
        {
            pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            isSigner: false,
            isWritable: false,
        },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: p.token0Mint, isSigner: false, isWritable: false },
        { pubkey: p.token1Mint, isSigner: false, isWritable: false },
        { pubkey: p.lpMint, isSigner: false, isWritable: true },
    ];
    if (name === "withdraw")
        keys.push({ pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false });
    return new TransactionInstruction({ programId: a.programId, keys, data });
}
/** `deposit(lp_token_amount, maximum_token_0_amount, maximum_token_1_amount)` */
export const cpmmDepositIx = (a) => liquidityIx("deposit", a);
/** `withdraw(lp_token_amount, minimum_token_0_amount, minimum_token_1_amount)` */
export const cpmmWithdrawIx = (a) => liquidityIx("withdraw", a);
//# sourceMappingURL=cpmm-liquidity.js.map