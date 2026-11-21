'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ExternalLink } from 'lucide-react';
import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { cn } from '@/lib/api';
import { bulkBasketUrl } from '@/lib/basket';
import { useLongCandles } from '../useDockCandles';
import { IntervalToggle, signedPct } from '../parts';
import { subscribePrice } from '../live';
import { CoinPick } from './CoinPick';

const css = (expr: string, fb: string) => {
  if (typeof document === 'undefined') return fb;
  const el = document.createElement('span'); el.style.color = expr; el.style.display = 'none';
  document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c || fb;
};
const fmtRatio = (r: number) => (r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toPrecision(4));

/**
 * One market priced in another: coin / coin2 from both markets' candles, moving live
 * with both prices. The line a pair trade lives on, and one click to open it on BULK
 * as a basket (long the first, short the second).
 */
export function PairChart({ coin, coin2, interval, onInterval, onChange }: {
  coin: string; coin2: string; interval: string; onInterval: (v: string) => void; onChange: (a: string, b: string) => void;
}) {
  const candlesOf = useLongCandles([coin, coin2], interval);
  const a = candlesOf(coin), b = candlesOf(coin2);
  const series = useMemo(() => {
    if (!a?.length || !b?.length) return null;
    const bm = new Map(b.map((k) => [k.t, k.c]));
    return a.filter((k) => bm.has(k.t) && k.c > 0 && (bm.get(k.t) ?? 0) > 0).map((k) => ({ t: k.t, v: k.c / (bm.get(k.t) as number) }));
  }, [a, b]);
  const [live, setLive] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<'Line'> | null>(null);
  const lastPx = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });

  useEffect(() => {
    const el = ref.current;
    if (!el || !series || series.length < 2) return;
    const text = css('var(--text-tertiary)', '#8a8478'), grid = css('var(--border-color)', '#2e2c24'), accent = css('var(--accent)', '#F3B65B');
    const c = createChart(el, {
      width: el.clientWidth, height: el.clientHeight, localization: { locale: 'en-US' },
      layout: { attributionLogo: false, background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 10, fontFamily: getComputedStyle(document.body).fontFamily },
      grid: { vertLines: { visible: false }, horzLines: { color: grid.replace(/rgb\(([^)]+)\)/, 'rgba($1,0.35)') } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, rightOffset: 2 },
    });
    const s = c.addLineSeries({ color: accent, lineWidth: 2, priceFormat: { type: 'custom', formatter: fmtRatio, minMove: 0.00000001 } });
    s.setData(series.map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.v })));
    const n = series.length; c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 2 });
    chart.current = c; line.current = s;
    const ro = new ResizeObserver(() => c.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => { ro.disconnect(); c.remove(); chart.current = null; line.current = null; };
  }, [series]);

  // Live: both prices stream; the ratio's last point follows them.
  useEffect(() => {
    lastPx.current = { a: null, b: null }; setLive(null);
    const push = () => {
      const { a: pa, b: pb } = lastPx.current;
      if (!pa || !pb || !series?.length || !line.current) return;
      const r = pa / pb; setLive(r);
      try { line.current.update({ time: Math.floor(series[series.length - 1].t / 1000) as UTCTimestamp, value: r }); } catch { /* ignore */ }
    };
    const offA = subscribePrice(coin, (t) => { lastPx.current.a = t.price; push(); });
    const offB = subscribePrice(coin2, (t) => { lastPx.current.b = t.price; push(); });
    return () => { offA(); offB(); };
  }, [coin, coin2, series]);

  const first = series?.[0]?.v, now = live ?? series?.[series.length - 1]?.v;
  const chg = first && now ? (now / first - 1) * 100 : null;
  const open = () => window.open(bulkBasketUrl([{ coin, side: 'long', weight: 50 }, { coin: coin2, side: 'short', weight: 50 }], false), '_blank', 'noopener,noreferrer');

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <CoinPick value={coin} exclude={[coin2]} onChange={(c) => onChange(c, coin2)} />
        <button type="button" onClick={() => onChange(coin2, coin)} title="Flip the pair" aria-label="Flip the pair"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"><ArrowLeftRight className="h-3.5 w-3.5" /></button>
        <CoinPick value={coin2} exclude={[coin]} onChange={(c) => onChange(coin, c)} />
        <div className="flex-1" />
        <IntervalToggle value={interval} onChange={onInterval} />
      </div>
      <div className="flex items-baseline gap-2 px-3 pb-1">
        <span className="text-[18px] font-medium tabular-nums text-[var(--text-primary)]">{now ? fmtRatio(now) : '—'}</span>
        <span className="text-[11px] text-[var(--text-tertiary)]">{coin} per {coin2}</span>
        {chg !== null && <span className={cn('text-[12px] tabular-nums', chg >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>{signedPct(chg)}</span>}
        <div className="flex-1" />
        <button type="button" onClick={open} title={`Long ${coin}, short ${coin2} as a basket on BULK`}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-muted)]">
          Long {coin} / Short {coin2}<ExternalLink className="h-3 w-3 text-[var(--text-tertiary)]" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {series === null ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Loading…</div>
          : series.length < 2 ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Not enough shared history.</div>
          : <div ref={ref} className="absolute inset-0" />}
      </div>
    </div>
  );
}
