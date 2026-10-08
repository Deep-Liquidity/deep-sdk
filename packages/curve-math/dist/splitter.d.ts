/** The builder's share of all DEEP revenue (bps of 10_000). Compiled into deep-curve. */
export declare const BUILDER_SPLIT_BPS = 1000n;
export declare const SPLIT_BPS_DENOMINATOR = 10000n;
export declare const MAX_SPLIT_DESTINATIONS = 8;
/** Default minimum new revenue per distribute: 0.01 SOL. */
export declare const DEFAULT_MIN_DISTRIBUTE_LAMPORTS = 10000000n;
/** On-chain cap for the minimum distribute amount: 10 SOL. */
export declare const MAX_MIN_DISTRIBUTE_LAMPORTS = 10000000000n;
export interface SplitRound {
    /** Paid to the builder this round. */
    builder: bigint;
    /** The 90% pool of this round: revenue − builder + retainedIn. */
    pool: bigint;
    /** floor(pool · bps / 10000) per destination, config order. */
    shares: bigint[];
    /** Rounding dust kept in the vault for the next round. */
    retained: bigint;
    baseTotal: bigint;
    builderPaidTotal: bigint;
}
/**
 * One splitter round on `revenue` NEW lamports. `retainedIn` is last round's dust (already in
 * `baseTotal`). Throws CurveMathError("Overflow") where the program returns Overflow.
 */
export declare function splitRound(revenue: bigint, retainedIn: bigint, baseTotal: bigint, builderPaidTotal: bigint, bps: readonly bigint[]): SplitRound;
