// One position, summarised for a share link: what the link's title says and what
// its preview image draws. Server-side only (page metadata and the image route);
// numbers come straight from BULK through our backend, same as the page itself.

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

export interface PositionSummary {
  coin: string;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'liquidated';
  /** Actual leverage for an open position; for a closed one BULK only keeps the market's cap, so null. */
  leverage: number | null;
  entry: number;
  /** Exit price when closed, current mark when open. */
  last: number;
  sizeUsd: number;
  pnl: number;
  /** Price move in the position's favour, percent. */
  movePct: number;
  openedAt: number | null;
  closedAt: number | null;
}

async function get<T>(path: string, ms = 3500): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${API}${path}`, { signal: ctl.signal, next: { revalidate: 30 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

type Closed = { symbol: string; side: 'long' | 'short'; size: number; openPrice: number; closePrice: number; openedAt: number; closedAt: number; realizedPnl: number; liquidated: boolean; notional?: number };
type Live = { symbol: string; size: number; price: number; fairPrice?: number; notional: number; unrealizedPnl: number; leverage: number };

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function fromClosed(c: Closed): PositionSummary {
  const sign = c.side === 'long' ? 1 : -1;
  return {
    coin: c.symbol.replace(/-USD$/, ''), side: c.side, status: c.liquidated ? 'liquidated' : 'closed', leverage: null,
    entry: c.openPrice, last: c.closePrice, sizeUsd: Math.abs(c.notional ?? c.size * c.openPrice), pnl: c.realizedPnl,
    movePct: c.openPrice ? sign * (c.closePrice / c.openPrice - 1) * 100 : 0, openedAt: c.openedAt || null, closedAt: c.closedAt || null,
  };
}

/** The position a share link points at: `from`/`to` pin one trade; without them, the open one or else the latest closed. */
export async function resolvePosition(address: string, coin: string, from = 0, to = 0): Promise<PositionSummary | null> {
  const sym = `${coin.toUpperCase().replace(/-USD$/, '')}-USD`;
  const closedList = async () => (await get<{ positions: Closed[] }>(`/api/wallet/${address}/closed-positions?symbol=${encodeURIComponent(sym)}&limit=2000`))?.positions ?? [];

  if (to > 0) {
    const list = await closedList();
    const hit = list.find((c) => near(c.openedAt, from, 2000) && near(c.closedAt, to, 2000))
      ?? list.find((c) => near(c.closedAt, to, 60_000));
    return hit ? fromClosed(hit) : null;
  }

  const w = await get<{ live?: { positions?: Live[] } }>(`/api/wallet/${address}`);
  const p = w?.live?.positions?.find((x) => x.symbol === sym);
  if (p) {
    const side = p.size > 0 ? 'long' : 'short';
    const mark = p.fairPrice || (p.notional && p.size ? Math.abs(p.notional / p.size) : p.price);
    return {
      coin: sym.replace(/-USD$/, ''), side, status: 'open', leverage: p.leverage || null, entry: p.price, last: mark,
      sizeUsd: Math.abs(p.notional), pnl: p.unrealizedPnl, movePct: p.price ? (side === 'long' ? 1 : -1) * (mark / p.price - 1) * 100 : 0,
      openedAt: from || null, closedAt: null,
    };
  }
  // Not open any more: the trade the link was made for has closed since.
  const list = await closedList();
  const hit = from ? list.find((c) => near(c.openedAt, from, 60_000)) : [...list].sort((a, b) => b.closedAt - a.closedAt)[0];
  return hit ? fromClosed(hit) : null;
}

export async function priceLine(coin: string, startMs: number, endMs: number): Promise<number[]> {
  const span = Math.max(60_000, endMs - startMs);
  const iv = ([['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['1h', 3600e3], ['4h', 14400e3], ['1d', 86400e3]] as const)
    .find(([, ms]) => span / ms <= 160) ?? ['1d', 86400e3];
  const pad = iv[1] * 2;
  const qs = new URLSearchParams({ interval: iv[0], limit: '200', startTime: String(Math.floor(startMs - pad)), endTime: String(Math.floor(endMs + pad)) });
  const r = await get<{ candles?: { t: number; c: number }[] }>(`/api/analytics/candles/${encodeURIComponent(`${coin}-USD`)}?${qs}`, 3000);
  return (r?.candles ?? []).filter((k) => k.c > 0).sort((a, b) => a.t - b.t).map((k) => k.c);
}

export const fmtUsd = (n: number, signed = false) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `$${Math.round(a).toLocaleString('en-US')}` : `$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return signed ? `${n >= 0 ? '+' : '−'}${s}` : n < 0 ? `−${s}` : s;
};
export const fmtPx = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 3 : 5, maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 3 : 5 });
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const held = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

// ── Single fills and orders (share links by trade id / order id) ─────────────

export interface TradeFill {
  timestamp: number; symbol: string; price: number; size: number; isBuy: boolean; reasonCode: string;
  orderIdMaker?: string; orderIdTaker?: string; maker?: string; taker?: string; fee: number; isMaker: boolean;
  makerFee?: number; takerFee?: number; tradeId?: string; slot?: number; counterpartyHint?: string;
}
export interface OrderInfo {
  orderId: string; open: boolean; symbol: string; side: string; orderType: string; tif: string | null; price: number; vwap: number;
  originalSize: number; executedSize: number; reduceOnly: boolean; status: string; reason: string | null;
  trigger: { isAbove?: boolean; px?: number } | null; slot: number | null; timestamp: number;
}

export async function getTrade(address: string, tradeId: string): Promise<TradeFill | null> {
  if (!/^\d+:\d+$/.test(tradeId)) return null;
  return (await get<{ fill: TradeFill }>(`/api/wallet/${address}/trade/${encodeURIComponent(tradeId)}`, 6000))?.fill ?? null;
}

export async function getOrder(address: string, orderId: string, slot = 0): Promise<{ order: OrderInfo; fills: TradeFill[] } | null> {
  return get<{ order: OrderInfo; fills: TradeFill[] }>(`/api/wallet/${address}/order/${encodeURIComponent(orderId)}${slot ? `?slot=${slot}` : ''}`, 9000);
}

export const sideWord = (buy: boolean) => (buy ? 'Buy' : 'Sell');
export const orderStatus = (s: string) => ({ resting: 'Open', open: 'Open', filled: 'Filled', partiallyFilled: 'Partly filled', cancelled: 'Cancelled', canceled: 'Cancelled', rejected: 'Rejected', expired: 'Expired' } as Record<string, string>)[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : '—');
