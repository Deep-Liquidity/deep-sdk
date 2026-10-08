/**
 * DEEP V1 fee splitter maths (docs/V1_FEES.md section 1.1). Mirrors `split_round` in
 * programs/deep-curve/src/splitter.rs bit for bit; both are pinned by the `splitter` section of
 * fixtures/curve-vectors.json.
 *
 * Every lamport of DEEP revenue reaches one vault. Each `distribute` pays:
 * - the builder: exactly 10% over time, never more. Its cumulative pay is
 *   floor(baseTotal · 1000 / 10000), so this round's part is that minus what it was paid before;
 * - the remaining 90% (plus last round's rounding dust) to the configured destinations,
 *   floor(pool · bps / 10000) each. The new dust is retained for the next round and is not
 *   counted as revenue again.
 */
import { CurveMathError } from "./math.js";
/** The builder's share of all DEEP revenue (bps of 10_000). Compiled into deep-curve. */
export const BUILDER_SPLIT_BPS = 1000n;
export const SPLIT_BPS_DENOMINATOR = 10000n;
export const MAX_SPLIT_DESTINATIONS = 8;
/** Default minimum new revenue per distribute: 0.01 SOL. */
export const DEFAULT_MIN_DISTRIBUTE_LAMPORTS = 10000000n;
/** On-chain cap for the minimum distribute amount: 10 SOL. */
export const MAX_MIN_DISTRIBUTE_LAMPORTS = 10000000000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
function u64(v, what) {
    if (v < 0n || v > U64_MAX)
        throw new CurveMathError("Overflow", `${what} out of u64 range`);
    return v;
}
/**
 * One splitter round on `revenue` NEW lamports. `retainedIn` is last round's dust (already in
 * `baseTotal`). Throws CurveMathError("Overflow") where the program returns Overflow.
 */
export function splitRound(revenue, retainedIn, baseTotal, builderPaidTotal, bps) {
    u64(revenue, "revenue");
    u64(retainedIn, "retainedIn");
    u64(builderPaidTotal, "builderPaidTotal");
    const total = baseTotal + revenue;
    if (baseTotal < 0n || total > U128_MAX)
        throw new CurveMathError("Overflow", "baseTotal");
    const dueTotal = u64((total * BUILDER_SPLIT_BPS) / SPLIT_BPS_DENOMINATOR, "builder total");
    const builder = u64(dueTotal - builderPaidTotal, "builder");
    const pool = u64(u64(revenue - builder, "pool") + retainedIn, "pool");
    const shares = bps.map((b) => (pool * b) / SPLIT_BPS_DENOMINATOR);
    const paid = shares.reduce((a, b) => a + b, 0n);
    return {
        builder,
        pool,
        shares,
        retained: u64(pool - paid, "retained"),
        baseTotal: total,
        builderPaidTotal: dueTotal,
    };
}
//# sourceMappingURL=splitter.js.map