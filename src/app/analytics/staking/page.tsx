'use client';

// ----------------------------------------------------------------------------
// Staking analytics — native validator section (BulkSOL liquid section: TODO).
//
// Mainnet-only, like pre-deposit: plain fetch to the backend, no ?net scoping.
// Data comes from services/stakingIndexer.ts via /api/staking/native/*.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Coins, Users, Percent, TrendingUp, Loader2 } from 'lucide-react';
import { formatCompact, formatNumber } from '@/lib/api';
import { ChartFrame } from '@/components/ChartFrame';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

interface NativeSummary {
  voteAccount: string;
  identity: string;
  epoch: number | null;
  activeStake: number;
  delegatorCount: number;
  commission: number;
  activating: number;
  deactivating: number;
  apy: number | null;
  updatedAt: string | null;
}

interface HistoryPoint {
  epoch: number;
  activeStake: number;
  delegatorCount: number;
  apy: number | null;
}

export default function StakingPage() {
  const [summary, setSummary] = useState<NativeSummary | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, h] = await Promise.all([
          fetch(`${API_URL}/api/staking/native/summary`).then((r) => r.json()),
          fetch(`${API_URL}/api/staking/native/history`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setSummary(s);
        setHistory(Array.isArray(h) ? h : []);
      } catch {
        /* leave empty on failure */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Staking</h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
          Native delegation to the BULK validator on Solana mainnet.
          {summary?.epoch != null && <span> · Epoch {summary.epoch}</span>}
        </p>
      </div>

      {/* Native section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Native Staking</h2>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            label="Total Staked"
            value={loading ? '—' : `${formatCompact(summary?.activeStake ?? 0)} SOL`}
            caption={summary && (summary.activating > 0 || summary.deactivating > 0)
              ? `+${formatCompact(summary.activating)} activating · −${formatCompact(summary.deactivating)} leaving`
              : 'active stake'}
            icon={<Coins className="w-3.5 h-3.5" />}
            loading={loading}
          />
          <Kpi
            label="Delegators"
            value={loading ? '—' : formatNumber(summary?.delegatorCount ?? 0, 0)}
            caption="stake accounts"
            icon={<Users className="w-3.5 h-3.5" />}
            loading={loading}
          />
          <Kpi
            label="Commission"
            value={loading ? '—' : `${summary?.commission ?? 0}%`}
            caption="validator fee"
            icon={<Percent className="w-3.5 h-3.5" />}
            loading={loading}
          />
          <Kpi
            label="APY"
            value={loading ? '—' : summary?.apy != null ? `≈ ${summary.apy.toFixed(2)}%` : '—'}
            caption="net of commission"
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            loading={loading}
          />
        </div>

        {/* Stake over time */}
        <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl p-4">
          <div className="h-[340px]">
            <ChartFrame title="Staked SOL by Epoch" className="h-full" yLabel="Active Stake (SOL)">
              {history.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                    <defs>
                      <linearGradient id="stakeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="epoch" tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} tickFormatter={(e) => `#${e}`} />
                    <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} />
                    <Tooltip
                      cursor={{ stroke: 'var(--text-tertiary)', strokeOpacity: 0.3 }}
                      contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                      labelStyle={{ color: 'var(--text-secondary)' }}
                      itemStyle={{ color: 'var(--text-primary)' }}
                      labelFormatter={(e) => `Epoch ${e}`}
                      formatter={(v: number) => [`${formatNumber(v, 0)} SOL`, 'Active Stake']}
                    />
                    <Area type="monotone" dataKey="activeStake" stroke="var(--accent)" strokeWidth={2} fill="url(#stakeGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-center text-xs text-[var(--text-tertiary)]">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'History builds up as the indexer records each epoch.'}
                </div>
              )}
            </ChartFrame>
          </div>
        </div>
      </section>

      {/* BulkSOL placeholder — next build step */}
      <section className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl p-4 opacity-70">
        <div className="flex items-center gap-2 mb-1">
          <Coins className="w-4 h-4 text-[var(--text-tertiary)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">BulkSOL (Liquid Staking)</h2>
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          Supply, SOL backing, exchange rate and holders — coming next.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, caption, icon, loading }: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
        <span className="text-[var(--text-tertiary)]">{icon}</span>{label}
      </div>
      <div className="text-xl font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" /> : value}
      </div>
      <div className="text-[10px] text-[var(--text-tertiary)] mt-1 truncate">{caption}</div>
    </div>
  );
}
