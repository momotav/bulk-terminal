import type { Ticker, Candle, OrderBook, FullAccount, MarketInfo, ExchangeStats } from '@/types';

const API_BASE = 'https://exchange-api1.northstarlabs.xyz/api/v1';

export const api = {
  // Market Data
  async getExchangeInfo(): Promise<MarketInfo[]> {
    const res = await fetch(`${API_BASE}/exchangeInfo`);
    if (!res.ok) throw new Error('Failed to fetch exchange info');
    return res.json();
  },

  async getTicker(symbol: string): Promise<Ticker> {
    const res = await fetch(`${API_BASE}/ticker/${symbol}`);
    if (!res.ok) throw new Error(`Failed to fetch ticker for ${symbol}`);
    return res.json();
  },

  async getAllTickers(): Promise<Ticker[]> {
    const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
    const tickers = await Promise.all(
      symbols.map(symbol => 
        this.getTicker(symbol).catch(() => null)
      )
    );
    return tickers.filter((t): t is Ticker => t !== null);
  },

  async getCandles(
    symbol: string, 
    interval: string = '1h',
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol,
      interval,
      ...(startTime && { startTime: startTime.toString() }),
      ...(endTime && { endTime: endTime.toString() }),
    });
    const res = await fetch(`${API_BASE}/klines?${params}`);
    if (!res.ok) throw new Error('Failed to fetch candles');
    return res.json();
  },

  async getOrderBook(symbol: string, nlevels: number = 20): Promise<OrderBook> {
    const params = new URLSearchParams({
      type: 'l2Book',
      coin: symbol,
      nlevels: nlevels.toString(),
    });
    const res = await fetch(`${API_BASE}/l2book?${params}`);
    if (!res.ok) throw new Error('Failed to fetch order book');
    const data = await res.json();
    return {
      symbol,
      bids: data.levels?.[0] || [],
      asks: data.levels?.[1] || [],
      timestamp: data.timestamp || Date.now(),
    };
  },

  async getStats(period: string = '1d', symbol?: string): Promise<ExchangeStats> {
    const params = new URLSearchParams({ period });
    if (symbol) params.set('symbol', symbol);
    const res = await fetch(`${API_BASE}/stats?${params}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  // Account Data (unsigned - read only)
  async getFullAccount(userPubkey: string): Promise<FullAccount | null> {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fullAccount', user: userPubkey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.fullAccount || null;
  },

  async getOpenOrders(userPubkey: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'openOrders', user: userPubkey }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => d.openOrder).filter(Boolean);
  },

  async getFills(userPubkey: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fills', user: userPubkey }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => d.fills).filter(Boolean);
  },

  async getOrderHistory(userPubkey: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'orderHistory', user: userPubkey }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => d.orderHistory).filter(Boolean);
  },

  async getFundingHistory(userPubkey: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fundingHistory', user: userPubkey }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => d.fundingPayment).filter(Boolean);
  },
};

// Format utilities
export const formatNumber = (num: number | undefined | null, decimals = 2): string => {
  if (num === undefined || num === null) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

export const formatCompact = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '—';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

export const formatAddress = (addr: string | undefined): string => {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return addr.slice(0, 4) + '...' + addr.slice(-4);
};

export const formatPercent = (num: number | undefined | null, decimals = 2): string => {
  if (num === undefined || num === null) return '—';
  const sign = num >= 0 ? '+' : '';
  return sign + num.toFixed(decimals) + '%';
};

export const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export const cn = (...classes: (string | boolean | undefined | null)[]): string => {
  return classes.filter(Boolean).join(' ');
};
