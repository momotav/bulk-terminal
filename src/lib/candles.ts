import type { Candle } from '@/lib/api';

// Clamp obvious bad-print wicks. BULK's testnet klines regularly emit spurious
// highs/lows far outside the real price action (verified against BULK's own
// /api/v1/klines — e.g. a 77,154 high and a 49,700 low while price sits at
// ~64k). The candle BODY (open/close) is almost always valid; only the wick is
// a bad print, and BULK's own exchange chart doesn't show these spikes.
//
// We bound each wick to a small margin beyond the LOCAL MEDIAN high/low. The
// median is robust to single-candle outliers — a lone 77k high barely moves the
// median of the surrounding highs — so it tracks the *typical* wick extent and
// only trims prints that sit well beyond it. (The earlier body-range + fixed
// percentage approach was too loose: the 24h body range is already ~5-6%, so an
// 8% cap on top let 6-9% bad-print wicks through.) The candle's own body is
// never clamped into.
//
// Shared by the position-chart modal (candle rendering) and the wallet equity
// reconstruction (mark prices), so both handle bad prints identically.
export function clampWicks(candles: Candle[]): Candle[] {
  const n = candles.length;
  if (n < 5) return candles;
  const W = 12;      // neighbourhood half-window (± candles)
  const M = 0.012;   // allow a wick up to 1.2% beyond the local median high/low

  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  return candles.map((c, i) => {
    const lo = Math.max(0, i - W);
    const hi = Math.min(n - 1, i + W);
    const highs: number[] = [];
    const lows: number[] = [];
    for (let j = lo; j <= hi; j++) {
      highs.push(candles[j].h);
      lows.push(candles[j].l);
    }
    const hiCap = median(highs) * (1 + M);
    const loCap = median(lows) * (1 - M);
    // Never clamp into the candle's own body — only trim the wick past the cap.
    const h = Math.min(c.h, Math.max(c.o, c.c, hiCap));
    const l = Math.max(c.l, Math.min(c.o, c.c, loCap));
    return h === c.h && l === c.l ? c : { ...c, h, l };
  });
}
