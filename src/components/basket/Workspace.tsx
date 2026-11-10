'use client';

// The "+" in the corner of every page. It opens a menu of tools (charts and the
// basket today, more later); each opens as a floating window over the page, and
// windows can pop out into their own browser window for a second monitor.
// Minimised windows sit beside the "+" as a little dock.

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CandlestickChart, ChevronLeft, ChevronRight, Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { MAX_WINDOWS, dock, parseBasketSpec, useDock, type Win } from '@/lib/basket';
import { FloatingWindow } from './FloatingWindow';
import { ChartView } from './ChartView';
import { BasketView } from './BasketView';
import { CoinSearch, useMarkets } from './parts';
import { BasketLink } from './BasketLink';

const BASE_LAYER = 60;

export function popOut(win: Win) {
  const q = `id=${encodeURIComponent(win.id)}&` + (win.kind === 'chart' ? `kind=chart&coin=${encodeURIComponent(win.coin ?? '')}&iv=${win.interval}` : `kind=basket&iv=${win.interval}`);
  const w = win.kind === 'chart' ? Math.max(720, win.w) : Math.max(420, win.w);
  const h = Math.max(520, win.h);
  // Open to the right of this browser window, where a second screen usually is.
  const left = window.screenX + window.outerWidth - Math.min(w, 200);
  const top = window.screenY + 80;
  const opened = window.open(`/window?${q}`, `bulkstats-${win.id}`, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (opened) dock.popOut(win.id);
}

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 639px)');
    const on = () => setM(q.matches);
    on(); q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}

export function Workspace() {
  const path = usePathname();
  const st = useDock();
  const mobile = useIsMobile();
  const [menu, setMenu] = useState<'closed' | 'root' | 'chart'>('closed');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { markets } = useMarkets();

  // A shared ?basket= link opens its charts and the basket.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('basket');
    if (!q) return;
    const legs = parseBasketSpec(q);
    if (legs.length) dock.loadBasket(legs);
    const url = new URL(window.location.href); url.searchParams.delete('basket');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);

  // Pages (and older code) can open a chart by event.
  useEffect(() => {
    const on = (e: Event) => { const c = (e as CustomEvent<string>).detail; if (c) dock.openChart(c); };
    window.addEventListener('bulkstats:open-chart', on);
    return () => window.removeEventListener('bulkstats:open-chart', on);
  }, []);

  useEffect(() => {
    if (menu === 'closed') return;
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu('closed'); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu((m) => (m === 'chart' ? 'root' : 'closed')); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  if (path?.startsWith('/window')) return null;

  // Stacking by z-index only: reordering the DOM while a button is pressed swallows its click.
  const rank = new Map([...st.windows].sort((a, b) => a.z - b.z).map((w, i) => [w.id, i]));
  const minimized = st.windows.filter((w) => w.min || w.popped);
  const linkIds = st.windows.filter((w) => w.kind === 'chart' && !w.min && !w.popped).map((w) => w.id);
  const full = st.windows.length >= MAX_WINDOWS;

  return (
    <>
      {st.windows.map((w) => (
        <FloatingWindow key={w.id} win={w} layer={BASE_LAYER + (rank.get(w.id) ?? 0)} mobile={mobile}
          icon={w.kind === 'chart' ? <CoinIcon symbol={w.coin ?? ''} size={15} className="shrink-0" /> : <Layers className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
          title={w.kind === 'chart' ? `${w.coin}-USD` : `Basket${st.legs.length ? ` · ${st.legs.length}` : ''}`}
          onPopOut={() => popOut(w)}>
          {w.kind === 'chart'
            ? <ChartView coin={w.coin ?? 'BTC'} interval={w.interval} onInterval={(v) => dock.setWinInterval(w.id, v)} />
            : <BasketView interval={w.interval} onInterval={(v) => dock.setWinInterval(w.id, v)} />}
        </FloatingWindow>
      ))}

      {/* Two charts on screen and no basket yet: link them, with a way in. */}
      {!mobile && linkIds.length >= 2 && !st.windows.some((w) => w.kind === 'basket') && (
        <BasketLink ids={linkIds} below={BASE_LAYER - 1} above={BASE_LAYER + st.windows.length + 1} />
      )}

      {/* Dock: minimised windows, then the "+" */}
      <div ref={menuRef} className="fixed bottom-4 right-4 z-[90] flex items-end gap-2">
        {minimized.length > 0 && (
          <div className="ws-pop flex items-center gap-1.5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 shadow-xl">
            {minimized.map((w) => (
              <button key={w.id} type="button"
                // A popped-out window lives in its own browser window: bring that one forward.
                onClick={() => (w.popped ? window.open('', `bulkstats-${w.id}`)?.focus() : dock.minimize(w.id, false))}
                title={`${w.kind === 'chart' ? `${w.coin}-USD` : 'Basket'}${w.popped ? ' (in its own window)' : ''}`}
                className={cn('ws-pop relative w-9 h-9 rounded-xl bg-[var(--bg-base)] border flex items-center justify-center hover:-translate-y-0.5 transition-transform', w.popped ? 'border-dashed border-[var(--text-tertiary)]' : 'border-[var(--border-color)]')}>
                {w.kind === 'chart' ? <CoinIcon symbol={w.coin ?? ''} size={20} /> : <Layers className="w-4 h-4 text-[var(--text-secondary)]" />}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          {menu !== 'closed' && (
            <div key={menu} className="ws-pop absolute bottom-full right-0 mb-2.5 w-[280px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 shadow-2xl">
              {menu === 'root' ? (
                <>
                  <MenuItem icon={<CandlestickChart className="w-4 h-4" />} title="Chart" sub="Candles for any market" more disabled={full} onClick={() => setMenu('chart')} />
                  <MenuItem icon={<Layers className="w-4 h-4" />} title="Basket" sub="Long and short several markets, see the margin"
                    onClick={() => { dock.openBasket(); setMenu('closed'); }} />
                  {st.windows.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-[var(--border-color)]" />
                      <button type="button" onClick={() => { dock.closeAll(); setMenu('closed'); }}
                        className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] text-[var(--text-tertiary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]">
                        Close all windows
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setMenu('root')} className="flex items-center gap-1 px-1.5 py-1 mb-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                    <ChevronLeft className="w-3.5 h-3.5" /> Chart
                  </button>
                  <CoinSearch markets={markets} onPick={(c) => { dock.openChart(c); setMenu('closed'); }} />
                </>
              )}
            </div>
          )}
          <button type="button" onClick={() => setMenu((m) => (m === 'closed' ? 'root' : 'closed'))} aria-label="Open a tool" aria-expanded={menu !== 'closed'}
            className="w-12 h-12 rounded-full flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-muted)] text-[var(--text-primary)] shadow-xl hover:border-[var(--text-tertiary)] transition-colors">
            <Plus className={cn('w-5 h-5 transition-transform duration-200', menu !== 'closed' && 'rotate-45')} />
          </button>
        </div>
      </div>
    </>
  );
}

function MenuItem({ icon, title, sub, onClick, more, disabled }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; more?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--bg-base)] disabled:opacity-40">
      <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--bg-base)] border border-[var(--border-color)] text-[var(--text-primary)] shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
        <span className="block text-[12px] text-[var(--text-tertiary)] truncate">{sub}</span>
      </span>
      {more && <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />}
    </button>
  );
}
