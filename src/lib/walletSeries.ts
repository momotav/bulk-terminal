// Small history series for the wallet page's KPI tiles: the shape behind each number.
// All built from data the page already holds (fills, closed trades, transfers, the
// live positions), with no extra requests. They are drawn as sparklines, so they show
// a trend; the tile's headline figure stays the exact one.

import type { ActivityEvent, ClosedPosition } from '@/lib/api';
import type { WalletFillLite } from '@/lib/walletMetrics';

export const SERIES_POINTS = 48;

interface LivePos { symbol: string; size: number; price: number; fairPrice?: number }

/**
 * Open positions over time, walked BACK from the live account: the size of each
 * market at time t is today's size less every fill after t. That stays exact even
 * when BULK has cut off the oldest fills, since it only needs the fills after t.
 * Value uses the last traded price at or before t (else the next one, else today's).
 */
export function exposureSeries(fills: WalletFillLite[], live: LivePos[], now = Date.now()) {
  const empty = { count: [] as number[], gross: [] as number[], long: [] as number[], short: [] as number[] };
  if (!fills.length) return empty;
  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0].timestamp;
  // Over the span the wallet actually traded, then today's value: a wallet that went
  // quiet months ago would otherwise be one blip and a long flat line.
  const end = Math.max(sorted[sorted.length - 1].timestamp, start + 60_000);

  const prices = new Map<string, { t: number; p: number }[]>();
  for (const f of sorted) {
    const arr = prices.get(f.symbol) ?? [];
    arr.push({ t: f.timestamp, p: f.price });
    prices.set(f.symbol, arr);
  }
  const nowPrice = new Map(live.map((p) => [p.symbol, p.fairPrice || p.price]));
  const priceAt = (sym: string, t: number) => {
    const arr = prices.get(sym);
    if (!arr?.length) return nowPrice.get(sym) ?? 0;
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best >= 0 ? arr[best].p : arr[0].p;
  };

  // Sizes now, then undo fills newest-first as we step back through the buckets.
  const size = new Map<string, number>(live.map((p) => [p.symbol, p.size]));
  const times = [...Array.from({ length: SERIES_POINTS - 1 }, (_, i) => start + ((end - start) * i) / (SERIES_POINTS - 2)), Math.max(now, end)];
  const out = { count: [] as number[], gross: [] as number[], long: [] as number[], short: [] as number[] };
  let k = sorted.length - 1;
  for (let i = times.length - 1; i >= 0; i--) {
    const t = times[i];
    while (k >= 0 && sorted[k].timestamp > t) {
      const f = sorted[k];
      size.set(f.symbol, (size.get(f.symbol) ?? 0) - (f.isBuy ? f.size : -f.size));
      k--;
    }
    let n = 0, lg = 0, sh = 0;
    for (const [sym, s] of size) {
      if (Math.abs(s) < 1e-9) continue;
      const v = Math.abs(s) * priceAt(sym, t);
      n++;
      if (s > 0) lg += v; else sh += v;
    }
    out.count.unshift(n); out.long.unshift(lg); out.short.unshift(sh); out.gross.unshift(lg + sh);
  }
  return out;
}

/** Running total of a per-day map ("YYYY-MM-DD" keys), oldest day first. */
export function cumulativeDaily(map: Map<string, number> | undefined, sign = 1): number[] {
  if (!map?.size) return [];
  let run = 0;
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => (run += sign * v));
}

/** Net of two per-day maps, as a running total (realized less fees, say). */
export function cumulativeNet(a: Map<string, number> | undefined, b: Map<string, number> | undefined): number[] {
  const days = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
  if (!days.size) return [];
  let run = 0;
  return Array.from(days).sort().map((d) => (run += (a?.get(d) ?? 0) - (b?.get(d) ?? 0)));
}

/** Closed trades counted up over time. */
export function closedCountSeries(closed: ClosedPosition[]): number[] {
  if (closed.length < 2) return [];
  const ts = closed.map((c) => c.closedAt).filter(Boolean).sort((a, b) => a - b);
  if (ts.length < 2) return [];
  const start = ts[0]; const end = Math.max(ts[ts.length - 1], start + 60_000);
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < SERIES_POINTS; i++) {
    const t = start + ((end - start) * i) / (SERIES_POINTS - 1);
    while (j < ts.length && ts[j] <= t) j++;
    out.push(j);
  }
  return out;
}

/** Money in, money out and what stayed, as running totals stepped over real time
 *  (first transfer to now), so a few deposits read as steps, not one diagonal. */
export function transferSeries(events: ActivityEvent[] | null, address: string, now = Date.now()) {
  const inn: number[] = [], out: number[] = [], net: number[] = [];
  if (!events?.length) return { inn, out, net };
  const rows = events
    .filter((e) => !e.status || e.status === 'completed')
    .map((e) => {
      const amount = Number(e.amount) || 0;
      const incoming = e.activityType === 'deposit' || (e.to === address && e.from !== address && /transfer/i.test(e.activityType));
      const outgoing = e.activityType === 'withdrawal' || (e.from === address && e.to !== address && /transfer/i.test(e.activityType));
      return { t: e.timestamp / 1e6, in: incoming ? amount : 0, out: outgoing ? amount : 0 };
    })
    .filter((r) => r.in || r.out)
    .sort((a, b) => a.t - b.t);
  if (!rows.length) return { inn, out, net };
  const start = rows[0].t - 1; const end = Math.max(now, start + 60_000);
  let i = 0, o = 0, k = 0;
  for (let n = 0; n < SERIES_POINTS; n++) {
    const t = start + ((end - start) * n) / (SERIES_POINTS - 1);
    while (k < rows.length && rows[k].t <= t) { i += rows[k].in; o += rows[k].out; k++; }
    inn.push(i); out.push(o); net.push(i - o);
  }
  return { inn, out, net };
}

/**
 * Volume, realized PnL after fees, and fees, as running totals in time buckets over
 * the span the wallet traded (finer than days, so a one-day trader still draws).
 * Realized comes from an average-cost replay of the fills.
 */
export function fillSeries(fills: WalletFillLite[]) {
  const out = { volume: [] as number[], realized: [] as number[], fees: [] as number[] };
  if (fills.length < 2) return out;
  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0].timestamp;
  const end = Math.max(sorted[sorted.length - 1].timestamp, start + 60_000);
  const book = new Map<string, { net: number; avg: number }>();
  let vol = 0, real = 0, fee = 0, k = 0;
  for (let i = 0; i < SERIES_POINTS; i++) {
    const t = start + ((end - start) * i) / (SERIES_POINTS - 1);
    while (k < sorted.length && sorted[k].timestamp <= t) {
      const f = sorted[k++];
      const delta = f.isBuy ? f.size : -f.size;
      const m = book.get(f.symbol) ?? { net: 0, avg: 0 };
      vol += Math.abs(f.size) * f.price;
      // Fill fees carry the account's sign: negative is a cost, positive a rebate.
      fee += f.fee ?? 0;
      real += f.fee ?? 0;
      if (m.net !== 0 && Math.sign(delta) !== Math.sign(m.net)) {
        const closing = Math.min(Math.abs(delta), Math.abs(m.net));
        real += closing * (f.price - m.avg) * Math.sign(m.net);
        const after = m.net + delta;
        if (Math.abs(after) < 1e-9) { m.net = 0; m.avg = 0; }
        else if (Math.sign(after) !== Math.sign(m.net)) { m.net = after; m.avg = f.price; }
        else m.net = after;
      } else {
        const after = m.net + delta;
        m.avg = after !== 0 ? (m.avg * Math.abs(m.net) + f.price * Math.abs(delta)) / Math.abs(after) : 0;
        m.net = after;
      }
      book.set(f.symbol, m);
    }
    out.volume.push(vol); out.realized.push(real); out.fees.push(fee);
  }
  return out;
}

/** True when a series has something to draw (not empty, not one flat value). */
export const drawable = (s?: number[]) => !!s && s.length >= 2 && s.some((v) => v !== s[0]);
