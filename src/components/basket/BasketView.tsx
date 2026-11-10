'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { analytics, cn, formatNumber, type Candle, type RiskSurfaces } from '@/lib/api';
import { bulkBasketUrl, dock, useDock } from '@/lib/basket';
import { portfolioMargin } from '@/lib/portfolioMargin';
import { useDockCandles } from './useDockCandles';
import { BasketReturnChart, basketReturn } from './DockCharts';
import { BULK_GOLD, INTERVALS, IntervalToggle, LegGroup, MarginBar, signedPct, usd0, useMarkets } from './parts';

/**
 * The basket: long/short legs and weights, how it did over a window, the margin BULK
 * asks for it against holding each leg alone, and links that open it on BULK.
 */
export function BasketView({ interval, onInterval }: { interval: string; onInterval: (v: string) => void }) {
  const st = useDock();
  const { legs } = st;
  const { markets, maxLev } = useMarkets();
  const longs = legs.filter((l) => l.side === 'long');
  const shorts = legs.filter((l) => l.side === 'short');
  const sum = legs.reduce((a, l) => a + l.weight, 0);
  const longPct = sum > 0 ? (longs.reduce((a, l) => a + l.weight, 0) / sum) * 100 : 0;
  const capLev = legs.length ? Math.max(1, Math.min(...legs.map((l) => maxLev(l.coin)))) : 1;
  const lev = Math.min(st.leverage, capLev);
  const span = INTERVALS.find((i) => i.key === interval)?.span ?? '';

  const candlesOf = useDockCandles(legs.map((l) => l.coin), interval);
  const series: Record<string, Candle[]> = {};
  for (const l of legs) { const c = candlesOf(l.coin); if (c?.length) series[l.coin] = c; }
  const ret = useMemo(() => basketReturn(legs, series), [legs, ...legs.map((l) => series[l.coin])]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastRet = ret.length ? ret[ret.length - 1].v : null;
  const noPrices = legs.filter((l) => { const c = candlesOf(l.coin); return c === null || (c !== undefined && c.length === 0); }).map((l) => l.coin);

  // BULK's margin: live risk surfaces + correlations + regime decay.
  const [surfaces, setSurfaces] = useState<Record<string, RiskSurfaces | null>>({});
  const [dts, setDts] = useState<Record<string, number>>({});
  const coinKey = legs.map((l) => l.coin).sort().join(',');
  useEffect(() => {
    let live = true;
    const need = legs.map((l) => l.coin).filter((c) => !(c in surfaces));
    Promise.all(need.map((c) => analytics.getRiskSurfaces(c).then((r) => [c, r] as const).catch(() => [c, null] as const)))
      .then((pairs) => { if (live && pairs.length) setSurfaces((s) => ({ ...s, ...Object.fromEntries(pairs) })); });
    return () => { live = false; };
  }, [coinKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    analytics.getRegimeData().then((d) => setDts(Object.fromEntries(d.markets.map((m) => [m.symbol.replace(/-USD$/i, '').toUpperCase(), m.regimeDt])))).catch(() => {});
  }, []);
  const ready = legs.every((l) => l.coin in surfaces);
  const margin = useMemo(() => portfolioMargin(
    legs.map((l) => ({ asset: l.coin, side: l.side, notional: sum > 0 ? (st.size * l.weight) / sum : 0 })),
    { collateral: st.size / lev, surfaces, regimeDts: dts },
  ), [legs, sum, st.size, lev, surfaces, dts]);

  const canShare = legs.length > 0 && Math.abs(sum - 100) <= 0.05;

  return (
    <div className="p-4 space-y-5">
      <LegGroup title="Long Assets" side="long" legs={longs} all={legs} markets={markets} maxLev={maxLev} />
      <LegGroup title="Short Assets" side="short" legs={shorts} all={legs} markets={markets} maxLev={maxLev} />

      {legs.length > 0 && (<>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--text-secondary)]">Auto-balance</span>
            <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-md p-0.5">
              {([false, true] as const).map((v) => (
                <button key={String(v)} type="button" onClick={() => dock.setAutoBalance(v)}
                  className={cn('px-2.5 py-0.5 text-[12px] font-medium rounded transition-colors', st.autoBalance === v ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                  {v ? 'Equal' : 'Off'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, var(--pos) 0%, var(--pos) ${Math.max(0, longPct - 12)}%, var(--neg) ${Math.min(100, longPct + 12)}%, var(--neg) 100%)` }} />
          <div className="mt-1.5 flex justify-between text-[12px] tabular-nums">
            <span className="text-[var(--pos)]">{longPct.toFixed(0)}% long</span>
            <span className="text-[var(--neg)]">{(100 - longPct).toFixed(0)}% short</span>
          </div>
          {Math.abs(sum - 100) > 0.05 && <p className="mt-1.5 text-[12px] text-[var(--neg)]">Weights add up to {formatNumber(sum, 1)}%. BULK needs 100%.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-[var(--text-secondary)]">Over the last {span}</span>
            <IntervalToggle value={interval} onChange={onInterval} />
          </div>
          <div className="mt-1 text-[18px] font-medium tabular-nums" style={{ color: lastRet === null ? 'var(--text-tertiary)' : lastRet >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {lastRet === null ? '—' : signedPct(lastRet)}
          </div>
          <div className="relative h-32 mt-1 rounded-lg bg-[var(--bg-muted)]">
            {ret.length >= 2 ? <BasketReturnChart points={ret} />
              : <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[12px] text-[var(--text-tertiary)]">{noPrices.length ? `No prices for ${noPrices.join(', ')} right now.` : 'Loading prices…'}</div>}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">Price moves only, before fees and funding.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="basket-size" className="text-[13px] text-[var(--text-secondary)]">Size</label>
            <div className="mt-1.5 flex items-center h-11 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--text-tertiary)]">
              <input id="basket-size" inputMode="decimal" value={st.size ? st.size.toLocaleString('en-US') : ''} placeholder="0"
                onChange={(e) => dock.setSize(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] tabular-nums text-[var(--text-primary)]" />
              <span className="text-[13px] text-[var(--text-secondary)]">USD</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[13px]">
              <span className="text-[var(--text-secondary)]">Leverage</span>
              <span className="tabular-nums text-[var(--text-primary)]">{lev}x <span className="text-[var(--text-tertiary)]">· {usd0(st.size / lev)} collateral</span></span>
            </div>
            <input type="range" min={1} max={capLev} step={1} value={lev} onChange={(e) => dock.setLeverage(Number(e.target.value))}
              className="mt-2 w-full" style={{ accentColor: BULK_GOLD }} aria-label="Leverage" />
          </div>

          <div className="rounded-lg bg-[var(--bg-muted)] p-3.5">
            <div className="text-[13px] text-[var(--text-secondary)]">Margin BULK asks for this basket</div>
            {margin && ready ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[22px] font-medium tabular-nums text-[var(--text-primary)]">{usd0(margin.mp)}</span>
                  {margin.hedgeDiscount > 0.5 && <span className="text-[13px] tabular-nums text-[var(--pos)]">{margin.hedgeDiscount.toFixed(0)}% less</span>}
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <MarginBar label="Each leg on its own" value={margin.sumM} of={margin.sumM} tone="muted" />
                  <MarginBar label="BULK, netted as a basket" value={margin.mp} of={margin.sumM} tone="gold" />
                </div>
                <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  {margin.hedgeDiscount > 0.5
                    ? <>BULK margins the basket as one book, so legs that offset each other free up <span className="text-[var(--text-secondary)] tabular-nums">{usd0(margin.sumM - margin.mp)}</span>.</>
                    : 'These legs barely offset each other, so netting saves little. Pairing a long with a correlated short saves the most.'}
                </p>
                {margin.pairs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {margin.pairs.slice(0, 6).map((p) => (
                      <span key={`${p.a}${p.b}`} className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {p.a}/{p.b} <span className="text-[var(--text-secondary)]">{p.known ? p.rho.toFixed(2) : '—'}</span>
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : <div className="mt-1 text-[13px] text-[var(--text-tertiary)]">{st.size > 0 ? 'Loading BULK’s risk data…' : 'Enter a size.'}</div>}
            <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Maintenance margin from BULK’s live risk surfaces and correlations, as on the Risk page.</p>
          </div>
        </div>

        <div className="space-y-2">
          <a href={canShare ? bulkBasketUrl(legs, false) : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!canShare}
            className={cn('flex items-center justify-center gap-2 h-11 rounded-lg text-[14px] font-medium text-[#1a1408] transition', canShare ? 'hover:brightness-105' : 'opacity-40 pointer-events-none')}
            style={{ background: BULK_GOLD }}>
            Open basket on BULK <ExternalLink className="w-4 h-4" />
          </a>
          <button type="button" onClick={() => dock.clearLegs()} className="w-full text-center text-[12px] underline underline-offset-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] pt-1">Clear basket (closes its charts)</button>
        </div>
      </>)}
    </div>
  );
}
