/**
 * RETIRED: the pre-V1 5/70 builder share (deep-curve 89b7627..V1 Phase 1). deep-curve no longer
 * has it (DEEP V1 pays the builder 10% through the fee splitter, see splitter.ts), and it is not
 * part of the cross-language fixtures any more. Kept ONLY so SDK snapshots of the previously
 * deployed devnet build (packages/sdk/scripts/.sdk-deployed, used by the live campaign until the
 * V1 upgrade) still load. Do not use in new code.
 */
import { CurveMathError } from "./math.js";
/** @deprecated retired 5/70 builder share (pre-V1). */
export const BUILDER_SHARE_NUMERATOR = 5n;
/** @deprecated retired 5/70 builder share (pre-V1). */
export const BUILDER_SHARE_DENOMINATOR = 70n;
/** @deprecated retired: floor(base · 5 / 70), the pre-V1 sweep share. */
export function builderShare(base) {
    if (base < 0n || base > (1n << 64n) - 1n)
        throw new CurveMathError("Overflow", "base out of u64 range");
    return (base * BUILDER_SHARE_NUMERATOR) / BUILDER_SHARE_DENOMINATOR;
}
//# sourceMappingURL=legacy.js.map