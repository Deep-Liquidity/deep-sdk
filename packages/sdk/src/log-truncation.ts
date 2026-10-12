/**
 * Truncated transaction logs.
 *
 * The Solana runtime keeps about 10 kB of log text per transaction. The first line that does
 * not fit is replaced by the single line `Log truncated`; every later line is dropped too,
 * EXCEPT lines short enough to still fit in what is left of the budget. So after the marker
 * the log is not a faithful record any more: an event line can be missing while a shorter
 * line that was written after it is present.
 *
 * DEEP's programs report trades, launches, graduations and swaps as Anchor events in
 * `Program data:` log lines. A transaction with many instructions (a bundled launch, a long
 * route) can therefore lose its later events. The rule this module gives every reader:
 *
 *   - lines BEFORE the marker are complete and in order: events decoded from them are
 *     authoritative and numbered exactly as in an untruncated log;
 *   - nothing from the marker on may be used to decide that an event did NOT happen, and an
 *     event found there cannot be numbered.
 *
 * What the marker removed can be rebuilt from the transaction's instructions and balances:
 * see `readCurveTransaction` / `readAmmTransaction` (tx-reconstruct.ts).
 */
import type { PublicKey } from "@solana/web3.js";
import { parseAmmSwapEventsWithSource, type ParsedAmmSwap } from "./amm-events.js";
import { DEEP_CURVE_PROGRAM_ID } from "./constants.js";
import {
  parseEventsFromLogs,
  parseFeeEventsFromLogs,
  type DeepEvent,
  type FeeEvent,
} from "./events.js";
import { DEEP_AMM_PROGRAM_ID } from "./raydium-cpmm.js";

/**
 * The line the runtime writes in place of the first log line that did not fit. It is the
 * whole line: a program cannot produce it (`msg!` output starts with `Program log: `).
 */
export const LOG_TRUNCATED_LINE = "Log truncated";

/** Index of the truncation marker in `logs`, or -1 when the log is complete. */
export function logTruncationIndex(logs: readonly string[]): number {
  return logs.indexOf(LOG_TRUNCATED_LINE);
}

/** True when the runtime cut this transaction's log: events may be missing from it. */
export function logsTruncated(logs: readonly string[]): boolean {
  return logTruncationIndex(logs) >= 0;
}

/**
 * The lines before the truncation marker (all of them when the log is complete): the part of
 * a log that is a faithful, ordered record.
 */
export function logsBeforeTruncation(logs: readonly string[]): readonly string[] {
  const at = logTruncationIndex(logs);
  return at < 0 ? logs : logs.slice(0, at);
}

/** Events decoded from a log, with whether the log was complete. */
export interface CheckedLogEvents<T> {
  /**
   * Decoded from the lines before the truncation marker only, so every entry is real and
   * numbered as in a complete log. When `truncated`, more events may have been emitted.
   */
  events: T[];
  /** The runtime cut the log: `events` may be only the first part of what was emitted. */
  truncated: boolean;
}

/**
 * `parseEventsFromLogs` that says whether the log was complete. Use it wherever a missing
 * event matters (indexing, accounting): when `truncated` is true, read the transaction with
 * `readCurveTransaction` instead of trusting the list.
 */
export function parseEventsFromLogsChecked(
  logs: readonly string[],
  programId: PublicKey = DEEP_CURVE_PROGRAM_ID,
): CheckedLogEvents<{ index: number; event: DeepEvent }> {
  return {
    events: parseEventsFromLogs(logsBeforeTruncation(logs), programId),
    truncated: logsTruncated(logs),
  };
}

/** `parseFeeEventsFromLogs` that says whether the log was complete. */
export function parseFeeEventsFromLogsChecked(
  logs: readonly string[],
  programId: PublicKey = DEEP_CURVE_PROGRAM_ID,
): CheckedLogEvents<FeeEvent> {
  return {
    events: parseFeeEventsFromLogs(logsBeforeTruncation(logs), programId),
    truncated: logsTruncated(logs),
  };
}

/**
 * `parseAmmSwapEventsWithSource` that says whether the log was complete. When `truncated`,
 * read the transaction with `readAmmTransaction` instead of trusting the list.
 */
export function parseAmmSwapEventsChecked(
  logs: readonly string[],
  programId: PublicKey = DEEP_AMM_PROGRAM_ID,
): CheckedLogEvents<ParsedAmmSwap> {
  return {
    events: parseAmmSwapEventsWithSource(logsBeforeTruncation(logs), programId),
    truncated: logsTruncated(logs),
  };
}
