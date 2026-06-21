'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Landmark, TrendingUp, TrendingDown, Wallet, Users, Loader2 } from 'lucide-react';
import { formatCompact, formatAddress } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

interface Kpis {
  liveTvl: number; totalDeposited: number; totalWithdrawn: number;
  programTxns: number; uniqueDepositors: number;
  avgDeposit: number; medianDeposit: number; largestDeposit: number;
}
interface TvlPoint {
  day: string; deposits: number; withdrawals: number;
  netFlow: number; cumulativeDeposits: number; liveBalance: number;
}
interface DistBucket {
  bucket: string; numDepositors: number; totalDeposited: number;
  pctDepositors: number; pctDeposits: number;
}
interface GrowthPoint { day: string; newDepositors: number; cumulativeDepositors: number; }
interface ActivityPoint { day: string; activeDepositors: number; depositTxns: number; }
interface LeaderRow {
  rank: number; address: string; deposited: number; withdrawn: number;
  net: number; pctOfTotal: number; txns: number;
  twitterHandle: string | null; twitterName: string | null; twitterAvatar: string | null;
}
interface Status {
  backfillComplete: boolean; lastRun: string | null;
  totalIndexed: number; configured: boolean;
}

const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtUsdC = (n: number) => `$${formatCompact(n)}`;
const tooltipStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12,
};
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Wrapper card for the secondary charts in the 2-col grid.
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{subtitle}</p>}
      </div>
      <div className="h-[260px]">{children}</div>
    </div>
  );
}

function Empty({ loading }: { loading?: boolean }) {
  return (
    <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-sm">
      {loading ? 'Loading…' : 'No data yet'}
    </div>
  );
}

export default function PreDepositPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tvl, setTvl] = useState<TvlPoint[]>([]);
  const [dist, setDist] = useState<DistBucket[]>([]);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    // Fetch helper that treats any non-OK response (404 while the backend
    // isn't deployed yet, 500s, etc.) as "no data" rather than letting an
    // error body like {"error":...} through as if it were real data — that
    // was crashing the KPI cards with `undefined.toLocaleString()`.
    const getJson = async <T,>(path: string): Promise<T | null> => {
      try {
        const r = await fetch(`${API_URL}${path}`);
        if (!r.ok) return null;
        return (await r.json()) as T;
      } catch {
        return null;
      }
    };
    const load = async () => {
      const [k, t, d, g, a, l, s] = await Promise.all([
        getJson<Kpis>('/api/predeposit/kpis'),
        getJson<{ data: TvlPoint[] }>('/api/predeposit/tvl-history'),
        getJson<{ data: DistBucket[] }>('/api/predeposit/distribution'),
        getJson<{ data: GrowthPoint[] }>('/api/predeposit/depositor-growth'),
        getJson<{ data: ActivityPoint[] }>('/api/predeposit/daily-activity'),
        getJson<{ data: LeaderRow[] }>('/api/predeposit/leaderboard?limit=100'),
        getJson<Status>('/api/predeposit/status'),
      ]);
      if (cancelled) return;
      // Only accept KPIs if the object actually has the numeric fields —
      // guards against an error body slipping through.
      setKpis(k && typeof k.liveTvl === 'number' ? k : null);
      setTvl(Array.isArray(t?.data) ? t!.data : []);
      setDist(Array.isArray(d?.data) ? d!.data : []);
      setGrowth(Array.isArray(g?.data) ? g!.data : []);
      setActivity(Array.isArray(a?.data) ? a!.data : []);
      setLeaders(Array.isArray(l?.data) ? l!.data : []);
      setStatus(s && typeof s.configured === 'boolean' ? s : null);
      setLoading(false);
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const tvlSliced = (() => {
    if (range === 'all') return tvl;
    const days = range === '7d' ? 7 : 30;
    return tvl.slice(-days);
  })();

  return (
    <main className="flex-1 w-full px-4 sm:px-6 py-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Landmark className="w-6 h-6 text-[var(--accent)]" />
        <h1 className="page-title text-[var(--text-primary)]">Pre-Deposit</h1>
      </div>

      {/* Indexer status banner while backfilling or if RPC not yet wired. */}
      {!loading && !status && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          Pre-deposit analytics aren&apos;t available yet — the backend service for this section hasn&apos;t been deployed. Data appears here once it&apos;s live.
        </div>
      )}
      {status && !status.configured && (
        <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--text-secondary)]">
          Pre-deposit indexing isn&apos;t live yet — the Solana RPC connection is being set up. Numbers appear here once indexing begins.
        </div>
      )}
      {status && status.configured && !status.backfillComplete && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          Indexing vault history… {status.totalIndexed.toLocaleString()} transfers so far. Figures update as the backfill completes.
        </div>
      )}

      {/* KPI band — Current TVL is the hero. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="Current TVL" value={kpis ? fmtUsd(kpis.liveTvl) : '—'} color="var(--accent)" hero loading={loading} />
        <KpiCard label="Total Deposited" value={kpis ? fmtUsd(kpis.totalDeposited) : '—'} color="var(--bids)" loading={loading} />
        <KpiCard label="Total Withdrawn" value={kpis ? fmtUsd(kpis.totalWithdrawn) : '—'} color="var(--asks)" loading={loading} />
        <KpiCard label="Unique Depositors" value={kpis ? kpis.uniqueDepositors.toLocaleString() : '—'} color="#60a5fa" loading={loading} icon={Users} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard label="Program Txns" value={kpis ? kpis.programTxns.toLocaleString() : '—'} color="#c084fc" small loading={loading} />
        <KpiCard label="Avg Deposit" value={kpis ? fmtUsdC(kpis.avgDeposit) : '—'} color="var(--text-secondary)" small loading={loading} />
        <KpiCard label="Median Deposit" value={kpis ? fmtUsdC(kpis.medianDeposit) : '—'} color="var(--text-secondary)" small loading={loading} />
        <KpiCard label="Largest Deposit" value={kpis ? fmtUsdC(kpis.largestDeposit) : '—'} color="var(--text-secondary)" small loading={loading} />
      </div>

      {/* TVL history chart */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">TVL History</h2>
          <div className="flex gap-1">
            {(['7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  range === r
                    ? 'bg-[var(--accent)] text-[var(--accent-text)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[320px]">
          {tvlSliced.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-sm">
              {loading ? 'Loading…' : 'No data yet'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tvlSliced}>
                <defs>
                  <linearGradient id="tvlFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.3} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(v) => `$${formatCompact(v)}`}
                  width={60}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  formatter={(v: number, name) => [fmtUsd(v), name === 'liveBalance' ? 'Live TVL' : name]}
                />
                <Area type="monotone" dataKey="liveBalance" stroke="var(--accent)" strokeWidth={2} fill="url(#tvlFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Extra charts — 2-column grid, mirroring the Dune dashboard cuts.
          All derived from the same predeposit_transfers table. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily deposits vs withdrawals (stacked bars) */}
        <ChartCard title="Daily Deposits / Withdrawals" subtitle="USDC in vs out per day">
          {tvl.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tvl}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={30} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(v) => `$${formatCompact(v)}`} width={52} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                  formatter={(v: number, n) => [fmtUsd(v), n === 'deposits' ? 'Deposits' : 'Withdrawals']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="deposits" stackId="a" fill="var(--bids)" name="Deposits" />
                <Bar dataKey="withdrawals" stackId="a" fill="var(--asks)" name="Withdrawals" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* New depositors per day + cumulative line */}
        <ChartCard title="New Depositors per Day" subtitle="First-time depositors + cumulative">
          {growth.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={30} />
                <YAxis yAxisId="l" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={40} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={44}
                  tickFormatter={(v) => formatCompact(v)} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
                <Bar yAxisId="l" dataKey="newDepositors" fill="#c084fc" name="New" radius={[2, 2, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumulativeDepositors" stroke="var(--accent)" strokeWidth={2} dot={false} name="Cumulative" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Daily active depositors */}
        <ChartCard title="Daily Active Depositors" subtitle="Distinct depositors per day">
          {activity.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={30} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={40} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
                <Bar dataKey="activeDepositors" fill="#60a5fa" name="Active" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Daily deposit transaction count */}
        <ChartCard title="Daily Deposit Txns" subtitle="Number of deposits per day">
          {activity.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={30} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={40} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
                <Bar dataKey="depositTxns" fill="var(--accent)" name="Txns" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Distribution + Leaderboard side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* Distribution buckets */}
        <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Deposit Distribution</h2>
          <div className="space-y-2.5">
            {dist.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">{loading ? 'Loading…' : 'No data yet'}</p>
            ) : (
              dist.map((b) => (
                <div key={b.bucket}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)] font-medium tabular-nums">{b.bucket}</span>
                    <span className="text-[var(--text-tertiary)] tabular-nums">
                      {b.numDepositors} · {fmtUsdC(b.totalDeposited)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-secondary-20)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${Math.max(b.pctDeposits, 1)}%`, opacity: 0.85 }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Depositor leaderboard — the wallet-linked differentiator */}
        <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Top Depositors</h2>
            <span className="text-[11px] text-[var(--text-tertiary)]">Linked to wallet profiles</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-tertiary)] text-xs border-b border-[var(--border-color)]">
                  <th className="text-left font-medium px-2 py-2 w-12">#</th>
                  <th className="text-left font-medium px-2 py-2">Depositor</th>
                  <th className="text-right font-medium px-2 py-2">Deposited</th>
                  <th className="text-right font-medium px-2 py-2 hidden sm:table-cell">Net</th>
                  <th className="text-right font-medium px-2 py-2 hidden md:table-cell">% Total</th>
                  <th className="text-right font-medium px-2 py-2 hidden md:table-cell">Txns</th>
                </tr>
              </thead>
              <tbody>
                {leaders.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--text-tertiary)]">{loading ? 'Loading…' : 'No depositors yet'}</td></tr>
                ) : (
                  leaders.map((row) => (
                    <tr key={row.address} className="border-b border-[var(--border-color)]/50 hover:bg-[var(--bg-secondary-20)]/30 transition-colors">
                      <td className="px-2 py-2.5 text-[var(--text-tertiary)] tabular-nums">{row.rank}</td>
                      <td className="px-2 py-2.5">
                        <Link href={`/whales/${row.address}`} className="flex items-center gap-2 hover:text-[var(--accent)] transition-colors">
                          {row.twitterAvatar ? (
                            <img src={row.twitterAvatar} alt="" width={24} height={24} className="w-6 h-6 rounded-full border border-[var(--border-color)] shrink-0" />
                          ) : (
                            <span className="w-6 h-6 rounded-full bg-[var(--bg-secondary-20)] flex items-center justify-center shrink-0">
                              <Wallet className="w-3 h-3 text-[var(--text-tertiary)]" />
                            </span>
                          )}
                          <span className="min-w-0">
                            {row.twitterHandle ? (
                              <span className="text-[var(--text-primary)] truncate block">@{row.twitterHandle}</span>
                            ) : (
                              <span className="font-mono text-[var(--text-secondary)] truncate block">{formatAddress(row.address)}</span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-primary)] font-medium">{fmtUsdC(row.deposited)}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums hidden sm:table-cell ${row.net >= 0 ? 'text-bulk-green' : 'text-red-400'}`}>
                        {row.net >= 0 ? '+' : ''}{fmtUsdC(row.net)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-secondary)] hidden md:table-cell">{row.pctOfTotal.toFixed(1)}%</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-tertiary)] hidden md:table-cell">{row.txns}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

function KpiCard({
  label, value, color, hero, small, loading, icon: Icon,
}: {
  label: string; value: string; color: string;
  hero?: boolean; small?: boolean; loading?: boolean;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div className="relative overflow-hidden bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg pl-4 pr-3 py-3.5 hover:border-[var(--border-secondary)] transition-colors">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: color, opacity: hero ? 1 : 0.55 }} />
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.12em] font-medium">{label}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-[var(--bg-secondary-20)] rounded animate-pulse" />
      ) : (
        <p
          className={`${hero ? 'text-[26px]' : small ? 'text-xl' : 'text-2xl'} font-bold tabular-nums tracking-tight leading-none`}
          style={{ color: color === 'var(--text-secondary)' ? 'var(--text-primary)' : color }}
        >
          {value}
        </p>
      )}
    </div>
  );
}
