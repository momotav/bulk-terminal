'use client';

// Fees: BULK's fee schedule, a calculator for what a given volume costs, and BULK's own
// lifetime fee counters. All from /feeState, plus the account fee-tier quote when a
// wallet is entered, which BULK computes itself, so the calculator can be checked
// against it.

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { analytics, wallet as walletApi, formatNumber, formatCompact, cn, type FeeSchedule, type AccountFeeTier, type FeeTierRow, type MakerShareTier } from '@/lib/api';
import { feeOn, makerRebate, tierIndex } from '@/lib/fees';
import { CoinIcon } from '@/components/CoinIcon';
import { STOCK_NAMES, baseCoin } from '@/lib/coins';
import { OptionSelect } from '@/components/ui/OptionSelect';
import { FeeComparison } from '@/components/FeeComparison';
import { FeeCurve } from '@/components/FeeCurve';

const usd = (n: number) => `${n < 0 ? '−' : ''}$${formatNumber(Math.abs(n), Math.abs(n) < 1000 ? 2 : 0)}`;
const bps = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} bps`;
const pct = (ppm: number) => `${formatNumber(ppm / 10_000, ppm < 10_000 ? 2 : 1)}%`;

const card = 'bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)]';

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      {note && <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">{note}</p>}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-lg bg-[var(--bg-muted)] px-4 py-3 min-w-0">
      <div className="text-[12px] text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-1 text-[20px] font-medium tabular-nums truncate" style={tone ? { color: `var(--${tone})` } : { color: 'var(--text-primary)' }}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-[var(--text-tertiary)] truncate">{hint}</div>}
    </div>
  );
}

export default function FeesPage() {
  const [schedule, setSchedule] = useState<FeeSchedule | null>(null);
  const [failed, setFailed] = useState(false);

  // Calculator inputs.
  const [market, setMarket] = useState<string>('crypto');
  const [volume, setVolume] = useState(1_000_000);
  const [takerPct, setTakerPct] = useState(100);
  const [makerSharePct, setMakerSharePct] = useState(0);
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
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6">
                <div className="space-y-4">
                  <div>
                    <label className={labelCls} htmlFor="fee-wallet">Your wallet (optional)</label>
                    <div className="flex gap-2">
                      <input id="fee-wallet" className={inputCls} placeholder="Paste a wallet to use its real numbers" value={address}
                        onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadWallet(); }} />
                      <button type="button" onClick={() => void loadWallet()} disabled={!address.trim() || quoteState === 'loading'}
                        className="h-10 px-4 rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] text-[13px] font-medium shrink-0 disabled:opacity-40">
                        {quoteState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
                      </button>
                    </div>
                    {quoteState === 'error' && <p className="mt-1.5 text-[12px] text-[var(--neg)]">No fee tier found for that wallet.</p>}
                    {quote && quoteState === 'idle' && (
                      <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">
                        BULK quotes this wallet at tier {quote.tierIndex + 1}: {bps(quote.takerBps)} taker, {bps(quote.effectiveMakerBps)} maker.
                      </p>
                    )}
                  </div>

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
                    <label className={labelCls} htmlFor="fee-volume">Volume over {schedule.windowDays} days</label>
                    <input id="fee-volume" className={inputCls} inputMode="numeric" value={volume ? volume.toLocaleString('en-US') : ''}
                      onChange={(e) => setVolume(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[100_000, 1_000_000, 10_000_000, 50_000_000, 150_000_000].map((v) => (
                        <button key={v} type="button" onClick={() => setVolume(v)}
                          className={cn('px-2.5 py-1 rounded-md text-[12px] border transition-colors', volume === v ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                          ${formatCompact(v)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelCls} htmlFor="fee-taker">Taken from the book (market orders): {takerPct}%</label>
                    <input id="fee-taker" type="range" min={0} max={100} step={5} value={takerPct} onChange={(e) => setTakerPct(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                    <div className="flex justify-between text-[11px] text-[var(--text-tertiary)]"><span>All maker</span><span>All taker</span></div>
                  </div>

                  <div>
                    <label className={labelCls} htmlFor="fee-share">Your share of all maker volume on BULK (%)</label>
                    <input id="fee-share" className={inputCls} inputMode="decimal" value={makerSharePct}
                      onChange={(e) => setMakerSharePct(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))} />
                    <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">Only big market makers earn the rebate. Leave it at 0 if that isn’t you.</p>
                  </div>
                </div>

                {calc && (
                  <div className="min-w-0 flex flex-col gap-3">
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                      <Stat label="Your tier" value={policy!.tiers.length > 1 ? `${calc.i + 1} of ${policy!.tiers.length}` : 'Flat rate'}
                        hint={calc.tier.thresholdVolume > 0 ? `From $${formatCompact(calc.tier.thresholdVolume)}` : 'Starting tier'} />
                      <Stat label="Taker fee" value={bps(calc.tier.takerBps)} hint={`${usd(calc.perMillion)} per $1M`} />
                      <Stat label="Maker fee" value={calc.maker === 0 ? 'Free' : bps(calc.maker)} tone={calc.maker < 0 ? 'pos' : undefined}
                        hint={calc.rebate < 0 ? 'Paid to you as a rebate' : 'No maker fee'} />
                      <Stat label={`Fees on this volume`} value={usd(Math.abs(calc.total))} tone={calc.total < 0 ? 'pos' : undefined}
                        hint={calc.total < 0 ? 'Net rebate to you' : `Over ${schedule.windowDays} days at ${takerPct}% taker`} />
                    </div>

                    <div className="rounded-lg border border-[var(--border-color)] px-4 py-3 text-[14px] text-[var(--text-secondary)]">
                      {calc.next ? (
                        <>Trade <span className="text-[var(--text-primary)] tabular-nums">${formatCompact(calc.toNext ?? 0)}</span> more in {schedule.windowDays} days to reach tier {calc.i + 2} at{' '}
                          <span className="text-[var(--text-primary)]">{bps(calc.next.takerBps)}</span>, saving <span className="text-[var(--pos)] tabular-nums">{usd(calc.saving ?? 0)}</span> per $1M you take.</>
                      ) : policy!.tiers.length > 1 ? 'You’re in the top tier: the lowest taker fee BULK charges.' : 'This market has one rate for everyone.'}
                    </div>

                    <FeeCurve tiers={policy!.tiers} makerBpsAdj={calc.rebate} takerShare={takerPct / 100} volume={volume}
                      onPick={setVolume} compare={market === 'crypto'} className="flex-1" />
                  </div>
                )}
              </div>

              {/* The schedule for the chosen market, your tier marked, under both columns. */}
              {calc && (
                  <div className="mt-6 space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="text-left text-[12px] text-[var(--text-tertiary)]">
                            <th className="py-2 pr-3 font-normal">Tier</th>
                            <th className="py-2 pr-3 font-normal">{schedule.windowDays}-day volume from</th>
                            <th className="py-2 pr-3 font-normal text-right">Taker</th>
                            <th className="py-2 pr-3 font-normal text-right">Maker</th>
                            <th className="py-2 font-normal text-right">Per $1M taken</th>
                          </tr>
                        </thead>
                        <tbody>
                          {policy!.tiers.map((t, k) => (
                            <tr key={k} className={cn('border-t border-[var(--border-color)]', k === calc.i && 'bg-[var(--bg-muted)]')}>
                              <td className="py-2 pr-3 tabular-nums text-[var(--text-primary)]">{k + 1}{k === calc.i && <span className="ml-2 text-[11px] text-[var(--accent-text)]">You</span>}</td>
                              <td className="py-2 pr-3 tabular-nums text-[var(--text-secondary)]">{t.thresholdVolume > 0 ? `$${formatCompact(t.thresholdVolume)}` : '$0'}</td>
                              <td className="py-2 pr-3 tabular-nums text-right text-[var(--text-primary)]">{bps(t.takerBps)}</td>
                              <td className="py-2 pr-3 tabular-nums text-right text-[var(--text-secondary)]">{t.makerBps === 0 ? 'Free' : bps(t.makerBps)}</td>
                              <td className="py-2 tabular-nums text-right text-[var(--text-secondary)]">{usd((1_000_000 * t.takerBps) / 10_000)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {policy!.makerShareTiers.length > 0 && (
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Maker rebates: {policy!.makerShareTiers.map((t) => `${bps(t.rebateBps)} from ${pct(t.thresholdPpm)} of all maker volume`).join(' · ')}.
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
              <Heading title="Fees collected so far" note="BULK's own lifetime counters, as it reports them." />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Fills settled" value={formatNumber(schedule.settledFills, 0)} />
                <Stat label="Taker fees paid" value={usd(Math.abs(schedule.totalTakerFees))} />
                <Stat label="Maker rebates paid out" value={usd(Math.abs(schedule.totalMakerFees))} />
                <Stat label="Kept by the protocol" value={usd(schedule.totalProtocolSettlement)} hint="Taker fees less maker rebates" />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
