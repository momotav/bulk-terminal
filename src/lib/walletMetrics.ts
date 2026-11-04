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

/** Closed PnL plus the open position's unrealized, per market, biggest first. */
export function pnlByMarket(
  closed: Pick<ClosedPosition, 'symbol' | 'realizedPnl'>[],
  open: { symbol: string; unrealizedPnl: number }[],
): { symbol: string; pnl: number }[] {
  const m = new Map<string, number>();
  for (const p of closed) m.set(p.symbol, (m.get(p.symbol) ?? 0) + p.realizedPnl);
  for (const p of open) m.set(p.symbol, (m.get(p.symbol) ?? 0) + (p.unrealizedPnl || 0));
  return Array.from(m, ([symbol, pnl]) => ({ symbol, pnl }))
    .filter((r) => Math.abs(r.pnl) >= 0.01)
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}
