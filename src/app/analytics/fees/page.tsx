'use client';
import { InfoTip } from '@/components/InfoTip';

// Fees: BULK's fee schedule, a calculator for what a given volume costs, and BULK's own
// lifetime fee counters. All from /feeState, plus the account fee-tier quote when a
// wallet is entered, which BULK computes itself, so the calculator can be checked
// against it.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { analytics, wallet as walletApi, formatNumber, formatCompact, cn, type FeeSchedule, type AccountFeeTier, type FeeTierRow, type MakerShareTier } from '@/lib/api';
import { feeOn, makerRebate, tierIndex } from '@/lib/fees';
import { CoinIcon } from '@/components/CoinIcon';
import { STOCK_NAMES, baseCoin } from '@/lib/coins';
import { OptionSelect } from '@/components/ui/OptionSelect';
import { FeeComparison } from '@/components/FeeComparison';
import { FeeCurve } from '@/components/FeeCurve';
import { Sparkline } from '@/components/Sparkline';

const usd = (n: number) => `${n < 0 ? '−' : ''}$${formatNumber(Math.abs(n), Math.abs(n) < 1000 ? 2 : 0)}`;
const bps = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} bps`;
const pct = (ppm: number) => `${formatNumber(ppm / 10_000, ppm < 10_000 ? 2 : 1)}%`;

const card = 'bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)]';

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      {note && <InfoTip label={`About ${title}`}>{note}</InfoTip>}
    </div>
  );
}

// The volume slider runs on a log scale, $10K → $10B.
const VOL_MIN = 10_000, VOL_MAX = 10_000_000_000;
const volToPos = (v: number) => Math.round(((Math.log10(Math.min(VOL_MAX, Math.max(VOL_MIN, v || VOL_MIN))) - 4) / 6) * 1000);
const posToVol = (p: number) => { const v = Math.pow(10, 4 + (p / 1000) * 6); const m = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; };

const VOL_PRESETS = [100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000];

/** Small uppercase section label, with the explanation behind an "i". */
function SectionLabel({ children, note }: { children: React.ReactNode; note?: string }) {
  return <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{children}{note && <InfoTip label={`About ${String(children)}`}>{note}</InfoTip>}</div>;
}

/** Segmented control in the site's style. */
function Seg({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <div className="grid h-10 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          className={cn('rounded-lg text-[13px] transition-colors', value === v ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] shadow-[0_1px_2px_rgb(0_0_0/0.25)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A slider drawn as a row of ticks, lit up to the value; tier thresholds are the taller ticks. */
function TickSlider({ pos, onChange, marks }: { pos: number; onChange: (p: number) => void; marks: number[] }) {
  const N = 72;
  const markAt = new Set(marks.map((m) => Math.round((m / 1000) * (N - 1))));
  const at = Math.round((pos / 1000) * (N - 1));
  return (
    <div className="relative mt-2 h-9 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] px-3">
      <div className="pointer-events-none absolute inset-x-3 inset-y-0 flex items-center justify-between">
        {Array.from({ length: N }, (_, i) => (
          <span key={i} className="w-px rounded-full transition-colors duration-150"
            style={{ height: i === at ? 20 : markAt.has(i) ? 15 : 10, width: i === at ? 3 : 1, background: i === at ? 'var(--text-primary)' : i < at ? 'var(--accent)' : 'var(--border-color)' }} />
        ))}
      </div>
      <input type="range" min={0} max={1000} step={1} value={pos} onChange={(e) => onChange(Number(e.target.value))} aria-label="Volume"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </div>
  );
}

function Metric({ k, v, sub, dot, align = 'left' }: { k: string; v: string; sub?: string; dot?: string; align?: 'left' | 'center' | 'right' }) {
  const a = align === 'center' ? 'text-center items-center' : align === 'right' ? 'text-right items-end' : '';
  return (
    <div className={cn('flex min-w-0 flex-col', a)}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{dot && <span className="h-2 w-2 rounded-sm" style={{ background: dot }} />}{k}</div>
      <div className="mt-1 truncate text-[15px] font-medium tabular-nums text-[var(--text-primary)]">{v}</div>
      {sub && <div className="truncate text-[11px] text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="flex items-center justify-between py-2"><span className="text-[var(--text-tertiary)]">{k}</span><span className="tabular-nums" style={{ color: tone ?? 'var(--text-primary)' }}>{v}</span></div>;
}

function ResultCell({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-[var(--bg-base)] px-4 py-4">
      <div className="text-[12px] text-[var(--text-tertiary)]">{k}</div>
      <div className="mt-1 text-[20px] font-medium tabular-nums" style={{ color: tone ?? 'var(--text-primary)' }}>{v}</div>
      {sub && <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, hint, tone, series }: { label: string; value: string; hint?: string; tone?: 'pos' | 'neg'; series?: number[] }) {
  const charted = !!series && series.length >= 2 && series.some((v) => v !== series[0]);
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-[var(--bg-muted)] px-4 py-3 min-w-0', charted && 'min-h-[128px]')}>
      {charted && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[56px] opacity-90">
          <Sparkline data={series!} height={56} className="h-full w-full" />
        </div>
      )}
      <div className="relative">
        <div className="text-[12px] text-[var(--text-tertiary)]">{label}</div>
        <div className="mt-1 text-[20px] font-medium tabular-nums truncate" style={tone ? { color: `var(--${tone})` } : { color: 'var(--text-primary)' }}>{value}</div>
        {hint && <div className="mt-0.5 text-[12px] text-[var(--text-tertiary)] truncate">{hint}</div>}
      </div>
    </div>
  );
}

export default function FeesPage() {
  const [schedule, setSchedule] = useState<FeeSchedule | null>(null);
  const [failed, setFailed] = useState(false);
  // How the lifetime counters grew, day by day since mainnet: our daily revenue
  // record (taker fees, maker rebates, what the protocol kept) and trade counts.
  // Running totals, drawn behind each counter; the counters themselves are BULK's.
  const [growth, setGrowth] = useState<{ fills: number[]; taker: number[]; maker: number[]; kept: number[] } | null>(null);
  useEffect(() => {
    let live = true;
    const ALL = 8760 * 2;
    Promise.all([analytics.getProtocolRevenueChart(ALL).catch(() => null), analytics.getTradesCounts(ALL).catch(() => [])]).then(([rev, counts]) => {
      if (!live) return;
      const run = (xs: number[]) => { let a = 0; return xs.map((x) => (a += x)); };
      const rows = rev?.data ?? [];
      setGrowth({
        // Our trade-count table only keeps recent days; under a week isn't a trend.
        fills: counts.length >= 7 ? run(counts.map((c) => c.count)) : [],
        taker: run(rows.map((r) => Math.abs(r.takerFees))),
        maker: run(rows.map((r) => Math.abs(r.makerFees))),
        kept: rows.map((r) => r.cumulativeRevenue),
      });
    });
    return () => { live = false; };
  }, []);

  // Calculator inputs.
  const [market, setMarket] = useState<string>('crypto');
  const [volume, setVolume] = useState(1_000_000);
  const [takerPct, setTakerPct] = useState(100);
  const [makerSharePct, setMakerSharePct] = useState(0);
  const [showMaker, setShowMaker] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showCurve, setShowCurve] = useState(false);
  const [address, setAddress] = useState('');
  const [quote, setQuote] = useState<AccountFeeTier | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    analytics.getFeeTiers().then((s) => { if (!cancelled) setSchedule(s); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const overrides = schedule?.overrides ?? [];
  const policy = useMemo<{ tiers: FeeTierRow[]; makerShareTiers: MakerShareTier[] } | null>(() => {
    if (!schedule) return null;
    if (market === 'crypto') return { tiers: schedule.tiers, makerShareTiers: schedule.makerShareTiers ?? [] };
    return overrides.find((o) => o.symbol === market) ?? null;
  }, [schedule, market, overrides]);

  const loadWallet = async () => {
    const a = address.trim();
    if (!a) return;
    setQuoteState('loading');
    try {
      const q = await walletApi.getFeeTier(a);
      setQuote(q);
      setVolume(Math.round(q.rollingVolume));
      setMakerSharePct(q.makerSharePpm / 10_000);
      setMarket('crypto');
      setQuoteState('idle');
    } catch {
      setQuote(null);
      setQuoteState('error');
    }
  };

  const calc = useMemo(() => {
    if (!policy || !policy.tiers.length) return null;
    const i = tierIndex(policy.tiers, volume);
    const tier = policy.tiers[i];
    const next = policy.tiers[i + 1] ?? null;
    const rebate = makerRebate(policy.makerShareTiers, makerSharePct * 10_000);
    const maker = tier.makerBps + rebate;
    return {
      i, tier, next, rebate, maker,
      total: feeOn(volume, takerPct / 100, tier.takerBps, maker),
      perMillion: (1_000_000 * tier.takerBps) / 10_000,
      toNext: next ? Math.max(0, next.thresholdVolume - volume) : null,
      saving: next ? ((tier.takerBps - next.takerBps) * 1_000_000) / 10_000 : null,
    };
  }, [policy, volume, takerPct, makerSharePct]);

  const inputCls = 'w-full h-10 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] tabular-nums outline-none focus:border-[var(--accent)]';
  const labelCls = 'block text-[13px] text-[var(--text-secondary)] mb-1.5';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 w-full px-3 sm:px-6 lg:px-10 py-6">
        <h1 className="page-title text-[var(--text-primary)] mb-2">Fees</h1>
        <p className="text-[14px] text-[var(--text-secondary)] mb-6">What BULK charges, what a given volume would cost you, and what BULK has collected so far.</p>

        {failed && <div className={cn(card, 'p-6 text-[14px] text-[var(--text-secondary)]')}>Couldn’t load BULK’s fee schedule. Try again in a moment.</div>}
        {!schedule && !failed && (
          <div className={cn(card, 'p-10 flex items-center justify-center gap-2 text-[14px] text-[var(--text-tertiary)]')}><Loader2 className="w-4 h-4 animate-spin" />Loading the fee schedule</div>
        )}

        {schedule && (
          <div className="space-y-6">
            {/* ── Calculator: compact, one card ─────────────────────────── */}
            <section className={cn(card, 'p-4 sm:p-5')}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <SectionLabel note={`BULK sets your tier by your volume over the last ${schedule.windowDays} days. Paste a wallet to load its real tier and volume.`}>Fee calculator</SectionLabel>
                <div className="flex w-full items-center gap-1.5 sm:w-[300px]">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input id="fee-wallet" className={cn(inputCls, 'h-9 pl-8 text-[13px]')} placeholder="Your tier from a wallet…" value={address}
                      onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadWallet(); }} />
                  </div>
                  {address.trim() && (
                    <button type="button" onClick={() => void loadWallet()} disabled={quoteState === 'loading'}
                      className="h-9 shrink-0 rounded-lg bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-base)] disabled:opacity-40">
                      {quoteState === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Load'}
                    </button>
                  )}
                </div>
              </div>

              {/* controls: one row */}
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)]">
                <OptionSelect id="fee-market" value={market} onChange={setMarket} options={[
                  { value: 'crypto', label: 'Crypto, all markets', hint: `from ${bps(schedule.tiers[0]?.takerBps ?? 0)}`, icon: <CoinIcon symbol="BTC-USD" size={18} className="shrink-0" /> },
                  ...overrides.map((o) => {
                    const base = baseCoin(o.symbol);
                    return { value: o.symbol, label: STOCK_NAMES[base] ? `${base} · ${STOCK_NAMES[base]}` : base, hint: bps(o.tiers[0]?.takerBps ?? 0), icon: <CoinIcon symbol={o.symbol} size={18} className="shrink-0" /> };
                  }),
                ]} />
                <Seg value={takerPct} onChange={setTakerPct} options={[[100, 'Market'], [50, 'Mixed'], [0, 'Limit']]} />
                <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] pl-3 pr-1 transition-colors focus-within:border-[var(--text-tertiary)]">
                  <label htmlFor="fee-volume" className="shrink-0 text-[12px] text-[var(--text-tertiary)]">{schedule.windowDays}d vol $</label>
                  <input id="fee-volume" inputMode="numeric" value={volume ? volume.toLocaleString('en-US') : ''}
                    onChange={(e) => setVolume(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                    className="w-full min-w-0 bg-transparent text-[15px] font-medium tabular-nums text-[var(--text-primary)] outline-none" />
                  <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
                    {VOL_PRESETS.map((v) => (
                      <button key={v} type="button" onClick={() => setVolume(v)}
                        className={cn('h-8 rounded-lg px-2 text-[11px] tabular-nums transition-colors', volume === v ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                        {v >= 1e9 ? `${v / 1e9}B` : v >= 1e6 ? `${v / 1e6}M` : `${v / 1e3}K`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <TickSlider pos={volToPos(volume)} onChange={(p) => setVolume(posToVol(p))}
                marks={calc && policy!.tiers.length > 1 ? policy!.tiers.map((t) => volToPos(Math.max(t.thresholdVolume, VOL_MIN))) : []} />
              {(quoteState === 'error' || (quote && quoteState === 'idle') || showMaker) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
                  {quoteState === 'error' && <span className="text-[var(--neg)]">No fee tier found for that wallet.</span>}
                  {quote && quoteState === 'idle' && <span className="text-[var(--text-tertiary)]">BULK quotes this wallet at tier {quote.tierIndex + 1}: {bps(quote.takerBps)} taker, {bps(quote.effectiveMakerBps)} maker.</span>}
                  {showMaker && (
                    <label className="flex items-center gap-2 text-[var(--text-tertiary)]">Share of all maker volume
                      <input id="fee-share" className={cn(inputCls, 'h-8 w-20')} inputMode="decimal" value={makerSharePct}
                        onChange={(e) => setMakerSharePct(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))} />%
                    </label>
                  )}
                </div>
              )}

              {/* result: one line */}
              {calc && (
                <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-t border-[var(--border-color)] pt-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{calc.total < 0 ? 'BULK pays you' : 'You pay'}</div>
                    <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                      <span className="text-[30px] font-medium leading-none" style={{ color: calc.total < 0 ? 'var(--pos)' : 'var(--text-primary)' }}>{usd(Math.abs(calc.total))}</span>
                      <span className="text-[13px] text-[var(--text-tertiary)]">{volume > 0 ? `${((calc.total / volume) * 1e4).toFixed(2)} bp` : ''}</span>
                    </div>
                  </div>
                  <div className="grid flex-1 basis-full grid-cols-2 gap-x-6 gap-y-3 sm:basis-auto sm:grid-cols-4 lg:max-w-[640px]">
                    <Metric k="Tier" v={policy!.tiers.length > 1 ? `${calc.i + 1} of ${policy!.tiers.length}` : 'Flat'} />
                    <Metric k="Taker" v={bps(calc.tier.takerBps)} sub={`${usd(calc.perMillion)} / $1M`} />
                    <Metric k="Maker" v={calc.maker === 0 ? 'Free' : bps(calc.maker)} sub={calc.maker < 0 ? 'rebate' : undefined} />
                    <Metric k={calc.next ? `To tier ${calc.i + 2}` : 'Next tier'} v={calc.next ? `$${formatCompact(calc.toNext ?? 0)}` : 'Top tier'} sub={calc.next ? `saves ${usd(calc.saving ?? 0)} / $1M` : undefined} />
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <button type="button" onClick={() => setShowCurve((v) => !v)} className="inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showCurve && 'rotate-180')} />Cost chart
                </button>
                <button type="button" onClick={() => setShowSchedule((v) => !v)} className="inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSchedule && 'rotate-180')} />Fee schedule
                </button>
                <button type="button" onClick={() => setShowMaker((v) => !v)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">{showMaker ? 'Hide maker share' : 'I make markets'}</button>
              </div>
              {calc && showCurve && (
                <FeeCurve tiers={policy!.tiers} makerBpsAdj={calc.rebate} takerShare={takerPct / 100} volume={volume}
                  onPick={setVolume} compare={market === 'crypto'} className="mt-3 h-[280px] animate-[chart-fade_.3s_ease-out]" />
              )}
              {calc && showSchedule && (
                <div className="mt-3 animate-[chart-fade_.3s_ease-out]">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] text-[var(--text-tertiary)]">
                        <th className="pb-2 pr-3 font-normal">Tier</th><th className="pb-2 pr-3 font-normal">{schedule.windowDays}-day volume</th>
                        <th className="pb-2 pr-3 text-right font-normal">Taker</th><th className="pb-2 pr-3 text-right font-normal">Maker</th><th className="pb-2 text-right font-normal">Per $1M taken</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policy!.tiers.map((t, k) => (
                        <tr key={k} className={cn('border-t border-[var(--border-color)]', k === calc.i && 'bg-[var(--bg-muted)]')}>
                          <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{k + 1}</td>
                          <td className="py-1.5 pr-3 tabular-nums text-[var(--text-secondary)]">{t.thresholdVolume > 0 ? `$${formatCompact(t.thresholdVolume)}` : '$0'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--text-primary)]">{bps(t.takerBps)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.makerBps === 0 ? 'Free' : bps(t.makerBps)}</td>
                          <td className="py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{usd((1_000_000 * t.takerBps) / 10_000)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {policy!.makerShareTiers.length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
                      Maker rebates
                      <InfoTip label="Maker rebates">{policy!.makerShareTiers.map((t) => `${bps(t.rebateBps)} from ${pct(t.thresholdPpm)} of all maker volume`).join(' · ')}.</InfoTip>
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ── Against Hyperliquid ─────────────────────────────────── */}
            <section className={cn(card, 'p-4 sm:p-6')}>
              <Heading title="Why trade on BULK" note="BULK's fees against Hyperliquid's, by how much you trade. Lower is cheaper." />
              <FeeComparison crypto={schedule.tiers} tradfiTakerBps={overrides[0]?.tiers[0]?.takerBps ?? null}
                volume={volume} takerShare={takerPct / 100} comparing={market === 'crypto'} />
            </section>

            {/* ── TradFi markets ─────────────────────────────────────── */}
            {overrides.length > 0 && (
              <section className={cn(card, 'p-4 sm:p-6')}>
                <Heading title="Markets with their own fees"
                  note={`These don't use the volume tiers. Crypto starts at ${bps(schedule.tiers[0]?.takerBps ?? 0)} taker.`} />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {overrides.map((o) => {
                    const base = baseCoin(o.symbol);
                    const taker = o.tiers[0]?.takerBps ?? 0;
                    const rebate = o.makerShareTiers[0];
                    return (
                      <div key={o.symbol} className="flex items-center gap-3 rounded-lg bg-[var(--bg-muted)] px-4 py-3 min-w-0">
                        <CoinIcon symbol={o.symbol} size={28} className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] text-[var(--text-primary)] truncate">{base}{STOCK_NAMES[base] && <span className="text-[var(--text-tertiary)]"> · {STOCK_NAMES[base]}</span>}</div>
                          <div className="text-[12px] text-[var(--text-tertiary)] truncate">
                            {o.tiers.length > 1 ? `${o.tiers.length} tiers` : 'One rate'}{rebate ? ` · ${bps(rebate.rebateBps)} rebate at ${pct(rebate.thresholdPpm)}+` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[15px] font-medium tabular-nums text-[var(--text-primary)]">{bps(taker)}</div>
                          <div className="text-[11px] text-[var(--text-tertiary)]">taker</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── BULK's own counters ───────────────────────────────── */}
            <section className={cn(card, 'p-4 sm:p-6')}>
              <Heading title="Fees collected so far" note="BULK's own lifetime counters, as it reports them, with how each grew since mainnet." />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Fills settled" value={formatNumber(schedule.settledFills, 0)} series={growth?.fills} />
                <Stat label="Taker fees paid" value={usd(Math.abs(schedule.totalTakerFees))} series={growth?.taker} />
                <Stat label="Maker rebates paid out" value={usd(Math.abs(schedule.totalMakerFees))} series={growth?.maker} />
                <Stat label="Kept by the protocol" value={usd(schedule.totalProtocolSettlement)} hint="Taker fees less maker rebates" series={growth?.kept} />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
