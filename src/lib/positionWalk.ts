// ----------------------------------------------------------------------------
// Position-state walk: derives "when did the currently-open position start"
// from a wallet's fill history.
//
// BULK doesn't expose a per-position open timestamp on the position object —
// the position is just a snapshot of size + entry price. To find when the
// current position opened, we walk fills in chronological order, tracking
// the running net size, and find the most recent moment the size went from
// 0 to non-zero. That's the open event of whatever's open right now.
//
// Edge cases handled:
//   - No fills at all → null (sub-account scenario; can't tell)
//   - Fills exist but net is currently 0 → null (no open position)
//   - Position flipped sides (long → short → long) → returns the most
//     recent "from zero" transition, which is what users mean by "when
//     did this position open"
//   - Floating point dust (size like 1e-12 after closes) → treat any
//     |size| < 1e-9 as effectively zero
// ----------------------------------------------------------------------------

import type { WalletFill } from '@/lib/api';

const ZERO_EPS = 1e-9;

export interface PositionOpenInfo {
  /** Unix ms when the currently-open position transitioned from 0 to non-zero. */
  openedAt: number;
  /** 'long' or 'short' — the direction of the currently-open position. */
  side: 'long' | 'short';
  /** Net size at the moment of opening (signed: + long, − short). */
  openingSize: number;
  /** Price of the fill that opened it. */
  openingPrice: number;
  /** Number of fills that have happened since the open (adds + partials). */
  fillsSinceOpen: number;
}

/**
 * Given a list of fills for a single symbol, compute when the currently-open
 * position was opened. Returns null if no fills, or if the wallet currently
 * has no net position in this symbol (every position has been fully closed).
 *
 * The fills array can be in any order — we sort internally.
 */
export function computePositionOpenTime(fills: WalletFill[]): PositionOpenInfo | null {
  if (!fills || fills.length === 0) return null;

  // Sort ascending by timestamp. We need to walk the position state from
  // earliest to latest to know when transitions happen.
  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);

  // First pass: build the running net-size series and track the peak
  // absolute size. We treat "flat" RELATIVE to that peak (within ~1%)
  // rather than against an absolute 1e-9. On testnet, wallets routinely
  // reduce a position down to a tiny dust residual instead of exactly
  // zero; with an absolute epsilon the walk never sees a flat moment, so
  // it reports the position as continuously open since the very first
  // non-flat fill — days older than the real (re)open the user remembers.
  const running: number[] = [];
  let r = 0;
  let maxAbs = 0;
  for (const f of sorted) {
    r += f.isBuy ? f.size : -f.size;
    running.push(r);
    if (Math.abs(r) > maxAbs) maxAbs = Math.abs(r);
  }
  // Flat = within 1% of the largest size ever held (floored at ZERO_EPS so
  // a genuinely tiny scalper still works). Reducing below this counts as
  // effectively closed, so the next add registers as a fresh open.
  const eps = Math.max(ZERO_EPS, maxAbs * 0.01);

  // Walk, tracking the index of the most recent flat→nonflat transition.
  let lastOpenIndex: number | null = null;
  let lastOpenSize = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = i === 0 ? 0 : running[i - 1];
    const wasFlat = Math.abs(prev) < eps;
    const isNowOpen = Math.abs(running[i]) >= eps;
    if (wasFlat && isNowOpen) {
      lastOpenIndex = i;
      lastOpenSize = running[i];
    }
  }

  // Currently flat (or dust) — nothing to report.
  if (Math.abs(r) < eps) return null;

  // Never saw a flat→nonflat transition — fills don't cover the real open
  // (e.g. truncated at BULK's 5000-fill window). Better to show nothing
  // than a wrong time.
  if (lastOpenIndex === null) return null;

  const opener = sorted[lastOpenIndex];
  return {
    openedAt: opener.timestamp,
    side: lastOpenSize > 0 ? 'long' : 'short',
    openingSize: lastOpenSize,
    openingPrice: opener.price,
    fillsSinceOpen: sorted.length - lastOpenIndex - 1,
  };
}

/**
 * Walk the position state across all fills and annotate each one with the
 * position state AT THAT MOMENT. Used by the chart modal to display
 * "Open long: 0.5 @ 81200" vs "Add to long: +0.3" vs "Close long: -0.5"
 * tooltips per marker.
 *
 * Returns the same fills in chronological order with extra annotations.
 */
export interface AnnotatedFill extends WalletFill {
  /** Position size BEFORE this fill (signed). */
  positionBefore: number;
  /** Position size AFTER this fill (signed). */
  positionAfter: number;
  /** What this fill did to the position. */
  action: 'open' | 'add' | 'reduce' | 'close' | 'flip';
  /** Human-readable action label, e.g. "Open long" or "Add to short". */
  actionLabel: string;
}

export function annotateFills(fills: WalletFill[]): AnnotatedFill[] {
  if (!fills || fills.length === 0) return [];

  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const out: AnnotatedFill[] = [];
  let runningSize = 0;

  for (const f of sorted) {
    const before = runningSize;
    const signedDelta = f.isBuy ? f.size : -f.size;
    const after = before + signedDelta;

    // Classify the action. The state transitions matter for the label:
    //   flat → open       = "Open"
    //   open → bigger     = "Add to"
    //   open → smaller    = "Reduce"
    //   open → flat       = "Close"
    //   open → flipped    = "Flip" (closed and opened opposite)
    let action: AnnotatedFill['action'];
    let actionLabel: string;

    const wasFlat = Math.abs(before) < ZERO_EPS;
    const isFlat = Math.abs(after) < ZERO_EPS;
    const flippedSide =
      !wasFlat && !isFlat && Math.sign(before) !== Math.sign(after);

    if (wasFlat && !isFlat) {
      action = 'open';
      actionLabel = `Open ${after > 0 ? 'long' : 'short'}`;
    } else if (!wasFlat && isFlat) {
      action = 'close';
      actionLabel = `Close ${before > 0 ? 'long' : 'short'}`;
    } else if (flippedSide) {
      action = 'flip';
      actionLabel = `Flip to ${after > 0 ? 'long' : 'short'}`;
    } else if (Math.abs(after) > Math.abs(before)) {
      action = 'add';
      actionLabel = `Add to ${after > 0 ? 'long' : 'short'}`;
    } else {
      action = 'reduce';
      actionLabel = `Reduce ${before > 0 ? 'long' : 'short'}`;
    }

    out.push({
      ...f,
      positionBefore: before,
      positionAfter: after,
      action,
      actionLabel,
    });
    runningSize = after;
  }

  return out;
}

/**
 * Format a duration (in milliseconds) as a compact human-readable string.
 * "instant" / "47s" / "12m" / "2h 14m" / "3d 5h" / "12d"
 *
 * BULK timestamps positions with nanosecond precision but the matching
 * engine ticks every 20ms — and on testnet we've observed wallets whose
 * closed positions have `openTime === closeTime` to the nanosecond
 * (likely position-flip / one-tick-scalp records where the lifecycle
 * collapses to a single moment). We render 0ms as "instant" so users
 * can tell this apart from "the display is broken." Anything under 1
 * second renders as "<1s" for the same reason — communicates that the
 * trade happened, just very fast.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'instant';
  const sec = Math.floor(ms / 1000);
  if (sec === 0) return '<1s';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) {
    return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  }
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

/** Signed position size + average entry AFTER a given fill. */
export interface PositionStatePoint {
  t: number;
  /** Signed net size after this fill (+ long, − short). */
  size: number;
  /** Size-weighted average entry price of the open position. */
  avgEntry: number;
}

/**
 * Per-symbol timeline of position state (signed size + average entry) after
 * each fill. Lets callers reconstruct the open position — and thus unrealized
 * PnL against a mark price — at any point in time (Step 2 equity curve). Same
 * average-entry walk as realizedPnlSeries, exposed as state snapshots.
 */
export function symbolPositionTimeline(fills: WalletFill[]): Record<string, PositionStatePoint[]> {
  const bySym: Record<string, WalletFill[]> = {};
  for (const f of fills) (bySym[f.symbol] ??= []).push(f);

  const out: Record<string, PositionStatePoint[]> = {};
  for (const sym of Object.keys(bySym)) {
    const sorted = [...bySym[sym]].sort((a, b) => a.timestamp - b.timestamp);
    let size = 0;
    let avgEntry = 0;
    const tl: PositionStatePoint[] = [];
    for (const f of sorted) {
      const delta = f.isBuy ? f.size : -f.size;
      const before = size;
      const after = before + delta;
      const sameDir = Math.abs(before) < ZERO_EPS || Math.sign(before) === Math.sign(delta);
      if (sameDir) {
        const absAfter = Math.abs(after);
        if (absAfter > ZERO_EPS) {
          avgEntry = (Math.abs(before) * avgEntry + Math.abs(delta) * f.price) / absAfter;
        }
        size = after;
      } else if (Math.abs(after) < ZERO_EPS) {
        size = 0;
        avgEntry = 0;
      } else if (Math.sign(after) !== Math.sign(before)) {
        size = after;
        avgEntry = f.price;
      } else {
        size = after;
      }
      tl.push({ t: f.timestamp, size, avgEntry });
    }
    out[sym] = tl;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trade lifecycle reconstruction (powers the shareable /observe view).
//
// BULK has no per-trade id, no stored equity curve, and no projected TP/SL
// feed in any endpoint we proxy. What it DOES give us is the wallet's fill
// history + OHLC candles — and from just those two we can faithfully rebuild
// a single position's whole life: when it opened, every add / reduce / flip,
// when it closed, and — the headline — a continuous PnL-over-time curve
// (realized steps booked at each reduce, plus unrealized marked against the
// candle closes between fills). Everything below is derived, never invented.
// ---------------------------------------------------------------------------

/** Minimal OHLC shape — matches `Candle` from the API without importing it. */
export interface OHLC { t: number; o: number; h: number; l: number; c: number; }

/** One thing the trader did to the position, in order. */
export interface TradeEventPoint {
  t: number;
  action: AnnotatedFill['action'];
  actionLabel: string;
  price: number;
  /** Signed size change at this fill (+ buy, − sell). */
  sizeDelta: number;
  /** Signed net position immediately after this fill. */
  positionAfter: number;
  /** Realized PnL booked by this fill (0 for pure opens/adds). */
  realizedDelta: number;
}

/** One sample on the trade's PnL journey (realized + unrealized at time t). */
export interface PnlCurvePoint {
  t: number;
  /** Total PnL at t = realized booked so far + open-leg unrealized. */
  pnl: number;
  /** Cumulative realized component at t. */
  realized: number;
  /** Mark/close price used to value the open leg at t. */
  price: number;
}

/** The full life of a single position instance of one symbol. */
export interface TradeLifecycle {
  symbol: string;
  side: 'long' | 'short';
  openedAt: number;
  /** null while still open. */
  closedAt: number | null;
  isOpen: boolean;
  /** Price of the fill that opened this instance. */
  openPrice: number;
  /** Size-weighted average entry across the whole life. */
  avgEntry: number;
  /** Largest |signed size| the position ever reached. */
  peakSize: number;
  /** Signed size right now (0 once closed). */
  currentSize: number;
  events: TradeEventPoint[];
  pnlCurve: PnlCurvePoint[];
  /** Cumulative realized PnL at the end of the life. */
  realizedTotal: number;
  peakPnl: number;
  troughPnl: number;
  /** PnL at the last sample (unrealized if open, realized if closed). */
  finalPnl: number;
}

/** Replay the segment's fills up to and including time `uptoT`, returning the
 *  position state at that moment. O(fills) per call — fine for the handful of
 *  fills in one position instance against ~200 candle samples. */
function replaySegment(seg: AnnotatedFill[], uptoT: number): { size: number; avgEntry: number; realized: number } {
  let size = 0;
  let avgEntry = 0;
  let realized = 0;
  for (const f of seg) {
    if (f.timestamp > uptoT) break;
    const delta = f.isBuy ? f.size : -f.size;
    const before = size;
    const after = before + delta;
    const sameDir = Math.abs(before) < ZERO_EPS || Math.sign(before) === Math.sign(delta);
    if (sameDir) {
      const absAfter = Math.abs(after);
      if (absAfter > ZERO_EPS) avgEntry = (Math.abs(before) * avgEntry + Math.abs(delta) * f.price) / absAfter;
      size = after;
    } else {
      const closed = Math.min(Math.abs(before), Math.abs(delta));
      realized += closed * (f.price - avgEntry) * Math.sign(before);
      if (Math.abs(after) < ZERO_EPS) { size = 0; avgEntry = 0; }
      else if (Math.sign(after) !== Math.sign(before)) { size = after; avgEntry = f.price; }
      else size = after;
    }
  }
  return { size, avgEntry, realized };
}

/**
 * Reconstruct the most-recent position instance of a single symbol from the
 * wallet's fills + candles. `fills` MUST be pre-filtered to one symbol. Returns
 * null when the fetched fills don't contain the position's open (e.g. truncated
 * at BULK's fill window) — we'd rather show nothing than a trade that starts
 * mid-air.
 */
export function buildTradeLifecycle(
  fills: WalletFill[],
  candles: OHLC[],
  opts: { markPrice?: number | null; now?: number } = {},
): TradeLifecycle | null {
  if (!fills || fills.length === 0) return null;
  const annotated = annotateFills(fills); // sorted ascending, with actions

  // The instance we care about starts at the LAST open/flip transition —
  // that's "this position" as a trader means it. Anything before belongs to
  // earlier, already-closed instances of the same market.
  let startIdx = -1;
  for (let i = annotated.length - 1; i >= 0; i--) {
    if (annotated[i].action === 'open' || annotated[i].action === 'flip') { startIdx = i; break; }
  }
  if (startIdx === -1) return null;

  const seg = annotated.slice(startIdx);
  const side: 'long' | 'short' = seg[0].positionAfter > 0 ? 'long' : 'short';
  const openedAt = seg[0].timestamp;
  const openPrice = seg[0].price;

  // Walk the segment once to produce the ordered event list and final state.
  let size = 0;
  let avgEntry = 0;
  let realizedCum = 0;
  let peakSize = 0;
  let closedAt: number | null = null;
  // Life-long size-weighted entry (never reset on close) — the "avg entry"
  // a trader means for a finished trade that was added to several times.
  let entryNotional = 0;
  let entrySize = 0;
  const events: TradeEventPoint[] = [];
  for (let i = 0; i < seg.length; i++) {
    const f = seg[i];
    const delta = f.isBuy ? f.size : -f.size;
    const before = size;
    const after = before + delta;
    const sameDir = Math.abs(before) < ZERO_EPS || Math.sign(before) === Math.sign(delta);
    let realizedDelta = 0;
    if (sameDir) {
      const absAfter = Math.abs(after);
      if (absAfter > ZERO_EPS) avgEntry = (Math.abs(before) * avgEntry + Math.abs(delta) * f.price) / absAfter;
      size = after;
      entryNotional += Math.abs(delta) * f.price;
      entrySize += Math.abs(delta);
    } else {
      const closed = Math.min(Math.abs(before), Math.abs(delta));
      realizedDelta = closed * (f.price - avgEntry) * Math.sign(before);
      realizedCum += realizedDelta;
      if (Math.abs(after) < ZERO_EPS) { size = 0; avgEntry = 0; }
      else if (Math.sign(after) !== Math.sign(before)) {
        // Flip: the leftover opens a fresh leg at this fill's price.
        size = after; avgEntry = f.price;
        entryNotional += Math.abs(after) * f.price;
        entrySize += Math.abs(after);
      }
      else size = after;
    }
    if (Math.abs(size) > peakSize) peakSize = Math.abs(size);
    events.push({ t: f.timestamp, action: f.action, actionLabel: f.actionLabel, price: f.price, sizeDelta: delta, positionAfter: after, realizedDelta });
    if (i > 0 && Math.abs(size) < ZERO_EPS && closedAt === null) closedAt = f.timestamp;
  }

  const isOpen = Math.abs(size) >= ZERO_EPS;
  const currentSize = isOpen ? size : 0;
  const now = opts.now ?? Date.now();
  const endT = isOpen ? now : (closedAt ?? seg[seg.length - 1].timestamp);

  // --- PnL journey ---------------------------------------------------------
  // Sample at every candle close inside the life window, plus every event
  // time (so the realized steps land exactly), plus the endpoints. At each
  // sample we replay fills to get (size, avgEntry, realized) and value the
  // open leg at the price in effect then.
  const inWin = candles.filter((c) => c.t >= openedAt - 1 && c.t <= endT + 1 && Number.isFinite(c.c) && c.c > 0);
  const priceAt = (t: number, fallback: number): number => {
    let p = fallback;
    for (const c of inWin) { if (c.t <= t) p = c.c; else break; }
    return p;
  };
  const sampleTimes = new Set<number>([openedAt, endT]);
  for (const c of inWin) sampleTimes.add(c.t);
  for (const e of events) sampleTimes.add(e.t);
  const eventPriceByTime = new Map<number, number>();
  for (const e of events) eventPriceByTime.set(e.t, e.price);

  const pnlCurve: PnlCurvePoint[] = [...sampleTimes]
    .filter((t) => t >= openedAt && t <= endT)
    .sort((a, b) => a - b)
    .map((t) => {
      const st = replaySegment(seg, t);
      // Prefer the exact fill price at an event time; otherwise the live mark
      // at the very end (open trades), else the prevailing candle close.
      let price = eventPriceByTime.get(t) ?? priceAt(t, openPrice);
      if (isOpen && t === endT && opts.markPrice && opts.markPrice > 0) price = opts.markPrice;
      const unreal = Math.abs(st.size) < ZERO_EPS ? 0 : st.size * (price - st.avgEntry);
      return { t, realized: st.realized, pnl: st.realized + unreal, price };
    });

  let peakPnl = -Infinity;
  let troughPnl = Infinity;
  for (const p of pnlCurve) { if (p.pnl > peakPnl) peakPnl = p.pnl; if (p.pnl < troughPnl) troughPnl = p.pnl; }
  if (!pnlCurve.length) { peakPnl = troughPnl = realizedCum; }

  return {
    symbol: fills[0].symbol,
    side,
    openedAt,
    closedAt,
    isOpen,
    openPrice,
    avgEntry: entrySize > ZERO_EPS ? entryNotional / entrySize : openPrice,
    peakSize,
    currentSize,
    events,
    pnlCurve,
    realizedTotal: realizedCum,
    peakPnl,
    troughPnl,
    finalPnl: pnlCurve.length ? pnlCurve[pnlCurve.length - 1].pnl : realizedCum,
  };
}

/** A single point on the cumulative realized-PnL curve. */
export interface RealizedPnlPoint {
  /** Unix ms of the fill that realized this PnL. */
  t: number;
  /** Cumulative realized PnL (GROSS — before fees/funding) up to this fill. */
  realized: number;
  /** This fill's realized delta (GROSS), i.e. the step size at this point. */
  delta: number;
  /** Why the fill happened — 'trade' | 'adl' | 'liq' | … (undefined = trade). */
  reasonCode?: string;
  /** Notional closed by this fill (|closedSize| × fillPrice) — the weight used
   *  to attribute the liquidation/ADL calibration residual. */
  closedNotional: number;
}

/**
 * Reconstruct the cumulative realized-PnL curve from raw fills, at fill
 * resolution — the same net-size walk as annotateFills, but tracking a
 * size-weighted average entry PER SYMBOL so we can book realized PnL on the
 * closed portion of each reducing/closing/flipping fill:
 *
 *   long : realized += closedSize * (fillPrice - avgEntry)
 *   short: realized += closedSize * (avgEntry - fillPrice)
 *
 * Adds in the same direction update the average entry; a flip closes the old
 * position and reopens the leftover at the fill price. Output is GROSS
 * (fees/funding are layered on by the caller). Only realizing fills emit a
 * point, so the curve steps at genuine close events.
 */
export function realizedPnlSeries(fills: WalletFill[]): RealizedPnlPoint[] {
  if (!fills || fills.length === 0) return [];
  const sorted = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const state = new Map<string, { size: number; avgEntry: number }>();
  let cum = 0;
  const points: RealizedPnlPoint[] = [];

  for (const f of sorted) {
    const st = state.get(f.symbol) ?? { size: 0, avgEntry: 0 };
    const delta = f.isBuy ? f.size : -f.size;
    const before = st.size;
    const after = before + delta;
    const sameDir = Math.abs(before) < ZERO_EPS || Math.sign(before) === Math.sign(delta);

    if (sameDir) {
      // Open or add: size-weighted average entry.
      const absAfter = Math.abs(after);
      if (absAfter > ZERO_EPS) {
        st.avgEntry = (Math.abs(before) * st.avgEntry + Math.abs(delta) * f.price) / absAfter;
      }
      st.size = after;
    } else {
      // Reduce / close / flip: realize on the closed portion.
      const closed = Math.min(Math.abs(before), Math.abs(delta));
      const dir = Math.sign(before); // +1 long, −1 short
      const stepDelta = closed * (f.price - st.avgEntry) * dir;
      cum += stepDelta;
      if (Math.abs(after) < ZERO_EPS) {
        st.size = 0;
        st.avgEntry = 0;
      } else if (Math.sign(after) !== Math.sign(before)) {
        // Flipped: leftover opens fresh at this fill's price.
        st.size = after;
        st.avgEntry = f.price;
      } else {
        st.size = after; // partial reduce - average entry unchanged
      }
      points.push({
        t: f.timestamp,
        realized: cum,
        delta: stepDelta,
        reasonCode: f.reasonCode,
        closedNotional: closed * f.price,
      });
    }
    state.set(f.symbol, st);
  }

  return points;
}
