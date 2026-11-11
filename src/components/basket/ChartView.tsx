'use client';

import { BookOpen, Unlink, X } from 'lucide-react';
import { cn } from '@/lib/api';
import { BOOK_W } from '@/lib/basket';
import { useDockCandles } from './useDockCandles';
import { DockCandleChart } from './DockCharts';
import { IntervalToggle, price, signedPct } from './parts';
import { useLivePrice } from './live';
import { BookView } from './BookView';

/**
 * One market's live candles with its price, change over the window and timeframe.
 * With `book`, the market's order book sits attached on the right; it can be hidden
 * or detached into a window of its own.
 */
export function ChartView({ coin, interval, onInterval, book, onToggleBook, onDetachBook }: {
  coin: string; interval: string; onInterval: (v: string) => void;
  book?: boolean; onToggleBook?: () => void; onDetachBook?: () => void;
}) {
  const candlesOf = useDockCandles([coin], interval);
  const cs = candlesOf(coin);
  const tick = useLivePrice(coin);
  const first = cs?.[0];
  const now = tick?.price ?? cs?.[cs.length - 1]?.c;
  const chg = first && now ? (now / first.o - 1) * 100 : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-2 px-3 h-9 shrink-0">
          {now !== undefined && <span className="text-[14px] font-medium tabular-nums text-[var(--text-primary)]">{price(now)}</span>}
          {chg !== null && <span className={cn('text-[12px] tabular-nums', chg >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>{signedPct(chg)}</span>}
          <div className="flex-1" />
          {onToggleBook && (
            <button type="button" onClick={onToggleBook} aria-pressed={!!book} title={book ? 'Hide order book' : 'Show order book'}
              className={cn('flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium transition-colors',
                book ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
              <BookOpen className="w-3.5 h-3.5" />Book
            </button>
          )}
          <IntervalToggle value={interval} onChange={onInterval} />
        </div>
        <div className="relative flex-1 min-h-0">
          {cs === undefined ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Loading…</div>
            : cs === null || cs.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">No candles for {coin} right now.</div>
            : <DockCandleChart candles={cs} coin={coin} interval={interval} />}
        </div>
      </div>

      {book && (
        <div className="shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-base)] ws-pop" style={{ width: BOOK_W }}>
          <BookView coin={coin} actions={
            <>
              {onDetachBook && <BookCtl label="Detach: float the book in its own window" onClick={onDetachBook}><Unlink className="w-3.5 h-3.5" /></BookCtl>}
              {onToggleBook && <BookCtl label="Hide order book" onClick={onToggleBook}><X className="w-3.5 h-3.5" /></BookCtl>}
            </>
          } />
        </div>
      )}
    </div>
  );
}

export function BookCtl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] transition-colors">
      {children}
    </button>
  );
}
