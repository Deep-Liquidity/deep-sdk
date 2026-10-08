/** Where a piece of data came from. UI must label anything that is not "chain" or "indexer". */
export type DataSource = "chain" | "indexer" | "mock";

export type TokenLifecycle = "bonding" | "graduating" | "graduated";

export type DiscoveryCategory =
  "new" | "bonding" | "going-deep" | "near-graduation" | "graduated" | "trending" | "recent";

/**
 * DEEP V1 reward model of a token: chosen at `create_token`, stored on its bonding curve
 * (`BondingCurve.reward_model`: 0 standard, 1 creator, 2 holder) and never changed afterwards.
 */
export type RewardModelId = "standard" | "creator" | "holder";
export const REWARD_MODEL_IDS: readonly RewardModelId[] = ["standard", "creator", "holder"];

/** The fee terms a bonding curve snapshotted at launch, basis points, read from its account. */
export interface CurveFeeSnapshot {
  /** DEEP's fee on a buy (`BondingCurve.protocol_fee_bps`). */
  buyProtocolFeeBps: number;
  /** DEEP's fee on a sell (`sell_protocol_fee_bps`; equals the buy rate on a pre-v3 curve). */
  sellProtocolFeeBps: number;
  /**
   * The curve's reward rate on both sides, on top of the protocol fee
   * (`BondingCurve.creator_fee_bps`): to the creator for a standard / creator token, to the
   * holder vault for a holder token.
   */
  rewardBps: number;
}

export interface TokenSocials {
  website?: string;
  /** X (Twitter) profile URL. */
  x?: string;
  telegram?: string;
  discord?: string;
}

/** Token summary as served by the API / mock adapter. Amounts are decimal strings of integers. */
export interface TokenSummary {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  creator: string;
  createdAt: number; // unix ms
  decimals: number;
  lifecycle: TokenLifecycle;
  /** Curve state, integer strings (lamports / base units). */
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  curveSupply: string;
  tokenTotalSupply: string;
  /** 24h volume in lamports. */
  volume24h: string;
  /**
   * DeepSwap pool SOL reserves (lamports) once graduated: after the latest indexed swap,
   * or as seeded at graduation before any swap.
   */
  poolSolLiquidity?: string;
  /** DeepSwap pool token reserves (base units), same source as poolSolLiquidity. */
  poolTokenReserves?: string;
  /** DeepSwap pool created at graduation, if known. */
  poolAddress?: string;
  priceChange24hBps: number;
  trades24h: number;
  socials: TokenSocials;
  /** Off-chain Metaplex JSON URI recorded on chain at creation (creator-controlled). */
  metadataUri?: string;
  source: DataSource;
  /** Set when DEEP moderation hid this token from listings (on-chain it still exists). */
  moderation?: { hidden: true; reason: string };
  /** Where `socials` came from (API only; see TokenLinksState). Absent on mock data. */
  linksSource?: LinksSource;
  /** When the creator last signed a links update, unix ms; null when linksSource is "metadata". */
  linksUpdatedAt?: number | null;
  /** DEEP moderation hid this token's links (socials is then empty). */
  linksHidden?: true;
  /**
   * This is the DEEP platform's own token (DEEP), as set by a DEEP operator. At most one mint
   * carries it at a time; look-alikes never do. Absent on mock data.
   */
  official?: true;
  /**
   * The token's reward model, from its on-chain curve account (v3) or its creation event.
   * Absent while the curve account still has the pre-V1 layout (it stores no model) and on
   * tokens whose curve has not been read yet. Appended field.
   */
  rewardModel?: RewardModelId;
  /**
   * The token's own reward rate, basis points per side: what its creator chose at launch
   * (0 for a standard token), charged on the curve and on its DeepSwap graduation pool. From
   * the creation event (`TokenCreated.reward_bps`) and then from the curve account, which wins;
   * equal to `curveFees.rewardBps` once that is known. Absent on tokens created before the
   * event carried it whose curve has not been read yet. Appended field.
   */
  rewardBps?: number;
  /**
   * The curve's own fee snapshot, read from its account. Absent until the curve has been read
   * from chain. Appended field.
   */
  curveFees?: CurveFeeSnapshot;
}

/** The official-token record (admin API): which mint, the operator's note, when and by whom. */
export interface OfficialToken {
  mint: string;
  note: string;
  /** unix ms */
  setAt: number;
  /** The operator's wallet (admin session). */
  by: string;
}

export type TradeSide = "buy" | "sell";

export interface Trade {
  signature: string;
  mint: string;
  side: TradeSide;
  trader: string;
  solAmount: string;
  tokenAmount: string;
  timestamp: number;
  source: DataSource;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Real SOL in the curve (or pool) at candle close, SOL. Absent when unknown. */
  liquidity?: number;
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "24h" | "7d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "24h", "7d"];

export interface PoolSummary {
  address: string;
  mint: string;
  symbol: string;
  /**
   * "pending": graduated, liquidity released to the migration authority, pool not yet registered.
   * "external": the pool account is owned by an AMM program other than DEEP's (devnet tokens
   * graduated before deep-amm was deployed); set from the on-chain owner, never assumed.
   */
  provider: "deepswap" | "pending" | "external" | "mock";
  solReserves: string;
  tokenReserves: string;
  lpSupply: string;
  lpLockedBps: number;
  volume24h: string;
  /**
   * Total DeepSwap trade fees over 24h, lamports (= lpFees24h + protocolFees24h). The creator
   * fee is charged on top and is NOT included: see creatorFees24h.
   */
  fees24h: string;
  /** Graduation time (or creation time if unknown), unix ms. */
  createdAt: number;
  source: DataSource;
  /** Token name / image (from the token's metadata), when known. */
  name?: string;
  imageUrl?: string;
  /** Graduation time, unix ms (absent if not indexed). */
  graduatedAt?: number;
  /** 24h trade fees that stay in the pool for LPs, lamports. */
  lpFees24h?: string;
  /**
   * 24h protocol (+ fund) share of the trade fee, lamports: DEEP's protocol fee plus the DEEP
   * builder's fund fee (builderFees24h). DEEP's own part is protocolFees24h - builderFees24h.
   */
  protocolFees24h?: string;
  /**
   * 24h DEEP builder share of the trade fee (the AmmConfig fund fee, 166_667 / 1e6 of the
   * trade fee, ~0.05% of volume), lamports. Part of protocolFees24h, never added to it.
   * Appended field; absent from older API versions.
   */
  builderFees24h?: string;
  /**
   * 24h creator fees, lamports: charged on top of the trade fee, so not part of fees24h,
   * lpFees24h or protocolFees24h. The pool's creator and DEEP share it when it is settled on
   * chain (AmmConfig.creator_fee_share_rate). Traders paid fees24h + creatorFees24h in total.
   * 0 for swaps indexed before it was recorded.
   *
   * The name is too narrow under DEEP V1 and is kept for existing consumers: it also counts a
   * V1 pool's reward fees whoever receives them, so on a Holder Rewards pool it is money paid
   * to the token's holders. Prefer creatorRewardFees24h / holderRewardFees24h.
   */
  creatorFees24h?: string;
  /**
   * DEEP V1 Creator Rewards pool: its 24h reward fees (= rewardFees24h), 100% the reward
   * recipient's, lamports. "0" on any other pool. Absent until the pool's fee terms are read.
   */
  creatorRewardFees24h?: string;
  /**
   * DEEP V1 Holder Rewards pool: its 24h reward fees (= rewardFees24h), paid to the token's
   * holder vault for its holders, lamports. "0" on any other pool. Absent until the pool's
   * fee terms are read.
   */
  holderRewardFees24h?: string;
  /**
   * Indexed TVL in lamports: the pool's SOL reserves × 2 (a constant-product pool holds equal
   * value on both sides at its own price). An estimate of pool value, never a market cap.
   */
  tvl?: string;
  /** Price change over 24h, basis points, from indexed trades. */
  priceChange24hBps?: number;
  /** Spot price after the latest indexed state, SOL per whole token. */
  priceSol?: number;
  /** LP state verified on chain; null when it could not be read (RPC error / pool missing). */
  lp?: PoolLpStatus | null;
  /**
   * 24h reward fees of DEEP V1 swaps, lamports: the pool's own reward rate, 100% its reward
   * recipient's (`fees.rewardRecipient`). A PART of creatorFees24h (which also counts a legacy
   * pool's creator fee, shared with DEEP), never added to it. "0" on a legacy pool. Appended
   * field; absent from older API versions.
   */
  rewardFees24h?: string;
  /**
   * The pool's own fee terms, read from its PoolState and AmmConfig (see PairFees). Absent until
   * the pair indexer has read the pool.
   */
  fees?: PairFees;
}

/** One side of a pool's fee, millionths (per 1e6) of the amount it is charged on. */
export interface PairSideFees {
  /** Stays in the pool for liquidity providers. */
  lp: number;
  /** DEEP's part (on a legacy pool: the protocol and fund shares of the trade fee). */
  protocol: number;
  /**
   * DEEP V1: the pool's own reward rate, 100% its reward recipient's. Legacy: the creator fee
   * when the pool has it enabled (shared with DEEP when it is settled).
   */
  reward: number;
  /** lp + protocol + reward: what a trader pays on this side. */
  total: number;
}

/**
 * A DeepSwap pool's own fee terms, read from its PoolState and its AmmConfig (SDK
 * `cpmmPoolFeeRates`). The fee model, reward model, reward rate, recipient and quote token are
 * fixed at pool creation; the LP and DEEP rates are the AmmConfig's and can change.
 */
export interface PairFees {
  /**
   * "legacy": upstream cp-swap semantics (trade fee on the input, optional creator fee), both
   * sides equal. "v1": DEEP V1, side-dependent, every part taken in the quote token.
   */
  feeModel: "legacy" | "v1";
  /** A swap whose INPUT is the quote token (on a legacy pool: any swap). */
  buy: PairSideFees;
  /** A swap whose OUTPUT is the quote token (on a legacy pool: the same as `buy`). */
  sell: PairSideFees;
  /** V1 only: who the reward part is for. Absent on a legacy pool. */
  rewardModel?: RewardModelId;
  /**
   * V1 only: the address the reward part is paid to (`PoolState.pool_creator`): the token's or
   * pool's creator, or the token's deep-rewards holder vault for a holder pool.
   */
  rewardRecipient?: string;
  /** V1 only: the mint every fee part is taken in (SOL's wrapped mint on a TOKEN/SOL pool). */
  quoteMint?: string;
}

/** 24h fees of a DEEP V1 pair, base units of `mint` (the pool's quote token). */
export interface PairFees24h {
  mint: string;
  lp: string;
  protocol: string;
  reward: string;
}

/**
 * On-chain LP state of a graduation pool.
 * - `poolLpSupply`: the pool account's `lp_supply` (LP units the pool counts as outstanding,
 *   including the units cp-swap locks at creation and never mints).
 * - `lpMintSupply`: the LP mint's circulating SPL supply (what holders could redeem).
 * - `lockedBps` = (poolLpSupply − lpMintSupply) / poolLpSupply: the share of pool liquidity
 *   that nobody holds LP tokens for, i.e. permanently locked.
 * - `burned`: lpMintSupply is 0, so every LP token minted at graduation was burned.
 */
export interface PoolLpStatus {
  /** The AMM program that owns the pool account. */
  program: string;
  lpMint: string;
  poolLpSupply: string;
  lpMintSupply: string;
  lockedBps: number;
  burned: boolean;
  /** Pool reserves read from its vaults (net of accrued fees), lamports / base units. */
  solReserves: string;
  tokenReserves: string;
  slot: number;
  checkedAt: number;
}

// ───────────── live market + network data (all real; see docs/REDESIGN.md) ─────────────

/** GET /v1/price/sol: the on-chain Pyth SOL/USD PriceUpdateV2 account. */
export interface SolPrice {
  usd: number;
  /** Confidence interval, USD. */
  conf: number;
  /** Pyth publish time, unix seconds. */
  publishTime: number;
  /** vs the recorded sample nearest 24h ago; null until 24h of samples exist. */
  change24hPct: number | null;
  source: "pyth";
}

/** GET /v1/stats: protocol-wide totals computed from indexed events. Lamports as strings. */
export interface ProtocolStats {
  tokens: number;
  bonding: number;
  graduating: number;
  graduated: number;
  /** Curve + DeepSwap trades in the last 24h. */
  trades24h: number;
  curveTrades24h: number;
  poolTrades24h: number;
  curveVolume24h: string;
  poolVolume24h: string;
  /** Protocol fees taken by bonding-curve trades in 24h. */
  curveProtocolFees24h: string;
  /**
   * Reward fees taken by bonding-curve trades in 24h that go to token creators / to holder
   * vaults (TradeEvent.creator_fee / holder_fee), lamports. Appended fields.
   */
  curveCreatorFees24h?: string;
  curveHolderFees24h?: string;
  poolLpFees24h: string;
  /** DEEP's (+ fund) share of DeepSwap trade fees in 24h. Excludes its share of creator fees. */
  poolProtocolFees24h: string;
  /**
   * The fund (DEEP builder) part of poolProtocolFees24h, lamports. Appended field. The curve's
   * builder share (5/70 of the curve protocol fees) is paid at sweep time, not per trade, so
   * it is not estimated here.
   */
  poolBuilderFees24h?: string;
  /**
   * DeepSwap creator fees in 24h (see PoolSummary.creatorFees24h): on top of, and not part
   * of, poolLpFees24h and poolProtocolFees24h. Undivided: the creator/DEEP split happens at
   * settlement.
   */
  poolCreatorFees24h?: string;
  /**
   * The part of poolCreatorFees24h charged by DEEP V1 swaps: each pool's own reward rate, 100%
   * its reward recipient's (never shared with DEEP). Appended field.
   */
  poolRewardFees24h?: string;
  /** Σ over DeepSwap pools of SOL reserves × 2 (see PoolSummary.tvl). */
  poolTvl: string;
  /** Σ real SOL reserves held by bonding curves that have not graduated. */
  solLockedInCurves: string;
  /** unix ms when computed. */
  asOf: number;
  source: "indexer";
}

export interface TokenHolder {
  owner: string;
  tokenAccount: string;
  /** base units */
  amount: string;
  /** Share of total supply, basis points. */
  shareBps: number;
  /** Program-owned accounts: the bonding-curve vault or an AMM pool vault. */
  label: "bonding-curve" | "pool" | null;
}

export interface TokenLinks {
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  discord: string | null;
}

/** Where a token's displayed image comes from; DEEP's storage is the only place it is loaded from. */
export type TokenImageSource = "deep" | "ipfs" | "none";

/** GET /v1/tokens/:mint/stats */
export interface TokenStats {
  mint: string;
  creator: string;
  /** unix ms */
  createdAt: number;
  /** SOL per whole token, from the latest indexed state. */
  priceSol: number;
  /** Highest/lowest post-trade spot price over 24h (incl. the price entering the window). */
  high24h: number | null;
  low24h: number | null;
  /** Lamports. total = curve + pool. */
  volume24h: { total: string; curve: string; pool: string };
  buyVolume24h: string;
  sellVolume24h: string;
  trades24h: number;
  buys24h: number;
  sells24h: number;
  holders: {
    /** Token accounts with a non-zero balance; null when the RPC refused the query. */
    count: number | null;
    /** Distinct owners with a non-zero balance. */
    owners: number | null;
    top: TokenHolder[] | null;
    asOf: number;
    error?: string;
  };
  /** Sanitized fields from the token's metadata JSON (fetched server-side). */
  metadata: {
    description: string | null;
    /** Always a URL on DEEP's storage (its IPFS gateway), or null: never a creator's host. */
    image: string | null;
    /**
     * Why there is (no) image. "deep": the metadata names an object on DEEP's storage. "ipfs":
     * it names an IPFS CID elsewhere that DEEP's node holds, shown through DEEP's gateway.
     * "none": no image, or one hosted somewhere DEEP does not load images from.
     */
    imageSource: TokenImageSource;
    links: TokenLinks;
    /** "uri": fetched from the metadata URI; "indexer": stored copy; "none": unavailable. */
    source: "uri" | "indexer" | "none";
  };
  source: "indexer";
  /** Where metadata.links came from: the metadata JSON, or a links update the creator signed. */
  linksSource?: LinksSource;
  /** When the creator last signed a links update, unix ms; null when linksSource is "metadata". */
  linksUpdatedAt?: number | null;
  /** DEEP moderation hid this token's links (metadata.links are then all null). */
  linksHidden?: true;
}

/** A wallet's trade with its venue. GET /v1/traders/:wallet/trades */
export interface TraderTrade extends Trade {
  venue: "curve" | "deepswap";
  symbol: string | null;
  name: string | null;
}

/** GET /v1/network: live cluster info read from RPC by the API. */
export interface NetworkInfo {
  cluster: string;
  slot: number;
  blockHeight: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  /** Transactions per second over the sampled window (incl. votes); null without samples. */
  tps: number | null;
  /** Non-vote transactions per second; null without samples. */
  nonVoteTps: number | null;
  /** Seconds covered by the performance samples. */
  sampleSeconds: number;
  /** getEpochInfo round trip measured by the API server, ms. */
  rpcLatencyMs: number;
  asOf: number;
}

/** Uptime Kuma heartbeat states. */
export type MonitorState = "up" | "down" | "pending" | "maintenance";

export interface MonitorStatus {
  id: number;
  name: string;
  group: string;
  /** From the latest heartbeat; null when there is none. */
  state: MonitorState | null;
  /** Latest ping, ms. */
  pingMs: number | null;
  /** 0..1 */
  uptime24h: number | null;
  /** 0..1; null when the status page does not publish it. */
  uptime30d: number | null;
  /** Oldest first. */
  heartbeats: { state: MonitorState; time: number; pingMs: number | null }[];
}

export interface ProgramStatus {
  name: "deep-curve" | "deep-amm" | "deep-rewards";
  programId: string;
  deployed: boolean;
  upgradeAuthority: string | null;
  lastDeploySlot: number | null;
  /** Executable hash recorded for the release in docs/DEPLOYMENT.md. */
  releaseHash: string;
  /** solana-verify hash of the deployed ProgramData, computed live (cached); null if unread. */
  deployedHash: string | null;
  /** deployedHash === releaseHash; null when deployedHash is unknown. */
  matchesRelease: boolean | null;
}

export interface StatusIncident {
  title: string;
  content: string;
  style: string;
  createdAt: number | null;
  updatedAt: number | null;
}

/** GET /v1/status */
export interface ServiceStatus {
  title: string;
  monitors: MonitorStatus[];
  incident: StatusIncident | null;
  maintenance: { id: number; title: string; description: string; status: string }[];
  programs: ProgramStatus[] | null;
  programsError?: string;
  asOf: number;
}

/** A DEEP multisig proposal that still needs attention (GET /v1/governance). */
export interface GovernanceProposal {
  /** Squads transaction index (decimal string: a u64). */
  index: string;
  /** Squads proposal status, or "no-proposal" for a transaction not yet proposed. */
  status: string;
  /** unix seconds the status was entered; null while executing or before a proposal exists */
  statusAt: number | null;
  approvals: number;
  rejections: number;
  kind: "vault" | "config" | "batch" | "unknown";
  /** What the transaction does, e.g. the programs and instructions it calls. */
  summary: string;
  /** A later config change made it stale: it can no longer execute. */
  stale: boolean;
  /** unix seconds the time lock releases it (approved proposals only). */
  executableAt: number | null;
}

/**
 * GET /v1/governance: the DEEP Squads multisig as the API watches it, so anyone can see a
 * pending proposal before its time lock releases (docs/MAINNET.md step 0.3). `enabled` is
 * false when the API watches no multisig on this cluster; everything else is then null.
 */
export interface GovernanceStatus {
  enabled: boolean;
  /** The watch's last poll failed; `pending` may be stale. */
  failing: boolean;
  /** unix ms of the last successful poll. */
  lastRunAt: number | null;
  cluster: string | null;
  multisig: string | null;
  threshold: number | null;
  timeLockSeconds: number | null;
  pending: GovernanceProposal[];
  asOf: number;
}

// ───────────── DeepSwap pairs: every pool deep-amm owns, any two tokens ─────────────
//
// `PoolSummary` above is the launchpad view (token / SOL, graduation pools). A `Pair` is the
// AMM view: token0/token1 in the pool's own order, amounts in base units, no SOL assumption.
// Graduation pools appear in both.

/** Token-2022 extensions on a mint, by their spl-token `ExtensionType` name (e.g. "TransferFeeConfig"). */
export type MintExtension = string;

export interface PairToken {
  mint: string;
  /** From the mint's metadata; a shortened mint address when it has none. */
  symbol: string;
  name?: string;
  imageUrl?: string;
  decimals: number;
  tokenProgram: "spl-token" | "token-2022";
  /** Token-2022 only; empty for SPL Token mints. */
  extensions: MintExtension[];
  /** Mint has a freeze authority (the issuer can freeze holders' accounts, pool vaults included). */
  freezable: boolean;
  /**
   * Token-2022 ScaledUiAmount multiplier in effect now (1 when the mint has none). Balances,
   * reserves and volumes are raw; a displayed amount is raw × multiplier and a displayed price
   * per token is the raw price ÷ multiplier (issuers use it for splits and dividends).
   */
  uiMultiplier: number;
  /** Where symbol/name came from. "none": the mint has no readable metadata. */
  metadataSource: "deep" | "metaplex" | "token-2022" | "none";
  /**
   * Set when the mint's TransferHook extension points at a program (an ACTIVE hook). deep-amm
   * does not forward hook accounts yet, so such a pool cannot move this token: the UI blocks
   * trading and pool creation for it (docs/STOCK_PAIRS.md).
   */
  transferHookProgram?: string;
}

export interface PairSummary {
  /** Pool account address. */
  address: string;
  /** "graduation": created by deep-curve at graduation. "user": created by anyone via deep-amm. */
  kind: "graduation" | "user";
  token0: PairToken;
  token1: PairToken;
  /** Vault balances net of accrued protocol/fund/creator fees, base units. Chain wins. */
  reserve0: string;
  reserve1: string;
  lpMint: string;
  /** The pool account's lp_supply, LP base units. */
  lpSupply: string;
  ammConfig: string;
  /** Trade fee, millionths of the input, from the pool's AmmConfig. */
  tradeFeeRate: number;
  /** Share of the trade fee that does not go to LPs (protocol + fund), millionths. */
  protocolShareRate: number;
  /** Pool creator, when the creation transaction was indexed. */
  creator?: string;
  /** Unix seconds from which swaps are allowed (cp-swap open_time). */
  openTime: number;
  /** Creation time, unix ms (first seen time when the creation was not indexed). */
  createdAt: number;
  /** token1 per whole token0 at the current reserves. Presentation only. */
  price: number;
  /** 24h volume on each side, base units (sum of that token's amounts across swaps). */
  volume24h0: string;
  volume24h1: string;
  trades24h: number;
  priceChange24hBps: number;
  /** Slot of the reserves read. */
  slot: number;
  source: DataSource;
  /**
   * The pool's own fee per side with its LP / DEEP / reward parts (see PairFees). Appended
   * field: absent on a pair stored before it was indexed (until its next refresh); then
   * `tradeFeeRate` is all that is known.
   */
  fees?: PairFees;
  /**
   * DEEP V1 pools only: the LP, DEEP and reward fees of the last 24h, summed from each swap's
   * `SwapFeesV1` event (exact, in the quote token). Absent on a legacy pool, whose fees are on
   * the input token of each swap.
   */
  fees24h?: PairFees24h;
}

export interface PairTrade {
  signature: string;
  /** Event index within the transaction. */
  index: number;
  pair: string;
  trader: string;
  /** True when token0 went in and token1 came out. */
  zeroForOne: boolean;
  /** Amounts that moved, base units, without Token-2022 transfer fees. */
  amount0: string;
  amount1: string;
  /**
   * Legacy pool: the trade fee, charged on the input token, base units. DEEP V1 pool (`v1`
   * present): the LP + DEEP parts, in the pool's quote token (see `v1`).
   */
  fee: string;
  /** token1 per whole token0 after the swap. */
  price: number;
  slot: number;
  timestamp: number;
  source: DataSource;
  /**
   * DEEP V1 swaps only: the exact fee parts from the swap's `SwapFeesV1` event, all in the
   * pool's quote token (`feeMint`). On a sell the quote amount is already net of all three.
   */
  v1?: {
    /** True when the input was the quote token (the fee came off the input). */
    isBuy: boolean;
    feeMint: string;
    lpFee: string;
    protocolFee: string;
    rewardFee: string;
    rewardModel: RewardModelId;
  };
}

/**
 * GET /v1/pairs                         → PairSummary[]
 * GET /v1/pairs/:address                → PairSummary (404 when not a deep-amm pool)
 * GET /v1/pairs/:address/trades         → PairTrade[] (newest first)
 * GET /v1/pairs/:address/candles?tf=1m  → Candle[] (price = token1 per token0; volume in token1)
 */
export type PairsApi = never;

/**
 * One bucket of DeepSwap pool TVL history.
 * GET /v1/stats/tvl?days=30            → TvlPoint[] (all DeepSwap graduation pools)
 * GET /v1/pools/:address/tvl?days=30   → TvlPoint[] (one pool; 404 when unknown)
 *
 * Buckets are hourly for `days` ≤ 7 and daily (UTC) otherwise, oldest first, ending with the
 * bucket that contains "now". Buckets before the first pool existed are left out, so the
 * series can be shorter than the window (or empty).
 *
 * Limit: history is rebuilt from the graduation seed and each indexed swap's reserves, so a
 * past bucket does not show liquidity added or removed outside swaps. Only the last bucket,
 * which is the current reconciled value (the same one as ProtocolStats.poolTvl), does.
 */
export interface TvlPoint {
  /** Bucket start, unix seconds. */
  time: number;
  /** TVL at the end of the bucket, lamports: SOL reserves × 2 (see PoolSummary.tvl). */
  tvl: string;
}

// ───────────── creator history (the Creator page's charts) ─────────────

/** A token the wallet launched, as named in its history. */
export interface CreatorHistoryToken {
  mint: string;
  symbol: string;
  name: string;
}

/**
 * One token's indexed trading in one time bucket. Every amount is lamports as a decimal string
 * and an exact sum of indexed events, never an estimate. Only buckets with at least one trade
 * are listed: a (bucket, token) that is missing had no trades.
 */
export interface CreatorHistoryBucket {
  /** Bucket start, unix seconds. */
  time: number;
  mint: string;
  /** Trades in the bucket, curve and DeepSwap together. */
  trades: number;
  /** SOL volume on the bonding curve. */
  curveVolume: string;
  /** SOL volume in the token's DeepSwap graduation pool. */
  poolVolume: string;
  /** Curve reward fees paid to the creator (TradeEvent.creator_fee). 0 on a Holder Rewards token. */
  curveCreatorFees: string;
  /**
   * DeepSwap V1 reward fees of the token's graduation pool, counted only when that pool's reward
   * goes to this creator (a Creator Rewards pool): 100% the creator's.
   */
  poolCreatorFees: string;
  /**
   * The creator fee charged by a legacy (pre-V1, devnet only) graduation pool, GROSS: the
   * creator and DEEP share it when it is settled on chain, so it is not the creator's income
   * and is never added to the two fields above.
   */
  poolLegacyCreatorFees: string;
}

/**
 * GET /v1/creators/:creator/history?days=30: fees earned and volume of the tokens a wallet
 * launched, per token and time bucket.
 *
 * Buckets are hourly for `days` ≤ 7 and daily (UTC) otherwise, as in TvlPoint. The window is
 * the `days` ending with the bucket that contains "now": `from` and `to` are its first and last
 * bucket starts. Fees are what the trades charged for the creator (accrued on the curve and
 * pool accounts), whether or not they were claimed. Reward fees of pools the wallet opened
 * itself with `initialize_v1` (not graduation pools) are not part of this series.
 */
export interface CreatorHistory {
  creator: string;
  days: number;
  bucketSeconds: number;
  /** First bucket start of the window, unix seconds. */
  from: number;
  /** Last bucket start of the window (the bucket that contains "now"), unix seconds. */
  to: number;
  /** Every token the wallet launched, oldest first, including ones without a trade in the window. */
  tokens: CreatorHistoryToken[];
  /** Oldest first, then by mint. */
  buckets: CreatorHistoryBucket[];
  source: "indexer";
}

// ───────────── creator link updates (signed by the token's creator after launch) ─────────────

/**
 * "metadata": the links in the token's Metaplex JSON (as uploaded at launch).
 * "creator": a links update the creator signed with the wallet that created the token; it
 * replaces the metadata links as a whole (a null slot removes that link).
 */
export type LinksSource = "metadata" | "creator";

/**
 * POST /v1/tokens/:mint/links. The signed text is `buildLinksMessage` from @deepliquidity/sdk over
 * { mint, cluster, links, issuedAt, nonce }; see docs/ARCHITECTURE.md.
 */
export interface UpdateTokenLinksRequest {
  /** Full https URLs (handles already expanded) or null. */
  links: TokenLinks;
  /** Canonical ISO time (toISOString), within ±5 min of the server clock. */
  issuedAt: string;
  /** 32 lowercase hex characters, single use. */
  nonce: string;
  /** ed25519 signature over the message's UTF-8 bytes, base58. */
  signature: string;
  /** The signing wallet, base58; must be the token's creator as recorded on chain. */
  publicKey: string;
}

export interface UpdateTokenLinksResponse {
  mint: string;
  links: TokenLinks;
  linksSource: "creator";
  linksUpdatedAt: number;
}

/**
 * Error codes of POST /v1/tokens/:mint/links ({ error, field? }):
 * 400 invalid_body | invalid_link (field) | bad_issued_at | stale_message,
 * 401 bad_signature, 403 not_creator | links_hidden, 404 not_found,
 * 409 nonce_used | superseded, 413 body too large, 429 rate limited,
 * 503 rpc_unavailable | chain_read_failed.
 */
export type UpdateTokenLinksError =
  | "invalid_body"
  | "invalid_link"
  | "bad_issued_at"
  | "stale_message"
  | "bad_signature"
  | "not_creator"
  | "links_hidden"
  | "not_found"
  | "nonce_used"
  | "superseded"
  | "rpc_unavailable"
  | "chain_read_failed";

export * from "./stocks.js";
export * from "./rewards.js";

// ───────────── DEEP V1 fee splitter (docs/V1_FEES.md, Phase 1) ─────────────

/** One 90% destination of the fee splitter. Amounts in lamports, decimal strings. */
export interface SplitterDestinationStatus {
  wallet: string;
  /** Share of the 90% remainder, bps of 10_000. */
  bps: number;
  /** Due but unpaid (the wallet could not receive yet). */
  owed: string;
  /** Paid since the wallet was added. */
  paidTotal: string;
}

/** One `distribute` (RevenueDistributed event), as indexed. */
export interface RevenueDistribution {
  signature: string;
  /** Event index within the transaction's fee events. */
  index: number;
  slot: number;
  /** Unix seconds (the event's timestamp). */
  timestamp: number;
  /** New revenue split this round. */
  base: string;
  builderAmount: string;
  builderOwed: string;
  builderPaidTotal: string;
  baseTotal: string;
  wallets: string[];
  amounts: string[];
  owed: string[];
  retained: string;
  wsolUnwrapped: string;
}

/**
 * GET /splitter: the DEEP fee vault and splitter, read from chain (and the indexed history).
 * Every number is real chain data; `initialized: false` until `initialize_splitter` ran.
 */
export interface SplitterStatus {
  source: "chain";
  cluster: string;
  feeVault: string;
  feeVaultWsol: string;
  builder: string | null;
  /** The builder's compiled-in share of all DEEP revenue, bps (1000 = 10%). */
  builderSplitBps: number;
  initialized: boolean;
  /** fee_vault lamports (rent included) and the WSOL ATA's token amount. */
  vaultLamports: string;
  vaultWsol: string;
  /** What the next distribute would split now: vault + WSOL − rent − owed − carried dust. */
  pendingRevenue: string;
  minDistributeLamports: string;
  baseTotal: string;
  builderPaidTotal: string;
  builderOwed: string;
  retained: string;
  destinationsPaidTotal: string;
  distributions: number;
  /** Unix seconds of the last distribute, null before the first. */
  lastDistributeAt: number | null;
  /** Next scheduled keeper run (00:00 / 12:00 America/Los_Angeles), ISO-8601. */
  nextDistributionAt: string;
  destinations: SplitterDestinationStatus[];
  /** A queued destination change (timelocked), or null. */
  pending: {
    eta: number;
    queuedAt: number;
    destinations: { wallet: string; bps: number }[];
    minDistributeLamports: string;
  } | null;
  /** Latest distributions, newest first (indexed RevenueDistributed events). */
  history: RevenueDistribution[];
}

/** One deep-curve `sweep_holder_fees` (HolderFeesSwept event), as indexed. */
export interface HolderFeeSweep {
  signature: string;
  /** Event index within the transaction's fee events. */
  index: number;
  slot: number;
  /** Unix seconds (block time). */
  timestamp: number;
  mint: string;
  /** deep-rewards PDA ["holder_vault", mint] that received the lamports. */
  holderVault: string;
  /** Lamports moved, decimal string. */
  amount: string;
}

/**
 * Every token launched on DEEP gets a mint address that ends in this (base58, exact case)
 * whenever a pre-ground keypair is available. The one place the suffix is written.
 */
export const VANITY_MINT_SUFFIX = "deep";

/** A pre-ground mint keypair from `POST /v1/launch/mint`. Handed out once, never again. */
export interface VanityMint {
  /** The mint address (base58); ends in `VANITY_MINT_SUFFIX`. */
  mint: string;
  /** The 64-byte ed25519 secret key (seed + public key), base58. It only signs `create_token`. */
  secretKey: string;
}

/** `vanity` is null when no keypair is ready: the launch then uses an ordinary random mint. */
export interface VanityMintResponse {
  vanity: VanityMint | null;
}
