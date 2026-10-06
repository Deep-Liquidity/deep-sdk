import type { PublicKey } from "@solana/web3.js";
import { type CpmmAmmConfig, type CpmmSwapQuote } from "./raydium-cpmm.js";
/** spl-token-2022 `ExtensionType` discriminants this module refers to. */
export declare const MINT_EXTENSION: {
    readonly TransferFeeConfig: 1;
    readonly MintCloseAuthority: 3;
    readonly ConfidentialTransferMint: 4;
    readonly DefaultAccountState: 6;
    readonly NonTransferable: 9;
    readonly InterestBearingConfig: 10;
    readonly PermanentDelegate: 12;
    readonly TransferHook: 14;
    readonly ConfidentialTransferFeeConfig: 16;
    readonly MetadataPointer: 18;
    readonly TokenMetadata: 19;
    readonly GroupPointer: 20;
    readonly TokenGroup: 21;
    readonly GroupMemberPointer: 22;
    readonly TokenGroupMember: 23;
    readonly ConfidentialMintBurn: 24;
    readonly ScaledUiAmountConfig: 25;
    readonly PausableConfig: 26;
};
/** Extensions `is_supported_mint` accepts on a Token-2022 mint with no allow entry. */
export declare const CPMM_ALLOWED_MINT_EXTENSIONS: readonly number[];
/**
 * Mirror of `is_supported_mint`: an SPL Token mint is always accepted; a Token-2022 mint is
 * accepted when its `SupportMintAssociated` PDA exists (`deepAmmSupportMintPda`) or when
 * every extension it carries is in CPMM_ALLOWED_MINT_EXTENSIONS.
 */
export declare function cpmmMintSupported(a: {
    /** Owner program of the mint account. */
    tokenProgram: PublicKey;
    /** The mint's extension types (spl-token `getExtensionTypes(mint.tlvData)`). */
    extensions: readonly number[];
    /** The mint's support_mint PDA exists and is owned by the AMM program. */
    supportMintInitialized: boolean;
}): boolean;
/** The extensions that make `cpmmMintSupported` false without an allow entry. */
export declare function cpmmUnsupportedExtensions(extensions: readonly number[]): number[];
export interface MintTransferFee {
    /** First epoch this fee applies to. */
    epoch: bigint;
    maximumFee: bigint;
    transferFeeBasisPoints: number;
}
/** The two fee slots of a TransferFeeConfig (field names match @solana/spl-token). */
export interface MintTransferFeeConfig {
    olderTransferFee: MintTransferFee;
    newerTransferFee: MintTransferFee;
}
/** `TransferFeeConfig::get_epoch_fee` */
export declare function transferFeeForEpoch(cfg: MintTransferFeeConfig, epoch: bigint): MintTransferFee;
/** `TransferFee::calculate_fee`: ceil(amount × bps / 10_000), capped at the maximum fee. */
export declare function calculateTransferFee(fee: MintTransferFee, preFeeAmount: bigint): bigint;
/**
 * `get_transfer_fee`: what the token program withholds from a transfer of `amount`.
 * `cfg` null = the mint has no TransferFeeConfig (or is an SPL Token mint).
 */
export declare function cpmmTransferFee(cfg: MintTransferFeeConfig | null | undefined, epoch: bigint, amount: bigint): bigint;
/**
 * `get_transfer_inverse_fee`: the fee to add so that `postFeeAmount` ARRIVES in the vault.
 * Throws where the program errors: a zero amount, or a fee that does not round-trip. With
 * no TransferFeeConfig the fee is 0 (deposits never reach here with a zero amount).
 */
export declare function cpmmTransferInverseFee(cfg: MintTransferFeeConfig | null | undefined, epoch: bigint, postFeeAmount: bigint): bigint;
export interface CpmmSwapQuoteWithFees extends CpmmSwapQuote {
    /** Withheld by the input mint from what the user sends. */
    inputTransferFee: bigint;
    /** What reaches the pool vault (`amountIn − inputTransferFee`); the curve prices this. */
    amountInAfterFee: bigint;
    /** Withheld by the output mint from what the pool sends (`amountOut`). */
    outputTransferFee: bigint;
    /** What the user receives; `minimum_amount_out` is checked against this. */
    amountReceived: bigint;
}
/**
 * swap_base_input.rs end to end. `amountIn` is what the user's account is debited. Throws
 * where the program would reject (nothing reaches the pool, or nothing is received).
 */
export declare function quoteCpmmSwapWithTransferFees(args: {
    amountIn: bigint;
    inputReserve: bigint;
    outputReserve: bigint;
    config: Pick<CpmmAmmConfig, "tradeFeeRate" | "creatorFeeRate">;
    creatorFeeEnabled: boolean;
    creatorFeeOnInput: boolean;
    inputFee?: MintTransferFeeConfig | null;
    outputFee?: MintTransferFeeConfig | null;
    /** Current epoch; only read when either mint has a TransferFeeConfig. */
    epoch: bigint;
}): CpmmSwapQuoteWithFees;
