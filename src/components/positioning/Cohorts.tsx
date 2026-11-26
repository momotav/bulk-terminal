'use client';

import { useEffect, useState } from 'react';
import { analytics, cn, formatCompact, type CohortRow } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { InfoTip } from '@/components/InfoTip';
import { SeriesChart, Legend } from '@/components/charts/SeriesChart';

const usd = (n: number) => `$${formatCompact(n)}`;
const coinOf = (s: string) => s.replace(/-USD$/, '');

function range(c: CohortRow, kind: 'pnl' | 'size'): string {
  const f = (n: number) => `${n < 0 ? '−' : ''}$${formatCompact(Math.abs(n))}`;
  const what = kind === 'pnl' ? 'PnL' : 'account';
  if (c.min === null) return `${what} under ${f(c.max!)}`;
  if (c.max === null) return `${what} ${f(c.min)}+`;
  return `${what} ${f(c.min)} to ${f(c.max)}`;
}

/** Long/short split bar: green long, red short, 2px gap. */
function Split({ long, short, className }: { long: number; short: number; className?: string }) {
  const share = long + short > 0 ? long / (long + short) : 0.5;
  return (
    <span className={cn('flex h-2 overflow-hidden rounded-full', className)}>
      <span className="grad-pos-l transition-[width] duration-700 ease-out" style={{ width: `${share * 100}%` }} />
      <span className="w-0.5" />
      <span className="grad-neg-r flex-1" />
    </span>
  );
}

/**
 * The top traders split by how they've done (all-time PnL) or how big they are
 * (account value), and where each group leans. Click a group for its markets
 * and history.
 */
export function Cohorts({ isIn }: { isIn: (coin: string) => boolean }) {
  const [kind, setKind] = useState<'pnl' | 'size'>('pnl');
  const [data, setData] = useState<{ wallets: number; cohorts: CohortRow[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<{ t: number; long: number; short: number }[] | null>(null);

  useEffect(() => {
    let alive = true; setData(null); setSel(null);
    const load = () => analytics.getCohorts(kind).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData((x) => x ?? { wallets: 0, cohorts: [] }); });
    load(); const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [kind]);

  // Market filter (All / Crypto / TradFi) applies to the exposure numbers.
  const cohorts = (data?.cohorts ?? []).map((c) => {
    const markets = c.markets.filter((m) => isIn(coinOf(m.symbol)));
    return { ...c, markets, long: markets.reduce((a, m) => a + m.long, 0), short: markets.reduce((a, m) => a + m.short, 0) };
  });
  const active = cohorts.find((c) => c.key === sel) ?? null;
  const hasHist = !!hist && hist.length >= 2;

  useEffect(() => {
    if (!sel) return;
    let alive = true; setHist(null);
    analytics.getCohortHistory(sel, 7).then((d) => { if (alive) setHist(d.series); }).catch(() => { if (alive) setHist([]); });
    return () => { alive = false; };
  }, [sel]);

  return (
    <div className="glass-card p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-[var(--text-primary)]">
          Cohorts
          <InfoTip label="About cohorts" width={320}>
            The {data?.wallets ?? 300} most active traders, grouped by all-time PnL (realized plus open, as on their wallet pages) or by
            account size (balance plus open PnL). The bar is each group’s long vs short exposure right now; 24h is the change in its long share.
          </InfoTip>
        </h2>
        <div className="toggle-group">
          <button type="button" onClick={() => setKind('pnl')} className={cn('toggle-btn', kind === 'pnl' && 'active')}>By PnL</button>
          <button type="button" onClick={() => setKind('size')} className={cn('toggle-btn', kind === 'size' && 'active')}>By account size</button>
        </div>
      </div>

      {!data ? <div className="h-[150px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> : (
        <div key={kind} className="grid animate-[chart-fade_.35s_ease-out] grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {cohorts.map((c) => {
            const share = c.long + c.short > 0 ? c.long / (c.long + c.short) : null;
            const d = share !== null && c.longShare24hAgo !== null ? (share - c.longShare24hAgo) * 100 : null;
            const empty = c.wallets === 0;
            return (
              <button key={c.key} type="button" disabled={empty} onClick={() => setSel(sel === c.key ? null : c.key)}
                className={cn('rounded-xl border px-3.5 py-3 text-left transition-colors',
                  sel === c.key ? 'border-[var(--text-tertiary)] bg-[var(--bg-base)]' : 'border-[var(--border-color)] hover:border-[var(--text-tertiary)]',
                  empty && 'cursor-default opacity-40')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{c.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{c.wallets} wallets</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">{range(c, kind)}</div>
                <Split long={c.long} short={c.short} className="mt-3" />
                <div className="mt-1.5 flex items-baseline justify-between text-[12px] tabular-nums">
                  <span style={{ color: 'var(--pos)' }}>{share === null ? '—' : `${Math.round(share * 100)}% long`}</span>
                  <span style={{ color: d === null || Math.abs(d) < 0.5 ? 'var(--text-tertiary)' : d > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {d === null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-tertiary)]">{usd(c.long + c.short)} open</div>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div key={active.key} className={cn('mt-4 grid animate-[chart-fade_.35s_ease-out] gap-5 border-t border-[var(--border-color)] pt-4', hasHist && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]')}>
          <div>
            <div className="mb-2 text-[12px] text-[var(--text-secondary)]">{active.label}: biggest markets</div>
            {active.markets.length === 0 && <p className="text-[12px] text-[var(--text-tertiary)]">No open positions in these markets.</p>}
            <div className={cn('grid gap-x-8 gap-y-2', !hasHist && 'md:grid-cols-2')}>
              {active.markets.slice(0, hasHist ? 8 : 12).map((m) => (
                <div key={m.symbol} className="grid grid-cols-[72px_minmax(0,1fr)_70px] items-center gap-3 text-[12px] tabular-nums">
                  <span className="flex items-center gap-1.5 text-[var(--text-primary)]"><CoinIcon symbol={coinOf(m.symbol)} size={14} />{coinOf(m.symbol)}</span>
                  <Split long={m.long} short={m.short} />
                  <span className="text-right text-[var(--text-secondary)]">{usd(m.long + m.short)}</span>
                </div>
              ))}
            </div>
          </div>
          {hasHist && (
            <div>
              <div className="mb-1 text-[12px] text-[var(--text-secondary)]">{active.label}: long vs short over 7 days</div>
              <SeriesChart height={170} times={hist!.map((p) => p.t)} animKey={active.key}
                series={[{ key: 'l', label: 'Long', color: 'var(--pos)', values: hist!.map((p) => p.long) }, { key: 's', label: 'Short', color: 'var(--neg)', values: hist!.map((p) => p.short) }]}
                format={(v) => usd(v)} />
              <div className="mt-2"><Legend series={[{ key: 'l', label: 'Long', color: 'var(--pos)' }, { key: 's', label: 'Short', color: 'var(--neg)' }]} /></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
