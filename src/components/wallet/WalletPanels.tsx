'use client';

// The wallet page's analysis panels: market treemap, gross to net, maker/taker,
// PnL calendar, trade history, funding and transfers. Each takes figures that
// were already reconciled against BULK's account totals, and says so when a
// busy wallet's history is partial instead of presenting a sample as a total.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatCompact, type WalletFunding } from '@/lib/api';
import { coinOf, dayKey, formatPx, money, pnlColor, shortDate, signed } from '@/lib/walletFormat';
import { squarify, type MarketRow, type SideStats, type WalletFillLite } from '@/lib/walletMetrics';
import { CoinIcon } from '@/components/CoinIcon';

/** A strip of headline figures at the top of a tab. */
export function StatStrip({ items }: { items: { label: string; hint?: string; value: ReactNode; color?: string; bar?: { pct: number; color: string } }[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--border-color)] border-b border-[var(--border-color)]">
      {items.map((s) => (
        <div key={s.label} className="min-w-0 bg-[var(--bg-muted)] px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-[var(--role-content-muted)] truncate">{s.label}</span>
            {s.hint && <span className="text-[12px] text-[var(--role-content-subtle)] truncate">{s.hint}</span>}
          </div>
          <div className="mt-2 text-[24px] leading-none font-medium tabular-nums tracking-tight truncate" style={{ color: s.color ?? 'var(--role-content)' }}>{s.value}</div>
          {s.bar && (
            <div className="mt-3 h-1 rounded-full bg-[var(--role-surface-raised)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, s.bar.pct * 100))}%`, background: s.bar.color }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Panel({ title, hint, right, children }: { title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-[var(--bg-muted)] border-b border-[var(--border-color)] min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4">
        <h2 className="text-[15px] text-[var(--role-content)]">{title}</h2>
        {right ?? (hint && <span className="text-[12px] text-[var(--role-content-subtle)]">{hint}</span>)}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-[var(--border-color)] p-0.5 text-[12px]">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={cn('px-2.5 py-1 rounded-md transition-colors', value === k ? 'text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Tells the reader a figure covers only part of a busy wallet's life. */
export function PartialNote({ fills, oldest }: { fills: number; oldest: number | null }) {
  return (
    <p className="px-5 pb-4 text-[12px] text-[var(--role-content-subtle)]">
      Based on the latest {fills.toLocaleString('en-US')} fills{oldest ? `, back to ${shortDate(oldest)}` : ''}. BULK doesn’t serve older fills for this wallet.
    </p>
  );
}

// ---- Market breakdown ------------------------------------------------------

type TreeCell = MarketRow & { others?: number };
const MAX_CELLS = 18;

/** Net PnL per market as a treemap: size by volume or PnL, colour by bps on volume. */
export function MarketBreakdown({ rows, exact, fills, oldest, totalVolume, makerShare }: {
  rows: MarketRow[]; exact: boolean; fills: number; oldest: number | null; totalVolume: number; makerShare: number;
}) {
  const [sizeBy, setSizeBy] = useState<'volume' | 'pnl'>('volume');
  const box = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const metric = (r: MarketRow) => (sizeBy === 'volume' ? r.volume : Math.abs(r.net));
  const cells = useMemo(() => {
    const sorted = rows.filter((r) => metric(r) > 0).sort((a, b) => metric(b) - metric(a));
    const head: TreeCell[] = sorted.slice(0, MAX_CELLS);
    const tail = sorted.slice(MAX_CELLS);
    if (tail.length) {
      const volume = tail.reduce((s, r) => s + r.volume, 0);
      const net = tail.reduce((s, r) => s + r.net, 0);
      head.push({ symbol: `${tail.length} others`, volume, net, makerShare: 0, bps: volume ? (net / volume) * 10_000 : 0, others: tail.length });
    }
    return squarify(head.map((item) => ({ item, value: metric(item) })), dims.w, dims.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sizeBy, dims.w, dims.h]);

  const peak = Math.max(1, ...rows.filter((r) => r.volume > 0).map((r) => Math.abs(r.bps)));
  const net = rows.reduce((s, r) => s + r.net, 0);

  return (
    <Panel title="Market breakdown" right={<Segmented value={sizeBy} options={[['volume', 'Volume'], ['pnl', 'PnL']] as const} onChange={setSizeBy} />}>
      <div className="px-5 pt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <span className="text-[var(--role-content-muted)]">{rows.length} markets</span>
        <span className="text-[var(--role-content-muted)]">Volume <span className="text-[var(--role-content)] tabular-nums">${formatCompact(totalVolume)}</span></span>
        <span className="text-[var(--role-content-muted)]">Maker <span className="text-[var(--role-content)] tabular-nums">{(makerShare * 100).toFixed(0)}%</span></span>
        {totalVolume > 0 && exact && <span className="text-[var(--role-content-muted)]">Net <span className="tabular-nums" style={{ color: pnlColor(net) }}>{(net / totalVolume * 10_000).toFixed(2)} bps</span> on volume</span>}
      </div>
      <div ref={box} className="relative mx-5 my-4 h-[320px] sm:h-[420px]">
        {cells.map(({ item: c, x, y, w, h }) => {
          // Square root keeps mid-sized edges visible next to a single outlier.
          const strength = c.volume > 0 ? Math.sqrt(Math.min(1, Math.abs(c.bps) / peak)) : 0.3;
          const showName = w > 44 && h > 24;
          const showValue = w > 76 && h > 48;
          const showDetail = w > 200 && h > 96;
          return (
            <div key={c.symbol} title={`${c.symbol}: ${signed(c.net)}, $${formatCompact(c.volume)} volume`}
              className="absolute overflow-hidden rounded-lg flex flex-col items-center justify-center text-center p-1"
              style={{ left: x + 1, top: y + 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2), background: `color-mix(in srgb, ${pnlColor(c.net)} ${Math.round(8 + strength * 30)}%, var(--bg-muted))` }}>
              {showName && <span className={cn('text-[var(--role-content)] truncate max-w-full', showDetail ? 'text-[15px]' : 'text-[12px]')}>{c.others ? c.symbol : coinOf(c.symbol)}</span>}
              {showValue && <span className={cn('tabular-nums font-medium truncate max-w-full', showDetail ? 'text-[26px] leading-tight' : 'text-[14px]')} style={{ color: pnlColor(c.net) }}>{signed(c.net)}</span>}
              {showDetail && !c.others && <span className="text-[12px] text-[var(--role-content-muted)] tabular-nums truncate max-w-full">{c.bps.toFixed(2)} bps · ${formatCompact(c.volume)} · {(c.makerShare * 100).toFixed(0)}% maker</span>}
            </div>
          );
        })}
      </div>
      {!exact && <PartialNote fills={fills} oldest={oldest} />}
    </Panel>
  );
}

// ---- Gross to net ----------------------------------------------------------

/** How the PnL adds up. Every line is BULK's lifetime account figure. */
export function GrossToNet({ gross, fees, funding, net }: { gross: number; fees: number; funding: number; net: number }) {
  const lines = [
    { sign: '', label: 'Gross PnL', note: 'From price moves, before costs', value: gross },
    { sign: '', label: 'Fees', note: 'Taker fees, less maker rebates', value: fees },
    { sign: '', label: 'Funding', note: 'Paid or received while holding', value: funding },
    { sign: '=', label: 'Net PnL', note: 'What it actually kept', value: net, total: true },
  ];
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.value)));
  return (
    <Panel title="Gross to net" hint="How the PnL adds up">
      <div className="px-5 pt-2 pb-3 divide-y divide-[var(--role-line-subtle)]">
        {lines.map((l) => (
          <div key={l.label} className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-3 py-3">
            <span className="text-[var(--role-content-subtle)]">{l.sign}</span>
            <span className="min-w-0">
              <span className={cn('block text-[14px] text-[var(--role-content)]', l.total && 'font-medium')}>{l.label}</span>
              <span className="block text-[12px] text-[var(--role-content-subtle)] truncate">{l.note}</span>
            </span>
            <span className="h-1.5 rounded-full bg-[var(--role-surface-raised)] overflow-hidden">
              <span className="block h-full rounded-full" style={{ width: `${(Math.abs(l.value) / max) * 100}%`, background: l.total ? 'var(--accent)' : pnlColor(l.value) }} />
            </span>
            <span className="text-[14px] tabular-nums text-right w-24" style={{ color: pnlColor(l.value) }}>{signed(l.value)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---- Maker / taker ---------------------------------------------------------

export function MakerTaker({ maker, taker, partial, fills, oldest }: { maker: SideStats; taker: SideStats; partial: boolean; fills: number; oldest: number | null }) {
  const total = maker.volume + taker.volume;
  const share = total > 0 ? maker.volume / total : 0;
  const Side = ({ name, s, pct }: { name: string; s: SideStats; pct: number }) => (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between py-2">
        <span className="text-[14px] text-[var(--role-content)]">{name}</span>
        <span className="text-[13px] text-[var(--role-content-muted)] tabular-nums">{(pct * 100).toFixed(0)}%</span>
      </div>
      {([
        ['Volume', `$${formatCompact(s.volume)}`],
        ['Fills', s.fills.toLocaleString('en-US')],
        ['Fee rate', `${s.volume > 0 ? ((-s.fees / s.volume) * 10_000).toFixed(2) : '0.00'} bps`],
      ] as const).map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between py-1.5 border-t border-[var(--role-line-subtle)] text-[13px]">
          <span className="text-[var(--role-content-muted)]">{k}</span>
          <span className="tabular-nums text-[var(--role-content)]">{v}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between py-1.5 border-t border-[var(--role-line-subtle)] text-[13px]">
        <span className="text-[var(--role-content-muted)]">Fees</span>
        <span className="tabular-nums" style={{ color: pnlColor(s.fees) }}>{signed(s.fees)}</span>
      </div>
    </div>
  );
  return (
    <Panel title="Maker / taker" hint="By volume">
      <div className="px-5 pt-3 pb-4">
        <div className="flex h-1.5 gap-0.5 rounded-full overflow-hidden">
          <div className="rounded-full bg-[var(--accent)]" style={{ width: `${share * 100}%` }} />
          <div className="flex-1 rounded-full bg-[var(--role-content-subtle)]" />
        </div>
        <div className="mt-1 grid grid-cols-2 gap-6">
          <Side name="Maker" s={maker} pct={share} />
          <Side name="Taker" s={taker} pct={total > 0 ? 1 - share : 0} />
        </div>
      </div>
      {partial && <PartialNote fills={fills} oldest={oldest} />}
    </Panel>
  );
}

// ---- PnL calendar ----------------------------------------------------------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A month of daily PnL: colour for the result, a bar for that day's volume. */
export function PnlCalendar({ daily, volume }: { daily: Map<string, number> | null; volume: Map<string, number> }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const label = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7; // Monday first
  const key = (d: number) => dayKey(new Date(cursor.y, cursor.m, d).getTime());
  const cells = Array.from({ length: days }, (_, i) => ({ d: i + 1, pnl: daily?.get(key(i + 1)) ?? null, vol: volume.get(key(i + 1)) ?? 0 }));
  const traded = cells.filter((c) => c.pnl !== null);
  const net = traded.reduce((s, c) => s + (c.pnl as number), 0);
  const best = traded.length ? traded.reduce((a, b) => ((b.pnl as number) > (a.pnl as number) ? b : a)) : null;
  const worst = traded.length ? traded.reduce((a, b) => ((b.pnl as number) < (a.pnl as number) ? b : a)) : null;
  const peakPnl = Math.max(1, ...traded.map((c) => Math.abs(c.pnl as number)));
  const peakVol = Math.max(1, ...cells.map((c) => c.vol));
  const weeks: ((typeof cells)[number] | null)[][] = [];
  const padded = [...Array(lead).fill(null), ...cells];
  while (padded.length % 7) padded.push(null);
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  const step = (n: number) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const dayLabel = (d?: number) => (d ? shortDate(new Date(cursor.y, cursor.m, d).getTime()) : undefined);

  return (
    <>
      <StatStrip items={[
        { label: 'Net', hint: label, value: traded.length ? signed(net) : '—', color: traded.length ? pnlColor(net) : undefined },
        { label: 'Green days', hint: 'Of days recorded', value: traded.length ? `${traded.filter((c) => (c.pnl as number) > 0).length} / ${traded.length}` : '—' },
        { label: 'Best day', hint: dayLabel(best?.d), value: best ? signed(best.pnl as number) : '—', color: best ? pnlColor(best.pnl as number) : undefined },
        { label: 'Worst day', hint: dayLabel(worst?.d), value: worst ? signed(worst.pnl as number) : '—', color: worst ? pnlColor(worst.pnl as number) : undefined },
      ]} />
      <Panel title={label} right={
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="p-1.5 rounded-md text-[var(--role-content-muted)] hover:bg-[var(--role-surface-raised)]"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="p-1.5 rounded-md text-[var(--role-content-muted)] hover:bg-[var(--role-surface-raised)]"><ChevronRight className="w-4 h-4" /></button>
        </div>
      }>
        <div className="px-3 sm:px-5 py-3">
          <div className="grid grid-cols-7 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,0.7fr)] gap-1 sm:gap-1.5 text-[12px] text-[var(--role-content-subtle)] mb-1.5">
            {WEEKDAYS.map((d) => <span key={d} className="text-center">{d}</span>)}
            <span className="hidden sm:block text-center">Week</span>
          </div>
          {weeks.map((week, i) => {
            const total = week.reduce((s, c) => s + (c?.pnl ?? 0), 0);
            const any = week.some((c) => c?.pnl !== null && c !== null);
            return (
              <div key={i} className="grid grid-cols-7 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,0.7fr)] gap-1 sm:gap-1.5 mb-1 sm:mb-1.5">
                {week.map((c, j) => c === null ? <span key={j} /> : (
                  <div key={j} title={c.pnl === null ? `${dayLabel(c.d)}: nothing recorded` : `${dayLabel(c.d)}: ${signed(c.pnl)}, $${formatCompact(c.vol)} volume`}
                    className="relative min-w-0 h-14 sm:h-[72px] rounded-lg border border-[var(--role-line-subtle)] p-1 sm:p-1.5 flex flex-col"
                    style={c.pnl === null ? undefined : { background: `color-mix(in srgb, ${pnlColor(c.pnl)} ${Math.round(10 + Math.sqrt(Math.abs(c.pnl) / peakPnl) * 30)}%, var(--bg-muted))`, borderColor: 'transparent' }}>
                    <span className="text-[11px] text-[var(--role-content-subtle)] leading-none">{c.d}</span>
                    {c.pnl !== null && (
                      <span className="flex-1 grid place-items-center text-[11px] sm:text-[13px] tabular-nums text-[var(--role-content)] truncate">
                        <span className="sm:hidden">{c.pnl < 0 ? '−' : '+'}{formatCompact(Math.abs(c.pnl))}</span>
                        <span className="hidden sm:inline">{signed(c.pnl)}</span>
                      </span>
                    )}
                    {c.vol > 0 && <span className="h-0.5 rounded-full bg-[var(--role-content-muted)]" style={{ width: `${Math.max(4, (c.vol / peakVol) * 100)}%` }} />}
                  </div>
                ))}
                <div className="hidden sm:grid place-items-center h-[72px] rounded-lg border border-dashed border-[var(--role-line-subtle)] text-[13px] tabular-nums truncate" style={{ color: any ? pnlColor(total) : 'var(--role-content-subtle)' }}>{any ? signed(total) : '—'}</div>
              </div>
            );
          })}
          <p className="mt-2 text-[12px] text-[var(--role-content-subtle)]">Change in total PnL each day, open positions included. Darker means a bigger day; the bar is that day’s volume.</p>
        </div>
      </Panel>
    </>
  );
}

// ---- Trade history ---------------------------------------------------------

const PAGE = 50;

/** Every fill, newest first, with a market filter. */
export function FillsTable({ fills }: { fills: WalletFillLite[] }) {
  const [market, setMarket] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const markets = useMemo(() => Array.from(new Set(fills.map((f) => f.symbol))).sort(), [fills]);
  const rows = useMemo(() => [...(market === 'all' ? fills : fills.filter((f) => f.symbol === market))].sort((a, b) => b.timestamp - a.timestamp), [fills, market]);
  if (fills.length === 0) return <div className="p-10 text-center text-[14px] text-[var(--role-content-subtle)]">No fills yet</div>;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <span className="text-[13px] text-[var(--role-content-muted)] tabular-nums">{rows.length.toLocaleString('en-US')} fills</span>
        <select aria-label="Filter by market" value={market} onChange={(e) => { setMarket(e.target.value); setShown(PAGE); }}
          className="h-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-2 text-[13px] text-[var(--role-content)]">
          <option value="all">All markets</option>
          {markets.map((m) => <option key={m} value={m}>{coinOf(m)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] whitespace-nowrap">
          <thead>
            <tr className="text-[12px] text-[var(--role-content-muted)] border-y border-[var(--border-color)]">
              <th className="text-left font-normal px-5 py-2.5">Time</th>
              <th className="text-left font-normal px-3 py-2.5">Market</th>
              <th className="text-left font-normal px-3 py-2.5">Side</th>
              <th className="text-right font-normal px-3 py-2.5">Price</th>
              <th className="text-right font-normal px-3 py-2.5">Value</th>
              <th className="text-right font-normal px-3 py-2.5">Fee</th>
              <th className="text-right font-normal px-5 py-2.5">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--role-line-subtle)]">
            {rows.slice(0, shown).map((f, i) => (
              <tr key={`${f.timestamp}-${i}`}>
                <td className="px-5 py-2.5 text-[13px] text-[var(--role-content-muted)] tabular-nums">{new Date(f.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                <td className="px-3 py-2.5"><span className="flex items-center gap-2 text-[var(--role-content)]"><CoinIcon symbol={f.symbol} size={16} />{coinOf(f.symbol)}</span></td>
                <td className="px-3 py-2.5" style={{ color: f.isBuy ? 'var(--pos)' : 'var(--neg)' }}>{f.isBuy ? 'Buy' : 'Sell'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[var(--role-content)]">{formatPx(f.price)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[var(--role-content)]">{money(Math.abs(f.size) * f.price)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[var(--role-content-muted)]">{f.fee ? signed(f.fee) : '—'}</td>
                <td className="px-5 py-2.5 text-right text-[13px] text-[var(--role-content-muted)]">{f.isMaker ? 'Maker' : 'Taker'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < rows.length && (
        <div className="p-3 text-center">
          <button type="button" onClick={() => setShown((n) => n + 200)} className="h-9 px-4 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Show more</button>
        </div>
      )}
    </div>
  );
}

// ---- Funding ---------------------------------------------------------------

export function FundingPanel({ funding }: { funding: WalletFunding | null }) {
  if (!funding) return <div className="p-10 text-center text-[14px] text-[var(--role-content-subtle)]">Loading funding</div>;
  const rows = Object.entries(funding.bySymbol).map(([symbol, v]) => ({ symbol, v })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <>
      <StatStrip items={[
        { label: 'Net funding', hint: 'All time', value: signed(funding.net), color: pnlColor(funding.net) },
        { label: 'Paid', value: money(funding.paid) },
        { label: 'Received', value: money(funding.received) },
        { label: 'Payments', hint: `${rows.length} markets`, value: funding.count.toLocaleString('en-US') },
      ]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-px bg-[var(--border-color)]">
        <Panel title="By market">
          <div className="p-5 flex flex-col gap-3">
            {rows.length === 0 && <p className="text-[14px] text-[var(--role-content-subtle)]">No funding yet</p>}
            {rows.slice(0, 12).map((r) => (
              <div key={r.symbol}>
                <div className="flex items-baseline justify-between text-[14px]">
                  <span className="flex items-center gap-2 text-[var(--role-content)]"><CoinIcon symbol={r.symbol} size={16} />{coinOf(r.symbol)}</span>
                  <span className="tabular-nums" style={{ color: pnlColor(r.v) }}>{signed(r.v)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-[var(--role-surface-raised)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(Math.abs(r.v) / max) * 100}%`, background: pnlColor(r.v) }} /></div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Latest payments" hint={funding.recent.length ? `Last ${funding.recent.length}` : undefined}>
          <div className="mt-2 max-h-[460px] overflow-y-auto divide-y divide-[var(--role-line-subtle)]">
            {funding.recent.map((p, i) => (
              <div key={`${p.timestamp}-${p.symbol}-${i}`} className="flex items-center justify-between gap-3 px-5 py-2 text-[13px]">
                <span className="flex items-center gap-2 min-w-0 text-[var(--role-content)]"><CoinIcon symbol={p.symbol} size={16} />{coinOf(p.symbol)}<span className="text-[var(--role-content-subtle)] tabular-nums truncate">{new Date(p.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span></span>
                <span className="tabular-nums shrink-0" style={{ color: pnlColor(p.payment) }}>{signed(p.payment)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

