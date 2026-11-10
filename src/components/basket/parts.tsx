'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Plus, Search, X } from 'lucide-react';
import { cn, formatNumber } from '@/lib/api';
import { STOCK_NAMES } from '@/lib/coins';
import { CoinIcon } from '@/components/CoinIcon';
import { useAvailableCoins, type MarketInfo } from '@/hooks/useAvailableCoins';
import { MAX_LEGS, dock, type BasketLeg } from '@/lib/basket';

export const BULK_GOLD = '#F3B65B';
export const INTERVALS: { key: string; label: string; span: string }[] = [
  { key: '15m', label: '15m', span: '3 days' },
  { key: '1h', label: '1H', span: '12 days' },
  { key: '4h', label: '4H', span: '50 days' },
  { key: '1d', label: '1D', span: '300 days' },
];
export const price = (n: number) => n >= 1000 ? formatNumber(n, 2) : n >= 1 ? formatNumber(n, 3) : formatNumber(n, 5);
export const signedPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
export const usd0 = (n: number) => `$${formatNumber(n, 0)}`;

/** Tradeable markets (suspended ones left out), with their max leverage. */
export function useMarkets() {
  const { allMarkets } = useAvailableCoins();
  const markets = useMemo(() => allMarkets.filter((m) => m.status !== 'SUSPENDED'), [allMarkets]);
  const maxLev = (coin: string) => markets.find((m) => m.coin === coin)?.maxLeverage ?? 10;
  return { markets, maxLev };
}

export function IntervalToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-md p-0.5">
      {INTERVALS.map((i) => (
        <button key={i.key} type="button" onClick={() => onChange(i.key)}
          className={cn('px-2 py-0.5 text-[11px] font-medium rounded transition-colors', value === i.key ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Search-as-you-type market list, inline. Arrow keys + Enter pick. */
export function CoinSearch({ markets, exclude = [], onPick, autoFocus = true, maxHeight = 260 }: {
  markets: MarketInfo[]; exclude?: string[]; onPick: (coin: string) => void; autoFocus?: boolean; maxHeight?: number;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toUpperCase();
    return markets.filter((m) => !exclude.includes(m.coin) && (!s || m.coin.includes(s) || (STOCK_NAMES[m.coin] ?? '').toUpperCase().includes(s)));
  }, [markets, exclude, q]);
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  return (
    <div>
      <div className="flex items-center gap-2 px-2.5 h-9 rounded-md bg-[var(--bg-base)] border border-[var(--border-color)] mb-1">
        <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search markets"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && list[active]) { e.preventDefault(); onPick(list[active].coin); }
          }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]" />
      </div>
      <ul ref={listRef} role="listbox" className="overflow-y-auto" style={{ maxHeight }}>
        {list.length === 0 && <li className="px-2.5 py-2 text-[12px] text-[var(--text-tertiary)]">No market matches.</li>}
        {list.map((m, i) => (
          <li key={m.coin} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); onPick(m.coin); }}
            className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer text-[13px]', i === active && 'bg-[var(--bg-base)]')}>
            <CoinIcon symbol={m.coin} size={16} className="shrink-0" />
            <span className="text-[var(--text-primary)]">{m.coin}</span>
            {STOCK_NAMES[m.coin] && <span className="truncate text-[12px] text-[var(--text-tertiary)]">{STOCK_NAMES[m.coin]}</span>}
            <span className="ml-auto text-[11px] tabular-nums text-[var(--text-tertiary)]">{m.maxLeverage}x</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "+" that opens a market search in a popover. */
export function AddCoinButton({ markets, exclude, onPick, label, disabled }: {
  markets: MarketInfo[]; exclude: string[]; onPick: (coin: string) => void; label: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-label={label} title={disabled ? `Up to ${MAX_LEGS} markets` : label}
        className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40">
        <Plus className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-10 w-[250px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 shadow-2xl">
          <CoinSearch markets={markets} exclude={exclude} onPick={(c) => { onPick(c); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

export function LegGroup({ title, side, legs, all, markets, maxLev }: {
  title: string; side: 'long' | 'short'; legs: BasketLeg[]; all: BasketLeg[]; markets: MarketInfo[]; maxLev: (c: string) => number;
}) {
  const color = side === 'long' ? 'var(--pos)' : 'var(--neg)';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[14px] font-medium" style={{ color }}>{title} ({legs.length})</span>
        <AddCoinButton markets={markets} exclude={all.map((l) => l.coin)} disabled={all.length >= MAX_LEGS} onPick={(c) => dock.addLeg(c, side)} label={`Add a ${side}`} />
      </div>
      {legs.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border-color)] px-3 py-2.5 text-[12px] text-[var(--text-tertiary)]">
          None yet. Add one, or swap a leg with <ArrowLeftRight className="inline w-3 h-3 -mt-0.5" />.
        </div>
      ) : (
        <div className="space-y-1.5">
          {legs.map((l) => (
            <div key={l.coin} className="flex items-center gap-2 rounded-md pl-3 pr-1 py-1.5"
              style={{ borderLeft: `2px solid ${color}`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 26%, transparent), transparent 80%)` }}>
              <button type="button" onClick={() => dock.openChart(l.coin)} title={`Open the ${l.coin} chart`} className="flex items-center gap-2 min-w-0">
                <CoinIcon symbol={l.coin} size={16} className="shrink-0" />
                <span className="text-[13px] font-medium text-[var(--text-primary)] truncate hover:underline underline-offset-2">{l.coin}-USD</span>
              </button>
              <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)] text-[var(--text-secondary)]">{maxLev(l.coin)}x</span>
              <div className="flex-1" />
              <div className="flex items-center h-8 w-[74px] rounded-md border border-[var(--border-color)] bg-[var(--bg-base)] px-2">
                <input aria-label={`${l.coin} weight`} inputMode="decimal" value={l.weight}
                  onChange={(e) => dock.setWeight(l.coin, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                  className="w-full min-w-0 bg-transparent outline-none text-right text-[13px] tabular-nums text-[var(--text-primary)]" />
                <span className="ml-1 text-[12px] text-[var(--text-tertiary)]">%</span>
              </div>
              <button type="button" onClick={() => dock.setSide(l.coin, side === 'long' ? 'short' : 'long')} aria-label={`Make ${l.coin} ${side === 'long' ? 'short' : 'long'}`} title={side === 'long' ? 'Make it a short' : 'Make it a long'}
                className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><ArrowLeftRight className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => dock.removeLeg(l.coin)} aria-label={`Remove ${l.coin}`}
                className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarginBar({ label, value, of, tone }: { label: string; value: number; of: number; tone: 'muted' | 'gold' }) {
  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span className="text-[var(--text-tertiary)]">{label}</span>
        <span className="tabular-nums text-[var(--text-secondary)]">{usd0(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-base)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${of > 0 ? Math.max(2, (value / of) * 100) : 0}%`, background: tone === 'gold' ? BULK_GOLD : 'var(--text-tertiary)' }} />
      </div>
    </div>
  );
}
