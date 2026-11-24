'use client';
import { InfoTip } from '@/components/InfoTip';

// Fees: BULK's fee schedule, a calculator for what a given volume costs, and BULK's own
// lifetime fee counters. All from /feeState, plus the account fee-tier quote when a
// wallet is entered, which BULK computes itself, so the calculator can be checked
// against it.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
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
            {/* ── Calculator ─────────────────────────────────────────── */}
            <section className={cn(card, 'p-4 sm:p-6')}>
              <Heading title="Fee calculator" note={`BULK sets your tier by your volume over the last ${schedule.windowDays} days.`} />

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                {/* volume, the one thing that moves your fee */}
                <div className="rounded-2xl border border-[var(--border-color)] p-5">
                  <label htmlFor="fee-volume" className="text-[12px] text-[var(--text-tertiary)]">Your volume over {schedule.windowDays} days</label>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-[30px] font-medium text-[var(--text-tertiary)]">$</span>
                    <input id="fee-volume" inputMode="numeric" value={volume ? volume.toLocaleString('en-US') : ''}
                      onChange={(e) => setVolume(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                      className="w-full min-w-0 bg-transparent text-[30px] font-medium tabular-nums text-[var(--text-primary)] outline-none" />
                  </div>

                  {calc && policy!.tiers.length > 1 && (
                    <div className="mt-4">
                      <input type="range" min={0} max={1000} step={1} aria-label="Volume" value={volToPos(volume)}
                        onChange={(e) => setVolume(posToVol(Number(e.target.value)))} className="w-full accent-[var(--accent)]" />
                      <div className="relative mt-1 h-9">
                        {policy!.tiers.map((t, k) => {
                          const left = volToPos(Math.max(t.thresholdVolume, VOL_MIN)) / 10;
                          const reached = k <= calc.i;
                          return (
                            <button key={k} type="button" onClick={() => setVolume(Math.max(t.thresholdVolume, VOL_MIN))}
                              className="absolute -translate-x-1/2 text-center" style={{ left: `${left}%` }} title={`Tier ${k + 1}: ${bps(t.takerBps)} from $${formatCompact(t.thresholdVolume)}`}>
                              <span className={cn('mx-auto block h-2 w-px', reached ? 'bg-[var(--accent)]' : 'bg-[var(--border-color)]')} />
                              <span className={cn('mt-0.5 block text-[10px] tabular-nums transition-colors', k === calc.i ? 'font-medium text-[var(--text-primary)]' : reached ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')}>{k + 1}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]"><span>$10K</span><span>$10B</span></div>
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--border-color)] pt-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                    <div>
                      <label className={labelCls} htmlFor="fee-market">Market</label>
                      <OptionSelect id="fee-market" value={market} onChange={setMarket} options={[
                        { value: 'crypto', label: 'Crypto, all markets', hint: `from ${bps(schedule.tiers[0]?.takerBps ?? 0)}`, icon: <CoinIcon symbol="BTC-USD" size={18} className="shrink-0" /> },
                        ...overrides.map((o) => {
                          const base = baseCoin(o.symbol);
                          return { value: o.symbol, label: STOCK_NAMES[base] ? `${base} · ${STOCK_NAMES[base]}` : base, hint: bps(o.tiers[0]?.takerBps ?? 0), icon: <CoinIcon symbol={o.symbol} size={18} className="shrink-0" /> };
                        }),
                      ]} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="fee-taker">Market orders: {takerPct}% taker</label>
                      <input id="fee-taker" type="range" min={0} max={100} step={5} value={takerPct} onChange={(e) => setTakerPct(Number(e.target.value))} className="mt-3 w-full accent-[var(--accent)]" />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
                    <button type="button" onClick={() => setShowWallet((v) => !v)} className="text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline">{showWallet ? 'Hide wallet' : 'Use my wallet’s real tier'}</button>
                    <button type="button" onClick={() => setShowMaker((v) => !v)} className="text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline">{showMaker ? 'Hide maker share' : 'I make markets'}</button>
                  </div>
                  {showWallet && (
                    <div className="mt-2">
                      <div className="flex gap-2">
                        <input id="fee-wallet" className={inputCls} placeholder="Paste a wallet address" value={address}
                          onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadWallet(); }} />
                        <button type="button" onClick={() => void loadWallet()} disabled={!address.trim() || quoteState === 'loading'}
                          className="h-10 shrink-0 rounded-lg bg-[var(--text-primary)] px-3.5 text-[13px] font-medium text-[var(--bg-base)] disabled:opacity-40">
                          {quoteState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
                        </button>
                      </div>
                      {quoteState === 'error' && <p className="mt-1.5 text-[12px] text-[var(--neg)]">No fee tier found for that wallet.</p>}
                      {quote && quoteState === 'idle' && <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">BULK quotes this wallet at tier {quote.tierIndex + 1}: {bps(quote.takerBps)} taker, {bps(quote.effectiveMakerBps)} maker.</p>}
                    </div>
                  )}
                  {showMaker && (
                    <div className="mt-2 max-w-[260px]">
                      <label className={cn(labelCls, 'flex items-center gap-1.5')} htmlFor="fee-share">Share of all maker volume (%) <InfoTip label="About maker share">Only big market makers earn the rebate. Leave it at 0 if that isn’t you.</InfoTip></label>
                      <input id="fee-share" className={inputCls} inputMode="decimal" value={makerSharePct}
                        onChange={(e) => setMakerSharePct(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))} />
                    </div>
                  )}
                </div>

                {/* the answer */}
                {calc && (
                  <div className="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-5">
                    <div className="text-[12px] text-[var(--text-tertiary)]">{calc.total < 0 ? 'BULK pays you' : 'You’d pay'}</div>
                    <div className="mt-1 text-[40px] font-medium leading-none tabular-nums transition-colors" style={{ color: calc.total < 0 ? 'var(--pos)' : 'var(--text-primary)' }}>{usd(Math.abs(calc.total))}</div>
                    <div className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">over {schedule.windowDays} days at {takerPct}% taker</div>
                    <div className="mt-5 divide-y divide-[var(--border-color)] text-[13px]">
                      <Row k="Tier" v={policy!.tiers.length > 1 ? `${calc.i + 1} of ${policy!.tiers.length}` : 'Flat rate'} />
                      <Row k="Taker fee" v={`${bps(calc.tier.takerBps)} · ${usd(calc.perMillion)} per $1M`} />
                      <Row k="Maker fee" v={calc.maker === 0 ? 'Free' : bps(calc.maker)} tone={calc.maker < 0 ? 'var(--pos)' : undefined} />
                      <Row k="Effective rate" v={volume > 0 ? `${((calc.total / volume) * 1e4).toFixed(2)} bps on all volume` : '—'} />
                    </div>
                    {calc.next ? (
                      <div className="mt-5">
                        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
                          <span className="text-[var(--text-secondary)]">To tier {calc.i + 2} · {bps(calc.next.takerBps)}</span>
                          <span className="tabular-nums text-[var(--text-tertiary)]">${formatCompact(calc.toNext ?? 0)} to go</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-base)]">
                          <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
                            style={{ width: `${Math.max(2, Math.min(100, ((volume - calc.tier.thresholdVolume) / Math.max(1, calc.next.thresholdVolume - calc.tier.thresholdVolume)) * 100))}%` }} />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--text-tertiary)]">
                          <span>${formatCompact(calc.tier.thresholdVolume)}</span><span>${formatCompact(calc.next.thresholdVolume)}</span>
                        </div>
                        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">Reaching it saves <span className="tabular-nums text-[var(--pos)]">{usd(calc.saving ?? 0)}</span> per $1M you take.</p>
                      </div>
                    ) : (
                      <p className="mt-5 text-[13px] text-[var(--text-secondary)]">{policy!.tiers.length > 1 ? 'Top tier: the lowest taker fee BULK charges.' : 'This market has one rate for everyone.'}</p>
                    )}
                  </div>
                )}
              </div>

              {calc && (
                <>
                  <FeeCurve tiers={policy!.tiers} makerBpsAdj={calc.rebate} takerShare={takerPct / 100} volume={volume}
                    onPick={setVolume} compare={market === 'crypto'} className="mt-5" />
                  <button type="button" onClick={() => setShowSchedule((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSchedule && 'rotate-180')} />Full fee schedule
                  </button>
                  {showSchedule && (
                    <div className="mt-2 animate-[chart-fade_.3s_ease-out]">
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
                </>
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
