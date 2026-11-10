'use client';

import { cn } from '@/lib/api';
import { useDockCandles } from './useDockCandles';
import { DockCandleChart } from './DockCharts';
import { IntervalToggle, price, signedPct } from './parts';

/** One market's candles with its price, change over the window, and timeframe. */
export function ChartView({ coin, interval, onInterval }: { coin: string; interval: string; onInterval: (v: string) => void }) {
  const candlesOf = useDockCandles([coin], interval);
  const cs = candlesOf(coin);
  const first = cs?.[0]; const last = cs?.[cs.length - 1];
  const chg = first && last ? (last.c / first.o - 1) * 100 : null;
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-9 shrink-0">
        {last && <span className="text-[14px] font-medium tabular-nums text-[var(--text-primary)]">{price(last.c)}</span>}
        {chg !== null && <span className={cn('text-[12px] tabular-nums', chg >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>{signedPct(chg)}</span>}
        <div className="flex-1" />
        <IntervalToggle value={interval} onChange={onInterval} />
      </div>
      <div className="relative flex-1 min-h-0">
        {cs === undefined ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Loading…</div>
          : cs === null || cs.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">No candles for {coin} right now.</div>
          : <DockCandleChart candles={cs} />}
      </div>
    </div>
  );
}
