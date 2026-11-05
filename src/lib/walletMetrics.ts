// Pure maths behind the wallet page. No React, so it can be checked against
// real wallets on its own.

import type { ClosedPosition, WalletFill } from '@/lib/api';

export interface PnlPoint { t: number; v: number }

export interface PnlCurve {
  points: PnlPoint[];
  /** When collector snapshots begin. Before this the curve is realized PnL only,
   *  because nothing recorded the unrealized side. Null if there is no such gap. */
  realizedOnlyUntil: number | null;
}

interface SnapshotRow { timestamp: string; pnl: number; unrealized_pnl: number }
interface HistoryRow { timestamp: string; pnl: number }

const time = (s: string) => new Date(s).getTime();

/**
 * Total PnL (net realized + unrealized) over time, ending on the live account.
 *
 * trader_snapshots.pnl means two different things depending on the job that
 * wrote the row: wsListener stores net realized, leaderboardEnrichment stores
 * the total with unrealized already in it. Adding unrealized_pnl on top of every
 * row therefore double-counts most of them (one wallet read $133K against a true
 * $75K). Realized PnL only moves when something closes, so walking backwards from
 * the live figure, each row's realized value is whichever reading sits closer to
 * its neighbour. When a close does move it, unrealized has fallen to match, so
 * the two readings converge and the choice stops mattering.
 *
 * Older than the first snapshot, the closed-position log supplies realized PnL.
 * It is gross, so the gap to the net figure at the seam (fees and funding) is
 * spread linearly across it rather than shifted, which keeps the start at zero.
 */
export function buildPnlCurve(input: {
  snapshots: SnapshotRow[];
  history: HistoryRow[];
  realizedNow: number | null;
  unrealizedNow: number | null;
  now: number;
}): PnlCurve {
  const { snapshots, history, realizedNow, unrealizedNow, now } = input;

  const snaps = snapshots
    .map((r) => ({ t: time(r.timestamp), pnl: r.pnl || 0, u: r.unrealized_pnl || 0 }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  const recorded: { t: number; realized: number; total: number }[] = [];
  let prev = realizedNow ?? (snaps.length ? snaps[snaps.length - 1].pnl : 0);
  for (let i = snaps.length - 1; i >= 0; i--) {
    const { t, pnl, u } = snaps[i];
    const realized = Math.abs(pnl - prev) <= Math.abs(pnl - u - prev) ? pnl : pnl - u;
    recorded.unshift({ t, realized, total: realized + u });
    prev = realized;
  }

  const seam = recorded.length ? recorded[0].t : now;
  const seamRealized = recorded.length ? recorded[0].realized : realizedNow;

  // The route appends a synthetic "now" row to the log; the margin 2 min skips it.
  const log = history
    .map((h) => ({ t: time(h.timestamp), v: Number(h.pnl) || 0 }))
    .filter((p) => Number.isFinite(p.t) && p.t < seam - 120_000)
    .sort((a, b) => a.t - b.t);

  let prefix = log;
  if (log.length >= 1 && seamRealized != null) {
    const gap = seamRealized - log[log.length - 1].v;
    const t0 = log[0].t;
    const span = Math.max(1, log[log.length - 1].t - t0);
    prefix = log.map((p) => ({ t: p.t, v: p.v + gap * ((p.t - t0) / span) }));
  }
  // Realized PnL jumps at a close. Holding the old level until that moment keeps
  // a line between two sparse closes from inventing a gradual gain.
  prefix = prefix.flatMap((p, i) => (i > 0 ? [{ t: p.t - 1, v: prefix[i - 1].v }, p] : [p]));

  const points: PnlPoint[] = [...prefix, ...recorded.map((r) => ({ t: r.t, v: r.total }))];
  if (realizedNow != null) points.push({ t: now, v: realizedNow + (unrealizedNow ?? 0) });

  return { points, realizedOnlyUntil: prefix.length > 0 && recorded.length > 0 ? seam : null };
}

/**
 * Thin dense snapshots to about `target` points for a calm line: the last value in
 * each time bucket. The sparse realized-only stretch is kept exactly, and so is the
 * final point, which must stay on the live figure.
 */
export function thinCurve(points: PnlPoint[], realizedOnlyUntil: number | null, target = 320): PnlPoint[] {
  const seam = realizedOnlyUntil ?? -Infinity;
  const dense = points.filter((p) => p.t >= seam);
  if (dense.length <= target) return points;
  const bucket = (dense[dense.length - 1].t - dense[0].t) / target;
  const byBucket = new Map<number, PnlPoint>();
  for (const p of dense) byBucket.set(Math.floor((p.t - dense[0].t) / bucket), p);
  return [...points.filter((p) => p.t < seam), ...byBucket.values()];
}

/**
 * Make a market's fills add up to the live position. BULK only serves the latest
 * ~5,000 fills of a very busy wallet, so replaying them from flat can land on the
 * wrong size or even the wrong side. If the replay misses the live size, the gap
 * was already held when the history starts: prepend it as one fill at the entry
 * price. `openedBefore` is that fill's time, or null when history covers it all.
 */
export function anchorFills(fills: WalletFill[], liveSize: number, entry: number): { fills: WalletFill[]; openedBefore: number | null } {
  if (fills.length === 0) return { fills, openedBefore: null };
  const net = fills.reduce((s, f) => s + (f.isBuy ? f.size : -f.size), 0);
  const gap = liveSize - net;
  if (Math.abs(gap) <= Math.max(1e-9, Math.abs(liveSize) * 0.001)) return { fills, openedBefore: null };
  const first = fills.reduce((a, b) => (b.timestamp < a.timestamp ? b : a));
  const openedBefore = first.timestamp - 1;
  return {
    fills: [{ ...first, timestamp: openedBefore, price: entry, size: Math.abs(gap), isBuy: gap > 0, reasonCode: 'trade' }, ...fills],
    openedBefore,
  };
}

/** Largest fall from an earlier high, in dollars. Null until the curve falls. */
export function maxDrawdownUsd(points: PnlPoint[]): number | null {
  let peak = -Infinity;
  let worst = 0;
  for (const p of points) {
    if (p.v > peak) peak = p.v;
    if (peak - p.v > worst) worst = peak - p.v;
  }
  return worst > 0 ? worst : null;
}

export interface TrackRecord {
  count: number;
  wins: number;
  winRate: number;
  /** Gross won ÷ gross lost. Null with no losing trades, where it is undefined. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  best: { pnl: number; symbol: string } | null;
  worst: { pnl: number; symbol: string } | null;
  medianHoldMs: number | null;
  longPnl: number;
  shortPnl: number;
  lastClosedAt: number | null;
}

export function trackRecord(closed: ClosedPosition[]): TrackRecord | null {
  if (closed.length === 0) return null;
  let won = 0, lost = 0, wins = 0, losses = 0, longPnl = 0, shortPnl = 0, lastClosedAt = 0;
  let best: TrackRecord['best'] = null;
  let worst: TrackRecord['worst'] = null;
  const holds: number[] = [];
  for (const p of closed) {
    const pnl = p.realizedPnl;
    if (pnl > 0) { won += pnl; wins++; }
    else if (pnl < 0) { lost -= pnl; losses++; }
    if (p.side === 'long') longPnl += pnl; else shortPnl += pnl;
    if (pnl > 0 && (!best || pnl > best.pnl)) best = { pnl, symbol: p.symbol };
    if (pnl < 0 && (!worst || pnl < worst.pnl)) worst = { pnl, symbol: p.symbol };
    // BULK sometimes reports openTime === closeTime, so a sub-second hold is a
    // missing value, not a real one.
    if (p.openedAt > 0 && p.closedAt - p.openedAt >= 1000) holds.push(p.closedAt - p.openedAt);
    if (p.closedAt > lastClosedAt) lastClosedAt = p.closedAt;
  }
  holds.sort((a, b) => a - b);
  return {
    count: closed.length,
    wins,
    winRate: wins / closed.length,
    profitFactor: lost > 0 ? won / lost : null,
    avgWin: wins ? won / wins : null,
    avgLoss: losses ? -lost / losses : null,
    best,
    worst,
    // Only when most trades have a real open time; otherwise it describes a few.
    medianHoldMs: holds.length * 2 >= closed.length ? holds[Math.floor(holds.length / 2)] : null,
    longPnl,
    shortPnl,
    lastClosedAt: lastClosedAt || null,
  };
}

/** A fill with the fields the full-history (lite) feed adds. */
export type WalletFillLite = WalletFill & { fee?: number; isMaker?: boolean };

export interface SideStats { volume: number; fills: number; fees: number }

export interface FillSummary {
  markets: { symbol: string; volume: number; makerVolume: number; fills: number; fees: number; realized: number }[];
  maker: SideStats;
  taker: SideStats;
  volume: number;
  fees: number;
  /** Gross realized PnL replayed from the fills. */
  realized: number;
  dailyVolume: Map<string, number>;
  oldest: number | null;
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One pass over the fills: volume, fees, maker/taker and realized PnL per market. */
export function summarizeFills(fills: WalletFillLite[]): FillSummary {
  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const bySymbol = new Map<string, FillSummary['markets'][number] & { net: number; avg: number }>();
  const maker: SideStats = { volume: 0, fills: 0, fees: 0 };
  const taker: SideStats = { volume: 0, fills: 0, fees: 0 };
  const dailyVolume = new Map<string, number>();
  for (const f of sorted) {
    const m = bySymbol.get(f.symbol) ?? { symbol: f.symbol, volume: 0, makerVolume: 0, fills: 0, fees: 0, realized: 0, net: 0, avg: 0 };
    const value = Math.abs(f.size) * f.price;
    const fee = f.fee ?? 0;
    m.volume += value; m.fills += 1; m.fees += fee;
    if (f.isMaker) m.makerVolume += value;
    const side = f.isMaker ? maker : taker;
    side.volume += value; side.fills += 1; side.fees += fee;
    const day = localDay(f.timestamp);
    dailyVolume.set(day, (dailyVolume.get(day) ?? 0) + value);

    const delta = f.isBuy ? f.size : -f.size;
    if (m.net === 0 || m.net > 0 === delta > 0) {
      m.avg = (Math.abs(m.net) * m.avg + Math.abs(delta) * f.price) / (Math.abs(m.net) + Math.abs(delta));
      m.net += delta;
    } else {
      const closed = Math.min(Math.abs(m.net), Math.abs(delta));
      m.realized += closed * (f.price - m.avg) * Math.sign(m.net);
      const after = m.net + delta;
      if (Math.abs(after) < 1e-9) { m.net = 0; m.avg = 0; }
      else if (after > 0 !== m.net > 0) { m.net = after; m.avg = f.price; }
      else m.net = after;
    }
    bySymbol.set(f.symbol, m);
  }
  const markets = Array.from(bySymbol.values()).map(({ net: _net, avg: _avg, ...m }) => m);
  return {
    markets,
    maker,
    taker,
    volume: maker.volume + taker.volume,
    fees: maker.fees + taker.fees,
    realized: markets.reduce((s, m) => s + m.realized, 0),
    dailyVolume,
    oldest: sorted.length ? sorted[0].timestamp : null,
  };
}

export interface MarketRow { symbol: string; net: number; volume: number; makerShare: number; bps: number }

/**
 * Net PnL per market. With the wallet's full fill history the replay matches
 * BULK's realized total to the cent, so realized + unrealized + fees + funding
 * sums to the headline. When BULK has cut the history short the replay can't be
 * trusted, and realized falls back to the closed-position log: `exact` is false
 * and the page says the split is partial.
 */
export function marketBreakdown(input: {
  summary: FillSummary;
  /** BULK's lifetime gross realized PnL. */
  grossRealized: number | null;
  closed: Pick<ClosedPosition, 'symbol' | 'realizedPnl'>[];
  open: { symbol: string; unrealizedPnl: number }[];
  funding: Record<string, number>;
}): { rows: MarketRow[]; exact: boolean } {
  const { summary, grossRealized, closed, open, funding } = input;
  const exact = grossRealized !== null && summary.markets.length > 0
    && Math.abs(summary.realized - grossRealized) <= Math.max(1, Math.abs(grossRealized) * 0.001);
  const closedBySymbol = new Map<string, number>();
  for (const p of closed) closedBySymbol.set(p.symbol, (closedBySymbol.get(p.symbol) ?? 0) + p.realizedPnl);
  const symbols = new Set<string>([...summary.markets.map((m) => m.symbol), ...closedBySymbol.keys(), ...open.map((p) => p.symbol), ...Object.keys(funding)]);
  const rows = Array.from(symbols).map((symbol) => {
    const m = summary.markets.find((x) => x.symbol === symbol);
    const realized = exact ? (m?.realized ?? 0) : (closedBySymbol.get(symbol) ?? 0);
    const unrealized = open.find((p) => p.symbol === symbol)?.unrealizedPnl ?? 0;
    const net = realized + unrealized + (m?.fees ?? 0) + (funding[symbol] ?? 0);
    const volume = m?.volume ?? 0;
    return { symbol, net, volume, makerShare: volume > 0 ? (m?.makerVolume ?? 0) / volume : 0, bps: volume > 0 ? (net / volume) * 10_000 : 0 };
  }).filter((r) => r.volume > 0 || Math.abs(r.net) >= 0.01);
  return { rows, exact };
}

export interface TreeRect<T> { item: T; x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls et al.): rows of cells kept as close to square as it can. */
export function squarify<T>(items: { item: T; value: number }[], width: number, height: number): TreeRect<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const queue = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((i) => ({ item: i.item, area: i.value * scale }));
  const out: TreeRect<T>[] = [];
  let x = 0, y = 0, w = width, h = height;
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((s, r) => s + r.area, 0);
    return Math.max(...row.map((r) => Math.max((side * side * r.area) / (sum * sum), (sum * sum) / (side * side * r.area))));
  };
  while (queue.length) {
    const side = Math.min(w, h);
    const row = [queue.shift() as (typeof queue)[number]];
    while (queue.length && worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift() as (typeof queue)[number]);
    const sum = row.reduce((s, r) => s + r.area, 0);
    const thick = sum / side;
    let offset = 0;
    for (const r of row) {
      const len = r.area / thick;
      out.push(w >= h ? { item: r.item, x, y: y + offset, w: thick, h: len } : { item: r.item, x: x + offset, y, w: len, h: thick });
      offset += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
  }
  return out;
}

const CENT = 0.005;
/** At or below this many moves a curve is drawn through them one by one. */
const FEW_MOVES = 16;

/**
 * A curve with few moves, usually a handful of closes: keep every one of them, so
 * the line glides through each real value. Across a gap of about a third of the
 * chart the old level is held until just before the next move, so it reads as a flat
 * line and not as a slow drift nobody traded.
 */
function throughMoves(points: PnlPoint[], moves: PnlPoint[]): PnlPoint[] {
  const span = points[points.length - 1].t - points[0].t;
  const out = [points[0]];
  let prev = points[0];
  for (const m of moves) {
    if (m.t - prev.t > span * 0.3) out.push({ t: m.t - span * 0.012, v: prev.v });
    out.push(m);
    prev = m;
  }
  const end = points[points.length - 1];
  if (end.t > prev.t) out.push(end);
  return out;
}

/**
 * A calm version of the curve for drawing. A curve with few moves keeps them all,
 * see throughMoves. A busy one is resampled evenly in time, a rolling median drops
 * any swing lasting a few percent of the window, and averaging removes the stairs
 * the median leaves. Sustained moves stay: a real loss still reads as a steep fall.
 * The windows narrow towards the edges, so the first and last points are exact and
 * the line still ends on the live figure.
 * Display only: every number on the page comes from the unsmoothed curve.
 */
export function smoothCurve(points: PnlPoint[], samples = 180): PnlPoint[] {
  if (points.length < 3) return points;
  const moves = points.filter((p, i) => i > 0 && Math.abs(p.v - points[i - 1].v) >= CENT);
  if (moves.length <= FEW_MOVES) return throughMoves(points, moves);

  const t0 = points[0].t;
  const step = (points[points.length - 1].t - t0) / (samples - 1);
  if (step <= 0) return points;

  let j = 0;
  const grid = Array.from({ length: samples }, (_, i) => {
    const t = t0 + i * step;
    while (j < points.length - 2 && points[j + 1].t <= t) j++;
    const a = points[j];
    const b = points[j + 1];
    return a.v + (b.v - a.v) * Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
  });

  const pass = (vals: number[], radius: number, pick: (window: number[]) => number) =>
    vals.map((_, i) => {
      const r = Math.min(radius, i, vals.length - 1 - i);
      return pick(vals.slice(i - r, i + r + 1));
    });
  const median = (w: number[]) => [...w].sort((a, b) => a - b)[w.length >> 1];
  const mean = (w: number[]) => w.reduce((s, v) => s + v, 0) / w.length;

  const out = pass(pass(pass(grid, Math.round(samples * 0.035), median), 3, mean), 3, mean);
  return out.map((v, i) => ({ t: t0 + i * step, v }));
}

/**
 * Cut a long quiet ending off an all-time curve. A wallet that traded for an hour
 * and then sat for two months would otherwise squeeze all its history into a sliver.
 * Returns the time of its last move when the quiet part is over a third of the span.
 */
export function trimQuietTail(points: PnlPoint[]): { points: PnlPoint[]; quietSince: number | null } {
  if (points.length < 3) return { points, quietSince: null };
  const end = points[points.length - 1];
  let i = points.length - 1;
  while (i > 0 && Math.abs(points[i - 1].v - end.v) < CENT) i--;
  if (i === 0 || end.t - points[i].t <= (end.t - points[0].t) / 3) return { points, quietSince: null };
  return { points: [...points.slice(0, i), { t: points[i].t, v: end.v }], quietSince: points[i].t };
}
