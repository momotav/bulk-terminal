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

  // Walk the position state, tracking the index of the most recent
  // "zero → nonzero" transition. That's the index we'll use to read the
  // open metadata at the end.
  let runningSize = 0;
  let lastOpenIndex: number | null = null;
  let lastOpenSize = 0;

  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const wasFlat = Math.abs(runningSize) < ZERO_EPS;

    // Apply this fill to the running net. isBuy=true adds size, false
    // subtracts. (Backend already gives us positive `size` regardless of
    // direction, so we sign it here.)
    const signedDelta = f.isBuy ? f.size : -f.size;
    runningSize += signedDelta;

    // Did this fill take us off zero? That's an "open" event.
    const isNowOpen = Math.abs(runningSize) >= ZERO_EPS;
    if (wasFlat && isNowOpen) {
      lastOpenIndex = i;
      lastOpenSize = runningSize;
    }
  }

  // If the position is currently flat, there's no "open" to report — even
  // if there were prior opens, they've all been closed.
  if (Math.abs(runningSize) < ZERO_EPS) return null;

  // If we never saw a flat→nonflat transition, it means the fills don't
  // cover the position's actual open. This can happen when BULK truncates
  // history at 5000 fills and the position is older than that. Return null
  // — better to show nothing than a wrong time.
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
