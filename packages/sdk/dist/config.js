/**
 * Config timelock types: ConfigParams (borsh) and the PendingConfig PDA.
 * Layout mirrors `ConfigParams` / `PendingConfig` in programs/deep-curve/src/lib.rs.
 */
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "./constants.js";
/** v1: 32+32 + 3·2 + 4·8 + 1 + 32 + 4 */
export const CONFIG_PARAMS_V1_SIZE = 139;
/** v2: + u16 launch_fee_usd_cents */
export const CONFIG_PARAMS_V2_SIZE = 141;
/** v3: + u16 sell_protocol_fee_bps, u16 creator_reward_bps, u16 holder_reward_bps */
export const CONFIG_PARAMS_SIZE = 147;
const PARAMS_SIZE = {
    1: CONFIG_PARAMS_V1_SIZE,
    2: CONFIG_PARAMS_V2_SIZE,
    3: CONFIG_PARAMS_SIZE,
};
/**
 * Reads borsh ConfigParams starting at `offset`. `version` is the layout to read (default 3,
 * the current one); `true` / `false` are the pre-v3 spelling of 1 / 3.
 */
export function readConfigParams(data, offset = 0, version = 3) {
    const ver = version === true ? 1 : version === false ? 3 : version;
    const v1 = ver === 1;
    if (data.length < offset + PARAMS_SIZE[ver])
        throw new RangeError("ConfigParams truncated");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = offset;
    const pk = () => {
        const k = new PublicKey(data.slice(o, o + 32));
        o += 32;
        return k;
    };
    const u16 = () => {
        const x = v.getUint16(o, true);
        o += 2;
        return x;
    };
    const u64 = () => {
        const x = v.getBigUint64(o, true);
        o += 8;
        return x;
    };
    const feeRecipient = pk();
    const migrationAuthority = pk();
    const protocolFeeBps = u16();
    const creatorFeeBps = u16();
    const migrationFeeBps = u16();
    const initialVirtualSol = u64();
    const initialVirtualToken = u64();
    const curveSupply = u64();
    const tokenTotalSupply = u64();
    const decimals = data[o++];
    const raydiumAmmConfig = pk();
    const timelockSeconds = v.getUint32(o, true);
    o += 4;
    const launchFeeUsdCents = v1 ? 0 : v.getUint16(o, true);
    o += 2;
    const v3 = ver === 3;
    const sellProtocolFeeBps = v3 ? v.getUint16(o, true) : protocolFeeBps;
    const maxRewardBps = v3 ? v.getUint16(o + 2, true) : 0;
    const reservedBps = v3 ? v.getUint16(o + 4, true) : 0;
    return {
        feeRecipient,
        migrationAuthority,
        protocolFeeBps,
        creatorFeeBps,
        migrationFeeBps,
        initialVirtualSol,
        initialVirtualToken,
        curveSupply,
        tokenTotalSupply,
        decimals,
        raydiumAmmConfig,
        timelockSeconds,
        launchFeeUsdCents,
        sellProtocolFeeBps,
        maxRewardBps,
        reservedBps,
    };
}
/** disc(8) | active u8 | eta i64 | queued_at i64 | ConfigParams | bump u8 */
export const PENDING_CONFIG_V1_SIZE = 8 + 1 + 8 + 8 + CONFIG_PARAMS_V1_SIZE + 1; // 165
export const PENDING_CONFIG_V2_SIZE = 8 + 1 + 8 + 8 + CONFIG_PARAMS_V2_SIZE + 1; // 167
export const PENDING_CONFIG_SIZE = 8 + 1 + 8 + 8 + CONFIG_PARAMS_SIZE + 1; // 173
/** Accepts v1 (165 B), v2 (167 B) and v3 (173 B) accounts. */
export function decodePendingConfig(data) {
    if (data.length < PENDING_CONFIG_V1_SIZE)
        throw new Error("account too small for PendingConfig");
    const ver = data.length < PENDING_CONFIG_V2_SIZE ? 1 : data.length < PENDING_CONFIG_SIZE ? 2 : 3;
    const d = discriminator("account", "PendingConfig");
    for (let i = 0; i < 8; i++)
        if (data[i] !== d[i])
            throw new Error("not a PendingConfig account");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
        active: data[8] === 1,
        eta: v.getBigInt64(9, true),
        queuedAt: v.getBigInt64(17, true),
        params: readConfigParams(data, 25, ver),
        bump: data[25 + PARAMS_SIZE[ver]],
    };
}
//# sourceMappingURL=config.js.map