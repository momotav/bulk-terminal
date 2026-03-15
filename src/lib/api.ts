// API client for BULK Stats backend
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

// ============ OPEN INTEREST (CALCULATED FROM TRADES - REAL TIME) ============

export async function getOpenInterestCalculated(symbol: string, hours: number = 24) {
  const response = await fetch(`${API_BASE}/api/analytics/open-interest-calculated/${symbol}?hours=${hours}`);
  if (!response.ok) throw new Error('Failed to fetch calculated open interest');
  return response.json();
}

export async function getOpenInterestLive(symbol: string) {
  const response = await fetch(`${API_BASE}/api/analytics/open-interest-live/${symbol}`);
  if (!response.ok) throw new Error('Failed to fetch live open interest');
  return response.json();
}

export async function getOpenInterestChart(symbol: string, hours: number = 24) {
  const response = await fetch(`${API_BASE}/api/analytics/open-interest-chart/${symbol}?hours=${hours}`);
  if (!response.ok) throw new Error('Failed to fetch open interest chart');
  return response.json();
}

// ============ BULK API PROXIED DATA ============

export async function getOpenInterest(symbol: string, hours: number = 24) {
  const response = await fetch(`${API_BASE}/api/analytics/open-interest/${symbol}?hours=${hours}`);
  if (!response.ok) throw new Error('Failed to fetch open interest');
  return response.json();
}

export async function getFundingRate(symbol: string, hours: number = 24) {
  const response = await fetch(`${API_BASE}/api/analytics/funding-rate/${symbol}?hours=${hours}`);
  if (!response.ok) throw new Error('Failed to fetch funding rate');
  return response.json();
}

// ============ REAL DATABASE DATA ============

export async function getTradesChart(hours: number = 720, symbol?: string) {
  const url = symbol 
    ? `${API_BASE}/api/analytics/trades-chart?hours=${hours}&symbol=${symbol}`
    : `${API_BASE}/api/analytics/trades-chart?hours=${hours}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch trades chart');
  return response.json();
}

export async function getLiquidationsChart(hours: number = 720, symbol?: string) {
  const url = symbol 
    ? `${API_BASE}/api/analytics/liquidations-chart?hours=${hours}&symbol=${symbol}`
    : `${API_BASE}/api/analytics/liquidations-chart?hours=${hours}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch liquidations chart');
  return response.json();
}

export async function getADLChart(hours: number = 720, symbol?: string) {
  const url = symbol 
    ? `${API_BASE}/api/analytics/adl-chart?hours=${hours}&symbol=${symbol}`
    : `${API_BASE}/api/analytics/adl-chart?hours=${hours}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch ADL chart');
  return response.json();
}

export async function getVolumeChart(hours: number = 720, symbol?: string) {
  const url = symbol 
    ? `${API_BASE}/api/analytics/volume-chart?hours=${hours}&symbol=${symbol}`
    : `${API_BASE}/api/analytics/volume-chart?hours=${hours}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch volume chart');
  return response.json();
}

export async function getStats() {
  const response = await fetch(`${API_BASE}/api/analytics/stats`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

// ============ LEADERBOARD & WALLET ============

export async function getLeaderboard(timeframe: string = '24h', limit: number = 100) {
  const response = await fetch(`${API_BASE}/api/leaderboard?timeframe=${timeframe}&limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch leaderboard');
  return response.json();
}

export async function getWalletStats(walletAddress: string) {
  const response = await fetch(`${API_BASE}/api/wallet/${walletAddress}`);
  if (!response.ok) throw new Error('Failed to fetch wallet stats');
  return response.json();
}

export async function getWalletTrades(walletAddress: string, limit: number = 50) {
  const response = await fetch(`${API_BASE}/api/wallet/${walletAddress}/trades?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch wallet trades');
  return response.json();
}

// ============ TOP TRADERS ============

export async function getTopTraders(limit: number = 10) {
  const response = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch top traders');
  return response.json();
}
