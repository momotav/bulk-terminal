// API client for BULK Terminal Backend

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

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
  BTC: number;
  ETH: number;
  SOL: number;
  Cumulative?: number;
  total?: number;
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
  live: {
    margin: {
      totalBalance: number;
      availableBalance: number;
      marginUsed: number;
      realizedPnl: number;
      unrealizedPnl: number;
    };
    positions: Array<{
      symbol: string;
      size: number;
      price: number;
      notional: number;
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

// Helper to get auth token (for legacy auth only)
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bulk_token');
}

// API request helper
async function request<T>(
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
  
  const res = await fetch(`${API_URL}${endpoint}`, {
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
};

// Analytics API
export const analytics = {
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

  async getLiquidationsChart(hours: number = 720): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const data = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
      `/api/analytics/liquidations-chart?hours=${hours}`
    );
    return data.data;
  },

  async getADLChart(hours: number = 720): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const data = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
      `/api/analytics/adl-chart?hours=${hours}`
    );
    return data.data;
  },

  async getVolumeChart(hours: number = 720): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const data = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
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
  async getVolumeFromBulkAPI(hours: number = 24): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    try {
      const response = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
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
  async getTradesFromBulkAPI(hours: number = 24): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    try {
      const response = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
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
  async getVolumeChartBulk(interval: string = '1h'): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; XRP: number; GOLD: number; total: number }[]> {
    try {
      const response = await request<{ 
        data: { timestamp: string; BTC: number; ETH: number; SOL: number; XRP: number; GOLD: number; total: number }[];
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

// Wallet API
export const wallet = {
  async getWallet(address: string): Promise<WalletData> {
    return request(`/api/wallet/${address}`);
  },

  async getTrades(address: string, limit: number = 50): Promise<{ data: Array<{ id: number; symbol: string; side: string; size: number; price: number; value: number; timestamp: string }> }> {
    return request(`/api/wallet/${address}/trades?limit=${limit}`);
  },

  async getLiquidations(address: string, limit: number = 50): Promise<{ data: Array<{ id: number; symbol: string; side: string; size: number; price: number; value: number; timestamp: string }> }> {
    return request(`/api/wallet/${address}/liquidations?limit=${limit}`);
  },

  async trackWallet(address: string): Promise<{ success: boolean }> {
    return request(`/api/wallet/${address}/track`, { method: 'POST' });
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
