// API client for BULK Terminal Backend

import { withNetwork } from './network';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

// Live market price stream (SSE). Used by PositionChartModal to update the
// last candle + mark line in real time. One stream per open modal.
export function marketStreamUrl(symbol: string): string {
  return `${API_URL}/api/stream/market/${encodeURIComponent(symbol)}`;
}

// Types
export interface User {
  id: number;
  email: string;
  username: string | null;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  value: number;
  trades?: number;
  positions?: number;
}

export interface WalletRankData {
  wallet_address: string;
  found: boolean;
  rankings: {
    volume: { rank: number; total: number; value: number } | null;
    pnl: { rank: number; total: number; value: number } | null;
    trades: { rank: number; total: number; value: number } | null;
    liquidations: { rank: number; total: number; value: number } | null;
  };
  stats: {
    total_volume: number;
    total_trades: number;
    total_pnl: number;
    total_liquidations: number;
    liquidation_value: number;
  } | null;
}

export interface ChartDataPoint {
  timestamp: string;
  value: number;
}

export interface ChartData {
  timestamp: string;
  // Per-coin dictionary from the additive backend shape (Phase 2). Contains
  // every coin BULK has data for — BTC/ETH/SOL plus any new markets.
  coins?: Record<string, number>;
  // Legacy top-level per-coin fields kept for backward compatibility with
  // components that haven't migrated yet. The backend populates both.
  BTC?: number;
  ETH?: number;
  SOL?: number;
  Cumulative?: number;
  total?: number;
  // Index signature allows ad-hoc coin keys (BNB, DOGE, FARTCOIN, SUI, ZEC, ...)
  // to live alongside the named ones. Without this, TS can't accept the full
  // additive rows the backend returns.
  [key: string]: unknown;
}

export interface LongShortDataPoint {
  timestamp: string;
  long_ratio: number;
  short_ratio: number;
}

export interface ExchangeHealth {
  total_volume_24h: number;
  total_open_interest: number;
  total_traders: number;
  total_liquidations_24h: number;
  liquidation_value_24h: number;
}

// ---------------------------------------------------------------------------
// OHLCV candles (BULK kline format passes through unchanged)
// ---------------------------------------------------------------------------

export interface Candle {
  t: number;   // open time, ms
  T: number;   // close time, ms
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume in base asset
  n: number;   // number of trades
}

export interface CandlesResponse {
  symbol: string;
  interval: string;
  limit: number;
  candles: Candle[];
}

// ---------------------------------------------------------------------------
// Account hierarchy (BULK v1.0.14: Master/Sub-account/Multisig)
// ---------------------------------------------------------------------------

export interface HierarchySubAccountRef {
  pubkey: string;
  name?: string;
}

export interface HierarchySummary {
  totalBalance: number;
  availableBalance: number;
  marginUsed: number;
  notional: number;
  unrealizedPnl: number;
  realizedPnl: number;
  positionsCount: number;
}

export interface HierarchyResponse {
  address: string;
  kind: 'MasterEOA' | 'SubAccount' | 'Unknown';
  parent?: string;
  subAccounts: HierarchySubAccountRef[];
  multisigAccounts: string[];
  resolvedAt: number;
  // Per-pubkey financial summary keyed by pubkey. Includes the queried
  // address itself plus each sub-account when the queried address is a master.
  summaries: Record<string, HierarchySummary>;
}

// ---------------------------------------------------------------------------
// Activity timeline (deposits, withdrawals, transfers, sub-account events)
// ---------------------------------------------------------------------------

export type ActivityEventType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'createSubAccount'
  | 'removeSubAccount'
  | 'renameSubAccount'
  | 'multisigCreated'
  | 'proposalCreated'
  | 'proposalExecuted'
  | 'proposalFailed'
  | 'proposalCancelled'
  | string; // unknown future event types pass through as-is

export interface ActivityEvent {
  activityType: ActivityEventType;
  status: string;                 // "completed" | "failed" | etc.
  from?: string;                  // source pubkey (or null for some events)
  to?: string;                    // destination pubkey
  fromLabel?: string;             // resolver-friendly label, e.g. "farm (alice's sub-account)"
  toLabel?: string;
  symbol?: string;                // token symbol for transfers (e.g. "USDC")
  amount?: number;
  iso?: boolean;
  slot?: number;
  timestamp: number;              // nanoseconds (BULK convention) — divide by 1e6 for JS Date
  sequence?: number;
}

export interface ActivityResponse {
  address: string;
  data: ActivityEvent[];
  count: number;
}

// One closed position from BULK's `positions` API. Represents a single
// open→close lifecycle: trader opened a long/short, possibly added or
// reduced, then fully closed. Realized PnL is net of fees and funding,
// pre-computed by BULK.
//
// Used by the wallet page's "Closed Positions" list and the chart modal's
// trade-history panel. Far more meaningful than raw fills because each
// row is one decision the trader committed to.
export interface ClosedPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  openPrice: number;
  closePrice: number;
  openedAt: number;     // ms since epoch
  closedAt: number;     // ms since epoch
  /** Net realized PnL — already includes fees and funding. Use this as
   *  the headline number in any UI. The components (grossPnl, fees,
   *  funding) are exposed below for breakdown tooltips. */
  realizedPnl: number;
  /** Gross price-only PnL: (closePrice - openPrice) × size. Useful for
   *  showing the breakdown ("Gross $X · Fees -$Y → Net $Z") in tooltips
   *  so users see where the number came from. */
  grossPnl: number;
  fees: number;        // negative when paid by trader; zero when not yet booked
  funding: number;     // signed (negative when paid, positive when received)
  leverage: number;
  notional?: number;
  liquidated: boolean;
  /** BULK's close reason string, e.g. "trade", "liquidation", "adl".
   *  Empty when not provided. Useful for distinguishing forced exits
   *  with finer granularity than the boolean `liquidated`. */
  closeReason?: string;
}

// One executed trade fill from BULK's `fills` API. We render these as
// triangle markers on the position chart so users can see exactly when
// and at what price the wallet entered/exited a market.
//
// reasonCode tells us *why* the fill happened — most are "trade" but some
// are forced (liq) or auto-deleveraging (adl). We tint markers by reason
// so a stream viewer can spot a liquidation entry visually.
export interface WalletFill {
  timestamp: number;       // ms since epoch
  symbol: string;          // e.g. "BTC-USD"
  price: number;
  size: number;            // always positive; direction is in isBuy
  isBuy: boolean;
  orderIdMaker?: string;
  orderIdTaker?: string;
  reasonCode?: string;     // "trade" | "liq" | "adl" | other
  // BULK includes these for completeness; we don't use them in the chart
  // overlay but expose them in the type for downstream consumers.
  maker?: string;
  taker?: string;
  iso?: boolean;
  counterpartyHint?: string;
}

export interface Notification {
  id: number;
  wallet_address: string;
  nickname: string | null;
  type: 'trade' | 'liquidation';
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  read: boolean;
  created_at: string;
}

export interface WalletData {
  address: string;
  /**
   * Live account snapshot. PnL fields here are NET — the backend has
   * already added fees and funding into the realizedPnl values for both
   * margin and per-position. Unrealized PnL stays gross (mark-to-market
   * doesn't book fees until close).
   */
  live: {
    margin: {
      totalBalance: number;
      availableBalance: number;
      marginUsed: number;
      /** Net realized PnL (gross realized + fees + funding). */
      realizedPnl: number;
      unrealizedPnl: number;
      /** Lifetime fees paid by this wallet (negative when paid). */
      fees: number;
      /** Lifetime funding paid/received (negative when paid, positive when received). */
      funding: number;
    };
    positions: Array<{
      symbol: string;
      size: number;
      price: number;
      notional: number;
      /** Net realized on this position (gross + fees + funding). */
      realizedPnl?: number;
      unrealizedPnl: number;
      leverage: number;
      liquidationPrice: number;
    }>;
  } | null;
  markPrices: Record<string, number>;
  tracked: {
    total_pnl: number;
    total_volume: number;
    total_trades: number;
    total_liquidations: number;
  } | null;
  history: Array<{
    timestamp: string;
    pnl: number;
    unrealized_pnl: number;
    positions_count: number;
    total_notional: number;
  }>;
}

// NEW: Types for calculated Open Interest
export interface OpenInterestCalculated {
  symbol: string;
  hours: number;
  currentOI: number;
  totalLongs: number;
  totalShorts: number;
  positionCount: number;
  topPositions: Array<{ wallet: string; position: number }>;
  data: ChartDataPoint[];
}

export interface OpenInterestLive {
  symbol: string;
  openInterest: number;
  totalLongs: number;
  totalShorts: number;
  positions: number;
  timestamp: string;
}

// Live order book level: price, size (base), and number of orders at that price.
export interface OrderbookLevel {
  px: number;
  sz: number;
  n: number;
}

// Derived stats the backend pre-computes for the order book page — saves the
// client from redoing the math on every 3-second refresh.
export interface OrderbookStats {
  bestBid: OrderbookLevel | null;
  bestAsk: OrderbookLevel | null;
  mid: number | null;
  spreadAbs: number | null;
  spreadBps: number | null;
  bidDepth2pctUsd: number;
  askDepth2pctUsd: number;
  imbalance: number; // [-1, +1]
}

// Full order book snapshot returned by /api/analytics/orderbook/:coin.
// `bids` are sorted DESCENDING by price; `asks` are sorted ASCENDING.
export interface OrderbookSnapshot {
  symbol: string;
  updateType: string;
  timestamp: number; // milliseconds
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  stats: OrderbookStats;
}

// ============ Risk Surfaces ============
//
// BULK publishes per-market maintenance margin surfaces as a 2D grid indexed
// by (notional_idx, leverage_idx), with one grid per regime and one each for
// buy vs sell sides. Each cell tells you:
//   mmrO = maintenance margin rate for OPENING a new position at that size/lev
//   mmrE = maintenance margin rate for an EXISTING position (usually looser)
//   p    = portfolio margining factor (credit when hedging across markets)
//
// regime is an integer in roughly [-12, +12]: negative = bearish stress,
// 0 = neutral, positive = bullish stress. `liveRegime` tells you which one
// is currently active.
//
// See: https://docs.bulk.trade (Risk Surfaces section)
export interface RiskSurfaceCell {
  mmrO: number;
  mmrE: number;
  p: number;
}

export interface RiskSurfaceEntry {
  regime: number;
  /** Leverage steps (x-axis). Typically [1, 2, ..., 50]. */
  leverage: number[];
  /** Notional size buckets in USD (y-axis). Log-ish spacing from ~$50K to $100M. */
  notionals: number[];
  /** buy[notional_idx][leverage_idx] → cell for LONG positions. */
  buy: RiskSurfaceCell[][];
  /** sell[notional_idx][leverage_idx] → cell for SHORT positions. */
  sell: RiskSurfaceCell[][];
}

export interface RiskSurfaces {
  symbol: string;
  /** The regime that is currently active for this market. */
  liveRegime: number;
  /** One entry per regime the market publishes a surface for. */
  surfaces: RiskSurfaceEntry[];
  /** BULK's portfolio-margining correlation coefficients.
   *  Shape: [["COINA:COINB", rho], ...] — the pair is a single colon-joined
   *  string (e.g. "BTC:ETH"), not a tuple. Upper-triangle only (each
   *  unordered pair appears once). Same full matrix on every market's
   *  response, so any one /risk-surfaces call carries all pairs. */
  corrs: Array<[string, number]>;
}

// Helper to get auth token (for legacy auth only)
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bulk_token');
}

// API request helper. Exported so other modules (hooks, new feature files)
// can share the same auth + error-handling behavior instead of duplicating it.
export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  // ONLY add bulk_token if no Authorization header was explicitly provided
  // This allows Privy tokens to be passed through without being overwritten
  const existingHeaders = options.headers as Record<string, string> | undefined;
  const hasAuthHeader = existingHeaders?.['Authorization'] || existingHeaders?.['authorization'];
  
  if (!hasAuthHeader) {
    const token = getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }
  
  // Append `?net=devnet` (or current network) so the backend can
  // route this request's BULK upstream calls to the right network.
  // Mainnet (default) gets no query param to keep URLs clean.
  const url = `${API_URL}${withNetwork(endpoint)}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  
  return res.json();
}

// Auth API (legacy email/password - kept for compatibility)
export const auth = {
  async register(email: string, password: string, username?: string): Promise<{ user: User; token: string }> {
    const data = await request<{ user: User; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username }),
    });
    localStorage.setItem('bulk_token', data.token);
    return data;
  },

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const data = await request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('bulk_token', data.token);
    return data;
  },

  async getMe(): Promise<User | null> {
    try {
      const data = await request<{ user: User }>('/api/auth/me');
      return data.user;
    } catch {
      return null;
    }
  },

  logout() {
    localStorage.removeItem('bulk_token');
  },

  isLoggedIn(): boolean {
    return !!getToken();
  },
};

// Leaderboard API
export const leaderboard = {
  async getTopPnL(timeframe: string = 'all', limit: number = 50): Promise<LeaderboardEntry[]> {
    const data = await request<{ data: LeaderboardEntry[] }>(
      `/api/leaderboard/pnl?timeframe=${timeframe}&limit=${limit}`
    );
    return data.data;
  },

  async getMostLiquidated(timeframe: string = 'all', limit: number = 50): Promise<LeaderboardEntry[]> {
    const data = await request<{ data: LeaderboardEntry[] }>(
      `/api/leaderboard/liquidated?timeframe=${timeframe}&limit=${limit}`
    );
    return data.data;
  },

  async getWhales(limit: number = 50): Promise<LeaderboardEntry[]> {
    const data = await request<{ data: LeaderboardEntry[] }>(
      `/api/leaderboard/whales?limit=${limit}`
    );
    return data.data;
  },

  async getMostActive(timeframe: string = 'all', limit: number = 50): Promise<LeaderboardEntry[]> {
    const data = await request<{ data: LeaderboardEntry[] }>(
      `/api/leaderboard/active?timeframe=${timeframe}&limit=${limit}`
    );
    return data.data;
  },

  async getRecentLiquidations(limit: number = 50): Promise<unknown[]> {
    const data = await request<{ data: unknown[] }>(
      `/api/leaderboard/liquidations/recent?limit=${limit}`
    );
    return data.data;
  },

  async getRecentTrades(limit: number = 50): Promise<unknown[]> {
    const data = await request<{ data: unknown[] }>(
      `/api/leaderboard/trades/recent?limit=${limit}`
    );
    return data.data;
  },

  async getWalletRank(walletAddress: string): Promise<WalletRankData> {
    const data = await request<WalletRankData>(
      `/api/leaderboard/rank/${walletAddress}`
    );
    return data;
  },

  // Tournament-grade leaderboard sourced from BULK's official indexer.
  // Numbers match what users see on bulk.trade exactly — use this for the
  // primary "Top Traders" view, not the DB-backed getTopPnL above.
  //
  // Per the BULK dev: window=24h tracks the last 12h of trades (indexer
  // limitation). Just expose it as "24h" so the UI matches their site.
  async getBulkLeaderboard(opts: {
    window?: BulkLeaderboardWindow;
    metric?: BulkLeaderboardMetric;
    page?: number;
    pageSize?: number;
  } = {}): Promise<BulkLeaderboardResponse> {
    const params = new URLSearchParams();
    params.set('window', opts.window || '24h');
    params.set('metric', opts.metric || 'cashflow_adjusted_roi');
    if (opts.page) params.set('page', String(opts.page));
    if (opts.pageSize) params.set('page_size', String(opts.pageSize));
    return request<BulkLeaderboardResponse>(
      `/api/leaderboard/bulk?${params.toString()}`
    );
  },

  // Look up a wallet's rank on the BULK indexer leaderboard for a given
  // window+metric. Backend paginates server-side and returns the rank +
  // the row's metric values, or `found: false` if not in top ~2000.
  // Cached 60s, so it's safe to call on every wallet page render.
  async getBulkRank(
    address: string,
    opts: {
      window?: BulkLeaderboardWindow;
      metric?: BulkLeaderboardMetric;
    } = {},
  ): Promise<BulkLeaderboardRankResponse> {
    const params = new URLSearchParams();
    params.set('window', opts.window || '24h');
    params.set('metric', opts.metric || 'cashflow_adjusted_roi');
    return request<BulkLeaderboardRankResponse>(
      `/api/leaderboard/bulk/rank/${encodeURIComponent(address)}?${params.toString()}`
    );
  },
};

// Types for the BULK indexer leaderboard. Mirror the proxy endpoint's
// validation: anything outside these unions is rejected at the backend.
export type BulkLeaderboardWindow = '24h' | '7d' | '30d' | 'all';
export type BulkLeaderboardMetric =
  | 'cashflow_adjusted_roi'
  | 'realized_pnl'
  | 'net_realized_pnl'
  | 'volume'
  | 'roi'
  | 'net_realized_roi'
  | 'win_rate';

export interface BulkLeaderboardRow {
  rank: number;
  wallet: string;
  /** Gross realized PnL — closed-position price math only, no fees/funding.
   *  Confirmed 2026-05-21: indexer exposes both gross and net side-by-side. */
  realized_pnl: number;
  /** Net realized PnL — gross minus fees. This is the user-facing PnL
   *  number; UIs should use this for headlines. (Funding isn't broken
   *  out on the indexer response so it's not separately netted here,
   *  but if BULK adds it, the net value would already include it.) */
  net_realized_pnl: number;
  /** Total fees paid on this wallet's lifetime trades. Already negative-signed
   *  (the trader paid them). realized_pnl + fees_paid = net_realized_pnl. */
  fees_paid?: number;
  volume: number;
  closed_count: number;
  roi: number | null;
  net_realized_roi: number | null;
  cashflow_adjusted_roi: number | null;
  win_rate: number;
  /** Largest gross notional this wallet has ever held open. */
  peak_notional?: number;
  /** Largest account balance ever observed. */
  peak_balance?: number;
  /** Effective capital deployed — typically equals peak_balance. */
  effective_capital?: number;
  /** Indexer's composite skill metric. */
  skill_score?: number;
  updated_at: string;
}

export interface BulkLeaderboardResponse {
  window: string;
  metric: string;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  rows: BulkLeaderboardRow[];
  error?: string;
}

// Discriminated union for the rank-lookup endpoint. `found: true` means
// the wallet is in the top ~2000 traders for this window+metric and we
// have its rank; `found: false` means it's not — could be too low to
// matter, could be a fresh wallet with no closed positions yet, etc.
export type BulkLeaderboardRankResponse =
  | {
      found: true;
      rank: number;
      total: number;
      metric: string;
      window: string;
      wallet: string;
      row: BulkLeaderboardRow;
    }
  | {
      found: false;
      total: number;
      metric: string;
      window: string;
      wallet: string;
      scannedPages: number;
    };

// Analytics API
export const analytics = {
  // Live order book snapshot for a market. Backed by BULK's /l2book endpoint,
  // proxied through our backend with a 2-second cache so many users viewing
  // the page don't hammer BULK.
  async getOrderbook(coin: string, nlevels: number = 20): Promise<OrderbookSnapshot> {
    return request<OrderbookSnapshot>(
      `/api/analytics/orderbook/${encodeURIComponent(coin)}?nlevels=${nlevels}`
    );
  },

  // BULK's margin model for a given market — a grid of (notional x leverage)
  // maintenance margin rates per regime, per side (buy/sell). See RiskSurfaces
  // type below for the shape. Backend is a 5-min caching proxy.
  async getRiskSurfaces(coin: string): Promise<RiskSurfaces> {
    return request<RiskSurfaces>(
      `/api/analytics/risk-surfaces/${encodeURIComponent(coin)}`
    );
  },

  // OHLCV candles for a market — used by the position-detail chart on the
  // wallet page. Backend caches 30s. Allowed intervals match BULK's
  // documented set: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M.
  //
  // Optional `startTime` / `endTime` (ms epoch) restrict the response to
  // a specific time window — used by the closed-position chart to load
  // candles around a historical trade rather than the most recent N
  // candles. When omitted, behavior is unchanged.
  async getCandles(
    symbol: string,
    interval: string = '1h',
    limit: number = 100,
    opts: { startTime?: number; endTime?: number } = {},
  ): Promise<CandlesResponse> {
    const s = symbol.toUpperCase().endsWith('-USD')
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}-USD`;
    const params = new URLSearchParams({ interval, limit: String(limit) });
    if (typeof opts.startTime === 'number') {
      params.set('startTime', String(Math.floor(opts.startTime)));
    }
    if (typeof opts.endTime === 'number') {
      params.set('endTime', String(Math.floor(opts.endTime)));
    }
    return request<CandlesResponse>(
      `/api/analytics/candles/${encodeURIComponent(s)}?${params.toString()}`
    );
  },

  // REAL Open Interest history from ticker_snapshots (collected via WebSocket)
  async getOpenInterestHistory(symbol: string, hours: number = 24): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/open-interest-history/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  // REAL Funding Rate history from ticker_snapshots (collected via WebSocket)
  async getFundingRateHistory(symbol: string, hours: number = 24): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/funding-rate-history/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  // REAL Combined OI chart for all symbols
  async getOIChart(hours: number = 24): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/oi-chart?hours=${hours}`
    );
    return data.data;
  },

  // REAL Combined Funding Rate chart for all symbols
  async getFundingChart(hours: number = 24): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/funding-chart?hours=${hours}`
    );
    return data.data;
  },

  // Trades chart from our database
  async getTradesChart(hours: number = 24): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/trades-chart?hours=${hours}`
    );
    return data.data;
  },

  // Exchange health stats
  async getExchangeHealth(): Promise<ExchangeHealth> {
    return request('/api/analytics/exchange-stats');
  },

  // Live open interest from BULK API
  async getLiveOpenInterest(symbol: string): Promise<OpenInterestLive> {
    return request(`/api/analytics/open-interest-live/${symbol}`);
  },

  // All tickers
  async getTickers(): Promise<unknown> {
    return request('/api/analytics/tickers');
  },

  // Long/short ratio
  async getLongShortRatio(symbol: string, hours: number = 24): Promise<LongShortDataPoint[]> {
    const data = await request<{ data: LongShortDataPoint[] }>(
      `/api/analytics/long-short/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getLiquidationsChart(hours: number = 720): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/liquidations-chart?hours=${hours}`
    );
    return data.data;
  },

  async getADLChart(hours: number = 720): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/adl-chart?hours=${hours}`
    );
    return data.data;
  },

  async getVolumeChart(hours: number = 720): Promise<ChartData[]> {
    const data = await request<{ data: ChartData[] }>(
      `/api/analytics/volume-chart?hours=${hours}`
    );
    return data.data;
  },

  async getStats(): Promise<{
    trades: { count: number; volume: number };
    liquidations: { count: number; volume: number };
    adl: { count: number; volume: number };
    uniqueTraders: number;
  }> {
    return request('/api/analytics/stats');
  },

  // Volume chart from BULK API (via backend proxy)
  async getVolumeFromBulkAPI(hours: number = 24): Promise<ChartData[]> {
    try {
      const response = await request<{ data: ChartData[] }>(
        `/api/analytics/volume-chart-api?hours=${hours}`
      );
      console.log('Volume API response:', response);
      return response.data || [];
    } catch (error) {
      console.error('Volume API error:', error);
      return [];
    }
  },

  // Trades count chart from BULK API (via backend proxy)
  async getTradesFromBulkAPI(hours: number = 24): Promise<ChartData[]> {
    try {
      const response = await request<{ data: ChartData[] }>(
        `/api/analytics/trades-chart-api?hours=${hours}`
      );
      console.log('Trades API response:', response);
      return response.data || [];
    } catch (error) {
      console.error('Trades API error:', error);
      return [];
    }
  },

  // ============ NEW: BULK API DIRECT (no PostgreSQL) ============

  // Volume chart directly from BULK /klines endpoint
  async getVolumeChartBulk(interval: string = '1h'): Promise<ChartData[]> {
    try {
      const response = await request<{
        data: ChartData[];
        source: string;
        interval: string;
      }>(`/api/analytics/volume-chart-bulk?interval=${interval}`);
      console.log('Volume BULK API response:', response);
      return response.data || [];
    } catch (error) {
      console.error('Volume BULK API error:', error);
      return [];
    }
  },

  // Current market stats from BULK /stats endpoint
  async getMarketStatsBulk(): Promise<{
    timestamp: number;
    totalVolume24h: number;
    totalOpenInterest: number;
    markets: Array<{
      symbol: string;
      volume24h: number;
      openInterest: number;
      openInterestCoins: number;
      fundingRate: number;
      price: number;
    }>;
  }> {
    return request('/api/analytics/market-stats-bulk');
  },

  // All tickers from BULK /ticker endpoints
  async getTickersBulk(): Promise<{
    tickers: Array<{
      symbol: string;
      lastPrice: number;
      markPrice: number;
      volume: number;
      quoteVolume: number;
      openInterest: number;
      fundingRate: number;
      priceChange: number;
      priceChangePercent: number;
    }>;
  }> {
    return request('/api/analytics/tickers-bulk');
  },

  // Unique traders by coin (daily breakdown)
  async getUniqueTradersByCoin(hours: number = 720): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    try {
      const response = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
        `/api/analytics/unique-traders-by-coin?hours=${hours}`
      );
      return response.data || [];
    } catch (error) {
      console.error('Unique traders by coin error:', error);
      return [];
    }
  },

  // Daily Active Users
  async getDailyActiveUsers(hours: number = 720): Promise<{ timestamp: string; dau: number }[]> {
    try {
      const response = await request<{ data: { timestamp: string; dau: number }[] }>(
        `/api/analytics/daily-active-users?hours=${hours}`
      );
      return response.data || [];
    } catch (error) {
      console.error('DAU error:', error);
      return [];
    }
  },

  // Cumulative New Users
  async getCumulativeNewUsers(hours: number = 720): Promise<{ timestamp: string; newUsers: number; cumulative: number }[]> {
    try {
      const response = await request<{ data: { timestamp: string; newUsers: number; cumulative: number }[] }>(
        `/api/analytics/cumulative-new-users?hours=${hours}`
      );
      return response.data || [];
    } catch (error) {
      console.error('Cumulative new users error:', error);
      return [];
    }
  },

  // ============ LIQUIDATIONS DASHBOARD ============

  // Treemap data - liquidations by coin and side
  async getLiquidationsTreemap(period: string = '24h'): Promise<{
    period: string;
    data: { symbol: string; side: string; value: number; count: number }[];
    totalValue: number;
    assets: number;
  }> {
    return request(`/api/analytics/liquidations/treemap?period=${period}`);
  },

  // Chart data - long vs short over time (for liquidations dashboard)
  async getLiquidationsLongShortChart(period: string = 'all'): Promise<{
    period: string;
    data: { timestamp: string; longValue: number; shortValue: number; longCount: number; shortCount: number }[];
  }> {
    return request(`/api/analytics/liquidations/chart?period=${period}`);
  },

  // Summary for a specific coin
  async getLiquidationsSummary(symbol: string, period: string = '7d'): Promise<{
    symbol: string;
    period: string;
    totalValue: number;
    totalCount: number;
    longValue: number;
    shortValue: number;
    longCount: number;
    shortCount: number;
    longPercent: number;
    shortPercent: number;
    largestValue: number;
    largestSize: number;
  }> {
    return request(`/api/analytics/liquidations/summary/${symbol}?period=${period}`);
  },

  // Market summary for a specific coin
  async getLiquidationsMarket(symbol: string, period: string = 'all'): Promise<{
    symbol: string;
    period: string;
    markPrice: number;
    priceChange24h: number;
    totalValue: number;
    longValue: number;
    shortValue: number;
    longCount: number;
    shortCount: number;
    longPercent: number;
    shortPercent: number;
    dominant: 'LONGS' | 'SHORTS' | 'NEUTRAL';
  }> {
    return request(`/api/analytics/liquidations/market/${symbol}?period=${period}`);
  },

  // Featured/Recent large liquidations
  async getLiquidationsFeatured(limit: number = 10, symbol?: string): Promise<{
    data: {
      id: number;
      wallet: string;
      symbol: string;
      side: string;
      size: number;
      price: number;
      value: number;
      timestamp: string;
      isHighImpact: boolean;
    }[];
  }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.append('symbol', symbol);
    return request(`/api/analytics/liquidations/featured?${params}`);
  },

  // ============ NEW: REGIME & SENTIMENT ============

  // Live market regime data
  async getRegimeData(): Promise<{
    timestamp: number;
    aggregateRegime: number;
    markets: {
      symbol: string;
      regime: number;
      regimeDt: number;
      regimeVol: number;
      fairBookPx: number;
      markPrice: number;
      fairBias: number;
    }[];
  }> {
    return request('/api/analytics/regime');
  },

  // Volatility chart
  async getVolatilityChart(hours: number = 24): Promise<{
    period: number;
    data: { timestamp: string; BTC: number; ETH: number; SOL: number }[];
  }> {
    return request(`/api/analytics/volatility-chart?hours=${hours}`);
  },

  // Fair price vs mark price spread chart
  async getFairSpreadChart(symbol: string = 'BTC-USD', hours: number = 24): Promise<{
    symbol: string;
    period: number;
    data: { timestamp: string; markPrice: number; fairPrice: number; spreadBps: number }[];
  }> {
    return request(`/api/analytics/fair-spread-chart?symbol=${symbol}&hours=${hours}`);
  },

  // ============ FEE DATA ============

  // Fee tiers and protocol revenue
  async getFeeTiers(): Promise<{
    timestamp: number;
    windowDays: number;
    tiers: { thresholdVolume: number; makerBps: number; takerBps: number }[];
    totalMakerFees: number;
    totalTakerFees: number;
    totalProtocolSettlement: number;
    settledFills: number;
  }> {
    return request('/api/analytics/fee-tiers');
  },

  // Protocol revenue chart
  async getProtocolRevenueChart(hours: number = 168): Promise<{
    period: number;
    data: { timestamp: string; cumulativeRevenue: number; periodRevenue: number; makerFees: number; takerFees: number }[];
  }> {
    return request(`/api/analytics/protocol-revenue-chart?hours=${hours}`);
  },

  // ============ ADL DATA ============

  // ADL events chart
  async getADLChartNew(hours: number = 168): Promise<{
    period: number;
    data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number; count: number; Cumulative: number }[];
  }> {
    return request(`/api/analytics/adl-chart?hours=${hours}`);
  },

  // ADL summary stats
  async getADLSummary(period: string = '7d'): Promise<{
    period: string;
    totalValue: number;
    totalCount: number;
    byAsset: { BTC: number; ETH: number; SOL: number };
  }> {
    return request(`/api/analytics/adl-summary?period=${period}`);
  },
};

// Explorer API — read-only views into BULK's chain via the explorer
// node. See backend/src/routes/explorer.ts for shape details.

export interface ExplorerBlock {
  round: number;
  txCount: number;
  actionCount: number;
  timestampNs: number;
  blockhash: string;
  previousRoundHash?: string | null;
  txHashes?: string[];
  txHashXor?: string;
  nextRound?: number;
  receivedAt?: number;
}

export interface ExplorerBlockDetail extends ExplorerBlock {
  type: 'block';
  missingBodies: number;
  transactions: Array<{
    hash: string;
    nonce: number;
    account: string;
    signer: string;
    actionCount: number;
    actions: string[];
  }>;
}

export interface ExplorerTxDetail {
  type: 'tx';
  hash: string;
  round: number;
  indexInBlock: number;
  timestampNs: number;
  blockhash: string;
  previousRoundHash?: string | null;
  nextRound?: number;
  missingBody: boolean;
  nonce: number;
  account: string;
  signer: string;
  actionCount: number;
  actions: string[];
}

export const explorer = {
  async getRecentBlocks(limit: number = 50): Promise<{ blocks: ExplorerBlock[]; limit: number }> {
    return request(`/api/explorer/blocks?limit=${limit}`);
  },
  async getBlock(blockhash: string): Promise<ExplorerBlockDetail> {
    return request(`/api/explorer/block/${blockhash}`);
  },
  async getTransaction(txhash: string): Promise<ExplorerTxDetail> {
    return request(`/api/explorer/tx/${txhash}`);
  },
};

// Risk event from BULK's POST /account type:"riskHistory" (v1.0.15).
// Backend normalizes the raw BULK payload — timestamp arrives as ms,
// side is the position side (derived from isBuy on the BULK fill).
export interface RiskEvent {
  eventType: 'liquidation' | 'adl';
  symbol: string;
  side: 'long' | 'short';
  size: number;
  price: number;
  value: number;                          // size * price (USD notional at the fill)
  marginPrior: number;
  marginAfter: number;
  marginDelta: number;                    // marginAfter - marginPrior (negative on loss)
  /** Human-readable reason, e.g. "liquidation due to equity X < maintenance margin: Y". */
  reason: string;
  /** True for isolated-margin per-instrument events; false for cross-margin (base). */
  iso: boolean;
  timestamp: number;                      // ms
  slot: number;                           // Solana slot
  sequence: number;                       // per-block sequence number
}

export interface RiskEventsResponse {
  events: RiskEvent[];
  source: 'bulk';                         // explicit so callers can adapt UI later
  /** True when BULK's 5000-event ring is full and history likely extends further back. */
  truncated: boolean;
}

// Wallet API
export const wallet = {
  async getWallet(address: string): Promise<WalletData> {
    return request(`/api/wallet/${address}`);
  },

  async getTrades(address: string, limit: number = 50): Promise<{ data: Array<{ id: number; symbol: string; side: string; size: number; price: number; value: number; timestamp: string }> }> {
    return request(`/api/wallet/${address}/trades?limit=${limit}`);
  },

  // BULK riskHistory — liquidations + ADL events. Source is BULK exclusively
  // as of v1.0.15 migration; the older DB-backed return shape ({data: [...]})
  // is gone. Optional type filter narrows to one event kind.
  async getLiquidations(
    address: string,
    opts: { limit?: number; type?: 'liquidation' | 'adl' | 'all' } = {}
  ): Promise<RiskEventsResponse> {
    const { limit = 50, type = 'all' } = opts;
    return request(`/api/wallet/${address}/liquidations?limit=${limit}&type=${type}`);
  },

  async trackWallet(address: string): Promise<{ success: boolean }> {
    return request(`/api/wallet/${address}/track`, { method: 'POST' });
  },

  // Account hierarchy from BULK v1.0.14: kind (Master/Sub), parent, sub-accounts,
  // multisig membership, plus per-account financial summaries. Backend resolver
  // service caches hierarchy 24h and per-account summaries 60s — this is the
  // single source of truth used by /whales/[address] and (eventually) the
  // leaderboard / liquidations feed.
  async getHierarchy(address: string): Promise<HierarchyResponse> {
    return request(`/api/wallet/${address}/hierarchy`);
  },

  // Activity timeline (deposits, withdrawals, transfers, sub-account events,
  // multisig proposals). Proxies BULK's activityHistory query and labels
  // addresses through the resolver so sub-accounts show as e.g. "alice's farm"
  // instead of off-curve pubkeys.
  async getActivity(address: string, limit: number = 50): Promise<ActivityResponse> {
    return request(`/api/wallet/${address}/activity?limit=${limit}`);
  },

  // Live fill history for the wallet, optionally filtered to a symbol.
  // Used by the position chart modal to draw markers showing every entry
  // and exit on a given market. Sourced from BULK's `fills` API (not our
  // DB) so the chart reflects fills that just happened a few seconds ago.
  async getFills(
    address: string,
    opts: { symbol?: string; limit?: number } = {}
  ): Promise<{ fills: WalletFill[] }> {
    const params = new URLSearchParams();
    if (opts.symbol) params.set('symbol', opts.symbol);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request(
      `/api/wallet/${address}/fills${qs ? `?${qs}` : ''}`
    );
  },

  // Closed-position history for the wallet — each entry is one full
  // open→close lifecycle with realized PnL pre-computed by BULK. This is
  // what powers the wallet page's "Recent Trades" list (which is really a
  // closed-positions list, not a fills list).
  //
  // Optional symbol filter is server-side, so we don't ship hundreds of
  // unrelated positions to render one wallet's BTC-only history.
  async getClosedPositions(
    address: string,
    opts: { symbol?: string; limit?: number } = {}
  ): Promise<{ positions: ClosedPosition[] }> {
    const params = new URLSearchParams();
    if (opts.symbol) params.set('symbol', opts.symbol);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request(
      `/api/wallet/${address}/closed-positions${qs ? `?${qs}` : ''}`
    );
  },

  async getWatchlist(): Promise<Array<{ wallet_address: string; nickname: string | null; total_pnl?: number; total_volume?: number }>> {
    const data = await request<{ data: Array<{ wallet_address: string; nickname: string | null; total_pnl?: number; total_volume?: number }> }>(
      '/api/wallet/user/watchlist'
    );
    return data.data;
  },

  async addToWatchlist(address: string, nickname?: string): Promise<{ success: boolean }> {
    return request(`/api/wallet/watchlist/${address}`, {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    });
  },

  async removeFromWatchlist(address: string): Promise<{ success: boolean }> {
    return request(`/api/wallet/watchlist/${address}`, { method: 'DELETE' });
  },

  async getNotifications(limit: number = 50, unreadOnly: boolean = false): Promise<{ data: Notification[]; unread_count: number }> {
    return request(`/api/wallet/user/notifications?limit=${limit}&unread=${unreadOnly}`);
  },

  async markNotificationsRead(ids?: number[]): Promise<{ success: boolean }> {
    return request('/api/wallet/user/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  async clearNotifications(): Promise<{ success: boolean }> {
    return request('/api/wallet/user/notifications', { method: 'DELETE' });
  },
};

// ============ USER API (Privy auth) ============

export interface UserSearchResult {
  wallet_address: string;
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
  display_name?: string;
  total_pnl?: number;
  total_volume?: number;
  trade_count?: number;
}

export const userApi = {
  // Search users by Twitter handle or wallet address
  async search(query: string): Promise<UserSearchResult[]> {
    if (!query || query.length < 2) return [];
    try {
      const data = await request<{ results: UserSearchResult[] }>(
        `/api/users/search?q=${encodeURIComponent(query)}`
      );
      return data.results || [];
    } catch (error) {
      console.error('User search error:', error);
      return [];
    }
  },

  // Get multiple wallet profiles in one request (batch)
  async getWalletProfilesBatch(addresses: string[]): Promise<Record<string, { profile: any; stats: any }>> {
    if (!addresses || addresses.length === 0) return {};
    try {
      const data = await request<{ profiles: Record<string, { profile: any; stats: any }> }>(
        '/api/users/wallets/batch',
        {
          method: 'POST',
          body: JSON.stringify({ addresses }),
        }
      );
      return data.profiles || {};
    } catch (error) {
      console.error('Batch wallet profiles error:', error);
      return {};
    }
  },

  // Authenticate with backend after Privy login
  async authenticate(token: string, walletAddress?: string, email?: string) {
    return request('/api/users/auth', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ walletAddress, email }),
    });
  },

  // Get current user
  async getMe(token: string) {
    return request('/api/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Link Twitter account
  async linkTwitter(token: string, data: {
    twitterId: string;
    twitterHandle: string;
    twitterName: string;
    twitterAvatar: string;
  }) {
    return request('/api/users/link/twitter', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
  },

  // Unlink Twitter account
  async unlinkTwitter(token: string) {
    return request('/api/users/link/twitter', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Claim a wallet (for email users)
  async claimWallet(token: string, walletAddress: string) {
    return request('/api/users/claim-wallet', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ walletAddress }),
    });
  },

  // Unclaim wallet
  async unclaimWallet(token: string) {
    return request('/api/users/claim-wallet', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Get followed wallets
  async getFollowing(token: string) {
    return request('/api/users/following', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Follow a wallet
  async followWallet(token: string, walletAddress: string, nickname?: string) {
    return request('/api/users/follow', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ walletAddress, nickname }),
    });
  },

  // Unfollow a wallet
  async unfollowWallet(token: string, walletAddress: string) {
    return request(`/api/users/follow/${walletAddress}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Check if following a wallet
  async isFollowing(token: string, walletAddress: string) {
    return request(`/api/users/is-following/${walletAddress}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  },

  // Get public wallet profile
  async getWalletProfile(walletAddress: string) {
    return request(`/api/users/wallet/${walletAddress}`);
  },
};

// Utility functions
export function formatCurrency(num: number | string | null | undefined): string {
  if (num === null || num === undefined || num === '') return '$0';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(2) + 'K';
  return sign + '$' + abs.toFixed(2);
}

// Utility functions
export function formatNumber(num: number | string | null | undefined, decimals = 2): string {
  if (num === null || num === undefined || num === '') return '—';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatCompact(num: number | string | null | undefined): string {
  if (num === null || num === undefined || num === '') return '—';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

export function formatAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr || '';
  return addr.slice(0, 4) + '...' + addr.slice(-4);
}

export function formatPercent(num: number | string | null | undefined, decimals = 2): string {
  if (num === null || num === undefined || num === '') return '—';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(decimals) + '%';
}

export function timeAgo(timestamp: string | number): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
