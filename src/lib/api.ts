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

export interface ChartDataPoint {
  timestamp: string;
  value: number;
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

// Helper to get auth token
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bulk_token');
}

// API request helper
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
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

// Auth API
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
};

// Analytics API
export const analytics = {
  // Original BULK API proxy (may be delayed/cached)
  async getOpenInterest(symbol: string, hours: number = 168): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/open-interest/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  // NEW: Open Interest calculated from trades table (real-time)
  async getOpenInterestCalculated(symbol: string, hours: number = 24): Promise<OpenInterestCalculated> {
    return request<OpenInterestCalculated>(
      `/api/analytics/open-interest-calculated/${symbol}?hours=${hours}`
    );
  },

  // NEW: Live OI snapshot with longs/shorts breakdown
  async getOpenInterestLive(symbol: string): Promise<OpenInterestLive> {
    return request<OpenInterestLive>(
      `/api/analytics/open-interest-live/${symbol}`
    );
  },

  // NEW: OI chart data calculated from trades
  async getOpenInterestChart(symbol: string, hours: number = 24): Promise<{ symbol: string; hours: number; data: ChartDataPoint[] }> {
    return request<{ symbol: string; hours: number; data: ChartDataPoint[] }>(
      `/api/analytics/open-interest-chart/${symbol}?hours=${hours}`
    );
  },

  async getFundingRate(symbol: string, hours: number = 168): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/funding-rate/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getVolume(symbol: string, hours: number = 168): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/volume/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getPrice(symbol: string, hours: number = 168): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/price/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getLongShortRatio(symbol: string, hours: number = 168): Promise<LongShortDataPoint[]> {
    const data = await request<{ data: LongShortDataPoint[] }>(
      `/api/analytics/long-short-ratio/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getLiquidationHeatmap(symbol: string, hours: number = 168): Promise<unknown[]> {
    const data = await request<{ data: unknown[] }>(
      `/api/analytics/liquidation-heatmap/${symbol}?hours=${hours}`
    );
    return data.data;
  },

  async getCorrelation(hours: number = 168): Promise<{ symbols: string[]; matrix: number[][] }> {
    return request(`/api/analytics/correlation?hours=${hours}`);
  },

  async getExchangeHealth(): Promise<ExchangeHealth> {
    return request('/api/analytics/exchange-health');
  },

  // Real data from database (testnet activity)
  async getTradesChart(hours: number = 720): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const data = await request<{ data: { timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[] }>(
      `/api/analytics/trades-chart?hours=${hours}`
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

  // BULK API Direct - Exchange Stats (volume, OI, funding)
  async getBulkStats(period: '1d' | '7d' | '30d' | '90d' | '1y' | 'all' = '1d'): Promise<{
    timestamp: number;
    period: string;
    volume: { totalUsd: number };
    openInterest: { totalUsd: number };
    funding: { rates: Record<string, { current: number; annualized: number }> };
    markets: Array<{
      symbol: string;
      volume: number;
      quoteVolume: number;
      openInterest: number;
      fundingRate: number;
      fundingRateAnnualized: number;
      lastPrice: number;
      markPrice: number;
    }>;
  }> {
    const response = await fetch(`https://exchange-api.bulk.trade/api/v1/stats?period=${period}`);
    if (!response.ok) throw new Error('Failed to fetch BULK stats');
    return response.json();
  },

  // BULK API Direct - Klines for trade count aggregation
  async getBulkKlines(symbol: string, interval: string, startTime?: number, endTime?: number): Promise<Array<{
    t: number;  // open timestamp ms
    T: number;  // close timestamp ms
    o: number;  // open
    h: number;  // high
    l: number;  // low
    c: number;  // close
    v: number;  // volume
    n: number;  // number of trades
  }>> {
    let url = `https://exchange-api.bulk.trade/api/v1/klines?symbol=${symbol}&interval=${interval}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch BULK klines');
    return response.json();
  },

  // Helper: Get volume chart data from BULK API klines
  async getVolumeFromBulkAPI(hours: number = 24): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const now = Date.now();
    const startTime = now - (hours * 60 * 60 * 1000);
    
    // Determine interval based on hours
    let interval = '1h';
    if (hours <= 24) interval = '1h';
    else if (hours <= 168) interval = '4h'; // 1 week
    else if (hours <= 720) interval = '1d'; // 1 month
    else interval = '1d';

    const [btcKlines, ethKlines, solKlines] = await Promise.all([
      this.getBulkKlines('BTC-USD', interval, startTime, now),
      this.getBulkKlines('ETH-USD', interval, startTime, now),
      this.getBulkKlines('SOL-USD', interval, startTime, now),
    ]);

    // Create a map of timestamp -> volumes
    const volumeMap = new Map<number, { BTC: number; ETH: number; SOL: number }>();

    // Process BTC
    btcKlines.forEach(k => {
      const ts = k.t;
      if (!volumeMap.has(ts)) volumeMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      volumeMap.get(ts)!.BTC = k.v * k.c; // volume in USD (size * price)
    });

    // Process ETH
    ethKlines.forEach(k => {
      const ts = k.t;
      if (!volumeMap.has(ts)) volumeMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      volumeMap.get(ts)!.ETH = k.v * k.c;
    });

    // Process SOL
    solKlines.forEach(k => {
      const ts = k.t;
      if (!volumeMap.has(ts)) volumeMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      volumeMap.get(ts)!.SOL = k.v * k.c;
    });

    // Convert to array and sort
    const result = Array.from(volumeMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, vol]) => ({
        timestamp: new Date(ts).toISOString(),
        BTC: vol.BTC,
        ETH: vol.ETH,
        SOL: vol.SOL,
        total: vol.BTC + vol.ETH + vol.SOL,
      }));

    return result;
  },

  // Helper: Get trades count chart data from BULK API klines
  async getTradesFromBulkAPI(hours: number = 24): Promise<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]> {
    const now = Date.now();
    const startTime = now - (hours * 60 * 60 * 1000);
    
    // Determine interval based on hours
    let interval = '1h';
    if (hours <= 24) interval = '1h';
    else if (hours <= 168) interval = '4h';
    else if (hours <= 720) interval = '1d';
    else interval = '1d';

    const [btcKlines, ethKlines, solKlines] = await Promise.all([
      this.getBulkKlines('BTC-USD', interval, startTime, now),
      this.getBulkKlines('ETH-USD', interval, startTime, now),
      this.getBulkKlines('SOL-USD', interval, startTime, now),
    ]);

    // Create a map of timestamp -> trade counts
    const tradesMap = new Map<number, { BTC: number; ETH: number; SOL: number }>();

    // Process BTC
    btcKlines.forEach(k => {
      const ts = k.t;
      if (!tradesMap.has(ts)) tradesMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      tradesMap.get(ts)!.BTC = k.n; // number of trades
    });

    // Process ETH
    ethKlines.forEach(k => {
      const ts = k.t;
      if (!tradesMap.has(ts)) tradesMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      tradesMap.get(ts)!.ETH = k.n;
    });

    // Process SOL
    solKlines.forEach(k => {
      const ts = k.t;
      if (!tradesMap.has(ts)) tradesMap.set(ts, { BTC: 0, ETH: 0, SOL: 0 });
      tradesMap.get(ts)!.SOL = k.n;
    });

    // Convert to array and sort
    const result = Array.from(tradesMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, trades]) => ({
        timestamp: new Date(ts).toISOString(),
        BTC: trades.BTC,
        ETH: trades.ETH,
        SOL: trades.SOL,
        total: trades.BTC + trades.ETH + trades.SOL,
      }));

    return result;
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
