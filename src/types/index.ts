// Market Data Types
export interface Ticker {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  markPrice: number;
  oraclePrice: number;
  openInterest: number;
  fundingRate: number;
  regime?: number;
  regimeDt?: number;
  regimeVol?: number;
  regimeMv?: number;
  fairBookPx?: number;
  fairVol?: number;
  fairBias?: number;
  timestamp: number;
}

export interface Candle {
  t: number;  // Open timestamp
  T: number;  // Close timestamp
  o: number;  // Open
  h: number;  // High
  l: number;  // Low
  c: number;  // Close
  v: number;  // Volume
  n: number;  // Number of trades
}

export interface OrderBookLevel {
  px: number;
  sz: number;
  n: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface Trade {
  s: string;      // Symbol
  px: number;     // Price
  sz: number;     // Size
  time: number;   // Timestamp
  side: boolean;  // true = buy, false = sell
  maker?: string;
  taker?: string;
  reason?: 'normal' | 'liquidation' | 'adl';
}

// Liquidation Types
export interface Liquidation {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  price: number;
  value: number;
  address?: string;
  timestamp: number;
}

// Account Types
export interface Margin {
  totalBalance: number;
  availableBalance: number;
  marginUsed: number;
  notional: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  funding: number;
}

export interface Position {
  symbol: string;
  size: number;
  price: number;
  fairPrice: number;
  notional: number;
  realizedPnl: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  fees: number;
  funding: number;
  maintenanceMargin: number;
  lambda?: number;
  riskAllocation?: number;
  allocMargin?: number;
}

export interface OpenOrder {
  symbol: string;
  orderId: string;
  price: number;
  originalSize: number;
  size: number;
  filledSize: number;
  vwap: number;
  isBuy: boolean;
  maker: boolean;
  reduceOnly: boolean;
  tif: 'gtc' | 'ioc' | 'postOnly';
  status: string;
  timestamp: number;
}

export interface LeverageSetting {
  symbol: string;
  leverage: number;
}

export interface FullAccount {
  margin: Margin;
  positions: Position[];
  openOrders: OpenOrder[];
  leverageSettings: LeverageSetting[];
}

// Exchange Info
export interface MarketInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'TRADING' | 'SUSPENDED' | 'CLOSED';
  pricePrecision: number;
  sizePrecision: number;
  tickSize: number;
  lotSize: number;
  minNotional: number;
  maxLeverage: number;
  orderTypes: string[];
  timeInForces: string[];
}

// Exchange Stats
export interface ExchangeStats {
  timestamp: number;
  period: string;
  volume: { totalUsd: number };
  openInterest: { totalUsd: number };
  funding: {
    rates: Record<string, { current: number; annualized: number }>;
  };
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
}

// WebSocket Message Types
export interface WSMessage {
  type: string;
  data?: any;
  topic?: string;
}

export interface WSSubscription {
  type: string;
  symbol?: string;
  user?: string | string[];
  interval?: string;
  nlevels?: number;
}

// Theme
export type Theme = 'dark' | 'light';

// Leaderboard Entry
export interface LeaderboardEntry {
  rank: number;
  address: string;
  totalLiquidations: number;
  totalValue: number;
  largestLiq: number;
  lastLiqTime: number;
}
