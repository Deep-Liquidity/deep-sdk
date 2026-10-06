/**
 * Token-2022 rules DeepSwap (programs/deep-amm) applies to pool mints, mirrored in pure
 * integer TypeScript:
 *
 * - `cpmmMintSupported`: utils/token.rs `is_supported_mint` (which extensions a mint may carry
 *   without a per-mint allow entry).
 * - transfer fees: spl-token-2022 `TransferFee::calculate_fee` / `calculate_inverse_fee` as
 *   used by utils/token.rs `get_transfer_fee` / `get_transfer_inverse_fee`.
 * - `quoteCpmmSwapWithTransferFees`: instructions/swap_base_input.rs (fee on the input
 *   transfer, the curve on what reaches the vault, fee again on the output transfer).
 */
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { quoteCpmmSwapBaseInput } from "./raydium-cpmm.js";
/** spl-token-2022 `ExtensionType` discriminants this module refers to. */
export const MINT_EXTENSION = {
    TransferFeeConfig: 1,
    MintCloseAuthority: 3,
    ConfidentialTransferMint: 4,
    DefaultAccountState: 6,
    NonTransferable: 9,
    InterestBearingConfig: 10,
    PermanentDelegate: 12,
    TransferHook: 14,
    ConfidentialTransferFeeConfig: 16,
    MetadataPointer: 18,
    TokenMetadata: 19,
    GroupPointer: 20,
    TokenGroup: 21,
    GroupMemberPointer: 22,
    TokenGroupMember: 23,
    ConfidentialMintBurn: 24,
    ScaledUiAmountConfig: 25,
    PausableConfig: 26,
};
/** Extensions `is_supported_mint` accepts on a Token-2022 mint with no allow entry. */
export const CPMM_ALLOWED_MINT_EXTENSIONS = [
    MINT_EXTENSION.TransferFeeConfig,
    MINT_EXTENSION.MetadataPointer,
    MINT_EXTENSION.TokenMetadata,
    MINT_EXTENSION.InterestBearingConfig,
    MINT_EXTENSION.ScaledUiAmountConfig,
];
/**
 * Mirror of `is_supported_mint`: an SPL Token mint is always accepted; a Token-2022 mint is
 * accepted when its `SupportMintAssociated` PDA exists (`deepAmmSupportMintPda`) or when
 * every extension it carries is in CPMM_ALLOWED_MINT_EXTENSIONS.
 */
export function cpmmMintSupported(a) {
    if (a.tokenProgram.equals(TOKEN_PROGRAM_ID))
        return true;
    if (a.supportMintInitialized)
        return true;
    return a.extensions.every((e) => CPMM_ALLOWED_MINT_EXTENSIONS.includes(e));
}
/** The extensions that make `cpmmMintSupported` false without an allow entry. */
export function cpmmUnsupportedExtensions(extensions) {
    return extensions.filter((e) => !CPMM_ALLOWED_MINT_EXTENSIONS.includes(e));
}
const BPS = 10000n;
const U64_MAX = (1n << 64n) - 1n;
/** `TransferFeeConfig::get_epoch_fee` */
export function transferFeeForEpoch(cfg, epoch) {
    return epoch >= cfg.newerTransferFee.epoch ? cfg.newerTransferFee : cfg.olderTransferFee;
}
/** `TransferFee::calculate_fee`: ceil(amount × bps / 10_000), capped at the maximum fee. */
export function calculateTransferFee(fee, preFeeAmount) {
    const bps = BigInt(fee.transferFeeBasisPoints);
    if (bps === 0n || preFeeAmount === 0n)
        return 0n;
    const raw = (preFeeAmount * bps + BPS - 1n) / BPS;
    return raw < fee.maximumFee ? raw : fee.maximumFee;
}
/** `TransferFee::calculate_pre_fee_amount`; null where the program's Option is None. */
function preFeeAmount(fee, postFeeAmount) {
    const bps = BigInt(fee.transferFeeBasisPoints);
    if (bps === 0n)
        return postFeeAmount;
    if (postFeeAmount === 0n)
        return 0n;
    const capped = postFeeAmount + fee.maximumFee;
    if (bps === BPS)
        return capped > U64_MAX ? null : capped;
    const raw = (postFeeAmount * BPS + (BPS - bps) - 1n) / (BPS - bps);
    if (raw - postFeeAmount >= fee.maximumFee)
        return capped > U64_MAX ? null : capped;
    return raw > U64_MAX ? null : raw;
}
/**
 * `get_transfer_fee`: what the token program withholds from a transfer of `amount`.
 * `cfg` null = the mint has no TransferFeeConfig (or is an SPL Token mint).
 */
export function cpmmTransferFee(cfg, epoch, amount) {
    return cfg ? calculateTransferFee(transferFeeForEpoch(cfg, epoch), amount) : 0n;
}
/**
 * `get_transfer_inverse_fee`: the fee to add so that `postFeeAmount` ARRIVES in the vault.
 * Throws where the program errors: a zero amount, or a fee that does not round-trip. With
 * no TransferFeeConfig the fee is 0 (deposits never reach here with a zero amount).
 */
export function cpmmTransferInverseFee(cfg, epoch, postFeeAmount) {
    if (!cfg)
        return 0n;
    if (postFeeAmount === 0n)
        throw new RangeError("amount must be greater than zero");
    const fee = transferFeeForEpoch(cfg, epoch);
    if (BigInt(fee.transferFeeBasisPoints) === BPS)
        return fee.maximumFee;
    const pre = preFeeAmount(fee, postFeeAmount);
    if (pre === null)
        throw new RangeError("transfer fee overflows u64");
    const inverse = calculateTransferFee(fee, pre);
    // The program re-derives the fee from the gross amount and refuses a mismatch.
    if (inverse !== calculateTransferFee(fee, postFeeAmount + inverse))
        throw new RangeError("transfer fee does not round-trip for this amount");
    return inverse;
}
/**
 * swap_base_input.rs end to end. `amountIn` is what the user's account is debited. Throws
 * where the program would reject (nothing reaches the pool, or nothing is received).
 */
export function quoteCpmmSwapWithTransferFees(args) {
    if (args.amountIn <= 0n)
        throw new RangeError("amountIn must be > 0");
    const inputTransferFee = cpmmTransferFee(args.inputFee, args.epoch, args.amountIn);
    const amountInAfterFee = args.amountIn - inputTransferFee;
    if (amountInAfterFee <= 0n)
        throw new RangeError("Amount too small: the token's transfer fee takes all of it");
    const q = quoteCpmmSwapBaseInput({
        amountIn: amountInAfterFee,
        inputReserve: args.inputReserve,
        outputReserve: args.outputReserve,
        config: args.config,
        creatorFeeEnabled: args.creatorFeeEnabled,
        creatorFeeOnInput: args.creatorFeeOnInput,
    });
    const outputTransferFee = cpmmTransferFee(args.outputFee, args.epoch, q.amountOut);
    const amountReceived = q.amountOut - outputTransferFee;
    if (amountReceived <= 0n)
        throw new RangeError("Amount too small: nothing would be received");
    return {
        ...q,
        amountIn: args.amountIn,
        inputTransferFee,
        amountInAfterFee,
        outputTransferFee,
        amountReceived,
    };
}
//# sourceMappingURL=cpmm-token2022.js.map