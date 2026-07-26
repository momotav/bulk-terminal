import type { Candle } from '@/lib/api';

// Clamp obvious bad-print wicks. BULK's testnet klines occasionally emit a
// spurious high/low far outside the real price action (verified against BULK's
// own /api/v1/klines — e.g. a 77,154 high and a 49,700 low while price sits at
// ~64k). The candle BODY (open/close) is almost always valid; only the wick is
// a bad print. We keep the body and pull an absurd wick back to a sane bound
// derived from the surrounding candles' bodies. Legit intrabar wicks (a few %)
// are untouched — only prints well beyond the local range are trimmed.
//
// Shared by the position-chart modal (candle rendering) and the wallet equity
// reconstruction (mark prices), so both handle bad prints identically.
export function clampWicks(candles: Candle[]): Candle[] {
  const n = candles.length;
  if (n < 5) return candles;
  const W = 12; // neighbourhood half-window (± candles)
  const CAP = 0.08; // allow a wick up to 8% beyond the local body range
  return candles.map((c, i) => {
    let bodyHi = -Infinity;
    let bodyLo = Infinity;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
      bodyHi = Math.max(bodyHi, candles[j].o, candles[j].c);
      bodyLo = Math.min(bodyLo, candles[j].o, candles[j].c);
    }
    const hiCap = bodyHi * (1 + CAP);
    const loCap = bodyLo * (1 - CAP);
    // Never clamp into the candle's own body — only trim the wick past the cap.
    const h = Math.min(c.h, Math.max(c.o, c.c, hiCap));
    const l = Math.max(c.l, Math.min(c.o, c.c, loCap));
    return h === c.h && l === c.l ? c : { ...c, h, l };
  });
}
