'use client';

// Mark over oracle per market. The oracle is Pyth spot; the mark is BULK's own price,
// built from the oracle and the order book, and it's what PnL and liquidations use.
// The gap shows where BULK is trading rich or cheap against spot right now.

import { useEffect, useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analytics, cn } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { baseCoin } from '@/lib/coins';

type Live = { symbol: string; bps: number; mark: number; oracle: number; ts: number };
const RANGES = [['24h', 24], ['7d', 168], ['30d', 720]] as const;
const STALE_MS = 5 * 60_000; // a market whose ticker went quiet (suspended) drops out

const fmtBps = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} bps`;

export function MarkOraclePanel() {
  const [live, setLive] = useState<Live[]>([]);
  const [history, setHistory] = useState<Record<string, { t: number; bps: number }[]>>({});
  const [hours, setHours] = useState<number>(24);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => analytics.getMarkOracle(hours)
      .then((d) => { if (cancelled) return; setLive(d.live); setHistory(d.history); setFailed(false); })
      .catch(() => { if (!cancelled) setFailed(true); });
    void load();
    const id = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [hours]);

  const rows = useMemo(() => live.filter((r) => Date.now() - r.ts < STALE_MS).sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps)), [live]);
  const selected = picked ?? rows[0]?.symbol ?? 'BTC-USD';
  const series = history[selected] ?? [];
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.bps)));
  const tick = { fill: 'var(--text-tertiary)', fontSize: 11 };

  return (
    <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4 sm:p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Mark vs oracle</h2>
        </div>
        <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
          How far BULK’s mark price sits from the Pyth spot price. The mark is what PnL and liquidations use; above zero, BULK is pricing the market above spot.
        </p>
      </div>

      {failed && rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-[var(--text-tertiary)]">Couldn’t load mark and oracle prices.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
          {/* Live, biggest gap first. A bar either side of zero shows direction. */}
          <div className="max-h-[360px] overflow-y-auto pr-1">
            {rows.length === 0 && <p className="py-6 text-[13px] text-[var(--text-tertiary)]">Waiting for the live price feed…</p>}
            {rows.map((r) => {
              const w = (Math.abs(r.bps) / peak) * 50;
              return (
                <button key={r.symbol} type="button" onClick={() => setPicked(r.symbol)}
                  className={cn('w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors', r.symbol === selected ? 'bg-[var(--bg-muted)]' : 'hover:bg-[var(--bg-muted)]')}>
                  <CoinIcon symbol={r.symbol} size={18} className="shrink-0" />
                  <span className="w-16 shrink-0 text-[13px] text-[var(--text-primary)] truncate">{baseCoin(r.symbol)}</span>
                  <span className="relative flex-1 h-2" aria-hidden>
                    <span className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-[var(--border-color)]" />
                    <span className="absolute top-0 h-2 rounded-sm" style={{ background: r.bps >= 0 ? 'var(--pos)' : 'var(--neg)', width: `${w}%`, left: r.bps >= 0 ? '50%' : `${50 - w}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right text-[13px] tabular-nums" style={{ color: r.bps >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtBps(r.bps)}</span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <CoinIcon symbol={selected} size={18} className="shrink-0" />
                <span className="text-[14px] text-[var(--text-primary)]">{baseCoin(selected)}</span>
                <span className="text-[12px] text-[var(--text-tertiary)]">hourly average</span>
              </div>
              <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
                {RANGES.map(([label, h]) => (
                  <button key={label} type="button" onClick={() => setHours(h)}
                    className={cn('px-3 py-1 text-xs font-medium rounded transition-colors', hours === h ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[300px]">
              {series.length < 2 ? (
                <div className="h-full grid place-items-center text-center text-[13px] text-[var(--text-tertiary)] px-6">
                  Recording started on Nov 10, 2026. The history fills in hour by hour.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--role-line-subtle)" strokeOpacity={0.5} />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={tick} axisLine={false} tickLine={false} minTickGap={48}
                      tickFormatter={(t) => new Date(t).toLocaleString('en-US', hours <= 24 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric' })} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `${Number(v).toFixed(1)}`} />
                    <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="3 3" />
                    <Tooltip contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(t) => new Date(t as number).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                      formatter={(v: number) => [fmtBps(v), 'Mark vs oracle']} />
                    <Line type="monotone" dataKey="bps" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
