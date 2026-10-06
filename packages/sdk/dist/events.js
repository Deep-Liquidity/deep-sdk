/**
 * Decoders for deep-curve Anchor events. `emit!` writes
 * `Program data: <base64(discriminator ‖ borsh(event))>` to the transaction logs.
 * Layouts must match the `#[event]` structs in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import { CONFIG_PARAMS_SIZE, readConfigParams } from "./config.js";
import { DEEP_CURVE_PROGRAM_ID, discriminator } from "./constants.js";
class Reader {
    b;
    o = 0;
    v;
    constructor(b) {
        this.b = b;
        this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    }
    need(n) {
        if (this.o + n > this.b.length)
            throw new RangeError("event data truncated");
    }
    pubkey() {
        this.need(32);
        const k = new PublicKey(this.b.slice(this.o, this.o + 32)).toBase58();
        this.o += 32;
        return k;
    }
    u64() {
        this.need(8);
        const x = this.v.getBigUint64(this.o, true);
        this.o += 8;
        return x;
    }
    i64() {
        this.need(8);
        const x = this.v.getBigInt64(this.o, true);
        this.o += 8;
        return x;
    }
    bool() {
        this.need(1);
        const x = this.b[this.o++];
        if (x !== 0 && x !== 1)
            throw new RangeError("invalid bool");
        return x === 1;
    }
    params() {
        this.need(CONFIG_PARAMS_SIZE);
        const p = readConfigParams(this.b, this.o);
        this.o += CONFIG_PARAMS_SIZE;
        return p;
    }
    string() {
        this.need(4);
        const len = this.v.getUint32(this.o, true);
        this.o += 4;
        if (len > 1024)
            throw new RangeError("string too long");
        this.need(len);
        const s = new TextDecoder("utf-8", { fatal: true }).decode(this.b.slice(this.o, this.o + len));
        this.o += len;
        return s;
    }
}
const DECODERS = {
    TokenCreated: (r) => ({
        name: "TokenCreated",
        mint: r.pubkey(),
        creator: r.pubkey(),
        tokenName: r.string(),
        symbol: r.string(),
        uri: r.string(),
        curveSupply: r.u64(),
        tokenTotalSupply: r.u64(),
    }),
    TradeEvent: (r) => ({
        name: "TradeEvent",
        mint: r.pubkey(),
        trader: r.pubkey(),
        isBuy: r.bool(),
        solAmount: r.u64(),
        tokenAmount: r.u64(),
        protocolFee: r.u64(),
        creatorFee: r.u64(),
        virtualSolReserves: r.u64(),
        virtualTokenReserves: r.u64(),
        realSolReserves: r.u64(),
        realTokenReserves: r.u64(),
        timestamp: r.i64(),
    }),
    CurveCompleted: (r) => ({ name: "CurveCompleted", mint: r.pubkey(), realSolReserves: r.u64() }),
    CreatorFeesClaimed: (r) => ({
        name: "CreatorFeesClaimed",
        mint: r.pubkey(),
        creator: r.pubkey(),
        amount: r.u64(),
    }),
    Graduated: (r) => ({
        name: "Graduated",
        mint: r.pubkey(),
        lpSol: r.u64(),
        lpTokens: r.u64(),
        burnedTokens: r.u64(),
        migrationFee: r.u64(),
        timestamp: r.i64(),
    }),
    PauseChanged: (r) => ({ name: "PauseChanged", paused: r.bool() }),
    ConfigUpdated: (r) => ({ name: "ConfigUpdated", admin: r.pubkey() }),
    ConfigUpdateQueued: (r) => ({
        name: "ConfigUpdateQueued",
        eta: r.i64(),
        queuedAt: r.i64(),
        params: r.params(),
    }),
    ConfigUpdateCancelled: (r) => ({ name: "ConfigUpdateCancelled", eta: r.i64() }),
    ProtocolFeesWithdrawn: (r) => ({
        name: "ProtocolFeesWithdrawn",
        recipient: r.pubkey(),
        amount: r.u64(),
    }),
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const BY_DISC = new Map(Object.entries(DECODERS).map(([name, dec]) => [hex(discriminator("event", name)), dec]));
/** Decode one event payload (discriminator included). Returns null for unknown events. */
export function decodeEvent(data) {
    if (data.length < 8)
        return null;
    const dec = BY_DISC.get(hex(data.subarray(0, 8)));
    return dec ? dec(new Reader(data.subarray(8))) : null;
}
function base64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/**
 * Extract deep-curve events from a transaction's log messages. Tracks the invoke
 * stack so `Program data:` lines emitted by OTHER programs (spoofing) are ignored.
 * `index` is the event's ordinal within the transaction, for idempotent storage.
 */
export function parseEventsFromLogs(logs, programId = DEEP_CURVE_PROGRAM_ID) {
    const pid = programId.toBase58();
    const stack = [];
    const out = [];
    let index = 0;
    for (const line of logs) {
        const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
        if (invoke) {
            stack.push(invoke[1]);
            continue;
        }
        if (/^Program \w+ (success|failed)/.test(line)) {
            stack.pop();
            continue;
        }
        if (line.startsWith("Program data: ") && stack[stack.length - 1] === pid) {
            try {
                const ev = decodeEvent(base64ToBytes(line.slice("Program data: ".length).trim()));
                if (ev)
                    out.push({ index: index++, event: ev });
            }
            catch {
                // malformed payload from our program id — skip, never crash the indexer
            }
        }
    }
    return out;
}
const FEE_DISC = {
    LaunchFeeCharged: hex(discriminator("event", "LaunchFeeCharged")),
    ProtocolFeesSwept: hex(discriminator("event", "ProtocolFeesSwept")),
};
/** Decode a LaunchFeeCharged or ProtocolFeesSwept payload (discriminator included), else null. */
export function decodeFeeEvent(data) {
    if (data.length < 8)
        return null;
    const d = hex(data.subarray(0, 8));
    const b = data.subarray(8);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const pk = (o) => new PublicKey(b.slice(o, o + 32)).toBase58();
    if (d === FEE_DISC.LaunchFeeCharged) {
        if (b.length < 32 + 32 + 2 + 8 + 8 + 4 + 8)
            throw new RangeError("event data truncated");
        return {
            name: "LaunchFeeCharged",
            mint: pk(0),
            creator: pk(32),
            usdCents: v.getUint16(64, true),
            lamports: v.getBigUint64(66, true),
            price: v.getBigInt64(74, true),
            exponent: v.getInt32(82, true),
            publishTime: v.getBigInt64(86, true),
        };
    }
    if (d === FEE_DISC.ProtocolFeesSwept) {
        if (b.length < 40)
            throw new RangeError("event data truncated");
        return { name: "ProtocolFeesSwept", mint: pk(0), amount: v.getBigUint64(32, true) };
    }
    return null;
}
/** LaunchFeeCharged / ProtocolFeesSwept emitted by `programId` itself (same spoofing rules). */
export function parseFeeEventsFromLogs(logs, programId = DEEP_CURVE_PROGRAM_ID) {
    const pid = programId.toBase58();
    const stack = [];
    const out = [];
    for (const line of logs) {
        const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
        if (invoke) {
            stack.push(invoke[1]);
            continue;
        }
        if (/^Program \w+ (success|failed)/.test(line)) {
            stack.pop();
            continue;
        }
        if (line.startsWith("Program data: ") && stack[stack.length - 1] === pid) {
            try {
                const ev = decodeFeeEvent(base64ToBytes(line.slice("Program data: ".length).trim()));
                if (ev)
                    out.push(ev);
            }
            catch {
                // malformed payload: skip
            }
        }
    }
    return out;
}
//# sourceMappingURL=events.js.map