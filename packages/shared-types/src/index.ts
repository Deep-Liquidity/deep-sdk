/** Where a piece of data came from. UI must label anything that is not "chain" or "indexer". */
export type DataSource = "chain" | "indexer" | "mock";

export type TokenLifecycle = "bonding" | "graduating" | "graduated";

export type DiscoveryCategory =
  "new" | "bonding" | "going-deep" | "near-graduation" | "graduated" | "trending" | "recent";

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
  /** 24h protocol (+ fund) share of the trade fee, lamports. */
  protocolFees24h?: string;
  /**
   * 24h creator fees, lamports: charged on top of the trade fee, so not part of fees24h,
   * lpFees24h or protocolFees24h. The pool's creator and DEEP share it when it is settled on
   * chain (AmmConfig.creator_fee_share_rate). Traders paid fees24h + creatorFees24h in total.
   * 0 for swaps indexed before it was recorded.
   */
  creatorFees24h?: string;
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
  poolLpFees24h: string;
  /** DEEP's (+ fund) share of DeepSwap trade fees in 24h. Excludes its share of creator fees. */
  poolProtocolFees24h: string;
  /**
   * DeepSwap creator fees in 24h (see PoolSummary.creatorFees24h): on top of, and not part
   * of, poolLpFees24h and poolProtocolFees24h. Undivided: the creator/DEEP split happens at
   * settlement.
   */
  poolCreatorFees24h?: string;
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
    image: string | null;
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
  name: "deep-curve" | "deep-amm";
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
  /** Trade fee charged on the input token, base units. */
  fee: string;
  /** token1 per whole token0 after the swap. */
  price: number;
  slot: number;
  timestamp: number;
  source: DataSource;
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
