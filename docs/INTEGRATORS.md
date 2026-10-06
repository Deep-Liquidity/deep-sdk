# Integrating DEEP (trading terminals, aggregators, indexers)

Everything a terminal, aggregator, screener or indexer needs to support DEEP's launchpad
(**deep-curve**) and DEX (**DeepSwap**, the **deep-amm** program) without asking us: addresses,
byte layouts, events, the exact fee maths, errors, compute budgets, runnable examples and the
public HTTP API.

> **Status (2026-10-06).** Both programs run on **Solana devnet**. They are **not deployed on
> mainnet** (`getAccountInfo` on mainnet-beta returns null for both program ids) and have **not
> been audited**. Treat everything here as devnet integration material.

Where the numbers come from: program ids, PDAs and decoders from `@deepliquidity/sdk`; byte layouts and
error codes generated from the committed IDLs (`packages/sdk/scripts/gen-integrator-tables.ts`);
fee maths from `@deepliquidity/curve-math`, `programs/deep-curve/src/math.rs`, `pyth.rs` and deep-amm
`curve/fees.rs`; live values and compute units from devnet reads and simulations on 2026-10-06
(`packages/sdk/examples`, `packages/sdk/scripts/idl-devnet-check.ts`).

## 1. Packages, IDLs and API

| What                   | Where                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| TypeScript SDK         | `@deepliquidity/sdk` (PDAs, instruction builders, account + event decoders, quotes)                 |
| Curve maths            | `@deepliquidity/curve-math` (BigInt, bit-for-bit with the Rust program)                             |
| API types              | `@deepliquidity/shared-types`                                                                       |
| Anchor IDLs (spec 0.1) | `idl/deep_curve.json`, `idl/deep_amm.json`; in the npm package `<sdk>/idl/deep_curve.json` |
| HTTP API (devnet data) | `https://api.deepliquidity.fun/v1/…`, OpenAPI 3.1 at `GET /v1/openapi.json`                |
| Jupiter adapter        | `integrations/jupiter` (Rust `Amm` trait implementation, see `docs/JUPITER.md`)            |

The npm packages are **not published yet**. `packages/publish.config.json` holds the planned
scope (placeholder `@deepliquidity/*`); `node scripts/pack-packages.mjs` builds and stages them
and dry-runs `npm pack` (section 14).

There is no on-chain Anchor IDL account for either program; the repository files are the
source. `scripts/idl-devnet-check.ts` checks them against devnet: every live account of every IDL
type has the IDL's size and decodes to the same values with the IDL layout and with the SDK, and
the same holds for the events in recent transactions.

## 2. Addresses per cluster

| Account                                 | devnet                                         | mainnet-beta |
| --------------------------------------- | ---------------------------------------------- | ------------ |
| deep-curve program                      | `7czURwVLkQpcF1HVhhZU5GGzvPA8YniogZY1BhZHCDtA` | not deployed |
| deep-amm (DeepSwap) program             | `HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP` | not deployed |
| deep-curve Config (`["config"]`)        | `66TKkpLt9XJxALWGkR5vE7z1nAWVFiwtLGZhg79HPn62` | not deployed |
| deep-curve Treasury (`["treasury"]`)    | `GqxLdYqarHucFdko8GGGBESNzdWzFGSe76ympb6Le6Kh` | not deployed |
| deep-curve PendingConfig                | `2pUiest4kgcheWQsD8w8r5H8wJDSZrfwWPBQF9carmBR` | not deployed |
| DeepSwap AmmConfig used by graduations  | `8UY49GiUH4jR9RkUYTCHPpuKu5WQsFaf6KCTeUxQojoS` | not deployed |
| deep-amm vault/LP authority             | `9Ed3EyFMgN3q2SbAJPcPNp6aDacgRGF5RyFT7smVSn8o` | not deployed |
| Pyth SOL/USD PriceUpdateV2 (launch fee) | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | same address |
| Pyth receiver program (its owner)       | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`  | same address |
| Metaplex Token Metadata                 | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`  | same address |

The SDK exports these as `DEEP_CURVE_PROGRAM_ID`, `DEEP_AMM_PROGRAM_ID`, `configPda()`,
`treasuryPda()`, `pendingConfigPda()`, `cpmmAuthority(DEEP_AMM_PROGRAM_ID)`,
`PYTH_SOL_USD_PRICE_UPDATE`, `PYTH_RECEIVER_PROGRAM_ID` and `TOKEN_METADATA_PROGRAM_ID`. The
program ids are planned to stay the same on mainnet (`docs/MAINNET.md`), but nothing exists there
until the owner approves a mainnet deploy; check `getAccountInfo` before enabling a mainnet path.
The graduation AmmConfig is read from `Config.raydium_amm_config`, never hard-coded.

## 3. PDAs and seeds

| Account                            | Program    | Seeds                                                       | SDK                                |
| ---------------------------------- | ---------- | ----------------------------------------------------------- | ---------------------------------- |
| Config                             | deep-curve | `"config"`                                                  | `configPda()`                      |
| Treasury                           | deep-curve | `"treasury"`                                                | `treasuryPda()`                    |
| PendingConfig                      | deep-curve | `"pending_config"`                                          | `pendingConfigPda()`               |
| BondingCurve                       | deep-curve | `"curve"`, mint                                             | `curvePda(mint)`                   |
| curve vault (token account)        | ATA        | ATA(mint, owner = BondingCurve PDA)                         | `vaultAddress(mint)`               |
| graduation pool (PoolState)        | deep-curve | `"raydium_pool"`, mint                                      | `graduationPoolPda(mint)`          |
| graduation payer                   | deep-curve | `"pool_creator"`                                            | `graduationPayerPda()`             |
| Metaplex metadata                  | Metaplex   | `"metadata"`, metadata program id, mint                     | `metadataPda(mint)`                |
| AmmConfig                          | deep-amm   | `"amm_config"`, index as **u16 big-endian**                 | `deepAmmConfigPda(index)`          |
| vault + LP mint authority          | deep-amm   | `"vault_and_lp_mint_auth_seed"`                             | `cpmmAuthority(programId)`         |
| pool (permissionless `initialize`) | deep-amm   | `"pool"`, amm_config, mint0, mint1 (mint0 < mint1 bytewise) | `cpmmPoolPda(…)`                   |
| pool vault                         | deep-amm   | `"pool_vault"`, pool, mint                                  | `cpmmVault(programId, pool, mint)` |
| LP mint                            | deep-amm   | `"pool_lp_mint"`, pool                                      | `cpmmLpMint(programId, pool)`      |
| observation                        | deep-amm   | `"observation"`, pool                                       | `cpmmObservation(programId, pool)` |
| Permission                         | deep-amm   | `"permission"`, authority                                   | `deepAmmPermissionPda(authority)`  |
| CreatorFeeShare                    | deep-amm   | `"creator_fee_share"`, creator, amm_config                  | `deepAmmCreatorFeeSharePda(…)`     |

A **graduation pool is not at the cp-swap pool PDA**: deep-curve creates it at its own PDA
`["raydium_pool", mint]` (so nobody can pre-create it to grief graduation). Use
`graduationPoolPda(mint)` or `BondingCurve.pool`, and `isGraduationPool(pool, mint0, mint1)` to
tell the token's official pool from any other pool someone opens for the same pair with
`initialize` (anyone can, at any price).

## 4. Account layouts

All offsets include the 8-byte Anchor discriminator (`sha256("account:<Name>")[0..8]`). Integers
are little-endian; `pubkey` is 32 bytes. deep-amm's PoolState is `repr(C, packed)` (zero-copy),
the others are borsh; both lay fields out back to back. Decoders: `decodeConfig`,
`decodeBondingCurve`, `decodePendingConfig`, `decodeCpmmPoolState`, `decodeCpmmAmmConfig`.
Config and BondingCurve accept the pre-upgrade v1 sizes too (213 and 177 bytes); every devnet
account is v2.

### Config (deep_curve, 215 bytes)

Discriminator `[155, 12, 170, 224, 30, 250, 204, 130]`.

| offset | field                   | type    |
| -----: | ----------------------- | ------- |
|      0 | discriminator           | [u8; 8] |
|      8 | `admin`                 | pubkey  |
|     40 | `pending_admin`         | pubkey  |
|     72 | `fee_recipient`         | pubkey  |
|    104 | `migration_authority`   | pubkey  |
|    136 | `protocol_fee_bps`      | u16     |
|    138 | `creator_fee_bps`       | u16     |
|    140 | `migration_fee_bps`     | u16     |
|    142 | `initial_virtual_sol`   | u64     |
|    150 | `initial_virtual_token` | u64     |
|    158 | `curve_supply`          | u64     |
|    166 | `token_total_supply`    | u64     |
|    174 | `decimals`              | u8      |
|    175 | `paused`                | bool    |
|    176 | `bump`                  | u8      |
|    177 | `raydium_amm_config`    | pubkey  |
|    209 | `timelock_seconds`      | u32     |
|    213 | `launch_fee_usd_cents`  | u16     |

### BondingCurve (deep_curve, 185 bytes)

Discriminator `[23, 183, 248, 55, 96, 216, 172, 96]`.

| offset | field                     | type    |
| -----: | ------------------------- | ------- |
|      0 | discriminator             | [u8; 8] |
|      8 | `mint`                    | pubkey  |
|     40 | `creator`                 | pubkey  |
|     72 | `virtual_sol_reserves`    | u64     |
|     80 | `virtual_token_reserves`  | u64     |
|     88 | `real_sol_reserves`       | u64     |
|     96 | `real_token_reserves`     | u64     |
|    104 | `curve_supply`            | u64     |
|    112 | `token_total_supply`      | u64     |
|    120 | `protocol_fee_bps`        | u16     |
|    122 | `creator_fee_bps`         | u16     |
|    124 | `migration_fee_bps`       | u16     |
|    126 | `creator_fees_unclaimed`  | u64     |
|    134 | `complete`                | bool    |
|    135 | `graduated`               | bool    |
|    136 | `created_at`              | i64     |
|    144 | `bump`                    | u8      |
|    145 | `pool`                    | pubkey  |
|    177 | `protocol_fees_unclaimed` | u64     |

### PendingConfig (deep_curve, 167 bytes)

Discriminator `[109, 48, 178, 191, 125, 67, 26, 70]`.

| offset | field                          | type    |
| -----: | ------------------------------ | ------- |
|      0 | discriminator                  | [u8; 8] |
|      8 | `active`                       | bool    |
|      9 | `eta`                          | i64     |
|     17 | `queued_at`                    | i64     |
|     25 | `params.fee_recipient`         | pubkey  |
|     57 | `params.migration_authority`   | pubkey  |
|     89 | `params.protocol_fee_bps`      | u16     |
|     91 | `params.creator_fee_bps`       | u16     |
|     93 | `params.migration_fee_bps`     | u16     |
|     95 | `params.initial_virtual_sol`   | u64     |
|    103 | `params.initial_virtual_token` | u64     |
|    111 | `params.curve_supply`          | u64     |
|    119 | `params.token_total_supply`    | u64     |
|    127 | `params.decimals`              | u8      |
|    128 | `params.raydium_amm_config`    | pubkey  |
|    160 | `params.timelock_seconds`      | u32     |
|    164 | `params.launch_fee_usd_cents`  | u16     |
|    166 | `bump`                         | u8      |

### Treasury (deep_curve, 9 bytes)

Discriminator `[238, 239, 123, 238, 89, 1, 168, 253]`.

| offset | field         | type    |
| -----: | ------------- | ------- |
|      0 | discriminator | [u8; 8] |
|      8 | `bump`        | u8      |

### PoolState (deep_amm, 637 bytes)

Discriminator `[247, 237, 227, 245, 215, 195, 222, 70]`.

| offset | field                   | type    |
| -----: | ----------------------- | ------- |
|      0 | discriminator           | [u8; 8] |
|      8 | `amm_config`            | pubkey  |
|     40 | `pool_creator`          | pubkey  |
|     72 | `token_0_vault`         | pubkey  |
|    104 | `token_1_vault`         | pubkey  |
|    136 | `lp_mint`               | pubkey  |
|    168 | `token_0_mint`          | pubkey  |
|    200 | `token_1_mint`          | pubkey  |
|    232 | `token_0_program`       | pubkey  |
|    264 | `token_1_program`       | pubkey  |
|    296 | `observation_key`       | pubkey  |
|    328 | `auth_bump`             | u8      |
|    329 | `status`                | u8      |
|    330 | `lp_mint_decimals`      | u8      |
|    331 | `mint_0_decimals`       | u8      |
|    332 | `mint_1_decimals`       | u8      |
|    333 | `lp_supply`             | u64     |
|    341 | `protocol_fees_token_0` | u64     |
|    349 | `protocol_fees_token_1` | u64     |
|    357 | `fund_fees_token_0`     | u64     |
|    365 | `fund_fees_token_1`     | u64     |
|    373 | `open_time`             | u64     |
|    381 | `recent_epoch`          | u64     |
|    389 | `creator_fee_on`        | u8      |
|    390 | `enable_creator_fee`    | bool    |
|    397 | `creator_fees_token_0`  | u64     |
|    405 | `creator_fees_token_1`  | u64     |

230 bytes of `padding*` fields are not shown.

### AmmConfig (deep_amm, 236 bytes)

Discriminator `[218, 244, 33, 104, 203, 203, 43, 111]`.

| offset | field                    | type    |
| -----: | ------------------------ | ------- |
|      0 | discriminator            | [u8; 8] |
|      8 | `bump`                   | u8      |
|      9 | `disable_create_pool`    | bool    |
|     10 | `index`                  | u16     |
|     12 | `trade_fee_rate`         | u64     |
|     20 | `protocol_fee_rate`      | u64     |
|     28 | `fund_fee_rate`          | u64     |
|     36 | `create_pool_fee`        | u64     |
|     44 | `protocol_owner`         | pubkey  |
|     76 | `fund_owner`             | pubkey  |
|    108 | `creator_fee_rate`       | u64     |
|    116 | `creator_fee_share_rate` | u64     |

112 bytes of `padding*` fields are not shown.

Notes:

- `BondingCurve.complete` (offset 134) becomes true in the trade that sells the last curve token;
  `graduated` (135) and `pool` (145) are set by `graduate`. Fees are snapshotted per curve at
  launch: read the curve's fee fields, not the Config's.
- Curve progress = `(curve_supply − real_token_reserves) / curve_supply` (`depthBps(state)`).
- Spot price (lamports per base unit) = `virtual_sol_reserves / virtual_token_reserves`;
  fully diluted value = `virtual_sol_reserves × token_total_supply / virtual_token_reserves`
  (`marketCapLamports`). That is a valuation at the marginal price, not liquidity.
- `PoolState.status`: bit 0 deposit disabled, bit 1 withdraw disabled, bit 2 swap disabled.
  `creator_fee_on`: 0 both / 1 token0 only / 2 token1 only. Tradable reserves are the vault
  balances minus `protocol_fees_token_*`, `fund_fees_token_*` and `creator_fees_token_*`
  (`cpmmReserves`).
- Every launch is a legacy SPL Token mint (`Tokenkeg…`) with Metaplex metadata created
  immutable, mint authority revoked in `create_token` and no freeze authority. Decimals, supply
  and curve supply come from the Config at launch (devnet today: 6 decimals, 1,000,000,000,000,000
  base units, 800,000,000,000,000 on the curve).

## 5. Events

Anchor `emit!`: a `Program data: <base64>` log line whose first 8 bytes are
`sha256("event:<Name>")[0..8]`. Only trust lines emitted while the DEEP program is the innermost
invoked program; `parseEventsFromLogs`, `parseFeeEventsFromLogs` and `parseAmmSwapEvents` track
the invoke stack, so a CPI from another program cannot spoof DEEP events. Logs can be truncated
by the runtime on very large transactions; for a full record read the transaction, or the
accounts.

### TokenCreated (deep_curve, variable bytes)

Discriminator `[236, 19, 41, 255, 130, 78, 147, 172]`.

| offset | field                | type    |
| -----: | -------------------- | ------- |
|      0 | discriminator        | [u8; 8] |
|      8 | `mint`               | pubkey  |
|     40 | `creator`            | pubkey  |
|     72 | `name`               | string  |
|   var. | `symbol`             | string  |
|   var. | `uri`                | string  |
|   var. | `curve_supply`       | u64     |
|   var. | `token_total_supply` | u64     |

### LaunchFeeCharged (deep_curve, 102 bytes)

Discriminator `[226, 227, 50, 17, 83, 210, 14, 149]`.

| offset | field          | type    |
| -----: | -------------- | ------- |
|      0 | discriminator  | [u8; 8] |
|      8 | `mint`         | pubkey  |
|     40 | `creator`      | pubkey  |
|     72 | `usd_cents`    | u16     |
|     74 | `lamports`     | u64     |
|     82 | `price`        | i64     |
|     90 | `exponent`     | i32     |
|     94 | `publish_time` | i64     |

### TradeEvent (deep_curve, 145 bytes)

Discriminator `[189, 219, 127, 211, 78, 230, 97, 238]`.

| offset | field                    | type    |
| -----: | ------------------------ | ------- |
|      0 | discriminator            | [u8; 8] |
|      8 | `mint`                   | pubkey  |
|     40 | `trader`                 | pubkey  |
|     72 | `is_buy`                 | bool    |
|     73 | `sol_amount`             | u64     |
|     81 | `token_amount`           | u64     |
|     89 | `protocol_fee`           | u64     |
|     97 | `creator_fee`            | u64     |
|    105 | `virtual_sol_reserves`   | u64     |
|    113 | `virtual_token_reserves` | u64     |
|    121 | `real_sol_reserves`      | u64     |
|    129 | `real_token_reserves`    | u64     |
|    137 | `timestamp`              | i64     |

### CurveCompleted (deep_curve, 48 bytes)

Discriminator `[1, 174, 164, 127, 219, 129, 243, 14]`.

| offset | field               | type    |
| -----: | ------------------- | ------- |
|      0 | discriminator       | [u8; 8] |
|      8 | `mint`              | pubkey  |
|     40 | `real_sol_reserves` | u64     |

### Graduated (deep_curve, 80 bytes)

Discriminator `[51, 241, 66, 50, 140, 245, 156, 192]`.

| offset | field           | type    |
| -----: | --------------- | ------- |
|      0 | discriminator   | [u8; 8] |
|      8 | `mint`          | pubkey  |
|     40 | `lp_sol`        | u64     |
|     48 | `lp_tokens`     | u64     |
|     56 | `burned_tokens` | u64     |
|     64 | `migration_fee` | u64     |
|     72 | `timestamp`     | i64     |

### CreatorFeesClaimed (deep_curve, 80 bytes)

Discriminator `[189, 178, 21, 181, 171, 179, 131, 1]`.

| offset | field         | type    |
| -----: | ------------- | ------- |
|      0 | discriminator | [u8; 8] |
|      8 | `mint`        | pubkey  |
|     40 | `creator`     | pubkey  |
|     72 | `amount`      | u64     |

### SwapEvent (deep_amm, 170 bytes)

Discriminator `[64, 198, 205, 232, 38, 8, 113, 226]`.

| offset | field                  | type    |
| -----: | ---------------------- | ------- |
|      0 | discriminator          | [u8; 8] |
|      8 | `pool_id`              | pubkey  |
|     40 | `input_vault_before`   | u64     |
|     48 | `output_vault_before`  | u64     |
|     56 | `input_amount`         | u64     |
|     64 | `output_amount`        | u64     |
|     72 | `input_transfer_fee`   | u64     |
|     80 | `output_transfer_fee`  | u64     |
|     88 | `base_input`           | bool    |
|     89 | `input_mint`           | pubkey  |
|    121 | `output_mint`          | pubkey  |
|    153 | `trade_fee`            | u64     |
|    161 | `creator_fee`          | u64     |
|    169 | `creator_fee_on_input` | bool    |

Decoders: `decodeEvent` / `parseEventsFromLogs` (TokenCreated, TradeEvent, CurveCompleted,
Graduated, CreatorFeesClaimed and the admin events), `decodeFeeEvent` /
`parseFeeEventsFromLogs` (LaunchFeeCharged, ProtocolFeesSwept), `decodeAmmSwapEvent` /
`parseAmmSwapEvents` (SwapEvent). `TradeEvent.sol_amount` is the **gross lamports paid** on a
buy (fees included) and the **net lamports received** on a sell. SwapEvent amounts are
**without** Token-2022 transfer fees, which are reported separately; `creator_fee` is in the input
token when `creator_fee_on_input`, otherwise in the output token. The SwapEvent does not name the
trader: use the transaction's signer.

## 6. Launch lifecycle

1. **New launch.** `create_token` emits `TokenCreated` (and `LaunchFeeCharged` when a launch
   fee is set) and creates the BondingCurve. Detect it from logs (`onLogs(DEEP_CURVE_PROGRAM_ID)`),
   or from accounts: `programSubscribe`/`getProgramAccounts` on deep-curve with a memcmp on the
   BondingCurve discriminator at offset 0. The creator often buys in the same transaction.
2. **Bonding.** Every `buy`/`sell` emits `TradeEvent` with the reserves after the trade.
3. **Complete.** The buy that sells the last curve token emits `CurveCompleted` and sets
   `complete`. From then on `buy` and `sell` fail with `CurveComplete` (6003).
4. **Graduated.** DEEP's migration authority (a crank) calls `graduate`, which creates the
   DeepSwap pool at `graduationPoolPda(mint)`, seeds it at the curve's final price, **burns every
   LP token**, records `BondingCurve.pool` and emits `Graduated`. The pool's `open_time` is 0, so
   cp-swap opens it at creation + 1 s. It is a WSOL/token pool; WSOL is token0 or token1 by mint
   byte order (`sortMints`).
5. **DeepSwap.** Trade the pool with `swap_base_input` / `swap_base_output`. Graduation pools
   created after the creator-fee upgrade have `enable_creator_fee = 1` with the creator fee always
   taken in WSOL (`creator_fee_on` = the WSOL side), and `pool_creator` = the token's creator.

Graduation amounts (`graduationAllocation`, all integer): `migration_fee = ceil(real_sol ×
migration_fee_bps / 10_000)`, `lp_sol = real_sol − migration_fee`, `lp_tokens = floor(lp_sol ×
virtual_token / virtual_sol)` capped at the reserve (`token_total_supply − curve_supply`), and the
rest of the reserve is burned. On devnet today a curve completes at 5 SOL of real reserves
(Config: 1.25 SOL virtual, 800,000,000 of 1,000,000,000 tokens on the curve); the protocol
defaults in `DEFAULT_LAUNCH_PARAMS` (45 SOL virtual) complete at 180 SOL.

## 7. Fee maths and rounding

All maths is integer. Fees and required inputs round **up**, outputs round **down**.

### Curve buy (`buy(sol_in, min_tokens_out, deadline)`) — exact SOL in

With `p = protocol_fee_bps`, `c = creator_fee_bps` read from the BondingCurve (devnet: 70 and 30):

```
fee_total   = ceil(sol_in × (p + c) / 10_000)
fee_creator = floor(sol_in × c / 10_000)
fee_protocol = fee_total − fee_creator
net         = sol_in − fee_total
tokens_out  = floor(virtual_token × net / (virtual_sol + net))
```

If `tokens_out ≥ real_token_reserves`, the buy is **capped**: it takes exactly the remaining
tokens, the SOL needed is `ceil(virtual_sol × tokens / (virtual_token − tokens))` and the program
charges the smallest gross amount whose net covers it (`grossForNet`), not the whole `sol_in`.
Both fees stay on the BondingCurve account: the creator share until `claim_creator_fees`, the
protocol share until `sweep_protocol_fees` moves it to the Treasury. `quoteBuy` returns all of
these. Devnet simulation, 0.01 SOL into a 30%-sold curve: fees 70,000 + 30,000 lamports,
9,900,000 lamports to the curve, 4,540,265,965,507 base units out; the program's TradeEvent
matched the quote exactly.

### Curve sell (`sell(tokens_in, min_sol_out, deadline)`) — exact tokens in

```
sol_from_curve = floor(virtual_sol × tokens_in / (virtual_token + tokens_in))
fee_total / fee_creator / fee_protocol: as above, on sol_from_curve
sol_out        = sol_from_curve − fee_total
```

`tokens_in` may not exceed the tokens the curve has sold, and `sol_from_curve` may not exceed
`real_sol_reserves` (`InsufficientReserves`). Fee rates are capped at 1,000 bps in total
(`MAX_TOTAL_FEE_BPS`), enforced on chain.

### Launch fee (`create_token`)

Charged only when `Config.launch_fee_usd_cents > 0` (devnet today: 200 = $2.00; on-chain hard cap
2,000 = $20.00). Priced from the Pyth SOL/USD `PriceUpdateV2` passed as the 7th account
(`createTokenIx` passes it), **fail-closed**:

- account owned by the Pyth receiver, feed id
  `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`, fully verified;
- age ≤ the build's maximum: **600 s on devnet** (the deployed devnet binary is the `devnet`
  feature build; its ProgramData contains the marker `DEEP devnet build: Pyth max price age 600 s`),
  **120 s** for the default build that mainnet will use (`pythMaxPriceAgeSeconds(cluster)`);
- `price > 0` and `conf × 10_000 ≤ price × 200` (confidence within 2%).

`lamports = ceil(usd_cents × 10^7 × 10^(−exponent) / price)` for `exponent ≤ 0`
(`quoteLaunchFeeLamports`). At the devnet price read on 2026-10-06 (12,114,573,024 × 10^−8 USD)
$2.00 was 16,509,043 lamports. The fee accrues on the new curve's `protocol_fees_unclaimed`
(swept to the Treasury later) and is reported in `LaunchFeeCharged`. Errors: `PriceFeedInvalid`
6022 … `PriceConfidenceTooWide` 6026.

### DeepSwap swap (`swap_base_input(amount_in, minimum_amount_out)`)

Rates are millionths, from the pool's AmmConfig (devnet graduation AmmConfig today:
`trade_fee_rate` 3,000 = 0.30%, `protocol_fee_rate` 333,333 of the trade fee, `fund_fee_rate` 0,
`creator_fee_rate` 3,000, `creator_fee_share_rate` 500,000). With `t` = trade fee rate, `c` =
creator fee rate when the pool has `enable_creator_fee` (else 0):

- **Creator fee on the input** (e.g. a buy on a graduation pool, SOL in):
  `total = ceil(in × (t + c) / 1e6)`, `creator_fee = floor(total × c / (t + c))`,
  `trade_fee = total − creator_fee`; the curve prices `in − total`.
- **Creator fee on the output** (e.g. a sell, SOL out), or none: `trade_fee = ceil(in × t /
1e6)`; the curve prices `in − trade_fee`; then `creator_fee = ceil(out × c / 1e6)` comes off
  what the trader receives.
- Constant product: `out = floor(in_after_fees × reserve_out / (reserve_in + in_after_fees))`.
- Of the trade fee, `floor(trade_fee × protocol_fee_rate / 1e6)` (protocol) and
  `floor(trade_fee × fund_fee_rate / 1e6)` (fund) leave the reserves into the pool's fee
  counters; the rest stays in the pool for LPs. With the devnet rates DEEP's protocol share is ⅓
  of 0.30%, rounded down: on a 1 SOL swap the trade fee is 3,000,000 lamports and the protocol share 999,999.
- The creator fee accrues in `creator_fees_token_*`, outside the reserves. `collect_creator_fee`
  (signed by `pool_creator`) or `collect_creator_fee_permissionless` (anyone pays) settles it:
  the protocol keeps `floor(accrued × creator_fee_share_rate / 1e6)` (a `CreatorFeeShare`
  account for that creator overrides the rate), the creator receives the rest.
- `quoteCpmmSwapBaseInput` implements this; the devnet simulations matched the program's
  SwapEvent exactly in both directions (section 11).

`swap_base_output(max_amount_in, amount_out)` is the exact-out variant (the required input rounds
up). The SDK builds `swap_base_input` only; the accounts are the same 13 in the same order
(see the IDL).

### Token-2022 transfer fees and ScaledUiAmount (any-pair pools)

deep-amm pools can hold Token-2022 mints whose extensions are on its allow list
(TransferFeeConfig, MetadataPointer, TokenMetadata, InterestBearingConfig, ScaledUiAmountConfig;
others need a per-mint `SupportMintAssociated` entry the admin creates). For a swap:
input transfer fee = `ceil(amount_in × bps / 10_000)` capped at the mint's maximum for the
current epoch; the curve prices what reaches the vault; the output transfer fee is withheld from
`amount_out`; `minimum_amount_out` is checked against what the trader receives
(`quoteCpmmSwapWithTransferFees`). Mints with an active TransferHook cannot be traded: deep-amm
does not forward hook accounts. ScaledUiAmount: every on-chain amount and every API amount is
**raw**; display = raw × the mint's current multiplier (`effectiveUiMultiplier`), a displayed
price per token = raw price ÷ multiplier. Graduation pools are SPL Token on both sides, so none of
this applies to them.

## 8. Slippage, deadlines and other guards

| Instruction        | Slippage                                                            | Deadline / time                                                                   |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| curve `buy`        | `min_tokens_out` (`SlippageExceeded` 6007)                          | `deadline` unix seconds, fails when `now > deadline` (`DeadlineExceeded` 6008)    |
| curve `sell`       | `min_sol_out` (6007)                                                | same                                                                              |
| `swap_base_input`  | `minimum_amount_out`, after transfer fees (`ExceededSlippage` 6005) | none: rely on the blockhash expiry; fails before `open_time` (`NotApproved` 6000) |
| `swap_base_output` | `max_amount_in` (6005)                                              | same as above                                                                     |
| `deposit`          | `maximum_token_0/1_amount` (6005)                                   | none                                                                              |
| `withdraw`         | `minimum_token_0/1_amount` (6005)                                   | none                                                                              |

`applySlippage(expected, bps)` rounds the floor down. A curve can complete between quote and
send: on `CurveComplete` (6003) route the trade to the graduation pool once it exists. The admin
can pause deep-curve (`Paused` 6000 for create, buy and sell; claims still work) and DeepSwap
pools (`status` bits). The buyer's token account is created by `buy` itself if missing
(`init_if_needed`, the buyer pays its rent).

## 9. Error codes

Anchor custom errors appear as `{"InstructionError":[ix,{"Custom":<code>}]}` and in the logs as
`Error Code: <Name>`. Both programs number from 6000, so map codes per program id.

### deep_curve errors

| code | hex    | name                   | message                                                     |
| ---: | ------ | ---------------------- | ----------------------------------------------------------- |
| 6000 | 0x1770 | Paused                 | Protocol is paused                                          |
| 6001 | 0x1771 | Unauthorized           | Unauthorized                                                |
| 6002 | 0x1772 | ZeroAmount             | Amount must be greater than zero                            |
| 6003 | 0x1773 | CurveComplete          | Bonding curve is complete                                   |
| 6004 | 0x1774 | CurveNotComplete       | Bonding curve is not complete                               |
| 6005 | 0x1775 | AlreadyGraduated       | Token already graduated                                     |
| 6006 | 0x1776 | InsufficientReserves   | Insufficient curve reserves                                 |
| 6007 | 0x1777 | SlippageExceeded       | Slippage tolerance exceeded                                 |
| 6008 | 0x1778 | DeadlineExceeded       | Quote deadline exceeded                                     |
| 6009 | 0x1779 | InvalidFee             | Invalid fee configuration                                   |
| 6010 | 0x177a | InvalidParams          | Invalid parameters                                          |
| 6011 | 0x177b | InvalidMetadata        | Invalid token metadata                                      |
| 6012 | 0x177c | InvalidFeeRecipient    | Fee recipient does not match config                         |
| 6013 | 0x177d | Overflow               | Arithmetic overflow                                         |
| 6014 | 0x177e | InsolventCurve         | Curve account would become insolvent                        |
| 6015 | 0x177f | InsufficientTreasury   | Withdrawal exceeds treasury balance above rent              |
| 6016 | 0x1780 | InvalidPool            | Invalid AMM pool account                                    |
| 6017 | 0x1781 | TimelockNotElapsed     | Config update timelock has not elapsed                      |
| 6018 | 0x1782 | NoPendingConfigUpdate  | No config update is queued                                  |
| 6019 | 0x1783 | ConfigUpdatePending    | A config update is already queued; cancel it first          |
| 6020 | 0x1784 | ConfigUpdateExpired    | Queued config update expired; cancel and re-queue           |
| 6021 | 0x1785 | LaunchFeeAboveCap      | Launch fee exceeds the hard cap                             |
| 6022 | 0x1786 | PriceFeedInvalid       | Invalid Pyth price account (address, owner, layout or feed) |
| 6023 | 0x1787 | PriceNotFullyVerified  | Pyth price update is not fully verified                     |
| 6024 | 0x1788 | PriceStale             | Pyth price is stale                                         |
| 6025 | 0x1789 | PriceNonPositive       | Pyth price is not positive                                  |
| 6026 | 0x178a | PriceConfidenceTooWide | Pyth price confidence interval too wide                     |

### deep_amm errors

| code | hex    | name                         | message                                                          |
| ---: | ------ | ---------------------------- | ---------------------------------------------------------------- |
| 6000 | 0x1770 | NotApproved                  | Not approved                                                     |
| 6001 | 0x1771 | InvalidOwner                 | Input account owner is not the program address                   |
| 6002 | 0x1772 | EmptySupply                  | Input token account empty                                        |
| 6003 | 0x1773 | InvalidInput                 | InvalidInput                                                     |
| 6004 | 0x1774 | IncorrectLpMint              | Address of the provided lp token mint is incorrect               |
| 6005 | 0x1775 | ExceededSlippage             | Exceeds desired slippage limit                                   |
| 6006 | 0x1776 | ZeroTradingTokens            | Given pool token amount results in zero trading tokens           |
| 6007 | 0x1777 | NotSupportMint               | Not support token_2022 mint extension                            |
| 6008 | 0x1778 | InvalidVault                 | invaild vault                                                    |
| 6009 | 0x1779 | InitLpAmountTooLess          | Init lp amount is too less(Because 100 amount lp will be locked) |
| 6010 | 0x177a | TransferFeeCalculateNotMatch | TransferFee calculate not match                                  |
| 6011 | 0x177b | MathOverflow                 | Math overflow                                                    |
| 6012 | 0x177c | InsufficientVault            | Insufficient vault                                               |
| 6013 | 0x177d | InvalidFeeModel              | Invalid fee model                                                |
| 6014 | 0x177e | NoFeeCollect                 | Fee is zero                                                      |
| 6015 | 0x177f | LamportsCalculateError       | Lamports calculate error                                         |

## 10. Compute units

Measured on devnet (`unitsConsumed`), not estimates. "Simulated" = this guide's examples on
2026-10-06; "live" = confirmed transactions of the 2026-10-04 DeepSwap campaign
(`docs/live-tests/devnet-2026-10-04-deepswap.md`); LiteSVM figures are in `docs/PROGRAMS.md`.

| Instruction                                   | Measured CU                                                   | Suggested limit                    |
| --------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| deep-curve `create_token` (with launch fee)   | 80,964 – 89,964 live                                          | 120,000                            |
| deep-curve `buy`                              | 55,582 simulated; 37,732 – 51,232 live                        | 80,000                             |
| deep-curve `sell`                             | 19,268 simulated; 20,918 – 23,918 live                        | 60,000                             |
| deep-curve `claim_creator_fees`               | 5,751 simulated; 5,902 live                                   | 20,000                             |
| deep-curve `graduate` (creates the pool)      | 185,340 – 191,340 live                                        | 400,000 (`GRADUATE_COMPUTE_UNITS`) |
| deep-amm `swap_base_input`                    | 25,903 – 26,029 simulated; 25,868 – 26,339 live               | 60,000 per swap                    |
| deep-amm `deposit`                            | 26,812 simulated                                              | 60,000                             |
| deep-amm `withdraw`                           | 27,016 simulated                                              | 60,000                             |
| deep-amm `collect_creator_fee_permissionless` | 84,205 simulated (incl. 2 ATA creations, then `NoFeeCollect`) | 150,000                            |
| associated-token create (idempotent)          | 13,413 – 13,417 simulated                                     | 25,000 each                        |

## 11. Example transactions (devnet simulations)

`packages/sdk/examples/` builds real transactions and simulates them on devnet with
`sigVerify: false`: nothing is signed or sent and no keypair is read. `--payer <public key>`
chooses whose account the simulation runs as (default: a funded devnet key from the Config).

```bash
pnpm --filter @deepliquidity/sdk exec tsx examples/read-curve.ts
pnpm --filter @deepliquidity/sdk exec tsx examples/quote-and-buy.ts --mint <mint>
pnpm --filter @deepliquidity/sdk exec tsx examples/sell.ts --mint <mint>
pnpm --filter @deepliquidity/sdk exec tsx examples/deepswap-swap.ts --mint <graduated mint> [--side sell]
pnpm --filter @deepliquidity/sdk exec tsx examples/deepswap-liquidity.ts --mint <graduated mint>
pnpm --filter @deepliquidity/sdk exec tsx examples/claim-creator-fees.ts
pnpm --filter @deepliquidity/sdk exec tsx examples/watch-launches.ts --seconds 60 --backfill 10
```

Results on 2026-10-06:

| Example                     | Instructions                                                             | Result                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quote-and-buy`             | compute budget, `buy`                                                    | success, 55,732 CU; TradeEvent = quote exactly                                                                                                                |
| `sell`                      | compute budget, `sell`                                                   | success, 19,418 CU; seller received 2,014,919 lamports = quote                                                                                                |
| `deepswap-swap`             | 2 × ATA, wrap, `swap_base_input`, unwrap                                 | success, 53,478 CU; SwapEvent output = quote exactly                                                                                                          |
| `deepswap-swap --side sell` | the same with a buy then a sell of exactly what it bought                | success, 79,381 CU; both SwapEvents = quotes                                                                                                                  |
| `deepswap-liquidity`        | 3 × ATA, wrap, swap, `deposit`, `withdraw`, unwrap, zero-slippage limits | success, 120,720 CU                                                                                                                                           |
| `claim-creator-fees`        | `claim_creator_fees`; `collect_creator_fee_permissionless`               | claim: success, CreatorFeesClaimed 15,151,515 lamports. Collect: rejected with `NoFeeCollect` (6014) as expected: no devnet pool has accrued creator fees yet |
| `watch-launches`            | `onLogs` on both programs + backfill                                     | decoded TokenCreated, LaunchFeeCharged, TradeEvent, ConfigUpdated…                                                                                            |

## 12. HTTP API

Base `https://api.deepliquidity.fun` (devnet data). The OpenAPI 3.1 document is served at
`GET /v1/openapi.json` (`cache-control: public, max-age=300`); its parameters are the server's own
validation schemas and its response schemas are tested against real responses
(`apps/api/test/openapi.test.ts`).

| Route                                                         | What                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /v1/tokens`, `/v1/tokens/{mint}`                         | launches with curve state (indexed)                        |
| `GET /v1/tokens/{mint}/trades?limit=1..500`                   | curve trades, newest first                                 |
| `GET /v1/tokens/{mint}/candles?tf=`                           | `1m 5m 15m 1h 4h 24h 7d`, price in SOL per whole token     |
| `GET /v1/tokens/{mint}/stats`                                 | 24h stats, holders from chain, sanitized metadata          |
| `GET /v1/creators/{creator}/tokens`                           | a creator's launches                                       |
| `GET /v1/traders/{wallet}/trades?limit=1..100`                | a wallet's curve and DeepSwap trades                       |
| `GET /v1/pools`, `/v1/pools/{address}/tvl`                    | graduation pools with on-chain LP status, TVL history      |
| `GET /v1/pairs`, `/v1/pairs/{address}`, `/trades`, `/candles` | every DeepSwap pool, any pair                              |
| `GET /v1/stocks`                                              | tokenized stock listings (devnet: TEST stocks only)        |
| `GET /v1/stats`, `/v1/stats/tvl?days=1..90`                   | protocol totals, TVL history                               |
| `GET /v1/price/sol`, `/v1/network`, `/v1/status`              | Pyth SOL/USD, cluster info, monitors + program hash check  |
| `GET /v1/ws` (WebSocket)                                      | `{"subscribe":"tokens"}` / `{"subscribe":"trades:<mint>"}` |

Rate limits (per client IP, `@fastify/rate-limit`, from `apps/api/src`): **300 requests per
minute** by default; `/v1/tokens/{mint}/stats` and `/v1/pools/{address}/tvl` **120 per minute**;
`POST /v1/metadata` 10 per minute; `POST /v1/reports` 5 per minute; `POST
/v1/tokens/{mint}/links` 10 per minute per IP and 6 per 10 minutes per mint. Responses carry
`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`; a 429 carries `retry-after`.
WebSocket: 20 topics per connection, 4,096-byte client messages; messages are
`{"topic": "...", "data": TokenSummary | Trade}`. Browser CORS is limited to DEEP's own sites on
the hosted API: call it from a server. Amounts are decimal strings of integers. The indexer is a
convenience; build transactions from chain reads.

## 13. Differences from pump.fun and from Raydium CPMM

If your integration was written for pump.fun, change these (verify the pump.fun side against
its own IDL; this list only states DEEP's behaviour):

- Different program, account layouts, discriminators and event names: use the IDLs above.
- `buy` is **exact SOL in** with `min_tokens_out`; `sell` is exact tokens in with
  `min_sol_out`; both take a `deadline` (unix seconds).
- Fees are taken in SOL on both sides (on the input of a buy, on the output of a sell), split
  protocol/creator by bps snapshotted on each curve. The creator's share accrues on the curve and
  is claimed with `claim_creator_fees`; nothing is sent to a fee account during a trade.
- A USD launch fee priced from Pyth, fail-closed (section 7).
- Graduation creates a pool on **DeepSwap (deep-amm)**, not on a third-party DEX, at
  `graduationPoolPda(mint)`, and burns all LP. Completion and graduation are separate steps
  (`CurveCompleted`, then `Graduated` from the crank).
- Tokens are legacy SPL Token mints with immutable Metaplex metadata; mint authority revoked, no
  freeze authority.

DeepSwap compared with Raydium CPMM (cp-swap): deep-amm is a fork of raydium-cp-swap commit
`b3187ae` (Apache-2.0, `programs/deep-amm/NOTICE`).

- **Same**: account layouts (PoolState 637 bytes, AmmConfig 236 bytes), instruction names,
  arguments and account order, discriminators, seeds, SwapEvent, swap maths (`src/curve/*` is
  unmodified). A cp-swap integration works by swapping the program id.
- **Different program id** (`HCrCy6…`), one id for every cluster, and DEEP-controlled privileged
  keys (admin, fee owners, create-pool fee receiver) fixed at build time.
- **Graduation pools live at a deep-curve PDA**, not at the cp-swap pool PDA (section 3).
- `swap_base_output` rejects an `amount_out` ≥ the whole output reserve with
  `InsufficientVault` (6012) instead of panicking.
- Graduation pools charge the creator fee (in WSOL) on top of the trade fee; pools created with
  the permissionless `initialize` never do.
- Not routed by Jupiter yet: `docs/JUPITER.md` has the adapter and what is pending.

## 14. Publishing the packages (owner decisions)

Nothing is published. To prepare a release:

```bash
node scripts/pack-packages.mjs          # tsc → dist/, stage in target/npm/, smoke tests, npm pack --dry-run
node scripts/check-public-sdk.mjs       # leak check of the exact npm file lists
```

The staged packages get the scope from `packages/publish.config.json` (placeholder
`@deepliquidity`), `workspace:*` replaced by versions, and exports pointing at `dist/`. The
workspace packages stay `private` and keep exporting `src/`, so the apps are unaffected. Before
publishing, the owner decides: the npm scope and org, whether the repository (or an SDK-only
repository) is public and its `repository` field, and the licences (packages: MIT for
`curve-math` and `shared-types`; `MIT AND Apache-2.0` for the SDK, whose cp-swap ports are
Apache-2.0 per its `NOTICE`; the repository root has no LICENSE file yet).

## 15. How this was verified

- `packages/sdk/test/idl.test.ts`: IDL ids, every discriminator, account sizes, and every field of
  every decoded account and event against the IDL layout (random bytes decoded both ways).
- `packages/sdk/scripts/idl-devnet-check.ts`: the same against every live devnet account and the
  events of recent transactions; both ProgramData hashes equal the recorded release hashes.
- `packages/sdk/test/browser-globals.test.ts` and `scripts/pack-packages.mjs`: the packages load
  and build instructions in a browser bundle with no global `Buffer`.
- `apps/api/test/openapi.test.ts`: route coverage both ways, parameters, rate limits, responses.
- Not run here: the Rust side of the IDL parity (`programs/deep-curve/tests/idl_parity.rs`,
  needs Docker) and anything on mainnet.
