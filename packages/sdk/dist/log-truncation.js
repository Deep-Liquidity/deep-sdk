import { parseAmmSwapEventsWithSource } from "./amm-events.js";
import { DEEP_CURVE_PROGRAM_ID } from "./constants.js";
import { parseEventsFromLogs, parseFeeEventsFromLogs, } from "./events.js";
import { DEEP_AMM_PROGRAM_ID } from "./raydium-cpmm.js";
/**
 * The line the runtime writes in place of the first log line that did not fit. It is the
 * whole line: a program cannot produce it (`msg!` output starts with `Program log: `).
 */
export const LOG_TRUNCATED_LINE = "Log truncated";
/** Index of the truncation marker in `logs`, or -1 when the log is complete. */
export function logTruncationIndex(logs) {
    return logs.indexOf(LOG_TRUNCATED_LINE);
}
/** True when the runtime cut this transaction's log: events may be missing from it. */
export function logsTruncated(logs) {
    return logTruncationIndex(logs) >= 0;
}
/**
 * The lines before the truncation marker (all of them when the log is complete): the part of
 * a log that is a faithful, ordered record.
 */
export function logsBeforeTruncation(logs) {
    const at = logTruncationIndex(logs);
    return at < 0 ? logs : logs.slice(0, at);
}
/**
 * `parseEventsFromLogs` that says whether the log was complete. Use it wherever a missing
 * event matters (indexing, accounting): when `truncated` is true, read the transaction with
 * `readCurveTransaction` instead of trusting the list.
 */
export function parseEventsFromLogsChecked(logs, programId = DEEP_CURVE_PROGRAM_ID) {
    return {
        events: parseEventsFromLogs(logsBeforeTruncation(logs), programId),
        truncated: logsTruncated(logs),
    };
}
/** `parseFeeEventsFromLogs` that says whether the log was complete. */
export function parseFeeEventsFromLogsChecked(logs, programId = DEEP_CURVE_PROGRAM_ID) {
    return {
        events: parseFeeEventsFromLogs(logsBeforeTruncation(logs), programId),
        truncated: logsTruncated(logs),
    };
}
/**
 * `parseAmmSwapEventsWithSource` that says whether the log was complete. When `truncated`,
 * read the transaction with `readAmmTransaction` instead of trusting the list.
 */
export function parseAmmSwapEventsChecked(logs, programId = DEEP_AMM_PROGRAM_ID) {
    return {
        events: parseAmmSwapEventsWithSource(logsBeforeTruncation(logs), programId),
        truncated: logsTruncated(logs),
    };
}
//# sourceMappingURL=log-truncation.js.map