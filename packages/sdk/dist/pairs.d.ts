import { PublicKey, type GetProgramAccountsFilter } from "@solana/web3.js";
import { type AmmSwapEventRaw, type AmmSwapFeesV1Raw, type PoolSwapRates } from "./amm-events.js";
/**
 * getProgramAccounts filter matching every PoolState account of a cp-swap program. Only the
 * discriminator is matched (not the size), so a pool reallocated by a future program version
 * is still found; decodeCpmmPoolState rejects anything too small.
 */
export declare function cpmmPoolStateFilters(): GetProgramAccountsFilter[];
export interface OnchainTokenMetadata {
    name: string;
    symbol: string;
    uri: string;
}
export interface MintFacts {
    decimals: number;
    tokenProgram: "spl-token" | "token-2022";
    /** Token-2022 extension names (spl-token `ExtensionType`); empty for SPL Token mints. */
    extensions: string[];
    /** The mint has a freeze authority. */
    freezable: boolean;
    /** ScaledUiAmount multiplier in effect at `nowSec` (1 without the extension). */
    uiMultiplier: number;
    /** Token-2022 TokenMetadata extension stored in the mint, when present and readable. */
    metadata?: OnchainTokenMetadata;
    /**
     * The program a TransferHook extension points at, when one is ACTIVE (non-null). deep-amm
     * does not forward hook accounts, so a pool holding such a mint cannot move it.
     */
    transferHookProgram?: string;
}
/**
 * The ScaledUiAmount multiplier in effect at `nowSec`: the pending multiplier once its
 * effective timestamp has passed, otherwise the current one.
 */
export declare function effectiveUiMultiplier(cfg: {
    multiplier: number;
    newMultiplier: number;
    newMultiplierEffectiveTimestamp: bigint;
}, nowSec: bigint): number;
/**
 * Facts about a mint account owned by SPL Token or Token-2022. Throws when the account is
 * not a mint of either program.
 */
export declare function decodeMintFacts(address: PublicKey, account: {
    data: Uint8Array;
    owner: PublicKey;
}, nowSec: bigint): MintFacts;
/**
 * name / symbol / uri from a Metaplex Token Metadata account (key 4 = MetadataV1), or
 * undefined when it is not one for `mint` or has an empty symbol. The caller checks the
 * account's owner program.
 */
export declare function decodeMetaplexMetadata(data: Uint8Array, mint: PublicKey): OnchainTokenMetadata | undefined;
/** "So11…1112": the symbol shown for a mint with no readable metadata. */
export declare function shortMint(mint: string): string;
export interface PairSwap {
    /** True when token0 went in and token1 came out. */
    zeroForOne: boolean;
    /** Amounts that moved, base units, without Token-2022 transfer fees. */
    amount0: bigint;
    amount1: bigint;
    /** Trade fee charged on the input token, base units. */
    fee: bigint;
    /** Pool reserves (net of accrued protocol/fund/creator fees) right after the swap. */
    reserve0After: bigint;
    reserve1After: bigint;
    /**
     * DEEP V1 pools only (present when the swap's `SwapFeesV1` was supplied). Then `fee` is NOT
     * necessarily on the input token: every fee of the swap is in the pool's quote token,
     * `fee` is `lpFee + protocolFee`, and on a sell `amount<quote>` is net of all of it.
     */
    v1?: {
        /** True when the input was the pool's quote token (the fee came off the input). */
        isBuy: boolean;
        /** True when the quote token, the one every fee amount is in, is token0. */
        feeOnToken0: boolean;
        /** Stays in the pool for LPs. */
        lpFee: bigint;
        /** DEEP's part. */
        protocolFee: bigint;
        /** The reward recipient's part (0 on a Standard pool), charged on top of `fee`. */
        rewardFee: bigint;
        /** 0 Standard, 1 Creator, 2 Holder. */
        rewardModel: number;
    };
}
/**
 * A SwapEvent in the pool's own token order, with the reserves right after it. Same
 * arithmetic as toPoolSwap (the protocol, fund and creator slices leave the reserves, with
 * the program's floor rounding) but with no SOL assumption. Null when the event's mints are
 * not the pool's or its numbers are inconsistent.
 *
 * DEEP V1 pools: pass the swap's `SwapFeesV1` as `feesV1` (`parseAmmSwapEventsWithSource`
 * pairs them). `rates` is then not used: the DEEP and reward parts leave the reserves on the
 * quote side in both directions, and the result carries the breakdown in `v1`. Null when
 * `feesV1` does not belong to `e`. Without it the legacy arithmetic applies unchanged, which
 * is wrong for a V1 swap.
 */
export declare function toPairSwap(e: AmmSwapEventRaw, pool: {
    token0Mint: PublicKey;
    token1Mint: PublicKey;
}, rates?: PoolSwapRates, feesV1?: AmmSwapFeesV1Raw | null): PairSwap | null;
/** token1 per whole token0 at the given raw reserves. Presentation only, never for amounts. */
export declare function pairPrice(reserve0: bigint, reserve1: bigint, decimals0: number, decimals1: number): number;
