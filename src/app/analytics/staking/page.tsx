'use client';

// ----------------------------------------------------------------------------
// Staking analytics — native validator + BulkSOL liquid staking.
// Mainnet-only (plain fetch, no ?net). Shares the Pre-Deposit design system.
// Charts are time-series (a point every indexer run) with 7D/30D/ALL ranges.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Coins, Users, Percent, TrendingUp, ArrowUpRight, ArrowDownRight, Droplet, Layers, Repeat } from 'lucide-react';
import { formatCompact, formatNumber } from '@/lib/api';
import { ChartFrame } from '@/components/ChartFrame';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';
type Range = '7d' | '30d' | 'all';

interface NativeSummary {
  epoch: number | null; activeStake: number; delegatorCount: number; commission: number;
  activating: number; deactivating: number; apy: number | null;
}
interface BulkSolSummary {
  epoch: number | null; tvlSol: number; supply: number; exchangeRate: number;
  holders: number | null; validators: number | null; apy: number | null;
}
interface TsPoint { t: number; [k: string]: number | null; }

export default function StakingPage() {
  const [native, setNative] = useState<NativeSummary | null>(null);
  const [nativeHist, setNativeHist] = useState<TsPoint[]>([]);
  const [bulksol, setBulksol] = useState<BulkSolSummary | null>(null);
  const [bulksolHist, setBulksolHist] = useState<TsPoint[]>([]);
  const [range, setRange] = useState<Range>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const get = (p: string) => fetch(`${API_URL}${p}`).then((r) => r.json()).catch(() => null);
    (async () => {
      const [ns, nh, bs, bh] = await Promise.all([
        get('/api/staking/native/summary'), get('/api/staking/native/history'),
        get('/api/staking/bulksol/summary'), get('/api/staking/bulksol/history'),
      ]);
      if (cancelled) return;
      setNative(ns && !ns.error ? ns : null);
      setNativeHist(Array.isArray(nh) ? nh : []);
      setBulksol(bs && !bs.error ? bs : null);
      setBulksolHist(Array.isArray(bh) ? bh : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const net = (native?.activating ?? 0) - (native?.deactivating ?? 0);

  return (
    <main className="flex-1 w-full px-4 sm:px-6 py-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Coins className="w-6 h-6 text-[var(--accent)]" />
        <h1 className="page-title text-[var(--text-primary)]">Staking</h1>
      </div>

      {!loading && !native && !bulksol && (
        <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--text-secondary)]">
          Staking indexing isn&apos;t live yet — the Solana RPC connection is being set up. Numbers appear here once indexing begins.
        </div>
      )}

      {/* ============================ NATIVE ============================ */}
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-[var(--accent)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Native Staking
          {native?.epoch != null && <span className="text-[var(--text-tertiary)] font-normal"> · Epoch {native.epoch}</span>}
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="Total Staked" value={native ? `${formatCompact(native.activeStake)} SOL` : '—'} color="var(--accent)" hero loading={loading} icon={Coins} />
        <KpiCard label="APY" value={native?.apy != null ? `≈ ${native.apy.toFixed(2)}%` : '—'} color="var(--bids)" loading={loading} icon={TrendingUp} />
        <KpiCard label="Delegators" value={native ? native.delegatorCount.toLocaleString() : '—'} color="#60a5fa" loading={loading} icon={Users} />
        <KpiCard label="Commission" value={native ? `${native.commission}%` : '—'} color="#c084fc" loading={loading} icon={Percent} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="Activating" value={native ? `${formatCompact(native.activating)} SOL` : '—'} color="var(--bids)" small loading={loading} icon={ArrowUpRight} />
        <KpiCard label="Deactivating" value={native ? `${formatCompact(native.deactivating)} SOL` : '—'} color="var(--asks)" small loading={loading} icon={ArrowDownRight} />
        <KpiCard label="Net Epoch Flow" value={native ? `${net >= 0 ? '+' : '−'}${formatCompact(Math.abs(net))} SOL` : '—'} color={net >= 0 ? 'var(--bids)' : 'var(--asks)'} small loading={loading} />
        <KpiCard label="Epoch" value={native?.epoch != null ? `#${native.epoch}` : '—'} color="var(--text-secondary)" small loading={loading} />
      </div>

      <TimeChart title="Staked SOL" yLabel="Active Stake (SOL)" data={nativeHist} dataKey="activeStake" unit="SOL" range={range} setRange={setRange} loading={loading} />

      {/* ============================ BULKSOL ============================ */}
      <div className="flex items-center gap-2 pt-1">
        <Droplet className="w-4 h-4 text-[#60a5fa]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          BulkSOL · Liquid Staking
          {bulksol?.epoch != null && <span className="text-[var(--text-tertiary)] font-normal"> · Epoch {bulksol.epoch}</span>}
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="SOL Backing" value={bulksol ? `${formatCompact(bulksol.tvlSol)} SOL` : '—'} color="var(--accent)" hero loading={loading} icon={Coins} />
        <KpiCard label="BulkSOL Supply" value={bulksol ? formatCompact(bulksol.supply) : '—'} color="#60a5fa" loading={loading} icon={Droplet} />
        <KpiCard label="Exchange Rate" value={bulksol && bulksol.exchangeRate > 0 ? `${bulksol.exchangeRate.toFixed(4)} SOL` : '—'} color="var(--bids)" loading={loading} icon={Repeat} />
        <KpiCard label="Holders" value={bulksol?.holders != null ? bulksol.holders.toLocaleString() : '—'} color="#c084fc" loading={loading} icon={Users} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="Validators" value={bulksol?.validators != null ? String(bulksol.validators) : '—'} color="var(--text-secondary)" small loading={loading} icon={Layers} />
        <KpiCard label="APY" value={bulksol?.apy != null ? `≈ ${bulksol.apy.toFixed(2)}%` : '—'} color="var(--bids)" small loading={loading} icon={TrendingUp} />
        <KpiCard label="TVL (USD est.)" value="—" color="var(--text-secondary)" small loading={loading} />
        <KpiCard label="Epoch" value={bulksol?.epoch != null ? `#${bulksol.epoch}` : '—'} color="var(--text-secondary)" small loading={loading} />
      </div>

      <TimeChart title="SOL Backing" yLabel="SOL Backing" data={bulksolHist} dataKey="tvlSol" unit="SOL" range={range} setRange={setRange} loading={loading} />
    </main>
  );
}

// Time-series chart card with 7D/30D/ALL range tabs (matches Pre-Deposit).
function TimeChart({ title, yLabel, data, dataKey, unit, range, setRange, loading }: {
  title: string; yLabel: string; data: TsPoint[]; dataKey: string; unit: string;
  range: Range; setRange: (r: Range) => void; loading?: boolean;
}) {
  const sliced = useMemo(() => {
    if (range === 'all' || data.length === 0) return data;
    const days = range === '7d' ? 7 : 30;
    const cutoff = Date.now() - days * 86_400_000;
    return data.filter((d) => d.t >= cutoff);
  }, [data, range]);

  return (
    <div className="bg-transparent border border-[var(--border-color)] rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        <div className="flex gap-1">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                range === r ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[320px]">
        {sliced.length > 1 ? (
          <ChartFrame title={title} className="h-full" yLabel={yLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sliced} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} minTickGap={40}
                  tickFormatter={(t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} />
                <Tooltip
                  cursor={{ stroke: 'var(--text-tertiary)', strokeOpacity: 0.3 }}
                  contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  labelFormatter={(t) => new Date(t as number).toLocaleString('en-US')}
                  formatter={(v: number) => [`${formatNumber(v, 0)} ${unit}`, yLabel]}
                />
                <Area type="monotone" dataKey={dataKey} stroke="var(--accent)" strokeWidth={2} fill={`url(#grad-${dataKey})`} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        ) : (
          <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-sm">
            {loading ? 'Loading…' : 'Collecting data — the chart fills in as snapshots are recorded.'}
          </div>
        )}
      </div>
    </div>
  );
}

// Copied from the Pre-Deposit page so both pages share one KPI look.
function KpiCard({ label, value, color, hero, small, loading, icon: Icon }: {
  label: string; value: string; color: string;
  hero?: boolean; small?: boolean; loading?: boolean;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div className="relative overflow-hidden bg-transparent border border-[var(--border-color)] rounded-lg pl-4 pr-3 py-3.5 hover:border-[var(--border-secondary)] transition-colors">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: color, opacity: hero ? 1 : 0.55 }} />
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.12em] font-medium">{label}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-[var(--bg-secondary-20)] rounded animate-pulse" />
      ) : (
        <p className={`${hero ? 'text-[26px]' : small ? 'text-xl' : 'text-2xl'} font-bold tabular-nums tracking-tight leading-none`}
           style={{ color: color === 'var(--text-secondary)' ? 'var(--text-primary)' : color }}>
          {value}
        </p>
      )}
    </div>
  );
}
