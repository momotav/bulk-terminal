'use client';

import { useEffect, useState } from 'react';
import { analytics, type Candle } from '@/lib/api';
import { clampWicks } from '@/lib/candles';

// One fetch per (coin, interval) for the whole dock: the chart and the basket line
// read the same candles. Refreshed once a minute while something reads them.
const BARS = 300;
const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<Candle[]> }>();

export function fetchDockCandles(coin: string, interval: string): Promise<Candle[]> {
  const k = `${coin}|${interval}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const attempt = async (): Promise<Candle[]> => {
    // A shared basket opens several markets at once; a busy upstream can turn one
    // away, so try again before calling it empty.
    for (let i = 0; ; i++) {
      try {
        const r = await analytics.getCandles(coin, interval, BARS);
        if (r.candles?.length || i >= 2) return r.candles ?? [];
      } catch (e) { if (i >= 2) throw e; }
      await new Promise((ok) => setTimeout(ok, 700 * (i + 1)));
    }
  };
  const p = attempt()
    .then((cs) => clampWicks(cs.filter((c) => c.t > 0).sort((a, b) => a.t - b.t)))
    .catch((e) => { cache.delete(k); throw e; });
  cache.set(k, { at: Date.now(), p });
  return p;
}

export function useDockCandles(coins: string[], interval: string) {
  const [data, setData] = useState<Record<string, Candle[] | null>>({});
  const key = coins.join(',');
  useEffect(() => {
    let live = true;
    const run = () => coins.forEach((c) => {
      fetchDockCandles(c, interval)
        .then((cs) => { if (live) setData((d) => ({ ...d, [`${c}|${interval}`]: cs })); })
        .catch(() => { if (live) setData((d) => ({ ...d, [`${c}|${interval}`]: d[`${c}|${interval}`] ?? null })); });
    });
    run();
    const t = setInterval(run, TTL);
    return () => { live = false; clearInterval(t); };
  }, [key, interval]); // eslint-disable-line react-hooks/exhaustive-deps
  return (coin: string): Candle[] | null | undefined => data[`${coin}|${interval}`];
}
