// API client for BULK Stats backend
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

// ============ TYPES ============

export interface LeaderboardEntry {
  wallet_address: string;
  total_volume: number;
  trade_count: number;
  total_pnl: number;
  win_rate: number;
  last_seen: string;
}

export interface WalletStats {
  wallet_address: string;
  total_volume: number;
  trade_count: number;
  total_pnl: number;
  win_rate: number;
  last_seen: string;
}

export interface Trade {
  id: number;
  wallet_address: string;
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  timestamp: string;
}

// ============ UTILITY FUNCTIONS ============

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatCompact(num: number): string {
  if (num === 0) return '$0';
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

export function formatNumber(num: number, decimals: number = 2): string {
  return num.toLocaleString(undefined, { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
}

export function formatPercent(num: number): string {
  return `${(num * 100).toFixed(2)}%`;
}

export function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function timeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============ ANALYTICS API ============

export const analytics = {
  // Open Interest from BULK API (may be delayed)
  async getOpenInterest(symbol: string, hours: number = 24) {
    const response = await fetch(`${API_BASE}/api/analytics/open-interest/${symbol}?hours=${hours}`);
    if (!response.ok) throw new Error('Failed to fetch open interest');
    return response.json();
  },

  // NEW: Open Interest calculated from trades (real-time)
  async getOpenInterestCalculated(symbol: string, hours: number = 24) {
    const response = await fetch(`${API_BASE}/api/analytics/open-interest-calculated/${symbol}?hours=${hours}`);
    if (!response.ok) throw new Error('Failed to fetch calculated open interest');
    return response.json();
  },

  // NEW: Live OI snapshot
  async getOpenInterestLive(symbol: string) {
    const response = await fetch(`${API_BASE}/api/analytics/open-interest-live/${symbol}`);
    if (!response.ok) throw new Error('Failed to fetch live open interest');
    return response.json();
  },

  // NEW: OI chart data from trades
  async getOpenInterestChart(symbol: string, hours: number = 24) {
    const response = await fetch(`${API_BASE}/api/analytics/open-interest-chart/${symbol}?hours=${hours}`);
    if (!response.ok) throw new Error('Failed to fetch open interest chart');
    return response.json();
  },

  async getFundingRate(symbol: string, hours: number = 24) {
    const response = await fetch(`${API_BASE}/api/analytics/funding-rate/${symbol}?hours=${hours}`);
    if (!response.ok) throw new Error('Failed to fetch funding rate');
    return response.json();
  },

  async getTradesChart(hours: number = 720, symbol?: string) {
    const url = symbol 
      ? `${API_BASE}/api/analytics/trades-chart?hours=${hours}&symbol=${symbol}`
      : `${API_BASE}/api/analytics/trades-chart?hours=${hours}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch trades chart');
    return response.json();
  },

  async getLiquidationsChart(hours: number = 720, symbol?: string) {
    const url = symbol 
      ? `${API_BASE}/api/analytics/liquidations-chart?hours=${hours}&symbol=${symbol}`
      : `${API_BASE}/api/analytics/liquidations-chart?hours=${hours}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch liquidations chart');
    return response.json();
  },

  async getADLChart(hours: number = 720, symbol?: string) {
    const url = symbol 
      ? `${API_BASE}/api/analytics/adl-chart?hours=${hours}&symbol=${symbol}`
      : `${API_BASE}/api/analytics/adl-chart?hours=${hours}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch ADL chart');
    return response.json();
  },

  async getVolumeChart(hours: number = 720, symbol?: string) {
    const url = symbol 
      ? `${API_BASE}/api/analytics/volume-chart?hours=${hours}&symbol=${symbol}`
      : `${API_BASE}/api/analytics/volume-chart?hours=${hours}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch volume chart');
    return response.json();
  },

  async getStats() {
    const response = await fetch(`${API_BASE}/api/analytics/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },
};

// ============ LEADERBOARD API ============

export const leaderboard = {
  async getLeaderboard(timeframe: string = '24h', limit: number = 100): Promise<LeaderboardEntry[]> {
    const response = await fetch(`${API_BASE}/api/leaderboard?timeframe=${timeframe}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch leaderboard');
    const data = await response.json();
    return data.traders || data || [];
  },

  async getTopTraders(limit: number = 10): Promise<LeaderboardEntry[]> {
    const response = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch top traders');
    const data = await response.json();
    return data.traders || data || [];
  },

  async getRecentTrades(limit: number = 50): Promise<Trade[]> {
    const response = await fetch(`${API_BASE}/api/leaderboard/recent-trades?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch recent trades');
    const data = await response.json();
    return data.trades || data || [];
  },
};

// ============ WALLET API ============

export const wallet = {
  async getStats(walletAddress: string): Promise<WalletStats> {
    const response = await fetch(`${API_BASE}/api/wallet/${walletAddress}`);
    if (!response.ok) throw new Error('Failed to fetch wallet stats');
    return response.json();
  },

  async getTrades(walletAddress: string, limit: number = 50): Promise<Trade[]> {
    const response = await fetch(`${API_BASE}/api/wallet/${walletAddress}/trades?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch wallet trades');
    const data = await response.json();
    return data.trades || data || [];
  },

  async getWatchlist(): Promise<string[]> {
    const response = await fetch(`${API_BASE}/api/wallet/watchlist`, {
      credentials: 'include',
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.wallets || [];
  },

  async addToWatchlist(walletAddress: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/wallet/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ wallet_address: walletAddress }),
    });
    return response.ok;
  },

  async removeFromWatchlist(walletAddress: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/api/wallet/watchlist/${walletAddress}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return response.ok;
  },

  async getWhales(limit: number = 50): Promise<LeaderboardEntry[]> {
    const response = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}&sort=volume`);
    if (!response.ok) throw new Error('Failed to fetch whales');
    const data = await response.json();
    return data.traders || data || [];
  },
};

// ============ AUTH API ============

export const auth = {
  async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.error || 'Login failed' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  async getUser(): Promise<{ email: string } | null> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  },

  async register(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.error || 'Registration failed' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  },
};

// ============ STANDALONE EXPORTS (for backwards compatibility) ============

export async function getOpenInterest(symbol: string, hours: number = 24) {
  return analytics.getOpenInterest(symbol, hours);
}

export async function getOpenInterestCalculated(symbol: string, hours: number = 24) {
  return analytics.getOpenInterestCalculated(symbol, hours);
}

export async function getOpenInterestLive(symbol: string) {
  return analytics.getOpenInterestLive(symbol);
}

export async function getOpenInterestChart(symbol: string, hours: number = 24) {
  return analytics.getOpenInterestChart(symbol, hours);
}

export async function getFundingRate(symbol: string, hours: number = 24) {
  return analytics.getFundingRate(symbol, hours);
}

export async function getTradesChart(hours: number = 720, symbol?: string) {
  return analytics.getTradesChart(hours, symbol);
}

export async function getLiquidationsChart(hours: number = 720, symbol?: string) {
  return analytics.getLiquidationsChart(hours, symbol);
}

export async function getADLChart(hours: number = 720, symbol?: string) {
  return analytics.getADLChart(hours, symbol);
}

export async function getVolumeChart(hours: number = 720, symbol?: string) {
  return analytics.getVolumeChart(hours, symbol);
}

export async function getStats() {
  return analytics.getStats();
}

export async function getLeaderboard(timeframe: string = '24h', limit: number = 100) {
  return leaderboard.getLeaderboard(timeframe, limit);
}

export async function getTopTraders(limit: number = 10) {
  return leaderboard.getTopTraders(limit);
}

export async function getWalletStats(walletAddress: string) {
  return wallet.getStats(walletAddress);
}

export async function getWalletTrades(walletAddress: string, limit: number = 50) {
  return wallet.getTrades(walletAddress, limit);
}
