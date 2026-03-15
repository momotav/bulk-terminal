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
  async getOpenInterest(symbol: string, hours: number = 168): Promise<ChartDataPoint[]> {
    const data = await request<{ data: ChartDataPoint[] }>(
      `/api/analytics/open-interest/${symbol}?hours=${hours}`
    );
    return data.data;
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
};

// Wallet API
export const wallet = {
  async getWallet(address: string): Promise<WalletData> {
    return request(`/api/wallet/${address}`);
  },

  async trackWallet(address: string): Promise<{ success: boolean }> {
    return request(`/api/wallet/${address}/track`, { method: 'POST' });
  },

  async getWatchlist(): Promise<Array<{ wallet_address: string; nickname: string | null }>> {
    const data = await request<{ data: Array<{ wallet_address: string; nickname: string | null }> }>(
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
};

// Utility functions
export function formatNumber(num: number | null | undefined, decimals = 2): string {
  if (num === null || num === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatCompact(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  const abs = Math.abs(num);
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

export function formatAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr || '';
  return addr.slice(0, 4) + '...' + addr.slice(-4);
}

export function formatPercent(num: number | null | undefined, decimals = 2): string {
  if (num === null || num === undefined) return '—';
  const sign = num >= 0 ? '+' : '';
  return sign + num.toFixed(decimals) + '%';
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
