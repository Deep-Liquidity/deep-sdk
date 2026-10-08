# Integrating DEEP (trading terminals, aggregators, indexers)

Everything a terminal, aggregator, screener or indexer needs to support DEEP's launchpad
(**deep-curve**) and DEX (**DeepSwap**, the **deep-amm** program) without asking us: addresses,
byte layouts, events, the exact fee maths, errors, compute budgets, runnable examples and the
public HTTP API.

> **Status (2026-10-08).** deep-curve, deep-amm and deep-rewards are deployed on **Solana
> mainnet-beta** and on **devnet**, at the same program ids, with the **DEEP V1 fee model**
> (per-side DEEP fees, a reward model and rate chosen per token and per pool). Mainnet was
> deployed and initialised on 2026-10-08; every pool there is V1.
> Pools created on devnet before 2026-10-08 keep the legacy fee model: read `fee_model` on
> every pool. The live values, compute units and examples in this guide were measured on devnet.

Where the numbers come from: program ids, PDAs and decoders from `@deepliquidity/sdk`; byte layouts,
instruction account lists and error codes generated from the IDLs of all three programs; fee
maths from `@deepliquidity/curve-math`, which mirrors the programs; live values and compute units from
devnet reads and simulations on 2026-10-06 (`packages/sdk/examples`).

## 1. Packages, IDLs and API

| What                   | Where                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| TypeScript SDK         | `@deepliquidity/sdk` (PDAs, instruction builders, account + event decoders, quotes)                 |
| Curve maths            | `@deepliquidity/curve-math` (BigInt, bit-for-bit with the Rust program)                             |
| API types              | `@deepliquidity/shared-types`                                                                       |
| Anchor IDLs (spec 0.1) | `idl/deep_curve.json`, `idl/deep_amm.json`; in the npm package `<sdk>/idl/deep_curve.json` |
| HTTP API               | `https://api.deepliquidity.fun/v1/…`, OpenAPI 3.1 at `GET /v1/openapi.json`                |

The npm packages are **not published yet**: use the packages from the SDK repository.

There is no on-chain Anchor IDL account for either program; the repository files are the
source. They are checked against devnet: every live account of every IDL type has the IDL's
size and decodes to the same values with the IDL layout and with the SDK, and the same holds for
the events in recent transactions.

## 2. Addresses per cluster

| Account                                 | devnet                                              | mainnet-beta                                              |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| deep-curve program                      | `7czURwVLkQpcF1HVhhZU5GGzvPA8YniogZY1BhZHCDtA`      | same address                                              |
| deep-amm (DeepSwap) program             | `HCrCy6bzHhZ1b6bXwQAucEFkKXyzYMh3hgAR8UPrYSEP`      | same address                                              |
| deep-curve Config (`["config"]`)        | `66TKkpLt9XJxALWGkR5vE7z1nAWVFiwtLGZhg79HPn62`      | same address                                              |
| deep-curve Treasury (`["treasury"]`)    | `GqxLdYqarHucFdko8GGGBESNzdWzFGSe76ympb6Le6Kh`      | same address                                              |
| deep-curve PendingConfig                | `2pUiest4kgcheWQsD8w8r5H8wJDSZrfwWPBQF9carmBR`      | same address; exists only while a config change is queued |
| DEEP fee vault (`["fee_vault"]`, V1)    | `8a2XakVBzdMRJ6gMY6u8mvebzJGgbmG6nVBVPB8uwBVZ`      | same address                                              |
| fee vault WSOL ATA (create-pool fee)    | `EcnANJ5kYr7a8LpiH4ETkSGD3r7SDdicUn9ttf5MWCir`      | same address                                              |
| SplitterConfig (`["splitter"]`, V1)     | `DcWWvcELfMkh7xCYBgASu4RnbxLkfuFByLrCVE6vFpR4`      | same address                                              |
| DeepSwap AmmConfig used by graduations  | `4uaSjxHZdeNP8YyrZ72QQE7uHZV9gqttTBJS38V389pJ` (#1) | `8UY49GiUH4jR9RkUYTCHPpuKu5WQsFaf6KCTeUxQojoS` (#0, V1)   |
| legacy AmmConfig (pools before V1)      | `8UY49GiUH4jR9RkUYTCHPpuKu5WQsFaf6KCTeUxQojoS` (#0) | none: mainnet has no legacy config                        |
| deep-rewards program (Holder Rewards)   | `4z2KpxUcdNFXFpzxKtcmTv6aDMqE4CMLCdbYExLYeDE2`      | same address                                              |
| deep-amm vault/LP authority             | `9Ed3EyFMgN3q2SbAJPcPNp6aDacgRGF5RyFT7smVSn8o`      | same address                                              |
| Pyth SOL/USD PriceUpdateV2 (launch fee) | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`      | same address                                              |
| Pyth receiver program (its owner)       | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`       | same address                                              |
| Metaplex Token Metadata                 | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`       | same address                                              |

The SDK exports these as `DEEP_CURVE_PROGRAM_ID`, `DEEP_AMM_PROGRAM_ID`, `configPda()`,
`treasuryPda()`, `pendingConfigPda()`, `cpmmAuthority(DEEP_AMM_PROGRAM_ID)`,
`PYTH_SOL_USD_PRICE_UPDATE`, `PYTH_RECEIVER_PROGRAM_ID` and `TOKEN_METADATA_PROGRAM_ID`. The
program ids and every PDA are the same on both clusters. The AmmConfig index differs: mainnet
started at V1, so its V1 config is #0, while devnet's is #1 next to the legacy #0. The graduation
AmmConfig is read from `Config.raydium_amm_config`, never hard-coded.

## 3. PDAs and seeds

| Account                            | Program    | Seeds                                                       | SDK                                |
| ---------------------------------- | ---------- | ----------------------------------------------------------- | ---------------------------------- |
| Config                             | deep-curve | `"config"`                                                  | `configPda()`                      |
| Treasury                           | deep-curve | `"treasury"`                                                | `treasuryPda()`                    |
| PendingConfig                      | deep-curve | `"pending_config"`                                          | `pendingConfigPda()`               |
| fee vault (V1)                     | deep-curve | `"fee_vault"`                                               | `feeVaultPda()`                    |
| SplitterConfig (V1)                | deep-curve | `"splitter"`                                                | `splitterPda()`                    |
| PendingSplitterUpdate (V1)         | deep-curve | `"pending_splitter"`                                        | `pendingSplitterPda()`             |
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
The sizes below are the DEEP V1 layouts: Config 221 bytes (`CONFIG_SIZE`), BondingCurve 196 (`BONDING_CURVE_SIZE`),
PendingConfig 173 (`PENDING_CONFIG_SIZE`). The decoders also accept the earlier sizes (Config
213 / 215, BondingCurve 177 / 185, PendingConfig 165 / 167) and then report the sell rate equal
to the buy rate and no reward model. PoolState (637) and AmmConfig (236) did not change size:
the V1 fields were carved from padding and read as zero (legacy) on older accounts.

### Config (deep_curve, 221 bytes)

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
|    215 | `sell_protocol_fee_bps` | u16     |
|    217 | `max_reward_bps`        | u16     |
|    219 | `reserved_bps`          | u16     |

### BondingCurve (deep_curve, 196 bytes)

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
|    185 | `sell_protocol_fee_bps`   | u16     |
|    187 | `reward_model`            | u8      |
|    188 | `holder_fees_unclaimed`   | u64     |

### PendingConfig (deep_curve, 173 bytes)

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
|    166 | `params.sell_protocol_fee_bps` | u16     |
|    168 | `params.max_reward_bps`        | u16     |
|    170 | `params.reserved_bps`          | u16     |
|    172 | `bump`                         | u8      |

### Treasury (deep_curve, 9 bytes)

Discriminator `[238, 239, 123, 238, 89, 1, 168, 253]`.

| offset | field         | type    |
| -----: | ------------- | ------- |
|      0 | discriminator | [u8; 8] |
|      8 | `bump`        | u8      |

### SplitterConfig (deep_curve, 539 bytes)

Discriminator `[37, 70, 66, 89, 147, 213, 59, 153]`.

| offset | field                     | type             |
| -----: | ------------------------- | ---------------- |
|      0 | discriminator             | [u8; 8]          |
|      8 | `bump`                    | u8               |
|      9 | `vault_bump`              | u8               |
|     10 | `count`                   | u8               |
|     11 | `destinations`            | [Destination; 8] |
|    411 | `base_total`              | u128             |
|    427 | `builder_paid_total`      | u64              |
|    435 | `retained`                | u64              |
|    443 | `min_distribute_lamports` | u64              |
|    451 | `distributions`           | u64              |
|    459 | `last_distribute_at`      | i64              |
|    467 | `destinations_paid_total` | u64              |
|    475 | `builder_owed`            | u64              |

56 bytes of `padding*` fields are not shown.

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
|    413 | `fee_model`             | u8      |
|    414 | `reward_model`          | u8      |
|    421 | `reward_rate_snapshot`  | u64     |

220 bytes of `padding*` fields are not shown.

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
|    124 | `fee_model`              | u8      |
|    132 | `buy_lp_fee_rate`        | u64     |
|    140 | `buy_protocol_fee_rate`  | u64     |
|    148 | `sell_lp_fee_rate`       | u64     |
|    156 | `sell_protocol_fee_rate` | u64     |
|    164 | `max_reward_rate`        | u64     |

71 bytes of `padding*` fields are not shown.

Notes:

- `BondingCurve.complete` (offset 134) becomes true in the trade that sells the last curve token;
  `graduated` (135) and `pool` (145) are set by `graduate`. Fees are fixed per curve at
  launch: read the curve's fee fields, not the Config's. `protocol_fee_bps` is DEEP's rate on
  buys, `sell_protocol_fee_bps` on sells, `creator_fee_bps` the token's own reward rate (0 for
  Standard) and `reward_model` who receives it (0 Standard, 1 Creator, 2 Holder);
  `curveFees(decodeBondingCurve(data))` returns all four.
- V1 `PoolState`: `fee_model` 1, `reward_model`, `reward_rate_snapshot` (the pool's own rate,
  per 1e6) and `pool_creator`, the only address the reward part is paid to (the creator, or the
  token's holder vault). `creator_fee_on` names the QUOTE side of a V1 pool (1 token0,
  2 token1). V1 `AmmConfig`: `fee_model` 1, `buy_lp_fee_rate`, `buy_protocol_fee_rate`,
  `sell_lp_fee_rate`, `sell_protocol_fee_rate`, `max_reward_rate`; its legacy fields mirror the
  buy side. `cpmmPoolFeeRates(config, pool)` returns what each side pays for either model.
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

### RewardsConfig (deep_rewards, 390 bytes)

deep-rewards' one config account (`rewardsConfigPda()`, decoder `decodeRewardsConfig`). `root_delay_seconds` is how long a published Holder Rewards root waits before anyone can claim against it (at least 43 200 s = 12 h on chain; 86 400 s = 24 h on mainnet). `guardian` is a veto-only key: it may sign `veto_root` and `set_paused` and nothing else; the zero key means none is set.

Discriminator `[27, 65, 81, 182, 166, 101, 190, 207]`.

| offset | field                    | type        |
| -----: | ------------------------ | ----------- |
|      0 | discriminator            | [u8; 8]     |
|      8 | `version`                | u8          |
|      9 | `bump`                   | u8          |
|     10 | `admin`                  | pubkey      |
|     42 | `pending_admin`          | pubkey      |
|     74 | `root_authority`         | pubkey      |
|    106 | `payout_mode`            | u8          |
|    107 | `paused`                 | bool        |
|    108 | `root_delay_seconds`     | u32         |
|    112 | `max_proof_len`          | u8          |
|    113 | `push_min_usd_micros`    | u64         |
|    121 | `min_holding_usd_micros` | u64         |
|    129 | `max_price_age_seconds`  | u32         |
|    133 | `sol_usd_price_update`   | pubkey      |
|    165 | `stable_count`           | u8          |
|    166 | `stable_mints`           | [pubkey; 4] |
|    294 | `stray_recipient`        | pubkey      |
|    326 | `guardian`               | pubkey      |
|    358 | `reserved`               | [u8; 32]    |

### Distributor (deep_rewards, 465 bytes)

One per (token mint, reward asset), at `distributorPda(mint, reward_mint)` (the WSOL mint means native SOL); decoder `decodeDistributor`. A Holder Rewards pool opened with `initialize_v1` needs the (base token, WSOL) distributor to exist. `has_pending` / `pending_eta`: a published root that is not claimable yet.

Discriminator `[90, 90, 217, 147, 6, 32, 135, 4]`.

| offset | field                     | type     |
| -----: | ------------------------- | -------- |
|      0 | discriminator             | [u8; 8]  |
|      8 | `version`                 | u8       |
|      9 | `bump`                    | u8       |
|     10 | `vault_bump`              | u8       |
|     11 | `mint`                    | pubkey   |
|     43 | `reward_mint`             | pubkey   |
|     75 | `reward_token_program`    | pubkey   |
|    107 | `reward_decimals`         | u8       |
|    108 | `holder_vault`            | pubkey   |
|    140 | `token_vault`             | pubkey   |
|    172 | `vault_reserve`           | u64      |
|    180 | `round`                   | u32      |
|    184 | `root`                    | [u8; 32] |
|    216 | `max_total_claim`         | u64      |
|    224 | `total_claimed`           | u64      |
|    232 | `snapshot_slot`           | u64      |
|    240 | `data_hash`               | [u8; 32] |
|    272 | `activated_at`            | i64      |
|    280 | `has_pending`             | bool     |
|    281 | `pending_root`            | [u8; 32] |
|    313 | `pending_max_total_claim` | u64      |
|    321 | `pending_snapshot_slot`   | u64      |
|    329 | `pending_data_hash`       | [u8; 32] |
|    361 | `pending_eta`             | i64      |
|    369 | `created_by`              | pubkey   |
|    401 | `reserved`                | [u8; 64] |

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
|   var. | `reward_model`       | u8      |
|   var. | `reward_bps`         | u16     |

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

### TradeEvent (deep_curve, 154 bytes)

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
|    145 | `reward_model`           | u8      |
|    146 | `holder_fee`             | u64     |

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

### ProtocolFeesSwept (deep_curve, 48 bytes)

Discriminator `[233, 66, 206, 184, 30, 100, 130, 85]`.

| offset | field         | type    |
| -----: | ------------- | ------- |
|      0 | discriminator | [u8; 8] |
|      8 | `mint`        | pubkey  |
|     40 | `amount`      | u64     |

### RevenueDistributed (deep_curve, variable length; DEEP V1)

Emitted by `distribute`. Borsh, in order: `base` u64 (new revenue this round), `retained_in` u64,
`builder_amount` u64 (paid now), `builder_owed` u64 (still due), `builder_paid_total` u64
(= floor(`base_total` / 10)), `base_total` u128, `wallets` Vec<pubkey>, `amounts` Vec<u64>,
`owed` Vec<u64>, `retained` u64, `wsol_unwrapped` u64, `timestamp` i64. Decoded by
`parseFeeEventsFromLogs` / `decodeFeeEvent` (also `SplitterUpdated`, `SplitterUpdateQueued`,
`SplitterUpdateCancelled`, `VaultTokensWithdrawn`).

### BuilderFeePaid (deep_curve, 64 bytes; retired)

Emitted only by builds before DEEP V1 (devnet history); still decoded.
Discriminator `[177, 54, 109, 52, 55, 26, 75, 41]`.

| offset | field             | type    |
| -----: | ----------------- | ------- |
|      0 | discriminator     | [u8; 8] |
|      8 | `mint`            | pubkey  |
|     40 | `base`            | u64     |
|     48 | `builder_amount`  | u64     |
|     56 | `treasury_amount` | u64     |

### CreatorFeesClaimed (deep_curve, 80 bytes)

Discriminator `[189, 178, 21, 181, 171, 179, 131, 1]`.

| offset | field         | type    |
| -----: | ------------- | ------- |
|      0 | discriminator | [u8; 8] |
|      8 | `mint`        | pubkey  |
|     40 | `creator`     | pubkey  |
|     72 | `amount`      | u64     |

### HolderFeesSwept (deep_curve, 80 bytes)

Emitted by `sweep_holder_fees` and by `graduate` when a Holder Rewards curve's accrued reward fees move to the token's deep-rewards holder vault. Decoded by `parseFeeEventsFromLogs` / `decodeFeeEvent`.

Discriminator `[114, 254, 204, 95, 102, 185, 235, 146]`.

| offset | field          | type    |
| -----: | -------------- | ------- |
|      0 | discriminator  | [u8; 8] |
|      8 | `mint`         | pubkey  |
|     40 | `holder_vault` | pubkey  |
|     72 | `amount`       | u64     |

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

### SwapFeesV1 (deep_amm, 98 bytes)

Emitted next to `SwapEvent` by a swap on a DEEP V1 pool (`fee_model` 1): the fee parts of that swap, all in the pool's quote token. Decoded by `decodeAmmSwapFeesV1`; `parseAmmSwapEventsWithSource` returns it as `feesV1` next to its swap.

Discriminator `[199, 3, 11, 188, 36, 121, 207, 192]`.

| offset | field          | type    |
| -----: | -------------- | ------- |
|      0 | discriminator  | [u8; 8] |
|      8 | `pool_id`      | pubkey  |
|     40 | `is_buy`       | bool    |
|     41 | `quote_mint`   | pubkey  |
|     73 | `lp_fee`       | u64     |
|     81 | `protocol_fee` | u64     |
|     89 | `reward_fee`   | u64     |
|     97 | `reward_model` | u8      |

## 6. Launch lifecycle

1. **New launch.** `create_token` emits `TokenCreated` (and `LaunchFeeCharged` when a launch
   fee is set) and creates the BondingCurve. Detect it from logs (`onLogs(DEEP_CURVE_PROGRAM_ID)`),
   or from accounts: `programSubscribe`/`getProgramAccounts` on deep-curve with a memcmp on the
   BondingCurve discriminator at offset 0. The creator often buys in the same transaction.
2. **Bonding.** Every `buy`/`sell` emits `TradeEvent` with the reserves after the trade.
3. **Complete.** The buy that sells the last curve token emits `CurveCompleted` and sets
   `complete`. From then on `buy` and `sell` fail with `CurveComplete` (6003).
4. **Graduated.** Anyone can send `graduate` (it is permissionless: no account signs, the
   sender pays the network fee and receives nothing; it normally follows completion within about
   30 s, and `Config.migration_authority` is read by no instruction). It creates the
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

With `p` = DEEP's rate of the side (`protocol_fee_bps` on a buy, `sell_protocol_fee_bps` on a
sell) and `c = creator_fee_bps`, the token's own reward rate, all read from the BondingCurve
(a devnet V1 launch: 125 / 125 and whatever its creator chose, 0 to 500; a curve launched
before V1 keeps its 70 and 30). The reward part goes to the creator or, on a Holder Rewards
token, to the holder vault (`reward_model`):

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
protocol share until `sweep_protocol_fees` moves it to the DEEP fee vault, a Holder token's
reward until `sweep_holder_fees` moves it to its holder vault. `quoteBuyV1(state, solIn,
curveFees(curve))` returns all of these (`quoteBuy` is the pre-V1 form with one protocol rate).
Checked on devnet on 2026-10-08: 17 curve trades on Standard, Creator (100 and 500 bps) and
Holder (100 bps) tokens, every quote equal to the program's TradeEvent in every field. Example: 0.5 SOL into a 100 bps Creator token
pays 11,250,000 lamports: 6,250,000 to DEEP and 5,000,000 to the creator.

### Curve sell (`sell(tokens_in, min_sol_out, deadline)`) — exact tokens in

```
sol_from_curve = floor(virtual_sol × tokens_in / (virtual_token + tokens_in))
fee_total / fee_creator / fee_protocol: as above, on sol_from_curve
sol_out        = sol_from_curve − fee_total
```

`tokens_in` may not exceed the tokens the curve has sold, and `sol_from_curve` may not exceed
`real_sol_reserves` (`InsufficientReserves`). DEEP's rate plus the reward rate is capped at
1,000 bps per side (`MAX_TOTAL_FEE_BPS`) and a reward rate at 500 bps (`MAX_REWARD_BPS`), both
enforced on chain.

### Where DEEP's fees go: the fee vault and splitter

None of this changes what a trader pays. Every DEEP fee lands in one deep-curve PDA, the fee
vault `8a2X…uwBVZ`, and the permissionless `distribute` splits it:

| Source                              | Rate (devnet policy)                 | Into the vault by                                   |
| ----------------------------------- | ------------------------------------ | --------------------------------------------------- |
| curve protocol fee                  | 125 bps of each buy and each sell    | `sweep_protocol_fees(mint)` (anyone), `graduate`    |
| launch fee                          | $2.00 in SOL (Pyth), cap $20         | accrues on the curve, then as above                 |
| migration fee remainder             | 1% of the raise − pool costs         | `graduate`                                          |
| DeepSwap protocol fee, V1 pools     | 0.25% of a buy, 0.65% of a sell      | `collect_protocol_fee_to_vault` (anyone)            |
| DeepSwap protocol fee, legacy pools | 333,333 / 1e6 of the 0.30% trade fee | `collect_protocol_fee_to_vault` (anyone)            |
| DEEP's half of a legacy creator fee | 500,000 / 1e6 of the creator fee     | booked as protocol fee on settlement, then as above |
| DeepSwap create-pool fee            | 0.15 SOL per pool                    | deep-amm pays it into the vault's WSOL ATA          |

```
revenue        = new lamports in the vault (WSOL unwrapped) − rent − owed − carried dust
base_total    += revenue
builder        = floor(base_total × 1000 / 10000) − builder_paid_total   (exactly 10% over time)
pool           = revenue − builder + retained
destination_i  = floor(pool × bps_i / 10000)                             (bps sum to 10000)
retained       = pool − Σ destination_i                                  (carried to the next round)
```

The builder wallet (`DEEP_BUILDER_WALLET`; `DEEP_BUILDER_WALLET.devnet` / `.mainnet` in
`@deepliquidity/sdk`) and the 10% are fixed in the program; the 90% goes to the destinations in
`SplitterConfig` (1–8 wallets; today one, the DEEP Treasury wallet).
`distributeIx({ builder, destinations })` takes the destinations as trailing writable accounts in
config order. Example: 12,500,000 lamports reach the vault → builder 1,250,000, destinations
11,250,000. `GET /splitter` (DEEP API) reports the vault, totals and history.
`sweepProtocolFeesIx(mint)` and `graduateIx(…)` take no builder account.

### Launch fee (`create_token`)

Charged only when `Config.launch_fee_usd_cents > 0` (devnet today: 200 = $2.00; on-chain hard cap
2,000 = $20.00). Priced from the Pyth SOL/USD `PriceUpdateV2` passed as the 7th account
(`createTokenIx` passes it), **fail-closed**:

- account owned by the Pyth receiver, feed id
  `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`, fully verified;
- age ≤ the cluster's maximum: **600 s on devnet**, **120 s on mainnet**
  (`pythMaxPriceAgeSeconds(cluster)`);
- `price > 0` and `conf × 10_000 ≤ price × 200` (confidence within 2%).

`lamports = ceil(usd_cents × 10^7 × 10^(−exponent) / price)` for `exponent ≤ 0`
(`quoteLaunchFeeLamports`). At the devnet price read on 2026-10-06 (12,114,573,024 × 10^−8 USD)
$2.00 was 16,509,043 lamports. The fee accrues on the new curve's `protocol_fees_unclaimed`
(swept to the fee vault later) and is reported in `LaunchFeeCharged`. Errors: `PriceFeedInvalid`
6022 … `PriceConfidenceTooWide` 6026.

The creator caps the fee in lamports: `create_token`'s last argument `max_launch_fee_lamports`
(`createTokenIx` `maxLaunchFeeLamports`, required). If the fee priced inside the instruction is
above it, the transaction fails with `LaunchFeeAboveMax` (6041) and nothing is charged. Quote the
fee, add a small tolerance for the price moving before the transaction lands, and pass that.

### DeepSwap swap (`swap_base_input(amount_in, minimum_amount_out)`)

Rates are millionths. **Read `PoolState.fee_model` first**; a pool and its AmmConfig always
share one model, fixed at creation.

**DEEP V1 pool (`fee_model` = 1; every pool created on devnet since 2026-10-08, AmmConfig #1).**
"Buy": the swap's input is the pool's quote token (SOL on TOKEN/SOL); "sell": its output is.
With `L`, `D` = the AmmConfig's LP and DEEP rate of the side (devnet: 1,000 + 2,500 on a buy,
1,000 + 6,500 on a sell) and `R = PoolState.reward_rate_snapshot` (the pool's own rate, 0 for
Standard, at most 50,000), `T = L + D + R`:

```
buy:   total = ceil(in × T / 1e6);     net = in − total;  out = floor(net × res_out / (res_in + net))
sell:  gross = floor(in × res_out / (res_in + in));  total = ceil(gross × T / 1e6);  out = gross − total
parts: lp = floor(total × L / T);  reward = floor(total × R / T);  deep = total − lp − reward
```

Every part is in the quote token; nothing accrues on the other side. The LP part stays in the
reserves; DEEP's part leaves through `collect_protocol_fee_to_vault` (anyone) to the fee vault;
the reward part is 100% `pool_creator`'s (the creator, or the token's holder vault) through
`collect_creator_fee` / `collect_creator_fee_permissionless`. Each V1 swap emits `SwapFeesV1
{ pool_id, is_buy, quote_mint, lp_fee, protocol_fee, reward_fee, reward_model }` right after
its `SwapEvent` (`decodeAmmSwapFeesV1`). `quoteDeepSwapExactIn` / `quoteDeepSwapExactOut` price
either model from the decoded pool, its config and the two vault balances. Caps (program
constants): `L + D` at most 50,000 per side, `R` at most 50,000, so a side never exceeds 10%.
The four config rates and `max_reward_rate` (new pools only) can change at once, with no delay;
nobody can change a pool's `R` or its recipient.

| V1 swap, 100 bps pool          | total      | LPs       | DEEP      | reward     |
| ------------------------------ | ---------- | --------- | --------- | ---------- |
| buy, 1 SOL in                  | 13,500,000 | 1,000,000 | 2,500,000 | 10,000,000 |
| sell, 1 SOL gross out          | 17,500,000 | 1,000,000 | 6,500,000 | 10,000,000 |
| buy, 1 SOL in, Standard pool   | 3,500,000  | 1,000,000 | 2,500,000 | 0          |
| sell, 1 SOL gross, 500 bps max | 57,500,000 | 1,000,000 | 6,500,000 | 50,000,000 |

**Legacy pool (`fee_model` = 0; devnet pools created before 2026-10-08, AmmConfig #0).**
`trade_fee_rate` 3,000 = 0.30%, `protocol_fee_rate` 333,333 of the trade fee (DEEP),
`fund_fee_rate` 0, `creator_fee_rate` 3,000, `creator_fee_share_rate` 500,000: read the
account, never assume. deep-amm accepts no other `fund_fee_rate` than 0 (`BuilderFeeLocked`,
6016), no other `protocol_owner` than the fee vault (`ProtocolOwnerLocked`, 6017), and at most
10% fees per side (`FeeRateAboveCap`, 6019). With `t` = trade fee rate, `c` = creator fee rate
when the pool has `enable_creator_fee` (else 0):

- **Creator fee on the input** (e.g. a buy on a graduation pool, SOL in):
  `total = ceil(in × (t + c) / 1e6)`, `creator_fee = floor(total × c / (t + c))`,
  `trade_fee = total − creator_fee`; the curve prices `in − total`.
- **Creator fee on the output** (e.g. a sell, SOL out), or none: `trade_fee = ceil(in × t /
1e6)`; the curve prices `in − trade_fee`; then `creator_fee = ceil(out × c / 1e6)` comes off
  what the trader receives.
- Constant product: `out = floor(in_after_fees × reserve_out / (reserve_in + in_after_fees))`.
- Of the trade fee, `floor(trade_fee × protocol_fee_rate / 1e6)` (protocol, DEEP) and
  `floor(trade_fee × fund_fee_rate / 1e6)` (fund: 0 in V1) leave the reserves into the pool's fee
  counters; the rest stays in the pool for LPs. DEEP's part reaches the fee vault.

  | swap (input)    | trade fee  | DEEP (333,333) | LPs        |
  | --------------- | ---------- | -------------- | ---------- |
  | 1 SOL           | 3,000,000  | 999,999        | 2,000,001  |
  | 7.000123457 SOL | 21,000,371 | 7,000,116      | 14,000,255 |
  | 0.001 SOL       | 3,000      | 999            | 2,001      |

- The creator fee accrues in `creator_fees_token_*`, outside the reserves. `collect_creator_fee`
  (signed by `pool_creator`) or `collect_creator_fee_permissionless` (anyone pays) settles it:
  the protocol keeps `floor(accrued × creator_fee_share_rate / 1e6)` (a `CreatorFeeShare`
  account for that creator overrides the rate), the creator receives the rest.
- `quoteCpmmSwapBaseInput` implements the legacy maths (`quoteDeepSwapExactIn` picks the model
  from the pool); the devnet simulations matched the program's SwapEvent exactly in both
  directions (section 11), and a devnet check on 2026-10-08 did the same for 17 swaps on three
  V1 pools and 5 on a legacy pool.

`swap_base_output(max_amount_in, amount_out)` is the exact-out variant (the required input rounds
up). The SDK builds `swap_base_input` only; the accounts are the same 13 in the same order
(see the IDL).

### Token-2022 transfer fees and ScaledUiAmount (any-pair pools)

deep-amm pools can hold Token-2022 mints whose extensions are on its allow list
(TransferFeeConfig, MetadataPointer, TokenMetadata, InterestBearingConfig, ScaledUiAmountConfig;
others need a per-mint `SupportMintAssociated` entry, which DEEP creates). For a swap:
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
send: on `CurveComplete` (6003) route the trade to the graduation pool once it exists.
deep-curve can be paused (`Paused` 6000 for create, buy and sell; claims still work) and so can
DeepSwap pools (`status` bits). The buyer's token account is created by `buy` itself if missing
(`init_if_needed`, the buyer pays its rent).

### Instruction accounts and arguments

Account order and arguments from the IDLs, for the instructions whose requirements the account
list alone does not show (the SDK builders `createTokenIx`, `graduateIxs`, `distributeIx`,
`initializeV1Ix`, `rewardsVetoRootIx` and `rewardsSetPausedIx` produce exactly these). Each
instruction's data starts with its 8-byte discriminator.

#### create_token (deep_curve)

Discriminator `[84, 52, 204, 228, 24, 140, 234, 75]`. `max_launch_fee_lamports` is the most the creator accepts to pay as the launch fee (it is priced from Pyth SOL/USD at execution): above it the instruction fails with LaunchFeeAboveMax and nothing is charged.

Arguments: `name` string, `symbol` string, `uri` string, `reward_model` u8, `reward_bps` u16, `max_launch_fee_lamports` u64.

|   # | account                    | signer | writable |
| --: | -------------------------- | ------ | -------- |
|   0 | `creator`                  | yes    | yes      |
|   1 | `config`                   |        |          |
|   2 | `mint`                     | yes    | yes      |
|   3 | `curve`                    |        | yes      |
|   4 | `vault`                    |        | yes      |
|   5 | `metadata`                 |        | yes      |
|   6 | `price_update`             |        |          |
|   7 | `token_program`            |        |          |
|   8 | `associated_token_program` |        |          |
|   9 | `token_metadata_program`   |        |          |
|  10 | `system_program`           |        |          |
|  11 | `rent`                     |        |          |

#### graduate (deep_curve)

Discriminator `[45, 235, 225, 181, 17, 218, 64, 130]`. Permissionless: no account signs. Whoever sends the transaction pays the network fee and receives nothing. `Config.migration_authority` is read by no instruction.

Arguments: none.

|   # | account                    | signer | writable |
| --: | -------------------------- | ------ | -------- |
|   0 | `config`                   |        |          |
|   1 | `fee_vault`                |        | yes      |
|   2 | `mint`                     |        | yes      |
|   3 | `curve`                    |        | yes      |
|   4 | `vault`                    |        | yes      |
|   5 | `reward_recipient`         |        |          |
|   6 | `pool_creator`             |        | yes      |
|   7 | `creator_token`            |        | yes      |
|   8 | `wsol_mint`                |        |          |
|   9 | `creator_wsol`             |        | yes      |
|  10 | `creator_lp_token`         |        | yes      |
|  11 | `pool_state`               |        | yes      |
|  12 | `amm_config`               |        |          |
|  13 | `permission`               |        |          |
|  14 | `raydium_authority`        |        |          |
|  15 | `lp_mint`                  |        | yes      |
|  16 | `token_0_vault`            |        | yes      |
|  17 | `token_1_vault`            |        | yes      |
|  18 | `create_pool_fee`          |        | yes      |
|  19 | `observation_state`        |        | yes      |
|  20 | `cp_swap_program`          |        |          |
|  21 | `token_program`            |        |          |
|  22 | `associated_token_program` |        |          |
|  23 | `system_program`           |        |          |

#### distribute (deep_curve)

Discriminator `[191, 44, 223, 207, 164, 236, 126, 61]`. Permissionless. `payer` (anyone) signs, fronts the rent of the temporary `wsol_unwrap` account when the fee vault holds WSOL and gets exactly that back in the same instruction; it pays nothing else and receives nothing else. The splitter's destinations follow as remaining accounts, writable, in config order.

Arguments: none.

|   # | account          | signer | writable |
| --: | ---------------- | ------ | -------- |
|   0 | `payer`          | yes    | yes      |
|   1 | `splitter`       |        | yes      |
|   2 | `fee_vault`      |        | yes      |
|   3 | `fee_vault_wsol` |        | yes      |
|   4 | `wsol_unwrap`    |        | yes      |
|   5 | `wsol_mint`      |        |          |
|   6 | `builder`        |        | yes      |
|   7 | `token_program`  |        |          |
|   8 | `system_program` |        |          |

#### initialize_v1 (deep_amm)

Discriminator `[65, 29, 145, 95, 69, 59, 165, 253]`. A Holder Rewards pool (`reward_model` 2) must be quoted in SOL and needs one more account among the remaining accounts (after the listed ones; `@deepliquidity/sdk` `initializeV1Ix` appends it last, after any `support_mint` entries): the deep-rewards `Distributor` of (base token, WSOL mint), read-only. It must exist already, or the instruction fails with HolderRewardsNeedDistributor.

Arguments: `init_amount_0` u64, `init_amount_1` u64, `open_time` u64, `creator_fee_on` CreatorFeeOn, `reward_model` u8, `reward_rate` u64.

|   # | account                    | signer | writable |
| --: | -------------------------- | ------ | -------- |
|   0 | `creator`                  | yes    | yes      |
|   1 | `amm_config`               |        |          |
|   2 | `authority`                |        |          |
|   3 | `pool_state`               |        | yes      |
|   4 | `token_0_mint`             |        |          |
|   5 | `token_1_mint`             |        |          |
|   6 | `lp_mint`                  |        | yes      |
|   7 | `creator_token_0`          |        | yes      |
|   8 | `creator_token_1`          |        | yes      |
|   9 | `creator_lp_token`         |        | yes      |
|  10 | `token_0_vault`            |        | yes      |
|  11 | `token_1_vault`            |        | yes      |
|  12 | `create_pool_fee`          |        | yes      |
|  13 | `observation_state`        |        | yes      |
|  14 | `token_program`            |        |          |
|  15 | `token_0_program`          |        |          |
|  16 | `token_1_program`          |        |          |
|  17 | `associated_token_program` |        |          |
|  18 | `system_program`           |        |          |
|  19 | `rent`                     |        |          |

#### veto_root (deep_rewards)

Discriminator `[141, 196, 194, 143, 204, 114, 90, 226]`. `authority` is `RewardsConfig.admin` OR `RewardsConfig.guardian`. Discards a distributor's pending root before it activates.

Arguments: none.

|   # | account       | signer | writable |
| --: | ------------- | ------ | -------- |
|   0 | `authority`   | yes    |          |
|   1 | `config`      |        |          |
|   2 | `distributor` |        | yes      |

#### set_paused (deep_rewards)

Discriminator `[91, 60, 125, 192, 176, 225, 166, 218]`. `authority` is `RewardsConfig.admin` OR `RewardsConfig.guardian`. Pauses new roots and pushes; claims are never paused.

Arguments: `paused` bool.

|   # | account     | signer | writable |
| --: | ----------- | ------ | -------- |
|   0 | `authority` | yes    |          |
|   1 | `config`    |        | yes      |

## 9. Error codes

Anchor custom errors appear as `{"InstructionError":[ix,{"Custom":<code>}]}` and in the logs as
`Error Code: <Name>`. All three programs number from 6000, so map codes per program id.

### deep_curve errors

| code | hex    | name                    | message                                                                                          |
| ---: | ------ | ----------------------- | ------------------------------------------------------------------------------------------------ |
| 6000 | 0x1770 | Paused                  | Protocol is paused                                                                               |
| 6001 | 0x1771 | Unauthorized            | Unauthorized                                                                                     |
| 6002 | 0x1772 | ZeroAmount              | Amount must be greater than zero                                                                 |
| 6003 | 0x1773 | CurveComplete           | Bonding curve is complete                                                                        |
| 6004 | 0x1774 | CurveNotComplete        | Bonding curve is not complete                                                                    |
| 6005 | 0x1775 | AlreadyGraduated        | Token already graduated                                                                          |
| 6006 | 0x1776 | InsufficientReserves    | Insufficient curve reserves                                                                      |
| 6007 | 0x1777 | SlippageExceeded        | Slippage tolerance exceeded                                                                      |
| 6008 | 0x1778 | DeadlineExceeded        | Quote deadline exceeded                                                                          |
| 6009 | 0x1779 | InvalidFee              | Invalid fee configuration                                                                        |
| 6010 | 0x177a | InvalidParams           | Invalid parameters                                                                               |
| 6011 | 0x177b | InvalidMetadata         | Invalid token metadata                                                                           |
| 6012 | 0x177c | InvalidFeeRecipient     | Fee recipient does not match config                                                              |
| 6013 | 0x177d | Overflow                | Arithmetic overflow                                                                              |
| 6014 | 0x177e | InsolventCurve          | Curve account would become insolvent                                                             |
| 6015 | 0x177f | InsufficientTreasury    | Withdrawal exceeds treasury balance above rent                                                   |
| 6016 | 0x1780 | InvalidPool             | Invalid AMM pool account                                                                         |
| 6017 | 0x1781 | TimelockNotElapsed      | Config update timelock has not elapsed                                                           |
| 6018 | 0x1782 | NoPendingConfigUpdate   | No config update is queued                                                                       |
| 6019 | 0x1783 | ConfigUpdatePending     | A config update is already queued; cancel it first                                               |
| 6020 | 0x1784 | ConfigUpdateExpired     | Queued config update expired; cancel and re-queue                                                |
| 6021 | 0x1785 | LaunchFeeAboveCap       | Launch fee exceeds the hard cap                                                                  |
| 6022 | 0x1786 | PriceFeedInvalid        | Invalid Pyth price account (address, owner, layout or feed)                                      |
| 6023 | 0x1787 | PriceNotFullyVerified   | Pyth price update is not fully verified                                                          |
| 6024 | 0x1788 | PriceStale              | Pyth price is stale                                                                              |
| 6025 | 0x1789 | PriceNonPositive        | Pyth price is not positive                                                                       |
| 6026 | 0x178a | PriceConfidenceTooWide  | Pyth price confidence interval too wide                                                          |
| 6027 | 0x178b | InvalidBuilder          | Builder account is not the build-time builder wallet                                             |
| 6028 | 0x178c | BuilderNotRentExempt    | Builder wallet would stay below rent exemption; fund it once                                     |
| 6029 | 0x178d | InvalidSplitterParams   | Invalid splitter parameters                                                                      |
| 6030 | 0x178e | SplitterUpdatePending   | A splitter update is already queued; cancel it first                                             |
| 6031 | 0x178f | NoPendingSplitterUpdate | No splitter update is queued                                                                     |
| 6032 | 0x1790 | BelowMinDistribute      | New fee-vault revenue is below the minimum distribute amount                                     |
| 6033 | 0x1791 | InvalidDestination      | Destination accounts do not match the splitter config                                            |
| 6034 | 0x1792 | DestinationHasOwed      | A removed destination still has owed lamports; distribute first                                  |
| 6035 | 0x1793 | InvalidFeeVault         | Fee vault or its WSOL account does not match this build                                          |
| 6036 | 0x1794 | InvalidVaultToken       | WSOL leaves the fee vault only through distribute                                                |
| 6037 | 0x1795 | InvalidRewardModel      | Reward model must be 0 (Standard), 1 (Creator) or 2 (Holder)                                     |
| 6038 | 0x1796 | HolderVaultBelowRent    | Holder vault would stay below rent exemption; init its distributor or wait for more fees         |
| 6039 | 0x1797 | InvalidRewardRate       | Reward rate must be 0 for Standard and 1 to 500 bps for Creator and Holder                       |
| 6040 | 0x1798 | RewardRateAboveMax      | Reward rate is above the current maximum for new launches                                        |
| 6041 | 0x1799 | LaunchFeeAboveMax       | Launch fee in lamports is above the creator's limit (max_launch_fee_lamports)                    |
| 6042 | 0x179a | GraduationImpossible    | Parameters under which a completed curve could not graduate (no SOL or tokens left for the pool) |

### deep_amm errors

| code | hex    | name                         | message                                                                         |
| ---: | ------ | ---------------------------- | ------------------------------------------------------------------------------- |
| 6000 | 0x1770 | NotApproved                  | Not approved                                                                    |
| 6001 | 0x1771 | InvalidOwner                 | Input account owner is not the program address                                  |
| 6002 | 0x1772 | EmptySupply                  | Input token account empty                                                       |
| 6003 | 0x1773 | InvalidInput                 | InvalidInput                                                                    |
| 6004 | 0x1774 | IncorrectLpMint              | Address of the provided lp token mint is incorrect                              |
| 6005 | 0x1775 | ExceededSlippage             | Exceeds desired slippage limit                                                  |
| 6006 | 0x1776 | ZeroTradingTokens            | Given pool token amount results in zero trading tokens                          |
| 6007 | 0x1777 | NotSupportMint               | Not support token_2022 mint extension                                           |
| 6008 | 0x1778 | InvalidVault                 | invaild vault                                                                   |
| 6009 | 0x1779 | InitLpAmountTooLess          | Init lp amount is too less(Because 100 amount lp will be locked)                |
| 6010 | 0x177a | TransferFeeCalculateNotMatch | TransferFee calculate not match                                                 |
| 6011 | 0x177b | MathOverflow                 | Math overflow                                                                   |
| 6012 | 0x177c | InsufficientVault            | Insufficient vault                                                              |
| 6013 | 0x177d | InvalidFeeModel              | Invalid fee model                                                               |
| 6014 | 0x177e | NoFeeCollect                 | Fee is zero                                                                     |
| 6015 | 0x177f | LamportsCalculateError       | Lamports calculate error                                                        |
| 6016 | 0x1780 | BuilderFeeLocked             | The builder fund fee (rate and owner) is fixed at build time                    |
| 6017 | 0x1781 | ProtocolOwnerLocked          | The protocol fee owner is fixed at build time (the DEEP fee vault)              |
| 6018 | 0x1782 | InvalidProtocolFeeRecipient  | Protocol fees can only be collected to the DEEP fee vault's token accounts      |
| 6019 | 0x1783 | FeeRateAboveCap              | Fee rates exceed the 10% hard cap                                               |
| 6020 | 0x1784 | FeeModelMismatch             | Fee model mismatch between the pool, its AmmConfig or the instruction           |
| 6021 | 0x1785 | InvalidRewardModel           | Reward model must be 0 (Standard), 1 (Creator) or 2 (Holder)                    |
| 6022 | 0x1786 | InvalidQuoteSide             | A V1 pool takes fees in its quote token only (WSOL when the pair has it)        |
| 6023 | 0x1787 | InvalidRewardRate            | Reward rate must be 0 for Standard and at most 5% for Creator and Holder        |
| 6024 | 0x1788 | HolderRewardsNeedSolQuote    | A permissionless Holder Rewards pool must be quoted in SOL                      |
| 6025 | 0x1789 | RewardRateAboveMax           | Reward rate is above the current maximum for new pools                          |
| 6026 | 0x178a | CreatePoolFeeAboveCap        | Create-pool fee exceeds the 0.15 SOL hard cap                                   |
| 6027 | 0x178b | GraduationPermissionLocked   | The graduation payer's permission cannot be closed                              |
| 6028 | 0x178c | InvalidPoolStatus            | Pool status can disable deposits and swaps only; withdrawals are always enabled |
| 6029 | 0x178d | HolderRewardsNeedDistributor | A Holder Rewards pool needs its deep-rewards distributor to exist first         |

### deep_rewards errors

| code | hex    | name                  | message                                                             |
| ---: | ------ | --------------------- | ------------------------------------------------------------------- |
| 6000 | 0x1770 | Unauthorized          | unauthorized                                                        |
| 6001 | 0x1771 | InvalidParams         | invalid parameters                                                  |
| 6002 | 0x1772 | Paused                | paused (claims are never paused)                                    |
| 6003 | 0x1773 | InvalidMint           | invalid mint                                                        |
| 6004 | 0x1774 | UnsupportedRewardMint | unsupported reward mint                                             |
| 6005 | 0x1775 | NotSolDistributor     | not a SOL distributor                                               |
| 6006 | 0x1776 | NotTokenDistributor   | not a token distributor                                             |
| 6007 | 0x1777 | InvalidVault          | invalid vault account                                               |
| 6008 | 0x1778 | NoRoot                | no root has been activated yet                                      |
| 6009 | 0x1779 | ProofTooLong          | proof too long                                                      |
| 6010 | 0x177a | InvalidProof          | invalid Merkle proof                                                |
| 6011 | 0x177b | NothingToClaim        | nothing to claim                                                    |
| 6012 | 0x177c | ExceedsMaxTotal       | claim exceeds the root's total                                      |
| 6013 | 0x177d | RootNotMonotonic      | new root total is below the active one                              |
| 6014 | 0x177e | RootUnfunded          | root promises more than the vault holds                             |
| 6015 | 0x177f | StaleSnapshot         | snapshot slot not newer than the active one, or in the future       |
| 6016 | 0x1780 | NoPendingRoot         | no pending root                                                     |
| 6017 | 0x1781 | RootNotReady          | pending root not yet activatable                                    |
| 6018 | 0x1782 | PushDisabled          | auto-send is disabled (payout mode is CLAIM)                        |
| 6019 | 0x1783 | BelowPushThreshold    | unclaimed amount below the auto-send threshold                      |
| 6020 | 0x1784 | PushUnsupportedAsset  | auto-send is not supported for this reward asset (claim only)       |
| 6021 | 0x1785 | RecipientNotEligible  | recipient cannot receive this payout                                |
| 6022 | 0x1786 | RecipientFrozen       | recipient token account is frozen                                   |
| 6023 | 0x1787 | PriceInvalid          | Pyth SOL/USD price missing, stale or invalid                        |
| 6024 | 0x1788 | Overflow              | arithmetic overflow                                                 |
| 6025 | 0x1789 | ZeroAmount            | amount must be > 0                                                  |
| 6026 | 0x178a | InvalidClaimStatus    | claim status does not match                                         |
| 6027 | 0x178b | VaultShort            | vault cannot cover this payout                                      |
| 6028 | 0x178c | ConfigUpdatePending   | a settings change is already queued                                 |
| 6029 | 0x178d | NoPendingConfigUpdate | no settings change is queued                                        |
| 6030 | 0x178e | ConfigUpdateNotReady  | the queued settings change is not yet applicable                    |
| 6031 | 0x178f | ConfigUpdateExpired   | the queued settings change expired; cancel and re-queue             |
| 6032 | 0x1790 | NotStray              | this token is a reward asset, not stray                             |
| 6033 | 0x1791 | ConfigNotMigrated     | PendingRewardsConfig is in the old layout; run migrate_config first |

## 10. Compute units

Measured on devnet (`unitsConsumed`), not estimates. "Simulated" = this guide's examples on
2026-10-06; "live" = confirmed devnet transactions of 2026-10-04.

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
chooses whose account the simulation runs as (default: a funded devnet account).

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

Base `https://api.deepliquidity.fun`. The OpenAPI 3.1 document is served at
`GET /v1/openapi.json` (`cache-control: public, max-age=300`); its parameters are the API's own
validation schemas and its response schemas are tested against real responses.

| Route                                                         | What                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /v1/tokens`, `/v1/tokens/{mint}`                         | launches with curve state (indexed)                        |
| `GET /v1/tokens/{mint}/trades?limit=1..500`                   | curve trades, newest first                                 |
| `GET /v1/tokens/{mint}/candles?tf=`                           | `1m 5m 15m 1h 4h 24h 7d`, price in SOL per whole token     |
| `GET /v1/tokens/{mint}/stats`                                 | 24h stats, holders from chain, sanitized metadata          |
| `GET /v1/creators/{creator}/tokens`                           | a creator's launches                                       |
| `GET /v1/creators/{creator}/history?days=1..90`               | a creator's fees earned and volume, per token and bucket   |
| `GET /v1/traders/{wallet}/trades?limit=1..100`                | a wallet's curve and DeepSwap trades                       |
| `GET /v1/pools`, `/v1/pools/{address}/tvl`                    | graduation pools with on-chain LP status, TVL history      |
| `GET /v1/pairs`, `/v1/pairs/{address}`, `/trades`, `/candles` | every DeepSwap pool, any pair                              |
| `GET /v1/stocks`                                              | tokenized stock listings (devnet: TEST stocks only)        |
| `GET /v1/stats`, `/v1/stats/tvl?days=1..90`                   | protocol totals, TVL history                               |
| `GET /v1/price/sol`, `/v1/network`, `/v1/status`              | Pyth SOL/USD, cluster info, monitors + program hash check  |
| `GET /v1/ws` (WebSocket)                                      | `{"subscribe":"tokens"}` / `{"subscribe":"trades:<mint>"}` |

Rate limits (per client IP): **300 requests per minute** by default; `/v1/tokens/{mint}/stats` and `/v1/pools/{address}/tvl` **120 per minute**;
`POST /v1/metadata` 10 per minute; `POST /v1/reports` 5 per minute; `POST
/v1/tokens/{mint}/links` 10 per minute per IP and 6 per 10 minutes per mint. Responses carry
`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`; a 429 carries `retry-after`.
WebSocket: 20 topics per connection, 4,096-byte client messages; messages are
`{"topic": "...", "data": TokenSummary | Trade}`. Browser CORS is limited to DEEP's own sites on
the hosted API: call it from a server. Amounts are decimal strings of integers. The API is a
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
  (`CurveCompleted`, then `Graduated` from `graduate`).
- Tokens are legacy SPL Token mints with immutable Metaplex metadata; mint authority revoked, no
  freeze authority.

DeepSwap compared with Raydium CPMM (cp-swap): deep-amm is a fork of raydium-cp-swap commit
`b3187ae` (Apache-2.0; see the SDK's `NOTICE`).

- **Same**: account layouts (PoolState 637 bytes, AmmConfig 236 bytes), instruction names,
  arguments and account order, discriminators, seeds, SwapEvent and the constant-product swap
  maths. A cp-swap integration works by swapping the program id (fees: section 7).
- **Different program id** (`HCrCy6…`), one id for every cluster.
- **Graduation pools live at a deep-curve PDA**, not at the cp-swap pool PDA (section 3).
- `swap_base_output` rejects an `amount_out` ≥ the whole output reserve with
  `InsufficientVault` (6012) instead of panicking.
- Graduation pools charge the creator fee (in WSOL) on top of the trade fee; pools created with
  the permissionless `initialize` never do.
- Not routed by Jupiter yet.

## 14. How this was verified

- IDL ids, every discriminator, account sizes, and every field of every decoded account and
  event are tested against the IDL layout (random bytes decoded both ways).
- The same is checked against every live devnet account and the events of recent transactions.
- The packages load and build instructions in a browser bundle with no global `Buffer`.
- The OpenAPI document is tested against the API: route coverage both ways, parameters, rate
  limits, responses.
