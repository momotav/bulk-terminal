'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, TrendingUp, Wallet, Activity, AlertCircle, Clock, Loader2, UserCheck, Shield, Image as ImageIcon } from 'lucide-react';
import { wallet, leaderboard, analytics, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, type BulkLeaderboardRankResponse, type ClosedPosition, userApi } from '@/lib/api';
import { isSystemWallet } from '@/lib/systemWallets';
import { computePositionOpenTime, formatDuration, realizedPnlSeries, symbolPositionTimeline, buildTradeLifecycle, type PositionOpenInfo } from '@/lib/positionWalk';
import type { WalletFill, Candle } from '@/lib/api';
import { ClosedPositionsList } from '@/components/ClosedPositionsList';
import { TradeShareCard, type ShareCardData } from '@/components/TradeShareCard';
import { useStore } from '@/store';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { AreaChart, Area, BarChart, Bar, Cell, ReferenceLine, ReferenceDot, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { AccountHierarchy } from '@/components/AccountHierarchy';
import { BulkRankBadge } from '@/components/BulkRankBadge';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskEventsList } from '@/components/RiskEventsList';
import { PositionChartModal, type PositionForChart } from '@/components/PositionChartModal';
import { ChartFrame } from '@/components/ChartFrame';
import { getCoinColor } from '@/lib/coins';
import { Sparkline } from '@/components/Sparkline';
import { clampWicks } from '@/lib/candles';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface WalletProfile {
  wallet_address: string;
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
// Breakdown content for the "Total PnL" StatCard hover popover. Renders
// a Gross / Fees / Net summary so users can see how fees discounted the
// headline number. Reused at both StatCard call sites (with-live and
// no-live layouts). Numbers formatted with 2 decimals — the popover is
// the "show me the precision" surface, distinct from the compacted
// headline.
function TotalPnlBreakdown({
  gross,
  fees,
  net,
}: {
  gross: number;
  fees: number;
  net: number;
}) {
  const fmt = (n: number): string => {
    const sign = n >= 0 ? '+' : '-';
    return `${sign}$${formatNumber(Math.abs(n), 2)}`;
  };
  const isWin = net >= 0;
  const rows: { label: string; value: string; tone: 'win' | 'loss' | null }[] = [
    { label: 'Gross', value: fmt(gross), tone: gross >= 0 ? 'win' : 'loss' },
    { label: 'Fees', value: fmt(fees), tone: fees >= 0 ? 'win' : 'loss' },
  ];
  return (
    <>
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 text-xs leading-relaxed"
        >
          <span className="text-[var(--text-tertiary)] tracking-normal text-[10px]">
            {row.label}
          </span>
          <span
            className={cn(
              'font-mono tabular-nums',
              row.tone === 'win' && 'text-bulk-green',
              row.tone === 'loss' && 'text-bulk-red',
              !row.tone && 'text-[var(--text-secondary)]',
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-[var(--text-secondary)] tracking-normal text-[10px] font-semibold">
            Net
          </span>
          <span
            className={cn(
              'font-mono tabular-nums font-bold',
              isWin ? 'text-bulk-green' : 'text-bulk-red',
            )}
          >
            {fmt(net)}
          </span>
        </div>
      </div>
    </>
  );
}
// ----------------------------------------------------------------------------
// PnlCalendarHeatmap
//
// Day-by-day P&L heatmap. Each square is one day; color intensity
// reflects the day's net PnL (green for winning days, red for losing,
// muted gray for no-trade days). Mimics Hyperdash's Calendar tab view —
// at a glance you can see the wallet's good streaks and bad streaks.
//
// Aggregation is purely client-side from closedPositions. Each closed
// position contributes its realizedPnl (already net of fees+funding)
// to the bucket for the day it closed.
//
// Layout: columns are weeks, rows are weekdays (Mon-Sun). The grid
// renders left-to-right oldest-to-newest, similar to GitHub's
// contribution heatmap.
// ----------------------------------------------------------------------------
// A single day cell in the calendar heatmap, with its own styled hover
// tooltip showing the date and that day's net PnL. Color rules:
//   green  = positive PnL day
//   red    = negative PnL day
//   muted  = no trades (tooltip shows date only)
// Manages hover state locally so the parent (which returns early before
// any hooks) stays hooks-free.
function HeatmapCell({
  date,
  pnl,
  bg,
  isNoTrade,
  isWin,
}: {
  date: Date;
  pnl: number | null;
  bg: string | undefined;
  isNoTrade: boolean;
  isWin: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const pnlStr =
    pnl === null || isNoTrade
      ? null
      : `${pnl >= 0 ? '+' : '-'}$${formatNumber(Math.abs(pnl), 2)}`;
  return (
    <div className="relative">
      <div
        className="w-[36px] h-[36px] rounded-[5px] cursor-pointer transition-transform hover:scale-110 hover:ring-1 hover:ring-[var(--text-secondary)]/40"
        style={
          isNoTrade
            ? { backgroundColor: 'var(--border-color)', opacity: 0.5 }
            : { backgroundColor: bg }
        }
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered && (
        <div className="absolute z-30 bottom-full left-0 mb-1.5 pointer-events-none whitespace-nowrap">
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-base)] px-2.5 py-1.5 shadow-lg">
            <div className="text-[11px] font-medium text-[var(--text-primary)]">{dateStr}</div>
            {pnlStr ? (
              <div
                className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  isWin ? 'text-bulk-green' : 'text-bulk-red',
                )}
              >
                {pnlStr}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--text-tertiary)]">No trades</div>
            )}
          </div>
          {/* little downward arrow, aligned to the cell on the left */}
          <div className="absolute top-full left-[12px] -mt-px border-4 border-transparent border-t-[var(--border-color)]" />
        </div>
      )}
    </div>
  );
}

function PnlCalendarHeatmap({ closedPositions, dailyOverride }: { closedPositions: ClosedPosition[]; dailyOverride?: Map<string, number> | null }) {
  // Wallets with only OPEN positions have no closed trades, so instead of a dead
  // "No trade history" we fall back to a daily PnL derived from the reconstructed
  // (mark-to-market) curve, passed in as dailyOverride.
  const useOverride = closedPositions.length === 0 && !!dailyOverride && dailyOverride.size > 0;

  if (closedPositions.length === 0 && !useOverride) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
        <div>
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No trade history yet</p>
          <p className="text-xs mt-1">Daily PnL appears once the wallet has trades</p>
        </div>
      </div>
    );
  }

  // Bucket positions by day (YYYY-MM-DD in local time). Use a Map so
  // insertion order is irrelevant — we collect all days then render.
  const dayBuckets = new Map<string, number>();
  let earliest = Infinity;
  let latest = -Infinity;
  const noteDay = (dayKey: string, ms: number) => {
    if (ms < earliest) earliest = ms;
    if (ms > latest) latest = ms;
  };
  if (useOverride) {
    for (const [dayKey, pnl] of dailyOverride!) {
      dayBuckets.set(dayKey, (dayBuckets.get(dayKey) || 0) + pnl);
      const [y, mo, da] = dayKey.split('-').map(Number);
      noteDay(dayKey, new Date(y, mo - 1, da).getTime());
    }
  } else for (const p of closedPositions) {
    // Guard against ns-precision timestamps slipping through un-converted
    // (BULK ships closeTime in nanoseconds; if any path forgets the ÷1e6
    // the date lands in the far future and the whole heatmap renders
    // empty/blank). Anything past year ~5000 in ms is certainly ns.
    const closedMs = p.closedAt > 1e15 ? p.closedAt / 1e6 : p.closedAt;
    if (!closedMs || Number.isNaN(closedMs)) continue;
    const d = new Date(closedMs);
    // Normalize to start-of-day in local time so all timestamps that
    // fall on the same calendar day bucket together.
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dayBuckets.set(dayKey, (dayBuckets.get(dayKey) || 0) + p.realizedPnl);
    noteDay(dayKey, closedMs);
  }

  // If every position was filtered out (all bad timestamps), show the
  // empty state rather than rendering a blank grid from Infinity bounds.
  if (dayBuckets.size === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
        <div>
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No dated trade history</p>
          <p className="text-xs mt-1">Calendar appears once trades have valid close times</p>
        </div>
      </div>
    );
  }

  // Window: from the wallet's first trade day to "today" so we have a
  // continuous strip even on days with no activity. Bound the start at
  // most ~14 months back so a 5000-trade wallet doesn't try to render
  // a years-long heatmap (still useful but starts to lose density).
  const earliestDate = new Date(earliest);
  earliestDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Cap range at 420 days back (~14 months) to keep render bounded.
  const fourteenMonthsAgo = new Date(today);
  fourteenMonthsAgo.setDate(fourteenMonthsAgo.getDate() - 420);
  const rangeStart = earliestDate > fourteenMonthsAgo ? earliestDate : fourteenMonthsAgo;
  // Align rangeStart to the previous Monday so columns are full weeks.
  const startDow = rangeStart.getDay(); // 0=Sun, 1=Mon, ...
  const daysToBackUp = startDow === 0 ? 6 : startDow - 1;
  rangeStart.setDate(rangeStart.getDate() - daysToBackUp);

  // Build an array of weeks, each week is an array of 7 day entries.
  const weeks: Array<Array<{ date: Date; key: string; pnl: number | null; isFuture: boolean }>> = [];
  const cursor = new Date(rangeStart);
  while (cursor <= today) {
    const week: Array<{ date: Date; key: string; pnl: number | null; isFuture: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const isFuture = date > today;
      const pnl = isFuture ? null : (dayBuckets.get(key) ?? 0);
      week.push({ date, key, pnl, isFuture });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // Color intensity: cap at the 90th percentile of absolute daily PnL
  // to avoid one outlier day swamping the color scale. Days at or above
  // the cap get full saturation, lesser days get proportional opacity.
  const absValues = Array.from(dayBuckets.values()).map(Math.abs).sort((a, b) => a - b);
  const cap = absValues.length > 0 ? absValues[Math.min(absValues.length - 1, Math.floor(absValues.length * 0.9))] : 0;
  const intensity = (pnl: number): number => {
    if (cap === 0) return 0;
    return Math.min(1, Math.abs(pnl) / cap);
  };

  // Month labels — sample one column per visible month change for the
  // bottom axis. Track which month each week's first day belongs to;
  // when it differs from the previous, emit a label for that column.
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  weeks.forEach((week, col) => {
    const firstDay = week[0].date;
    if (firstDay.getMonth() !== lastMonth) {
      monthLabels.push({
        col,
        label: firstDay.toLocaleDateString('en-US', { month: 'short' }),
      });
      lastMonth = firstDay.getMonth();
    }
  });

  // Summary stats for the strip above the heatmap.
  let totalWins = 0;
  let totalLosses = 0;
  let bestDay = 0;
  let worstDay = 0;
  for (const pnl of dayBuckets.values()) {
    if (pnl > 0) totalWins++;
    else if (pnl < 0) totalLosses++;
    if (pnl > bestDay) bestDay = pnl;
    if (pnl < worstDay) worstDay = pnl;
  }

  // Per-day PnL bars for the panel beside the heatmap — the days that actually
  // traded, chronological. Turns the empty right half into a real readout.
  const dailyBars = Array.from(dayBuckets.entries())
    .filter(([, pnl]) => pnl !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, pnl]) => ({ label: key.slice(5).replace('-', '/'), pnl }));

  return (
    <div className="flex-1 p-4 min-h-[420px]">
      {/* Summary strip — gives context for the heatmap below. */}
      <div className="flex items-center gap-6 mb-4 text-xs flex-wrap">
        <div>
          <span className="text-[var(--text-tertiary)]">Winning Days </span>
          <span className="text-bulk-green font-mono font-semibold tabular-nums">{totalWins}</span>
        </div>
        <div>
          <span className="text-[var(--text-tertiary)]">Losing Days </span>
          <span className="text-bulk-red font-mono font-semibold tabular-nums">{totalLosses}</span>
        </div>
        <div>
          <span className="text-[var(--text-tertiary)]">Best Day </span>
          <span className="text-bulk-green font-mono font-semibold tabular-nums">
            +${formatCompact(bestDay)}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-tertiary)]">Worst Day </span>
          <span className="text-bulk-red font-mono font-semibold tabular-nums">
            -${formatCompact(Math.abs(worstDay))}
          </span>
        </div>
      </div>

      {/* Heatmap grid. Each column = one week (Mon top → Sun bottom).
          GitHub-contributions model: fixed-size cells (14px) with fixed
          gaps, left-aligned. Cells do NOT stretch to fill the panel - a
          wallet with one week of data shows a few small squares in the
          corner, not giant blocks. The panel scrolls horizontally if a
          very long history overflows. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      <div className="shrink-0">
        <div className="inline-flex items-start gap-2">
          {/* Weekday labels — 14px rows + 3px gaps to line up with cells. */}
          <div className="flex flex-col gap-[5px] shrink-0 pr-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div
                key={d}
                className="h-[36px] text-[10px] text-[var(--text-tertiary)] leading-[36px] tabular-nums"
                style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}
              >
                {d}
              </div>
            ))}
          </div>
          {/* Week columns — 36px cells, 5px gaps. */}
          <div className="flex gap-[5px]">
            {weeks.map((week, col) => (
              <div key={col} className="flex flex-col gap-[5px]">
                {week.map((day, row) => {
                  if (day.isFuture) {
                    return <div key={row} className="w-[36px] h-[36px]" />;
                  }
                  const i = day.pnl !== null && day.pnl !== 0 ? intensity(day.pnl) : 0;
                  const isWin = day.pnl !== null && day.pnl > 0;
                  const isNoTrade = day.pnl === 0;
                  const bg = isNoTrade
                    ? undefined
                    : isWin
                      ? `rgb(var(--pos-rgb) / ${0.2 + i * 0.8})`
                      : `rgb(var(--neg-rgb) / ${0.2 + i * 0.8})`;
                  return (
                    <HeatmapCell
                      key={row}
                      date={day.date}
                      pnl={day.pnl}
                      bg={bg}
                      isNoTrade={isNoTrade}
                      isWin={isWin}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* Month labels — fixed 17px per column (14px cell + 3px gap). */}
        <div className="flex mt-2 text-[10px] text-[var(--text-tertiary)] tabular-nums uppercase tracking-wider" style={{ marginLeft: "41px" }}>
          {monthLabels.map((m, idx) => {
            const nextCol = idx + 1 < monthLabels.length ? monthLabels[idx + 1].col : weeks.length;
            const widthCols = nextCol - m.col;
            return (
              <div key={`${m.col}-${m.label}`} style={{ width: `${widthCols * 41}px` }}>
                {m.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily-PnL bars — fills the space beside the heatmap with a real
          readout of each trading day's realized PnL, green up / red down. */}
      {dailyBars.length > 0 && (
        <div className="min-w-0 flex-1 lg:min-h-[220px]">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Daily PnL</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyBars} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="label" tick={{ fill: 'var(--text-tertiary)', fontSize: 9 }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`} tick={{ fill: 'var(--text-tertiary)', fontSize: 9 }} axisLine={false} tickLine={false} width={40} />
              <ReferenceLine y={0} stroke="var(--border-color)" />
              <Tooltip
                cursor={{ fill: 'var(--text-primary)', opacity: 0.05 }}
                contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={(v: number) => [<span style={{ color: v >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{v >= 0 ? '+' : '-'}${formatNumber(Math.abs(v), 2)}</span>, 'PnL']}
              />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {dailyBars.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? 'var(--pos)' : 'var(--neg)'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      </div>
    </div>
  );
}

// Shared empty state for the chart-body views.
function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
      <div>
        <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>{label}</p>
      </div>
    </div>
  );
}

// Drawdown of the cumulative-PnL curve (peak-to-current), from the same
// derived `history` series the PnL line chart uses.
function DrawdownChart({ history, address }: { history: WalletData['history']; address?: string }) {
  const data = useMemo(() => {
    let peak = -Infinity;
    return history.map((h) => {
      const cum = (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0);
      peak = Math.max(peak, cum);
      return { timestamp: h.timestamp, dd: cum - peak };
    });
  }, [history]);
  // One x-axis tick per calendar day — otherwise recharts labels adjacent
  // points that fall on the SAME day and prints "Sep 5 · Sep 5 · Sep 6 · Sep 6".
  const dayTicks = useMemo(() => {
    const seen = new Set<string>();
    const ticks: Array<(typeof data)[number]['timestamp']> = [];
    for (const d of data) {
      const dt = new Date(d.timestamp);
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      if (!seen.has(key)) { seen.add(key); ticks.push(d.timestamp); }
    }
    return ticks;
  }, [data]);
  if (!history.length) return <ChartEmpty label="No history data yet" />;
  return (
    <div className="flex-1 p-4 min-h-[420px]">
      <ChartFrame title="Drawdown" className="h-full" yLabel="Drawdown (USD)" walletAddress={address}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--neg)" stopOpacity={0} />
                <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.3} />
              </linearGradient>
              <pattern id="ddHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--role-content)" strokeWidth="0.6" strokeOpacity={0.06} />
              </pattern>
            </defs>
            <XAxis dataKey="timestamp" ticks={dayTicks} tickFormatter={(ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} minTickGap={20} />
            <YAxis tickFormatter={(v) => (v === 0 ? '$0' : `-$${formatCompact(Math.abs(v))}`)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} domain={[(min: number) => (min < 0 ? min * 1.1 : -1), 0]} />
            <Tooltip
              cursor={{ stroke: 'var(--text-tertiary)', strokeOpacity: 0.3 }}
              contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--text-secondary)' }}
              itemStyle={{ color: 'var(--text-primary)' }}
              labelFormatter={(ts) => new Date(ts).toLocaleDateString('en-US')}
              formatter={(v: number) => [Math.abs(v) < 0.005 ? '$0.00' : `-$${formatNumber(Math.abs(v), 2)}`, 'Drawdown']}
            />
            <Area type="monotone" dataKey="dd" stroke="var(--neg)" strokeWidth={2} fill="url(#ddGrad)" />
            <Area type="monotone" dataKey="dd" stroke="none" fill="url(#ddHatch)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

// Per-trade realized PnL — one bar per closed position, chronological.
function PerTradeChart({ closedPositions, address }: { closedPositions: ClosedPosition[]; address?: string }) {
  const data = useMemo(() =>
    [...closedPositions].sort((a, b) => a.closedAt - b.closedAt).map((p, i) => ({ i, v: p.realizedPnl })),
  [closedPositions]);
  if (!data.length) return <ChartEmpty label="No closed trades yet" />;
  return (
    <div className="flex-1 p-4 min-h-[420px]">
      <ChartFrame title="Per-Trade PnL" className="h-full" yLabel="Trade PnL (USD)" walletAddress={address}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="i" tick={false} axisLine={{ stroke: 'var(--border-color)' }} />
            <YAxis tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} />
            <Tooltip
              cursor={{ fill: 'var(--text-tertiary)', fillOpacity: 0.1 }}
              contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--text-secondary)' }}
              itemStyle={{ color: 'var(--text-primary)' }}
              labelFormatter={() => ''}
              formatter={(v: number) => [`${v >= 0 ? '+' : '-'}$${formatNumber(Math.abs(v), 2)}`, 'Trade PnL']}
            />
            <ReferenceLine y={0} stroke="var(--border-color)" />
            <Bar dataKey="v" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.v >= 0 ? 'var(--pos)' : 'var(--neg)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
// ----------------------------------------------------------------------------
// Dense strip primitives
//
// The wallet page's "now" and "performance" readouts are laid out as ONE
// bordered panel split into cells by hairlines, not as a row of padded cards.
// Cards spend ~40% of the main column on padding and give every number equal
// weight; hairline cells pack ~2× the information per screen and let the big
// mono figure carry the hierarchy on its own. Same density the BULK exchange
// itself runs at.
// ----------------------------------------------------------------------------
function StripCell({
  label,
  value,
  tone = 'neutral',
  sub,
  children,
  className,
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: 'green' | 'red' | 'orange' | 'neutral' | 'muted';
  /** One or two short context lines under the figure. */
  sub?: ReactNode;
  /** Optional inline viz (bar) between the figure and the sub line. */
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  const color =
    tone === 'green' ? 'var(--pos)' :
    tone === 'red' ? 'var(--neg)' :
    tone === 'orange' ? 'var(--warn, var(--neg))' :
    tone === 'muted' ? 'var(--role-content-subtle)' :
    'var(--role-content)';
  return (
    <div className={cn('min-w-0 px-4 py-3 flex flex-col gap-1.5', className)} title={title}>
      <div className="t-label truncate">{label}</div>
      <div className="font-mono text-[19px] sm:text-[22px] leading-none font-medium tabular-nums tracking-tight truncate" style={{ color }}>
        {value}
      </div>
      {children}
      {sub && <div className="text-[11px] leading-snug text-[var(--role-content-muted)] truncate">{sub}</div>}
    </div>
  );
}

/** Thin track with one fill (and an optional second fill from the right). */
/** Label/value row for the rail ledger. Hairlines come from the parent `divide-y`. */
function LedgerRow({
  label,
  hint,
  value,
  tone = 'neutral',
  title,
}: {
  label: string;
  /** Small muted qualifier after the label, e.g. "14d" or "200 loaded". */
  hint?: string;
  value: ReactNode;
  tone?: 'green' | 'red' | 'neutral' | 'muted';
  title?: string;
}) {
  const color =
    tone === 'green' ? 'var(--pos)' :
    tone === 'red' ? 'var(--neg)' :
    tone === 'muted' ? 'var(--role-content-subtle)' :
    'var(--role-content)';
  return (
    <div className="flex items-baseline justify-between gap-3 py-[7px] text-[13px]" title={title}>
      <span className="min-w-0 truncate text-[var(--role-content-muted)]">
        {label}
        {hint && <span className="ml-1.5 text-[10px] text-[var(--role-content-subtle)]">{hint}</span>}
      </span>
      <span className="shrink-0 font-mono tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function LedgerSection({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="pt-3">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <h3 className="t-label">{title}</h3>
        {aside && <span className="text-[10px] text-[var(--role-content-subtle)]">{aside}</span>}
      </div>
      <div className="divide-y divide-[var(--role-line-subtle)]">{children}</div>
    </section>
  );
}
// ----------------------------------------------------------------------------
// PerformanceStrip — the numbers that belong WITH the PnL curve.
//
// Return · Drawdown · Sharpe · Best day · Worst day · Up days, all derived from
// the same series the chart plots (fills + 1h marks when reconstructable),
// then a one-line PnL split (trading / funding / fees) and trade stats. Every
// figure says what it was computed from — the honest version of the headline.
// ----------------------------------------------------------------------------
function PerformanceStrip({
  series,
  source,
  daily,
  margin,
  closedPositions,
  analysisStats,
  tradeCount,
  compact = false,
}: {
  series: { t: number; v: number }[];
  source: 'reconstructed' | 'realized' | 'snapshot';
  daily: Map<string, number> | null;
  margin: { totalBalance: number; realizedPnl: number; unrealizedPnl: number; fees: number; funding: number } | null | undefined;
  closedPositions: ClosedPosition[];
  analysisStats: { closedWinRate: number | null; longestStreak: number };
  tradeCount: number;
  /** Cockpit mode: the six figures on one line, the split on the next. */
  compact?: boolean;
}) {
  const m = useMemo(() => {
    const last = series.length ? series[series.length - 1].v : 0;
    const equityNow = margin?.totalBalance ?? 0;
    // Starting equity implied by today's balance minus everything earned since
    // the first point — i.e. the capital the curve was earned on. Deposits in
    // between shift it; labelled as such.
    const base = equityNow - last;
    const ret = base > 0 && series.length >= 2 ? last / base : null;

    // Max drawdown of EQUITY (base + cumulative PnL), peak → trough, with dates.
    let peak = -Infinity, peakT = 0, dd = 0, ddFrom = 0, ddTo = 0;
    if (base > 0) {
      for (const p of series) {
        const eq = base + p.v;
        if (eq > peak) { peak = eq; peakT = p.t; }
        if (peak > 0) {
          const d = (peak - eq) / peak;
          if (d > dd) { dd = d; ddFrom = peakT; ddTo = p.t; }
        }
      }
    }

    // Daily returns on the running equity → annualised Sharpe. Needs 14
    // complete days or it is mostly noise; say so instead of printing one.
    const days = daily ? Array.from(daily.entries()).sort((a, b) => a[0].localeCompare(b[0])) : [];
    let sharpe: number | null = null;
    if (days.length >= 14 && base > 0) {
      let eq = base;
      const rets: number[] = [];
      for (const [, pnl] of days) { rets.push(pnl / Math.max(1, eq)); eq += pnl; }
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1));
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : null;
    }
    let best: [string, number] | null = null, worst: [string, number] | null = null, up = 0, down = 0, flat = 0;
    for (const d of days) {
      if (!best || d[1] > best[1]) best = d;
      if (!worst || d[1] < worst[1]) worst = d;
      if (d[1] > 0.005) up++; else if (d[1] < -0.005) down++; else flat++;
    }
    const gp = closedPositions.filter((p) => p.realizedPnl > 0).reduce((s, p) => s + p.realizedPnl, 0);
    const gl = Math.abs(closedPositions.filter((p) => p.realizedPnl < 0).reduce((s, p) => s + p.realizedPnl, 0));
    const profitFactor = gp === 0 && gl === 0 ? null : gl > 0 ? gp / gl : Infinity;
    return { ret, base, dd, ddFrom, ddTo, sharpe, dayCount: days.length, best, worst, up, down, flat, profitFactor };
  }, [series, daily, margin?.totalBalance, closedPositions]);

  const fmtDay = (key: string) => {
    const [y, mo, d] = key.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const fmtT = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(2)}%`;
  const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${formatCompact(Math.abs(v))}`;
  const since = series.length ? fmtT(series[0].t) : null;
  const totalDays = m.up + m.down + m.flat;

  // PnL split. margin.realizedPnl is NET (gross + fees + funding), so trading
  // = net − fees − funding; unrealized rides on top.
  const fees = margin?.fees ?? 0;
  const funding = margin?.funding ?? 0;
  const trading = margin ? margin.realizedPnl - fees - funding + margin.unrealizedPnl : null;
  const sourceLabel = source === 'reconstructed' ? 'BULK fills + 1h marks' : source === 'realized' ? 'BULK fills, realized only' : 'collector snapshots';

  if (compact) {
    const F = ({ k, v, tone, title }: { k: string; v: string; tone: 'green' | 'red' | 'neutral' | 'muted'; title?: string }) => (
      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
        <span className="t-label">{k}</span>
        <span className="font-mono text-[12.5px] font-medium tabular-nums" style={{ color: tone === 'green' ? 'var(--pos)' : tone === 'red' ? 'var(--neg)' : tone === 'muted' ? 'var(--role-content-subtle)' : 'var(--role-content)' }}>{v}</span>
      </span>
    );
    return (
      <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-1.5 flex flex-col gap-1 text-[11px]">
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
          <F k="Return" v={m.ret !== null ? pct(m.ret) : '—'} tone={m.ret === null ? 'muted' : m.ret >= 0 ? 'green' : 'red'} title={since ? `since ${since}, on starting equity` : undefined} />
          <F k="Drawdown" v={m.dd > 0 ? `−${(m.dd * 100).toFixed(2)}%` : series.length >= 2 ? '0.00%' : '—'} tone={m.dd > 0 ? 'red' : 'muted'} title={m.dd > 0 ? `${fmtT(m.ddFrom)} → ${fmtT(m.ddTo)}` : undefined} />
          <F k="Sharpe" v={m.sharpe !== null ? m.sharpe.toFixed(2) : `— ${Math.min(m.dayCount, 14)}/14d`} tone={m.sharpe === null ? 'muted' : m.sharpe >= 1 ? 'green' : m.sharpe < 0 ? 'red' : 'neutral'} title="Annualised from daily returns on running equity; needs 14 complete days" />
          <F k="Best" v={m.best && m.best[1] > 0 ? `${usd(m.best[1])} ${fmtDay(m.best[0])}` : '—'} tone={m.best && m.best[1] > 0 ? 'green' : 'muted'} />
          <F k="Worst" v={m.worst && m.worst[1] < 0 ? `${usd(m.worst[1])} ${fmtDay(m.worst[0])}` : '—'} tone={m.worst && m.worst[1] < 0 ? 'red' : 'muted'} />
          <F k="Up days" v={totalDays ? `${m.up}/${totalDays}` : '—'} tone={totalDays ? 'neutral' : 'muted'} />
          <span className="ml-auto text-[10px] text-[var(--role-content-subtle)] whitespace-nowrap">{sourceLabel}{since ? ` · since ${since}` : ''}</span>
        </div>
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
          <F k="Trading" v={trading !== null ? usd(trading) : '—'} tone={trading === null ? 'muted' : trading >= 0 ? 'green' : 'red'} title="Lifetime: realized − fees − funding + unrealized" />
          <F k="Funding" v={margin ? usd(funding) : '—'} tone={!margin ? 'muted' : funding >= 0 ? 'green' : 'red'} />
          <F k="Fees" v={margin ? usd(fees) : '—'} tone={!margin ? 'muted' : fees >= 0 ? 'green' : 'red'} />
          <F k="Profit factor" v={m.profitFactor === null ? '—' : m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)} tone={m.profitFactor === null ? 'muted' : 'neutral'} />
          <span className="ml-auto text-[10px] text-[var(--role-content-subtle)] whitespace-nowrap">lifetime counters · this account only</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-[var(--border-color)] border-b border-[var(--border-color)]">
        <StripCell label="Return" value={m.ret !== null ? pct(m.ret) : '—'} tone={m.ret === null ? 'muted' : m.ret >= 0 ? 'green' : 'red'}
          sub={since ? `since ${since} · on starting equity` : '—'} title="Cumulative PnL over the equity the curve started on (today's balance minus PnL since). Deposits or withdrawals in between shift it." />
        <StripCell label="Drawdown" value={m.dd > 0 ? `−${(m.dd * 100).toFixed(2)}%` : series.length >= 2 ? '0.00%' : '—'} tone={m.dd > 0 ? 'red' : 'muted'}
          sub={m.dd > 0 ? `${fmtT(m.ddFrom)} → ${fmtT(m.ddTo)}` : 'no fall from a prior high'} title="Largest fall of equity below an earlier high on this curve." />
        <StripCell label="Sharpe" value={m.sharpe !== null ? m.sharpe.toFixed(2) : '—'} tone={m.sharpe === null ? 'muted' : m.sharpe >= 1 ? 'green' : m.sharpe < 0 ? 'red' : 'neutral'}
          sub={m.sharpe !== null ? `annualised · ${m.dayCount} days` : `${Math.min(m.dayCount, 14)} of 14 days`} title="Mean ÷ stdev of daily returns on running equity, × √365. Needs 14 complete days." />
        <StripCell label="Best day" value={m.best && m.best[1] > 0 ? usd(m.best[1]) : '—'} tone={m.best && m.best[1] > 0 ? 'green' : 'muted'}
          sub={m.best && m.best[1] > 0 ? fmtDay(m.best[0]) : totalDays ? 'no positive day yet' : '—'} />
        <StripCell label="Worst day" value={m.worst && m.worst[1] < 0 ? usd(m.worst[1]) : '—'} tone={m.worst && m.worst[1] < 0 ? 'red' : 'muted'}
          sub={m.worst && m.worst[1] < 0 ? fmtDay(m.worst[0]) : totalDays ? 'no negative day yet' : '—'} />
        <StripCell label="Up days" value={totalDays ? `${Math.round((m.up / totalDays) * 100)}%` : '—'} tone={totalDays ? 'neutral' : 'muted'}
          sub={totalDays ? `${m.up} of ${totalDays}` : '—'}>
          {totalDays > 0 && (
            <div className="flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--role-surface-raised)]">
              <div style={{ width: `${(m.up / totalDays) * 100}%`, background: 'var(--pos)' }} />
              <div style={{ width: `${(m.flat / totalDays) * 100}%` }} />
              <div style={{ width: `${(m.down / totalDays) * 100}%`, background: 'var(--neg)' }} />
            </div>
          )}
        </StripCell>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 px-4 py-2 text-[11px] border-b border-[var(--border-color)]">
        <span className="inline-flex items-baseline gap-3">
          <span className="t-label">PnL split <span className="normal-case tracking-normal text-[var(--role-content-subtle)]">lifetime</span></span>
          {trading !== null ? (
            <>
              <span className="whitespace-nowrap text-[var(--role-content-muted)]">Trading <b className="font-mono font-medium tabular-nums" style={{ color: trading >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{usd(trading)}</b></span>
              <span className="whitespace-nowrap text-[var(--role-content-muted)]">Funding <b className="font-mono font-medium tabular-nums" style={{ color: funding >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{usd(funding)}</b></span>
              <span className="whitespace-nowrap text-[var(--role-content-muted)]">Fees <b className="font-mono font-medium tabular-nums" style={{ color: fees >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{usd(fees)}</b></span>
            </>
          ) : <span className="text-[var(--role-content-subtle)]">—</span>}
        </span>
        <span className="inline-flex items-baseline gap-3">
          <span className="t-label">Trades</span>
          <span className="whitespace-nowrap text-[var(--role-content-muted)]">Win rate <b className="font-mono font-medium tabular-nums text-[var(--role-content)]">{analysisStats.closedWinRate !== null ? `${(analysisStats.closedWinRate * 100).toFixed(0)}%` : '—'}</b></span>
          <span className="whitespace-nowrap text-[var(--role-content-muted)]">Profit factor <b className="font-mono font-medium tabular-nums text-[var(--role-content)]">{m.profitFactor === null ? '—' : m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}</b></span>
          <span className="whitespace-nowrap text-[var(--role-content-muted)]">Streak <b className="font-mono font-medium tabular-nums text-[var(--role-content)]">{analysisStats.longestStreak || '—'}</b></span>
          <span className="text-[var(--role-content-muted)]"><b className="font-mono font-medium tabular-nums text-[var(--role-content)]">{tradeCount.toLocaleString('en-US')}</b> closed</span>
        </span>
        <span className="ml-auto text-[var(--role-content-subtle)]">{sourceLabel}{since ? ` · since ${since}` : ''} · this account only</span>
      </div>
    </>
  );
}

// ============================================================================
// TRADER TERMINAL
//
// The wallet page is a single-viewport cockpit, not a scrolling dashboard:
//   masthead  — who this is, in one computed sentence
//   ticker    — the "now" numbers in one line
//   panes     — ledger | curve (+ position bands) | positions (keyboard-driven)
//   tape      — the live narrative of what the wallet just did
// Everything fits ≥1024px without scrolling; each pane scrolls inside itself.
// Below lg it stacks in the same order and scrolls normally.
// ============================================================================

type OpenPos = NonNullable<WalletData['live']>['positions'][number];

/** One figure in the ticker line. */
function Tick({ k, v, tone = 'neutral', title }: { k: string; v: ReactNode; tone?: 'green' | 'red' | 'orange' | 'neutral' | 'muted'; title?: string }) {
  const color =
    tone === 'green' ? 'var(--pos)' : tone === 'red' ? 'var(--neg)' : tone === 'orange' ? 'var(--warn, var(--neg))' :
    tone === 'muted' ? 'var(--role-content-subtle)' : 'var(--role-content)';
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
      <span className="t-label">{k}</span>
      <span className="font-mono text-[13px] font-medium tabular-nums" style={{ color }}>{v}</span>
    </span>
  );
}

/**
 * Who this trader is, as one factual sentence built only from clauses the
 * data supports. No adjectives the numbers didn't earn.
 */
function buildVerdict(args: {
  fills: WalletFill[];
  address: string;
  style: string;
  leverage: number | null;
  longPct: number | null;
  openCount: number;
  trading: number | null;
  fees: number | null;
  liqs: number;
  cohort: string;
}): string {
  const { fills, address, style, leverage, longPct, openCount, trading, fees, liqs, cohort } = args;
  const parts: string[] = [];
  // Role: maker vs taker from the loaded fills.
  const makerShare = fills.length ? fills.filter((f) => f.maker === address).length / fills.length : null;
  const byMarket = new Map<string, number>();
  for (const f of fills) byMarket.set(f.symbol, (byMarket.get(f.symbol) ?? 0) + Math.abs(f.size) * f.price);
  const top = [...byMarket.entries()].sort((a, b) => b[1] - a[1])[0];
  const totalVol = [...byMarket.values()].reduce((s, v) => s + v, 0);
  const lead = top && totalVol > 0 ? `${top[0].replace(/-USD$/, '')}${top[1] / totalVol >= 0.5 ? '-led' : '-leaning'}` : null;
  const role = makerShare === null ? null : makerShare >= 0.8 ? 'maker' : makerShare <= 0.2 ? 'taker' : 'mixed-flow';
  const head = [style !== 'Unknown' ? style.toLowerCase() : null, lead, role ? `${role} across ${byMarket.size} market${byMarket.size === 1 ? '' : 's'}` : null].filter(Boolean).join(' ');
  if (head) parts.push(head.charAt(0).toUpperCase() + head.slice(1));
  if (openCount > 0 && leverage !== null && longPct !== null) {
    const bias = longPct >= 0.6 ? 'net long' : longPct <= 0.4 ? 'net short' : 'balanced';
    parts.push(`${bias} at ${leverage.toFixed(1)}× across ${openCount} open`);
  } else if (openCount === 0) parts.push('flat right now');
  if (makerShare !== null && fills.length >= 50) parts.push(`${Math.round(makerShare * 100)}% maker fills`);
  if (trading !== null && fees !== null && (Math.abs(trading) > 1 || Math.abs(fees) > 1)) {
    const t = `${trading >= 0 ? '+' : '−'}$${formatCompact(Math.abs(trading))} trading`;
    const f = fees >= 0 ? `+$${formatCompact(fees)} rebates` : `−$${formatCompact(Math.abs(fees))} fees`;
    parts.push(`${t}, ${f}`);
  }
  if (liqs > 0) parts.push(`${liqs.toLocaleString('en-US')} liquidation${liqs === 1 ? '' : 's'}`);
  if (parts.length === 0) parts.push(`${cohort} wallet with no recorded trading yet`);
  return parts.join(' · ');
}

/**
 * Right pane: the live list. One row per open position with a 24h price
 * sparkline oriented to the position's side, keyboard-navigable (j/k, ↵
 * opens the chart, s opens the share card, esc clears). Tabs swap the list
 * for closed trades, liquidations and the account activity feed.
 */
function PositionsPane({
  address,
  positions,
  markPrices,
  klinesBySymbol,
  openTimes,
  closedPositions,
  tab,
  onTab,
  selected,
  onSelect,
  onOpenChart,
  onShare,
  onSelectClosed,
  loading,
}: {
  address: string;
  positions: OpenPos[];
  markPrices: Record<string, number>;
  klinesBySymbol: Record<string, Candle[]>;
  openTimes: Record<string, PositionOpenInfo | null>;
  closedPositions: ClosedPosition[];
  tab: 'open' | 'recent' | 'liquidations' | 'activity';
  onTab: (t: 'open' | 'recent' | 'liquidations' | 'activity') => void;
  selected: number;
  onSelect: (i: number) => void;
  onOpenChart: (p: OpenPos) => void;
  onShare: (symbol: string) => void;
  onSelectClosed: (p: ClosedPosition) => void;
  loading: boolean;
}) {
  const rows = useMemo(() => [...positions].sort((a, b) => Math.abs(b.notional || 0) - Math.abs(a.notional || 0)), [positions]);
  return (
    <section className="flex flex-col min-h-0 min-w-0 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)]" aria-label="Positions">
      <div className="px-3 border-b border-[var(--border-color)] flex items-end justify-between gap-2 shrink-0">
        <div className="flex items-end -mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
          {([
            ['open', 'Open', positions.length],
            ['recent', 'Closed', closedPositions.length],
            ['liquidations', 'Liqs', null],
            ['activity', 'Activity', null],
          ] as const).map(([k, label, count]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => onTab(k)}
              className={cn('px-2.5 pt-2.5 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] border-b-2 transition-colors inline-flex items-baseline gap-1.5 whitespace-nowrap',
                tab === k ? 'border-[var(--accent)] text-[var(--role-content)]' : 'border-transparent text-[var(--role-content-subtle)] hover:text-[var(--role-content-muted)]')}>
              {label}{count !== null && count > 0 && <span className="font-mono tabular-nums text-[10px] text-[var(--role-content-subtle)]">{count}</span>}
            </button>
          ))}
        </div>
        {tab === 'open' && rows.length > 0 && (
          <span className="hidden xl:inline pb-2 font-mono text-[10px] text-[var(--role-content-subtle)] whitespace-nowrap">j/k · ↵ chart · s share</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {tab === 'open' ? (
          loading && rows.length === 0 ? (
            <div className="p-4 text-[12px] text-[var(--role-content-muted)] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />Fetching positions…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-[var(--role-content-subtle)]">Flat — no open positions</div>
          ) : (
            <ul className="divide-y divide-[var(--role-line-subtle)]" role="listbox" aria-label="Open positions">
              {rows.map((p, i) => {
                const isLong = p.size > 0;
                const mark = markPrices[p.symbol] || p.price;
                const notional = Math.abs(p.size * mark);
                const pnlPct = notional ? (p.unrealizedPnl / notional) * 100 : 0;
                const liqDist = p.liquidationPrice && mark ? Math.max(0, (isLong ? (mark - p.liquidationPrice) / mark : (p.liquidationPrice - mark) / mark)) : null;
                const spark = (klinesBySymbol[p.symbol] ?? []).slice(-24).map((c) => c.c);
                const opened = openTimes[p.symbol];
                const sel = i === selected;
                return (
                  <li key={p.symbol} role="option" aria-selected={sel}
                    onMouseEnter={() => onSelect(i)}
                    onClick={() => { onSelect(i); onOpenChart(p); }}
                    className={cn('relative flex flex-col gap-1 px-3 py-2 cursor-pointer transition-colors',
                      sel ? 'bg-[var(--role-surface-raised)]' : 'hover:bg-[var(--role-surface-raised)]/60')}>
                    {sel && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent)]" aria-hidden />}
                    {/* Line 1: side · market · leverage ……… notional · uPnL */}
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className={cn('w-[38px] shrink-0 text-center py-0.5 rounded-sm text-[9px] font-semibold tracking-wider leading-none', isLong ? 'bg-bulk-green/15 text-bulk-green' : 'bg-bulk-red/15 text-bulk-red')}>{isLong ? 'LONG' : 'SHORT'}</span>
                      <span className="font-medium text-[13px] text-[var(--role-content)] whitespace-nowrap">{p.symbol.replace(/-USD$/, '')}</span>
                      <span className="font-mono text-[10px] text-[var(--role-content-subtle)]">{p.leverage}×</span>
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--role-content-muted)] whitespace-nowrap">${formatCompact(notional)}</span>
                      <span className="w-[76px] text-right font-mono text-[13px] font-medium tabular-nums whitespace-nowrap" style={{ color: p.unrealizedPnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {p.unrealizedPnl >= 0 ? '+' : '−'}${formatNumber(Math.abs(p.unrealizedPnl), 2)}
                      </span>
                    </div>
                    {/* Line 2: entry→mark · liq distance · age ……… sparkline · % */}
                    <div className="flex items-center gap-2 min-w-0 font-mono text-[10px] tabular-nums text-[var(--role-content-subtle)]">
                      <span className="whitespace-nowrap truncate">{formatNumber(p.price, p.price < 1 ? 4 : p.price < 100 ? 2 : 0)} → {formatNumber(mark, mark < 1 ? 4 : mark < 100 ? 2 : 0)}</span>
                      {liqDist !== null && <span className="whitespace-nowrap" style={{ color: liqDist < 0.05 ? 'var(--neg)' : liqDist < 0.15 ? 'var(--warn, var(--neg))' : undefined }}>liq {(liqDist * 100).toFixed(1)}%</span>}
                      {opened && <span className="whitespace-nowrap">{formatDuration(Date.now() - opened.openedAt)}</span>}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="w-14 h-5 hidden sm:block" aria-hidden>
                          {spark.length >= 2 && <Sparkline data={spark} width={56} height={20} color={p.unrealizedPnl >= 0 ? 'var(--pos)' : 'var(--neg)'} />}
                        </span>
                        <span className="w-[52px] text-right whitespace-nowrap" style={{ color: p.unrealizedPnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatPercent(pnlPct)}</span>
                        <button type="button" title="Share card" aria-label={`Share ${p.symbol}`} onClick={(e) => { e.stopPropagation(); onShare(p.symbol); }}
                          className="p-0.5 -mr-1 rounded text-[var(--role-content-subtle)] hover:text-[var(--accent)] transition-colors">
                          <ImageIcon className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : tab === 'recent' ? (
          <ClosedPositionsList address={address} provided={closedPositions} limit={100} density="table" onSelect={onSelectClosed} />
        ) : tab === 'liquidations' ? (
          <RiskEventsList address={address} bare />
        ) : (
          <ActivityFeed address={address} />
        )}
      </div>
    </section>
  );
}

/**
 * Position bands under the curve: one thin bar per open position from the
 * moment it opened to now, on the SAME time axis as the visible chart, so you
 * can read "this leg of the curve happened while BTC was open" directly.
 */
function PositionBands({ positions, openTimes, t0, t1, selectedSymbol }: {
  positions: OpenPos[]; openTimes: Record<string, PositionOpenInfo | null>; t0: number; t1: number; selectedSymbol?: string | null;
}) {
  const span = Math.max(1, t1 - t0);
  const bands = positions
    .map((p) => ({ p, open: openTimes[p.symbol]?.openedAt ?? null }))
    .filter((b): b is { p: OpenPos; open: number } => b.open !== null && b.open <= t1)
    .sort((a, b) => a.open - b.open);
  if (bands.length === 0) return null;
  return (
    <div className="px-3 pb-1.5 pt-1 flex flex-col gap-[2px] shrink-0 border-t border-[var(--role-line-subtle)]" aria-label="Open positions on the time axis" title="When each open position was opened, on the curve's time axis">
      {bands.map(({ p, open }) => {
        const left = Math.max(0, (open - t0) / span) * 100;
        const isLong = p.size > 0;
        const sel = selectedSymbol === p.symbol;
        const labelBefore = left >= 10;
        return (
          <div key={p.symbol} className="relative h-[7px] w-full" title={`${p.symbol} ${isLong ? 'long' : 'short'} since ${new Date(open).toLocaleString('en-US')}`}>
            <div className="absolute top-[3px] h-[2px] rounded-full" style={{ left: `${left}%`, right: 0, background: isLong ? 'var(--pos)' : 'var(--neg)', opacity: sel ? 1 : 0.5 }} />
            <span className="absolute top-[-1px] font-mono text-[8px] leading-[9px] tabular-nums whitespace-nowrap"
              style={labelBefore
                ? { right: `calc(${100 - left}% + 4px)`, color: sel ? 'var(--role-content)' : 'var(--role-content-subtle)' }
                : { left: `calc(${left}% + 4px)`, color: sel ? 'var(--role-content)' : 'var(--role-content-subtle)', background: 'var(--bg-muted)', paddingInline: 2 }}>
              {p.symbol.replace(/-USD$/, '')}{open < t0 ? ' ←' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The bottom tape: what the wallet just did, newest first, one line each. */
type TapeEvent = { t: number; kind: 'open' | 'close' | 'liq'; text: string; amount?: number };
function buildTape(closed: ClosedPosition[], positions: OpenPos[], openTimes: Record<string, PositionOpenInfo | null>, limit = 40): TapeEvent[] {
  const ev: TapeEvent[] = [];
  for (const p of closed) {
    ev.push({
      t: p.closedAt,
      kind: p.liquidated ? 'liq' : 'close',
      text: `${p.liquidated ? 'liquidated' : 'closed'} ${p.symbol.replace(/-USD$/, '')} ${p.side} · held ${formatDuration(Math.max(0, p.closedAt - p.openedAt))}`,
      amount: p.realizedPnl,
    });
  }
  for (const p of positions) {
    const o = openTimes[p.symbol];
    if (o) ev.push({ t: o.openedAt, kind: 'open', text: `opened ${p.symbol.replace(/-USD$/, '')} ${p.size > 0 ? 'long' : 'short'} · $${formatCompact(Math.abs(p.size * p.price))} at ${p.leverage}×` });
  }
  return ev.sort((a, b) => b.t - a.t).slice(0, limit);
}

function Tape({ events, expanded, onToggle }: { events: TapeEvent[]; expanded: boolean; onToggle: () => void }) {
  const fmt = (t: number) => {
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const glyph = (k: TapeEvent['kind']) => k === 'open' ? '●' : k === 'liq' ? '⚠' : '○';
  const color = (e: TapeEvent) => e.kind === 'liq' ? 'var(--neg)' : e.amount === undefined ? 'var(--role-content-muted)' : e.amount >= 0 ? 'var(--pos)' : 'var(--neg)';
  return (
    <section className={cn('bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)] min-w-0 flex flex-col', expanded ? 'max-h-[40vh]' : '')} aria-label="Tape">
      <div className="flex items-center gap-3 px-3 h-8 shrink-0">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 t-label !text-[var(--role-content)] hover:text-[var(--accent)] transition-colors" aria-expanded={expanded}>
          Tape <span className="text-[var(--role-content-subtle)]">{expanded ? '▴' : '▸'}</span>
        </button>
        {events.length === 0 ? (
          <span className="text-[11px] text-[var(--role-content-subtle)]">Nothing recorded yet</span>
        ) : !expanded ? (
          <div className="flex-1 min-w-0 flex items-center gap-5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[11px]">
            {events.slice(0, 12).map((e, i) => (
              <span key={i} className="inline-flex items-baseline gap-1.5 shrink-0">
                <span className="font-mono text-[10px] text-[var(--role-content-subtle)] tabular-nums">{fmt(e.t)}</span>
                <span style={{ color: color(e) }}>{glyph(e.kind)}</span>
                <span className="text-[var(--role-content-muted)]">{e.text}</span>
                {e.amount !== undefined && <span className="font-mono font-medium tabular-nums" style={{ color: color(e) }}>{e.amount >= 0 ? '+' : '−'}${formatCompact(Math.abs(e.amount))}</span>}
              </span>
            ))}
          </div>
        ) : <span className="text-[11px] text-[var(--role-content-subtle)]">{events.length} events</span>}
      </div>
      {expanded && events.length > 0 && (
        <ol className="overflow-y-auto border-t border-[var(--border-color)] divide-y divide-[var(--role-line-subtle)] text-[12px]">
          {events.map((e, i) => (
            <li key={i} className="flex items-baseline gap-3 px-3 py-1.5">
              <span className="font-mono text-[10px] text-[var(--role-content-subtle)] tabular-nums w-[88px] shrink-0">{fmt(e.t)}</span>
              <span style={{ color: color(e) }}>{glyph(e.kind)}</span>
              <span className="text-[var(--role-content-muted)] min-w-0 truncate">{e.text}</span>
              {e.amount !== undefined && <span className="ml-auto font-mono font-medium tabular-nums shrink-0" style={{ color: color(e) }}>{e.amount >= 0 ? '+' : '−'}${formatNumber(Math.abs(e.amount), 2)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;
  // Wallet positions/PnL are per-network — refetch when the network changes.
  const { network } = useCurrentNetwork();
  
  const { following, addFollowing, removeFollowing, user, claimedWallet, setClaimedWallet, setUser } = useStore();
  const { authenticated, login, getAccessToken, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Reveal gate: the page's data arrives in several async waves (wallet +
  // positions, fills/volume, BULK rank, then the PnL-chart candles). Revealing
  // on the first wave flashed incomplete numbers ($0 volume, 0 trades, empty
  // chart) that only filled in after a refresh. Instead we hold the animated
  // logo loader until EVERY key wave has landed, then reveal the whole page at
  // once. A safety timeout guarantees we never hang on a slow/failed fetch.
  const [mainDone, setMainDone] = useState(false);
  const [fillsDone, setFillsDone] = useState(false);
  const [rankDone, setRankDone] = useState(false);
  const [revealTimedOut, setRevealTimedOut] = useState(false);
  useEffect(() => {
    setMainDone(false); setFillsDone(false); setRankDone(false); setRevealTimedOut(false);
    // Last-resort reveal cap. The waves now retry until COMPLETE before flipping
    // their done flags, so this only fires if the backend stays down — a longer
    // wait than before, but the user asked for complete info over a fast reveal.
    const t = window.setTimeout(() => setRevealTimedOut(true), 55_000);
    return () => window.clearTimeout(t);
  }, [address]);
  const [followLoading, setFollowLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Closed positions used for Tier-1 derived stats (performance bar,
  // win streak, trade durations, PnL/size cohorts). Fetched in parallel
  // with the live wallet data. Backend caches this for 60s so a wallet
  // page that also opens the Recent Trades panel doesn't double-fetch.
  // Empty array while loading or for new wallets — derivations downstream
  // guard against zero-length arrays.
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([]);
  // Raw fills, kept for the fills-reconstructed realized-PnL curve (Step 1 of
  // the accurate PnL rework). Populated by the same /fills fetch that feeds the
  // volume-by-window totals.
  const [allFills, setAllFills] = useState<WalletFill[]>([]);
  // Step 2: hourly klines per traded symbol, used to reconstruct a continuous
  // unrealized-PnL / equity curve (mark price over time × the fill-derived
  // position). Keyed by symbol.
  const [klinesBySymbol, setKlinesBySymbol] = useState<Record<string, Candle[]>>({});

  // Per-wallet stats sourced from BULK's official indexer. This replaces the
  // DB-tracked aggregates (tracked.total_volume / total_trades / total_pnl)
  // which only counted activity since BulkStats started collecting and were
  // expensive to maintain (the trades table grew to >4 GB on disk just to
  // compute these aggregates). BULK's indexer publishes the real numbers
  // for every wallet on the exchange — much more accurate, and lets us
  // stop persisting raw trades for aggregate purposes entirely.
  //
  // null while loading. `found: false` means the wallet isn't in BULK's
  // top ranks (typically because it's never closed a position) — we fall
  // back to the DB tracked numbers in that case so brand-new wallets
  // still see something.
  const [bulkStats, setBulkStats] = useState<BulkLeaderboardRankResponse | null>(null);

  // Position currently being inspected in the price-chart modal. null means
  // closed. Set when the user clicks any position card.
  const [chartPosition, setChartPosition] = useState<PositionForChart | null>(null);

  // Which sub-panel is showing — open positions or recent closed positions.
  // Defaults to whichever has data (we set this in an effect below). User
  // can flick between the two with the segmented control in the panel
  // header. Replaces the older two-panel stacked layout that wasted
  // vertical space.
  const [positionsTab, setPositionsTab] = useState<'open' | 'recent' | 'liquidations' | 'activity'>('open');
  // Terminal: keyboard-selected row in the positions pane, and the tape fold.
  const [selectedPos, setSelectedPos] = useState(-1);
  const [tapeOpen, setTapeOpen] = useState(false);
  // PnL History chart: switch between the line chart ('pnl') and a
  // day-by-day P&L heatmap calendar ('calendar'). Hyperdash signature
  // pattern — gives the user two complementary views of the same data
  // (continuous trend vs day-level resolution).
  const [chartView, setChartView] = useState<'pnl' | 'calendar' | 'drawdown' | 'trade' | 'compare'>('pnl');
  // Hero chart metric: cumulative PnL ('pnl') or the account-value/equity
  // curve ('value'), anchored to the current balance. Only relevant in the
  // 'pnl' view — the other views (drawdown/per-trade) plot their own series.
  const [heroMetric, setHeroMetric] = useState<'pnl' | 'value'>('pnl');
  // Time range filter for the PnL line chart. Affects what slice of
  // history is rendered. Default 'all' so users see the full curve on
  // first load; they can narrow to 24h/7d/30d for recent activity.
  const [chartRange, setChartRange] = useState<'24h' | '7d' | '30d' | 'all'>('all');
  // Tracks which position row's share button was just clicked, to flash a
  // checkmark for ~1.5s as copy confirmation.
  // Share-card state: reconstruct a trade's lifecycle (fills + klines) and open
  // the animated card for it — same card the observe page uses.
  const [cardData, setCardData] = useState<ShareCardData | null>(null);

  // Per-symbol "when did this position open" map. We compute this client-side
  // by walking the wallet's fill history for each symbol — BULK doesn't
  // expose a per-position timestamp on the position object. Null entries
  // mean we tried but couldn't determine (e.g. no fills, or position is
  // older than BULK's 5000-fill window). Undefined means we haven't fetched
  // yet, so the UI shows "—" instead of a wrong value.
  const [positionOpenTimes, setPositionOpenTimes] = useState<
    Record<string, PositionOpenInfo | null>
  >({});

  // Traded volume bucketed by trailing window (7d / 14d / 30d / 90d),
  // derived client-side from the wallet's recent fills. Null while loading.
  const [volByWindow, setVolByWindow] = useState<{ d7: number; d14: number; d30: number; d90: number } | null>(null);

  // Lifetime traded volume, summed from the wallet's OWN fills (both the
  // maker-side and taker-side fills BULK returns for the account). This matches
  // BULK's portfolio figure exactly; our DB total_volume was historically
  // taker-only and undercounts. `truncated` marks a heavy wallet whose fill
  // history hit the fetch cap, so the sum is a lower bound there.
  const [lifetimeFillVol, setLifetimeFillVol] = useState<{ total: number; truncated: boolean } | null>(null);

  // Get current user's wallet address from multiple sources
  const solanaWalletAddress = solanaWallets?.[0]?.address;
  const privyWalletAddress = privyUser?.wallet?.address;
  const linkedSolanaWallet = privyUser?.linkedAccounts?.find(
    (account: any) => account.type === 'wallet' && account.chainType === 'solana'
  ) as any;
  const linkedWalletAddress = linkedSolanaWallet?.address;
  const storeWalletAddress = user?.wallet_address;
  
  // Connected wallet (via Phantom etc)
  const connectedWallet = solanaWalletAddress || privyWalletAddress || linkedWalletAddress || '';
  
  // User's effective wallet (connected OR claimed)
  const currentUserWallet = connectedWallet || claimedWallet || user?.claimed_wallet || storeWalletAddress || '';
  
  // Check if user logged in via email (no connected wallet)
  const emailAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'email'
  );
  const isEmailUser = authenticated && !connectedWallet && !!emailAccount;
  
  // Check if this is user's claimed wallet
  const isClaimedWallet = !!(claimedWallet && address && 
    claimedWallet.toLowerCase() === address.toLowerCase());
  
  // Check if viewing own wallet (connected OR claimed)
  const isOwnWallet = !!(currentUserWallet && address && 
    currentUserWallet.toLowerCase() === address.toLowerCase());
  
  // Can claim: email user, no claimed wallet yet, not viewing already claimed wallet
  const canClaimWallet = isEmailUser && !claimedWallet && !user?.claimed_wallet;
  
  // Check if following this wallet
  const isFollowing = following.some(w => 
    w.wallet_address.toLowerCase() === address.toLowerCase()
  );

  useEffect(() => {
    if (!address) return;
    let cancelledMain = false;

    // One fetch attempt of the main account data. Returns true only when the
    // data we need to render a COMPLETE page actually came back — i.e. the live
    // account loaded AND the closed-position fetch succeeded (a genuine 200,
    // even if empty). The `silent` flag suppresses the spinner on background
    // ticks.
    const fetchData = async (silent: boolean): Promise<boolean> => {
      if (!silent) setError('');
      try {
        // Three parallel fetches:
        //  - wallet.getWallet:        live BULK account + tracked DB row
        //  - userApi.getWalletProfile: claimed username if any
        //  - wallet.getClosedPositions: closed-position history (Recent Trades,
        //    PnL heatmap, per-trade chart, win-rate stats).
        const [walletResult, profileResult, closedResult] = await Promise.all([
          wallet.getWallet(address),
          userApi.getWalletProfile(address).catch(() => ({ profile: null })),
          // null (not { positions: [] }) on failure so a THROWN fetch (network /
          // 429) is distinguishable from a genuine empty.
          wallet.getClosedPositions(address, { limit: 200 }).catch(() => null),
        ]);

        setData(walletResult);
        setProfile((profileResult as any)?.profile || null);
        // Overwrite closed positions when the fetch SUCCEEDED. On a failure
        // (null) keep what we have. On a silent tick only overwrite with a
        // non-empty list (a mid-session empty success is almost always a hiccup).
        if (closedResult && (!silent || (closedResult.positions?.length ?? 0) > 0)) {
          setClosedPositions(closedResult.positions || []);
        }
        // Complete = account came back AND closed-positions fetch succeeded.
        return !!walletResult && closedResult !== null;
      } catch {
        if (!silent) setError('Failed to load wallet data');
        return false;
      }
    };

    // Initial load — keep retrying until the data is COMPLETE before revealing,
    // so the page never flashes a half-empty state that heals on the next poll.
    // The reveal timeout is the ultimate safety net if the backend stays down.
    (async () => {
      setLoading(true);
      let ok = false;
      for (let attempt = 0; attempt < 9 && !cancelledMain && !ok; attempt++) {
        ok = await fetchData(false);
        if (!ok && !cancelledMain) await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
      }
      if (cancelledMain) return;
      await wallet.trackWallet(address).catch(() => {}); // track once, after load
      setLoading(false);
      setMainDone(true); // only now — we have complete data (or exhausted retries)
    })();

    // Background refresh every 10 seconds. Cleared on unmount or when the
    // wallet address changes. We don't visualize the refresh (no spinner,
    // no toast) — positions and PnL just update in place. This is the
    // behavior the BULK dev specifically asked for: live-feeling without
    // user action.
    const tick = window.setInterval(() => fetchData(true), 10_000);
    return () => { cancelledMain = true; window.clearInterval(tick); };
  }, [address, network]);

  // Fetch this wallet's stats from BULK's official indexer. We use the
  // 'all' window with `volume` metric because we want lifetime numbers
  // (the rank-by-volume window has the highest population so the wallet
  // is most likely to be present). The response includes volume,
  // closed_count, realized_pnl, win_rate — everything we need for the
  // header stat cards.
  //
  // Cached server-side for 60s, so this is essentially free to call. The
  // 30s polling matches the wallet's data-refresh cadence so stats stay
  // fresh without hammering the indexer.
  useEffect(() => {
    let cancelled = false;
    const fetchBulkStats = async () => {
      try {
        const res = await leaderboard.getBulkRank(address, {
          window: 'all',
          metric: 'volume',
        });
        if (!cancelled) setBulkStats(res);
      } catch (err) {
        // Indexer down or wallet not ranked — fall back to DB stats below
        if (!cancelled) setBulkStats(null);
      } finally {
        if (!cancelled) setRankDone(true);
      }
    };
    fetchBulkStats();
    const tick = window.setInterval(fetchBulkStats, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [address, network]);

  // Fetch fills for each open position and compute when it was opened.
  // BULK doesn't expose a per-position open timestamp on the position
  // object, so we derive it client-side from the wallet's fill history:
  // walk fills chronologically and find the most recent moment net size
  // went from 0 to non-zero. That timestamp is the position's open time.
  //
  // We fire one /fills request per open symbol. Backend caches 60s so
  // re-renders are cheap. We don't refetch on the 10s tick because open
  // times don't change for an existing position — only when a new one
  // is added or an old one is closed, which the dependency on the
  // joined symbol list handles.
  const openSymbolKey = (data?.live?.positions || [])
    .map((p) => p.symbol)
    .sort()
    .join(',');

  // Derive each open position's open-time from the SINGLE all-fills set we
  // already fetch (allFills), instead of firing one getFills per open position.
  // That per-position fan-out was a burst of BULK /account calls on page load
  // (18+ for a multi-position wallet) that the backend now has to serialize —
  // slow and pointless when allFills already contains these symbols' fills.
  // computePositionOpenTime returns null when the fills don't cover the open
  // (e.g. a master account whose subs traded, or older than the fill window).
  useEffect(() => {
    const positions = data?.live?.positions || [];
    if (positions.length === 0) { setPositionOpenTimes({}); return; }
    if (allFills.length === 0) return; // wait for the fills to land
    const bySymbol: Record<string, WalletFill[]> = {};
    for (const f of allFills) (bySymbol[f.symbol] ??= []).push(f);
    const next: Record<string, PositionOpenInfo | null> = {};
    for (const pos of positions) {
      next[pos.symbol] = computePositionOpenTime(bySymbol[pos.symbol] || []);
    }
    setPositionOpenTimes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSymbolKey, allFills]);

  // Compute traded volume per trailing window from the wallet's recent
  // fills. One unfiltered /fills call (capped at 1000) covers most wallets;
  // for extremely active accounts the longer windows are a lower bound,
  // which we flag in the UI. Volume per fill = |size| × price.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // Retry until the fills fetch succeeds before marking this wave done — the
    // PnL reconstruction, volume windows and position open-times all depend on
    // it, and (unlike the main data) nothing re-fetches fills on a timer, so a
    // one-shot failure would leave those permanently empty.
    (async () => {
      for (let attempt = 0; attempt < 9 && !cancelled; attempt++) {
        try {
          const res = await wallet.getFills(address, { limit: 1000 });
          if (cancelled) return;
          const fills = res.fills || [];
          setAllFills(fills);
          const now = Date.now();
          const D = 86_400_000;
          const acc = { d7: 0, d14: 0, d30: 0, d90: 0 };
          let lifetime = 0;
          for (const f of fills) {
            const v = Math.abs(f.size || 0) * (f.price || 0);
            lifetime += v;
            const age = now - f.timestamp;
            if (age <= 7 * D) acc.d7 += v;
            if (age <= 14 * D) acc.d14 += v;
            if (age <= 30 * D) acc.d30 += v;
            if (age <= 90 * D) acc.d90 += v;
          }
          setVolByWindow(acc);
          setLifetimeFillVol({ total: lifetime, truncated: fills.length >= 1000 });
          break; // success (even if genuinely empty)
        } catch {
          if (attempt === 8) { if (!cancelled) setVolByWindow(null); }
          else await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
        }
      }
      if (!cancelled) setFillsDone(true);
    })();
    return () => { cancelled = true; };
  }, [address, network]);

  // Step 2: once we have fills, fetch hourly klines for each traded symbol over
  // the wallet's active window. These give the mark price over time, which —
  // combined with the fill-derived position — reconstructs a continuous
  // unrealized-PnL / equity curve.
  useEffect(() => {
    if (allFills.length === 0) { setKlinesBySymbol({}); return; }
    let cancelled = false;
    const symbols = Array.from(new Set(allFills.map((f) => f.symbol)));
    // Snap the window to 1h boundaries so the request is byte-identical for
    // every viewer of this wallet within the same hour → it hits the backend's
    // candle cache instead of re-fetching 4 symbols × ~140 KB from BULK on
    // every load (the old `endTime = Date.now()` was unique per request and
    // never cached). Rounding the end UP to the next boundary also makes BULK
    // include the currently-forming candle, which `now` omitted.
    const HOUR = 3_600_000;
    const startTime = Math.floor(Math.min(...allFills.map((f) => f.timestamp)) / HOUR) * HOUR;
    const endTime = Math.ceil(Date.now() / HOUR) * HOUR;
    const hours = Math.ceil((endTime - startTime) / HOUR);
    const limit = Math.min(1000, Math.max(24, hours + 6));
    Promise.all(
      symbols.map(async (sym) => {
        // Retry per symbol so a transient candle failure doesn't leave the PnL
        // reconstruction flat/empty when the page reveals.
        for (let i = 0; i < 3 && !cancelled; i++) {
          try {
            const res = await analytics.getCandles(sym, '1h', limit, { startTime, endTime });
            // Clamp bad-print wicks (same as the position modal) so a stray
            // print can't distort the mark used for unrealized PnL.
            return [sym, clampWicks(res.candles || [])] as const;
          } catch {
            if (i < 2) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
          }
        }
        return [sym, [] as Candle[]] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setKlinesBySymbol(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [allFills]);

  // Track whether the user has manually clicked a tab. Once they have, we
  // never auto-switch on data changes — that would be jarring (e.g. their
  // last position closes and the panel suddenly jumps tabs). On first load
  // with no open positions we land on "recent" automatically; afterward,
  // the user is in charge.
  const [tabIsUserPicked, setTabIsUserPicked] = useState(false);

  useEffect(() => {
    if (tabIsUserPicked) return;
    const hasOpen = (data?.live?.positions || []).length > 0;
    setPositionsTab(hasOpen ? 'open' : 'recent');
  }, [data, tabIsUserPicked]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFollow = async () => {
    // If not authenticated, prompt login
    if (!authenticated) {
      console.log('[Follow] Not authenticated, prompting login');
      login();
      return;
    }

    setFollowLoading(true);
    
    try {
      // ALWAYS get fresh token from Privy (ES256 signed)
      console.log('[Follow] Getting fresh Privy access token...');
      const token = await getAccessToken();
      
      if (!token) {
        console.error('[Follow] Failed to get Privy access token');
        alert('Please reconnect your wallet to follow users');
        setFollowLoading(false);
        return;
      }

      if (isFollowing) {
        console.log('[Follow] Unfollowing wallet:', address);
        await userApi.unfollowWallet(token, address);
        removeFollowing(address);
        console.log('[Follow] Successfully unfollowed');
      } else {
        console.log('[Follow] Following wallet:', address);
        await userApi.followWallet(token, address);
        addFollowing({
          wallet_address: address,
          followed_at: new Date().toISOString(),
        });
        console.log('[Follow] Successfully followed');
      }
    } catch (err: any) {
      console.error('[Follow] Failed to update follow:', err);
      
      if (err.message?.includes('401') || err.message?.includes('expired') || err.message?.includes('Invalid')) {
        alert('Session expired. Please reconnect your wallet.');
      } else {
        alert(err.message || 'Failed to update follow status');
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const handleClaimWallet = async () => {
    if (!authenticated) {
      login();
      return;
    }

    setClaimLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please log in again');
        return;
      }

      console.log('[Claim] Claiming wallet:', address);
      const response = await userApi.claimWallet(token, address) as { user?: any; success?: boolean };
      
      if (response?.success) {
        setClaimedWallet(address);
        if (response.user) {
          setUser(response.user);
        }
        console.log('[Claim] Wallet claimed successfully');
      }
    } catch (err: any) {
      console.error('[Claim] Failed to claim wallet:', err);
      alert(err.message || 'Failed to claim wallet');
    } finally {
      setClaimLoading(false);
    }
  };

  const margin = data?.live?.margin;
  const positions = data?.live?.positions || [];
  const markPrices = data?.markPrices || {};
  const tracked = data?.tracked;
  const history = data?.history || [];

  // Step 1: fills-reconstructed cumulative NET realized-PnL, calibrated to
  // BULK's authoritative total. realizedPnlSeries walks raw fills at fill
  // resolution (gross); raw fills under-book forced-close losses (liq/ADL
  // execute worse than avgEntry×fillPrice), so the missing residual is
  // attributed to the liq/ADL fills weighted by the notional each closed —
  // NOT smeared across ordinary trades. Lifetime fees+funding (small) are
  // amortised by time. Endpoint then equals margin.realizedPnl exactly.
  const reconstructedRealized = useMemo(() => {
    const recRaw = realizedPnlSeries(allFills);
    if (recRaw.length === 0) return [] as { t: number; v: number }[];
    const t0 = recRaw[0].t;
    const tN = recRaw[recRaw.length - 1].t;
    const span = Math.max(1, tN - t0);
    const fees = margin?.fees ?? 0;
    const funding = margin?.funding ?? 0;
    const grossEnd = recRaw[recRaw.length - 1].realized;
    const netTarget = margin?.realizedPnl;
    const forcedWeight = recRaw.reduce(
      (s, p) => s + (p.reasonCode === 'adl' || p.reasonCode === 'liq' ? p.closedNotional : 0),
      0,
    );
    const residual = netTarget != null ? netTarget - fees - funding - grossEnd : 0;
    let attrib = 0;
    return recRaw.map((p) => {
      if (forcedWeight > 0 && (p.reasonCode === 'adl' || p.reasonCode === 'liq')) {
        attrib += residual * (p.closedNotional / forcedWeight);
      } else if (forcedWeight <= 0) {
        // No forced closes to carry the residual — amortise it by time.
        attrib = residual * ((p.t - t0) / span);
      }
      const feesFund = (fees + funding) * ((p.t - t0) / span);
      return { t: p.t, v: p.realized + attrib + feesFund };
    });
    // Depend on the PRIMITIVE margin numbers, not the margin OBJECT. The 10s
    // background refresh hands us a brand-new margin object every tick even when
    // the values are identical — depending on the object made this whole
    // reconstruction (and continuousPnl / dailyPnl below it) recompute every 10s,
    // which is what made the Daily/Per-trade/Compare tabs lag and flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFills, margin?.fees, margin?.funding, margin?.realizedPnl]);

  // Step 2: continuous TOTAL PnL (realized + unrealized) reconstructed from
  // fills + klines. At each hourly grid step we take the fill-derived open
  // position per symbol and mark it against that symbol's kline close:
  //   unrealized(t) = Σ size(t) · (mark(t) − avgEntry(t))
  // added to the calibrated realized-to-date. This is the high-resolution,
  // continuous version of the snapshot's pnl+unrealized_pnl.
  const continuousPnl = useMemo(() => {
    if (allFills.length === 0) return [] as { t: number; v: number }[];
    const timelines = symbolPositionTimeline(allFills);
    const symbols = Object.keys(timelines).filter((s) => (klinesBySymbol[s]?.length ?? 0) > 0);
    if (symbols.length === 0) return [];

    // Sorted klines per symbol (open time → close).
    // Mark = the (wick-clamped) candle close, additionally clamped into the
    // cleaned [low, high] so a bad-print close can't spike the unrealized line.
    const marks: Record<string, { t: number; c: number }[]> = {};
    for (const s of symbols) {
      marks[s] = (klinesBySymbol[s] || [])
        .map((c) => ({ t: c.t, c: Math.min(c.h, Math.max(c.l, c.c)) }))
        .sort((a, b) => a.t - b.t);
    }
    const lastAtOrBefore = <T extends { t: number }>(arr: T[], t: number): T | null => {
      let lo = 0, hi = arr.length - 1, res: T | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].t <= t) { res = arr[mid]; lo = mid + 1; } else { hi = mid - 1; }
      }
      return res;
    };

    // Grid across the union of kline times, from the first fill to now.
    const t0 = Math.min(...allFills.map((f) => f.timestamp));
    const gridSet = new Set<number>();
    for (const s of symbols) for (const m of marks[s]) if (m.t >= t0) gridSet.add(m.t);
    // Anchor the grid to the realized backbone (one point per closing fill) so
    // the curve ALWAYS spans the full fill history — even when klines only come
    // back for a recent window. Without this the reconstructed curve collapses
    // to wherever klines happen to exist (e.g. just today), then replaces the
    // full snapshot curve ~1s after load. Where no kline mark reaches back to an
    // early point, unrealized is 0 there, so the point sits on the realized
    // curve (correct); marked-unrealized detail is layered in only where klines
    // do exist.
    for (const p of reconstructedRealized) if (p.t >= t0) gridSet.add(p.t);
    gridSet.add(Date.now());
    const grid = Array.from(gridSet).sort((a, b) => a - b);

    return grid.map((tg) => {
      let unreal = 0;
      for (const s of symbols) {
        const st = lastAtOrBefore(timelines[s], tg);
        const mk = lastAtOrBefore(marks[s], tg);
        if (st && mk && Math.abs(st.size) > 1e-9) unreal += st.size * (mk.c - st.avgEntry);
      }
      const realized = lastAtOrBefore(reconstructedRealized, tg)?.v ?? 0;
      return { t: tg, v: realized + unreal };
    });
  }, [allFills, klinesBySymbol, reconstructedRealized]);

  // Merge the three series into rows for the Compare overlay. connectNulls
  // draws each line across its own timestamps.
  const pnlCompare = useMemo(() => {
    const snap = history
      .map((h) => ({
        t: new Date(h.timestamp).getTime(),
        v: (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0),
      }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);

    const rows = [
      ...snap.map((p) => ({ t: p.t, snapshot: p.v as number | null, reconstructed: null as number | null, equity: null as number | null })),
      ...reconstructedRealized.map((p) => ({ t: p.t, snapshot: null as number | null, reconstructed: p.v as number | null, equity: null as number | null })),
      ...continuousPnl.map((p) => ({ t: p.t, snapshot: null as number | null, reconstructed: null as number | null, equity: p.v as number | null })),
    ].sort((a, b) => a.t - b.t);

    return { rows, snapCount: snap.length, recCount: reconstructedRealized.length, eqCount: continuousPnl.length };
  }, [history, reconstructedRealized, continuousPnl]);

  // Daily PnL derived from the reconstructed cumulative curve — the day-over-day
  // change in total PnL. Lets the Daily calendar work for wallets with only OPEN
  // positions (no closed trades) via mark-to-market, instead of a dead panel.
  const dailyPnlFromSeries = useMemo<Map<string, number> | null>(() => {
    const src = continuousPnl.length >= 2
      ? continuousPnl
      : reconstructedRealized.map((p) => ({ t: p.t, v: p.v }));
    if (src.length < 2) return null;
    // Last cumulative value seen on each local calendar day.
    const lastByDay = new Map<string, number>();
    for (const p of src) {
      const d = new Date(p.t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      lastByDay.set(key, p.v);
    }
    const days = Array.from(lastByDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const out = new Map<string, number>();
    let prev = 0;
    for (const [key, v] of days) { out.set(key, v - prev); prev = v; }
    return out;
  }, [continuousPnl, reconstructedRealized]);


  // Reconstruct and open the share card for a market's current instance.
  const openShareCard = (sym: string) => {
    const coin2 = sym.replace(/-USD$/, '');
    const tf = allFills.filter((f) => f.symbol === sym);
    if (tf.length === 0) return;
    const mark = data?.markPrices?.[sym] ?? null;
    const lp = data?.live?.positions.find((p) => p.symbol === sym);
    const life = buildTradeLifecycle(tf, klinesBySymbol[sym] ?? [], {
      markPrice: mark, leverage: lp?.leverage ?? 0, liqPrice: lp?.liquidationPrice ?? null,
    });
    if (!life) return;
    const lastPrice = life.isOpen ? mark : (life.events.length ? life.events[life.events.length - 1].price : mark);
    setCardData({
      address, symbol: sym, coin: coin2,
      side: life.side, isOpen: life.isOpen, openedAt: life.openedAt, closedAt: life.closedAt,
      avgEntry: life.avgEntry, size: life.peakSize, leverage: lp?.leverage ?? 0,
      markPrice: mark, exitPrice: life.isOpen ? mark : lastPrice, pnl: life.finalPnl,
      events: life.events.map((e) => ({ t: e.t, price: e.price, buy: e.sizeDelta > 0, action: e.action, label: e.actionLabel, realized: e.realizedDelta, units: Math.abs(e.sizeDelta), liq: e.liq ?? null })),
      pnlCurve: life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl })),
      liqCurve: life.liqCurve,
    });
  };

  // The series the hero PnL/Value chart plots: the fills+klines continuous
  // total-PnL curve when we could reconstruct it, otherwise the coarse
  // snapshot curve (wallets with no fills, or before fills load). Each point is
  // {t: ms, v: cumulative total PnL}. The chart's Value toggle anchors this to
  // the live balance for an equity curve.
  const heroPnl = useMemo(() => {
    // Best: fills + klines continuous total-PnL (realized + marked unrealized).
    if (continuousPnl.length >= 2) {
      return { data: continuousPnl, source: 'reconstructed' as const };
    }
    // Fallback: the fills-only realized-PnL curve — exactly the dev's method
    // (walk the account's fills, book realized PnL per closing fill). This needs
    // no klines, so it still gives a real multi-point curve when the kline mark
    // isn't available, instead of collapsing to the single snapshot point.
    if (reconstructedRealized.length >= 2) {
      return { data: reconstructedRealized.map((p) => ({ t: p.t, v: p.v })), source: 'realized' as const };
    }
    const snap = history
      .map((h) => ({
        t: new Date(h.timestamp).getTime(),
        v: (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0),
      }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    return { data: snap, source: 'snapshot' as const };
  }, [continuousPnl, reconstructedRealized, history]);

  // Get the most recent PnL from history (snapshots) - this matches the chart
  const latestSnapshot = history.length > 0 ? history[history.length - 1] : null;
  const latestSnapshotPnL = latestSnapshot 
    ? (parseFloat(String(latestSnapshot.pnl)) || 0) + (parseFloat(String(latestSnapshot.unrealized_pnl)) || 0)
    : null;

  // For Total PnL stat: Use latest snapshot to match chart, fallback to live or tracked
  const totalPnL = latestSnapshotPnL !== null 
    ? latestSnapshotPnL
    : margin 
      ? (margin.realizedPnl || 0) + (margin.unrealizedPnl || 0)
      : (tracked?.total_pnl || 0);

  const hasLiveData = margin !== null && margin !== undefined;
  const hasTrackedData = tracked !== null && tracked !== undefined;

  // Stats sourced from BULK indexer with DB fallback. BULK's lifetime
  // numbers are authoritative — they cover every trade on the exchange,
  // not just trades we happened to capture. DB fallback exists for
  // wallets the indexer doesn't know about (brand-new traders) and the
  // brief moment before BULK stats load on page mount.
  const bulkRow = bulkStats?.found ? bulkStats.row : null;
  // Lifetime volume: the wallet's OWN fills (maker + taker sides) are the
  // authoritative figure and match BULK's portfolio exactly. Our indexed
  // total_volume / leaderboard volume was historically taker-only and
  // undercounts by ~half, so prefer the fill sum. When the fill history was
  // truncated (very heavy wallet past the fetch cap) fall back to whichever
  // known figure is larger, so we never display less than we've counted.
  const trackedVolume = bulkRow?.volume ?? tracked?.total_volume ?? 0;
  const bulkVolume = lifetimeFillVol
    ? (lifetimeFillVol.truncated ? Math.max(lifetimeFillVol.total, trackedVolume) : lifetimeFillVol.total)
    : trackedVolume;
  const bulkClosedCount = bulkRow?.closed_count ?? tracked?.total_trades ?? 0;
  // Total PnL: use the NET realized PnL from the indexer (already net
  // of fees) so the headline number matches what the trader actually
  // pocketed. BULK's indexer exposes both `realized_pnl` (gross) and
  // `net_realized_pnl` (fee-discounted) side-by-side; we want net.
  // DB fallback also stores net values (updated 2026-05-21 to match).
  // Hover popover below the card exposes the gross/fees breakdown.
  const bulkRealizedPnL = bulkRow?.net_realized_pnl ?? tracked?.total_pnl ?? 0;
  const bulkGrossPnL = bulkRow?.realized_pnl;
  const bulkFeesPaid = bulkRow?.fees_paid;

  // Lifetime fees + funding for the dedicated KPI cards. Pulled from
  // BULK's fullAccount.margin which carries wallet-wide aggregates.
  // We prefer this over the indexer's fees_paid (which is also lifetime
  // but updates on a slower cadence) because margin.fees and
  // margin.funding both come from the same source — using one for fees
  // and the other for funding would risk a small visible drift between
  // the two cards. Sign convention: both fields are negative when the
  // trader paid net, positive when they received net.
  //
  // Fallback: when no live margin is loaded, use the indexer's
  // fees_paid for the Fees card (it's the same metric) and omit the
  // Funding card (no equivalent indexer field).
  const lifetimeFees = margin?.fees ?? bulkFeesPaid ?? null;
  const lifetimeFunding = margin?.funding ?? null;

  // Display name priority: Twitter name > display name > null
  const displayName = profile?.twitter_name || profile?.display_name || null;
  const twitterHandle = profile?.twitter_handle;
  const twitterAvatar = profile?.twitter_avatar;

  // Calculate totals for positions
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  const totalNotional = positions.reduce((sum, p) => sum + Math.abs(p.notional || 0), 0);

  // ─────────────────────────────────────────────────────────────────────
  // Tier-1 derived stats — performance bar, direction bias, distance to
  // liquidation, analysis sidebar. All computed locally from data we
  // already have on the page. No additional fetches required.
  //
  // The derivations are co-located here (rather than scattered across
  // sub-components) so the relationships between them stay visible and
  // future-you doesn't have to grep five files to understand where the
  // "Longest Win Streak" number came from.
  // ─────────────────────────────────────────────────────────────────────

  // Performance bar: last 6 trades, newest first, signed by realizedPnl.
  // BULK already returns closed positions sorted newest-first, so we
  // can slice straight off the top. When fewer than 6 trades exist we
  // show what we have — the bar adapts visually.
  const recentTrades = closedPositions.slice(0, 6);
  const recentWinLoss: boolean[] = recentTrades.map((p) => p.realizedPnl >= 0);

  // Win rate across ALL closed positions (not just the last 6 — that
  // would be small-sample noise). Prefer indexer's lifetime win_rate
  // when available since it reflects the full ledger; fall back to
  // computing from the 200 we just fetched.
  const winRate: number | null = (() => {
    if (typeof bulkRow?.win_rate === 'number') return bulkRow.win_rate;
    if (closedPositions.length === 0) return null;
    const wins = closedPositions.filter((p) => p.realizedPnl >= 0).length;
    return wins / closedPositions.length;
  })();

  // Direction Bias: aggregate notional of open positions, split by side.
  // `size > 0` means long, `size < 0` means short. We use notional (size
  // × price) rather than size alone because comparing 1 BTC long to
  // 1000 SOL short is meaningless without dollar weighting.
  const directionBias = (() => {
    if (positions.length === 0) return null;
    let longNotional = 0;
    let shortNotional = 0;
    for (const p of positions) {
      const notional = Math.abs((p.size || 0) * (p.price || 0));
      if ((p.size || 0) > 0) longNotional += notional;
      else if ((p.size || 0) < 0) shortNotional += notional;
    }
    const total = longNotional + shortNotional;
    if (total === 0) return null;
    const longPct = longNotional / total;
    // Label thresholds chosen to match Hyperdash's tonality without
    // copying their exact numbers (which aren't documented).
    let label: 'Very Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Very Bearish';
    if (longPct >= 0.9) label = 'Very Bullish';
    else if (longPct >= 0.65) label = 'Bullish';
    else if (longPct >= 0.35) label = 'Neutral';
    else if (longPct >= 0.1) label = 'Bearish';
    else label = 'Very Bearish';
    return { label, longPct, longNotional, shortNotional };
  })();

  // Distance to Liquidation: per-position % distance from current mark
  // to liquidation price. We surface the WORST case (smallest distance)
  // because that's the position most likely to take the wallet down
  // next. Hidden card when no open positions.
  const distanceToLiq = (() => {
    if (positions.length === 0) return null;
    const distances: { symbol: string; pct: number }[] = [];
    for (const p of positions) {
      const liqPrice = (p as any).liquidationPrice;
      // BULK reports `markPrices` keyed by symbol on WalletData; fall
      // back to position.price if we don't have a mark for that symbol.
      const mark = data?.markPrices?.[p.symbol] ?? p.price;
      if (!liqPrice || !mark || liqPrice === 0) continue;
      // Long → liquidated below mark; Short → liquidated above mark.
      const isLong = (p.size || 0) > 0;
      const rawDist = isLong ? (mark - liqPrice) / mark : (liqPrice - mark) / mark;
      // Clamp at 0 — negative would mean already liquidated, which
      // shouldn't show as a healthy distance.
      distances.push({ symbol: p.symbol, pct: Math.max(0, rawDist) });
    }
    if (distances.length === 0) return null;
    distances.sort((a, b) => a.pct - b.pct);
    return distances[0]; // worst case
  })();

  // Effective leverage: total notional ÷ account equity. Mirrors how
  // Hyperdash shows "3.7X" with notional and equity below — the same
  // formula they use. Equity = totalBalance (includes unrealized PnL
  // adjustments per BULK convention).
  const effectiveLeverage = (() => {
    if (!margin || margin.totalBalance <= 0) return null;
    if (totalNotional === 0) return null;
    return totalNotional / margin.totalBalance;
  })();

  // Analysis sidebar stats: longest win streak, avg/median trade duration,
  // PnL cohort, size cohort. All derived from closed positions + bulkRow.
  const analysisStats = (() => {
    // Longest consecutive run of wins (realizedPnl >= 0). Walk in
    // chronological order — BULK returns newest first, so reverse.
    const chrono = [...closedPositions].reverse();
    let longestStreak = 0;
    let currentStreak = 0;
    for (const p of chrono) {
      if (p.realizedPnl >= 0) {
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }

    // Durations: open→close in ms per position. Filter out zero/invalid
    // (defensive — BULK has been known to return 0 timestamps on rare
    // edge cases).
    const durations = closedPositions
      .map((p) => p.closedAt - p.openedAt)
      .filter((d) => d > 0);
    const avgDuration = durations.length > 0
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : null;
    const medianDuration = durations.length > 0
      ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]
      : null;

    // PnL Cohort — categorical label based on lifetime net realized PnL.
    // Buckets chosen so the highest labels feel earned (most wallets
    // sit in Break-Even / Profitable; Extremely Profitable + Catastrophic
    // are reserved for the tails).
    const pnlForCohort = bulkRealizedPnL;
    let pnlCohort: { label: string; tone: 'green' | 'red' | 'neutral' };
    if (pnlForCohort >= 100_000) pnlCohort = { label: 'Extremely Profitable', tone: 'green' };
    else if (pnlForCohort >= 10_000) pnlCohort = { label: 'Profitable', tone: 'green' };
    else if (pnlForCohort >= -10_000) pnlCohort = { label: 'Break-Even', tone: 'neutral' };
    else if (pnlForCohort >= -100_000) pnlCohort = { label: 'Unprofitable', tone: 'red' };
    else pnlCohort = { label: 'Catastrophic', tone: 'red' };

    // Size Cohort — based on peak balance (more meaningful than volume,
    // which over-rewards high-frequency tiny traders). Falls back to
    // current totalBalance when peak isn't available from indexer.
    const sizeForCohort = bulkRow?.peak_balance ?? margin?.totalBalance ?? 0;
    let sizeCohort: string;
    if (sizeForCohort >= 1_000_000) sizeCohort = 'Whale';
    else if (sizeForCohort >= 100_000) sizeCohort = 'Shark';
    else if (sizeForCohort >= 10_000) sizeCohort = 'Dolphin';
    else sizeCohort = 'Fish';

    // --- Performance metrics (Hyperdash-style sub-panel) ---
    // Computed from the chronological realizedPnl series. All three are
    // derived purely from closed positions, so they're available for any
    // wallet without extra endpoints.
    const pnls = chrono.map((p) => p.realizedPnl);

    // Win rate over closed positions (distinct from the BULK indexer's
    // win_rate, which we show on the Performance top card; this is the
    // rail's own derivation as a cross-check).
    const wins = pnls.filter((v) => v > 0).length;
    const closedWinRate = pnls.length > 0 ? wins / pnls.length : null;

    // Max drawdown of the cumulative realized-PnL curve, expressed as a
    // percentage of the peak. Walk the curve tracking the running peak;
    // the largest peak-to-trough drop is the drawdown. A flat/rising
    // curve yields 0.
    let cum = 0;
    let peak = 0;
    let maxDrawdownPct = 0;
    for (const v of pnls) {
      cum += v;
      if (cum > peak) peak = cum;
      if (peak > 0) {
        const dd = ((peak - cum) / peak) * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      }
    }
    const drawdown = pnls.length > 0 ? maxDrawdownPct : null;

    // Sharpe-like ratio: mean per-trade PnL / stdev of per-trade PnL.
    // Not annualized (we don't have reliable per-trade timestamps thanks
    // to the BULK openTime bug), so it's a unitless consistency measure —
    // higher means more consistent wins relative to volatility. Labeled
    // "Sharpe" to match Hyperdash's vocabulary; shown to 2dp.
    let sharpe: number | null = null;
    if (pnls.length >= 2) {
      const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
      const variance =
        pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1);
      const stdev = Math.sqrt(variance);
      sharpe = stdev > 0 ? mean / stdev : null;
    }

    // Trading style — bucket by median hold duration. Hidden-data caveat:
    // BULK's openTime===closeTime bug zeroes durations, so this falls back
    // to 'Unknown' until that's fixed. When durations are valid:
    //   < 1 day  → Intraday, < 1 week → Swing, else → Position.
    let tradingStyle: string;
    if (medianDuration === null || medianDuration <= 0) tradingStyle = 'Unknown';
    else if (medianDuration < 86_400_000) tradingStyle = 'Intraday';
    else if (medianDuration < 7 * 86_400_000) tradingStyle = 'Swing';
    else tradingStyle = 'Position';

    return {
      longestStreak,
      avgDuration,
      medianDuration,
      pnlCohort,
      sizeCohort,
      drawdown,
      closedWinRate,
      sharpe,
      tradingStyle,
    };
  })();

  // Breakdown popover for the Total PnL card. Built once here so both
  // StatCard call sites (live + no-live layouts) get the same content.
  // Only rendered when the indexer gave us a gross/fees breakdown —
  // when we're falling back to tracked.total_pnl from our DB we don't
  // have the components, so the popover is omitted.
  const totalPnlTooltip =
    bulkGrossPnL !== undefined && bulkFeesPaid !== undefined ? (
      <TotalPnlBreakdown
        gross={bulkGrossPnL}
        fees={bulkFeesPaid}
        net={bulkRealizedPnL}
      />
    ) : undefined;

  // ── Terminal derivations ─────────────────────────────────────────────────
  const sortedPositions = useMemo(() => [...positions].sort((a, b) => Math.abs(b.notional || 0) - Math.abs(a.notional || 0)), [positions]);
  const selectedSymbol = selectedPos >= 0 ? sortedPositions[selectedPos]?.symbol ?? null : null;
  const maintTotal = positions.reduce((s, p) => s + (typeof p.maintenanceMargin === 'number' && p.maintenanceMargin > 0 ? p.maintenanceMargin : 0), 0);
  const verdict = useMemo(() => buildVerdict({
    fills: allFills,
    address,
    style: analysisStats.tradingStyle,
    leverage: effectiveLeverage,
    longPct: directionBias?.longPct ?? null,
    openCount: positions.length,
    trading: margin ? margin.realizedPnl - (margin.fees ?? 0) - (margin.funding ?? 0) + margin.unrealizedPnl : null,
    fees: margin?.fees ?? null,
    liqs: tracked?.total_liquidations || 0,
    cohort: analysisStats.sizeCohort,
  }), [allFills, address, analysisStats.tradingStyle, analysisStats.sizeCohort, effectiveLeverage, directionBias?.longPct, positions.length, margin, tracked?.total_liquidations]);
  // Visible time window of the curve, so the position bands share its axis.
  const visibleRange = useMemo(() => {
    if (heroPnl.data.length === 0) return null;
    const windowMs = chartRange === '24h' ? 86_400_000 : chartRange === '7d' ? 7 * 86_400_000 : chartRange === '30d' ? 30 * 86_400_000 : Infinity;
    const first = chartRange === 'all' ? heroPnl.data[0].t : (heroPnl.data.find((p) => p.t >= Date.now() - windowMs)?.t ?? null);
    return first === null ? null : { t0: first, t1: Date.now() };
  }, [heroPnl.data, chartRange]);
  const tapeEvents = useMemo(() => buildTape(closedPositions, positions, positionOpenTimes), [closedPositions, positions, positionOpenTimes]);

  const openLiveChart = (pos: OpenPos) => {
    const isLong = pos.size > 0;
    const markPrice = markPrices[pos.symbol] || 0;
    setChartPosition({
      kind: 'live', walletAddress: address, symbol: pos.symbol, side: isLong ? 'long' : 'short',
      entryPrice: pos.price, markPrice: markPrice || pos.price, liquidationPrice: pos.liquidationPrice,
      size: Math.abs(pos.size), leverage: pos.leverage, unrealizedPnl: pos.unrealizedPnl,
    });
  };
  const openClosedChart = (p: ClosedPosition) => setChartPosition({
    kind: 'closed', walletAddress: address, symbol: p.symbol, side: p.side, entryPrice: p.openPrice, closePrice: p.closePrice,
    size: p.size, leverage: p.leverage, realizedPnl: p.realizedPnl, fees: p.fees, funding: p.funding,
    openedAt: p.openedAt, closedAt: p.closedAt, liquidated: p.liquidated,
  });

  // Keyboard: j/k move the positions selection, ↵ opens its chart, s its share
  // card, 1–4 set the range, esc clears. Ignored while typing or in a modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (chartPosition || cardData || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = sortedPositions.length;
      if (e.key === 'j' || e.key === 'ArrowDown') { if (n) { e.preventDefault(); setPositionsTab('open'); setSelectedPos((i) => (i + 1) % n); } }
      else if (e.key === 'k' || e.key === 'ArrowUp') { if (n) { e.preventDefault(); setPositionsTab('open'); setSelectedPos((i) => (i <= 0 ? n - 1 : i - 1)); } }
      else if (e.key === 'Enter') { const p = selectedPos >= 0 ? sortedPositions[selectedPos] : null; if (p) { e.preventDefault(); openLiveChart(p); } }
      else if (e.key === 's') { const p = selectedPos >= 0 ? sortedPositions[selectedPos] : null; if (p) { e.preventDefault(); openShareCard(p.symbol); } }
      else if (e.key === 'Escape') setSelectedPos(-1);
      else if (e.key === '1') setChartRange('24h');
      else if (e.key === '2') setChartRange('7d');
      else if (e.key === '3') setChartRange('30d');
      else if (e.key === '4') setChartRange('all');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPositions, selectedPos, chartPosition, cardData]);

  // The PnL chart's candles load after the fills. It's "ready" once we have
  // candles, OR once we know the wallet genuinely has no fills to chart.
  const klinesReady = Object.values(klinesBySymbol).some((c) => c.length > 0) || (fillsDone && allFills.length === 0);
  // Reveal only when EVERY key wave has landed — or the safety timeout fires.
  const ready = revealTimedOut || (mainDone && fillsDone && rankDone && klinesReady);

  // Hold the animated logo loader until all the key data waves have landed, so
  // the page reveals complete instead of flashing partial numbers.
  if (!ready) {
    return (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-[var(--bg-base)]">
        <div className="flex flex-col items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-loader.svg" alt="Loading" className="h-20 w-auto select-none" />
          <p className="text-[12px] font-medium uppercase tracking-[0.25em] text-[var(--role-content-subtle)] animate-pulse">
            Loading wallet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-[var(--bg-base)] animate-[whale-reveal_0.45s_ease-out] lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
      {cardData && <TradeShareCard data={cardData} onClose={() => setCardData(null)} />}
      <main className="flex-1 min-h-0 w-full px-3 sm:px-4 pt-2.5 pb-3 flex flex-col">
        {error && !hasTrackedData ? (
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)] p-8 text-center max-w-xl mx-auto mt-8">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-bulk-red opacity-60" />
            <h2 className="text-lg font-medium mb-1">Wallet not found</h2>
            <p className="text-[13px] text-[var(--role-content-muted)] mb-4">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-md)] text-[12px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Whale Tracker
            </Link>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-2">

            {/* ── MASTHEAD — who this is, in one line. ───────────────────── */}
            <header className="shrink-0 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)]">
              <div className="flex items-center gap-3 px-3 py-2 min-w-0 flex-wrap lg:flex-nowrap">
                <Link href="/whales" className="shrink-0 p-1 -ml-1 rounded text-[var(--role-content-subtle)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors" title="Whale Tracker" aria-label="Back to Whale Tracker">
                  <ArrowLeft className="w-4 h-4" />
                </Link>
                {twitterAvatar ? (
                  <img src={twitterAvatar} alt="" width={28} height={28} loading="eager" decoding="async"
                    className="w-7 h-7 rounded-full border border-[var(--border-color)] object-cover shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-[var(--role-surface-raised)] border border-[var(--border-color)] grid place-items-center shrink-0"><Wallet className="w-3.5 h-3.5 text-[var(--role-content-muted)]" /></span>
                )}
                <div className="min-w-0 flex items-baseline gap-2">
                  <h1 className="font-mono text-[15px] font-medium text-[var(--role-content)] whitespace-nowrap">{displayName || formatAddress(address)}</h1>
                  <button onClick={copyAddress} className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--role-content-subtle)] hover:text-[var(--role-content)] transition-colors" title={address}>
                    <span className="hidden md:inline">{address.slice(0, 10)}…{address.slice(-6)}</span>
                    {copied ? <Check className="w-3 h-3 text-bulk-green" /> : <Copy className="w-3 h-3" />}
                  </button>
                  {isOwnWallet && <span className="px-1 py-px text-[9px] font-medium uppercase tracking-wider rounded-sm bg-[var(--accent)]/15 text-[var(--accent)]">You</span>}
                  {twitterHandle && (
                    <a href={`https://twitter.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="hidden xl:inline-flex items-center gap-1 text-[11px] text-[var(--role-content-subtle)] hover:text-[var(--role-content)]"><XIcon className="w-2.5 h-2.5" />@{twitterHandle}</a>
                  )}
                </div>
                {/* The verdict: one computed sentence. The thing no other tracker says. */}
                <p className="min-w-0 flex-1 basis-full lg:basis-auto text-[12.5px] leading-snug text-[var(--role-content-muted)] lg:truncate order-last lg:order-none" title={verdict}>
                  <span className="text-[var(--role-content-subtle)] mr-1.5">▸</span>{verdict}
                </p>
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  {isSystemWallet(address) ? (
                    <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-md)] text-[11px] border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]" title="Operated by the BULK exchange protocol"><Shield className="w-3 h-3" />BULK System</span>
                  ) : <BulkRankBadge address={address} />}
                  <AccountHierarchy address={address} />
                  {!isOwnWallet && (
                    <button onClick={toggleFollow} disabled={followLoading}
                      className={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-md)] text-[12px] font-medium border transition-colors disabled:opacity-50',
                        isFollowing ? 'border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15' : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110')}>
                      {followLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : isFollowing ? <StarOff className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                  {canClaimWallet && (
                    <button onClick={handleClaimWallet} disabled={claimLoading} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-md)] text-[12px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors disabled:opacity-50">
                      {claimLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}Claim
                    </button>
                  )}
                  {isClaimedWallet && <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-md)] text-[11px] border border-[var(--accent)]/30 text-[var(--accent)]"><UserCheck className="w-3 h-3" />Claimed</span>}
                  <a href={`https://explorer.bulk.trade/address/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-md)] text-[11px] border border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors" title="BULK explorer">Explorer<ExternalLink className="w-3 h-3" /></a>
                  <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-md)] text-[11px] border border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Solscan<ExternalLink className="w-3 h-3" /></a>
                </div>
              </div>

              {/* ── TICKER — the "now" numbers in one line. ────────────────── */}
              <div className="flex items-center gap-x-5 gap-y-1.5 px-3 py-1.5 border-t border-[var(--border-color)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Tick k="Net worth" v={margin ? `$${formatNumber(margin.totalBalance, 2)}` : '—'} tone={margin ? 'neutral' : 'muted'} />
                <Tick k="PnL" v={`${bulkRealizedPnL >= 0 ? '+' : '−'}$${formatNumber(Math.abs(bulkRealizedPnL), 2)}`} tone={bulkRealizedPnL >= 0 ? 'green' : 'red'} title="Net realized PnL after fees and funding" />
                <Tick k="uPnL" v={margin ? `${margin.unrealizedPnl >= 0 ? '+' : '−'}$${formatNumber(Math.abs(margin.unrealizedPnl), 2)}` : '—'} tone={!margin ? 'muted' : margin.unrealizedPnl >= 0 ? 'green' : 'red'} />
                <span className="h-4 w-px bg-[var(--border-color)] shrink-0" aria-hidden />
                <Tick k="Bias" v={directionBias ? `${(directionBias.longPct * 100).toFixed(0)}% long` : 'flat'} tone={!directionBias ? 'muted' : directionBias.longPct > 0.6 ? 'green' : directionBias.longPct < 0.4 ? 'red' : 'neutral'}
                  title={directionBias ? `$${formatCompact(directionBias.longNotional)} long · $${formatCompact(directionBias.shortNotional)} short` : undefined} />
                <Tick k="Lev" v={effectiveLeverage !== null ? `${effectiveLeverage.toFixed(1)}×` : '—'} tone={effectiveLeverage === null ? 'muted' : effectiveLeverage > 10 ? 'red' : effectiveLeverage > 5 ? 'orange' : 'neutral'}
                  title={margin ? `$${formatCompact(totalNotional)} notional on $${formatCompact(margin.totalBalance)}` : undefined} />
                <Tick k={maintTotal > 0 ? 'Maint' : 'Margin'} v={margin && margin.totalBalance > 0 ? `${(((maintTotal > 0 ? maintTotal : margin.marginUsed) / margin.totalBalance) * 100).toFixed(1)}%` : '—'}
                  tone={!margin ? 'muted' : (maintTotal > 0 ? maintTotal : margin.marginUsed) / Math.max(1, margin.totalBalance) >= 0.8 ? 'red' : 'neutral'}
                  title={margin ? (maintTotal > 0 ? `$${formatCompact(maintTotal)} maintenance · $${formatCompact(margin.marginUsed)} used of $${formatCompact(margin.totalBalance)}` : `$${formatCompact(margin.marginUsed)} used of $${formatCompact(margin.totalBalance)}`) : undefined} />
                <Tick k="Liq" v={distanceToLiq ? `${(distanceToLiq.pct * 100).toFixed(1)}% ${distanceToLiq.symbol.replace(/-USD$/, '')}` : '—'} tone={!distanceToLiq ? 'muted' : distanceToLiq.pct < 0.05 ? 'red' : distanceToLiq.pct < 0.15 ? 'orange' : 'green'} title="Nearest liquidation, distance from mark" />
                <span className="h-4 w-px bg-[var(--border-color)] shrink-0" aria-hidden />
                <Tick k="Open" v={String(positions.length)} tone={positions.length ? 'neutral' : 'muted'} />
                <Tick k="Net exp." v={directionBias ? `${directionBias.longNotional - directionBias.shortNotional >= 0 ? '+' : '−'}$${formatCompact(Math.abs(directionBias.longNotional - directionBias.shortNotional))}` : '—'} tone={!directionBias ? 'muted' : directionBias.longNotional >= directionBias.shortNotional ? 'green' : 'red'} />
                {hasLiveData && <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-[var(--role-content-subtle)] whitespace-nowrap"><span className="h-1.5 w-1.5 rounded-full bg-[var(--pos)]" />BULK live · 10s</span>}
              </div>
            </header>

            {/* ── PANES — ledger | curve | positions ─────────────────────── */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)_300px] xl:grid-cols-[248px_minmax(0,1fr)_340px] gap-2">

              {/* LEDGER */}
              <aside className="order-3 lg:order-1 min-h-0 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)] px-3 pt-1 pb-2 lg:overflow-y-auto" aria-label="Ledger">
                <LedgerSection title="Account">
                  <LedgerRow label="Available" value={margin ? `$${formatCompact(margin.availableBalance)}` : '—'} tone={margin ? 'neutral' : 'muted'} />
                  <LedgerRow label="In margin" value={margin ? `$${formatCompact(margin.marginUsed)}` : '—'} tone={margin ? 'neutral' : 'muted'} />
                  <LedgerRow label="Notional" value={positions.length ? `$${formatCompact(totalNotional)}` : '—'} tone={positions.length ? 'neutral' : 'muted'} />
                </LedgerSection>
                <LedgerSection title="Fees & volume" aside={lifetimeFillVol?.truncated ? 'fills capped' : undefined}>
                  <LedgerRow label="Volume" hint="lifetime" value={`$${formatCompact(bulkVolume)}`} />
                  <LedgerRow label="Volume" hint="7d" value={volByWindow ? `$${formatCompact(volByWindow.d7)}` : '—'} tone={volByWindow ? 'neutral' : 'muted'} />
                  <LedgerRow label="Volume" hint="30d" value={volByWindow ? `$${formatCompact(volByWindow.d30)}` : '—'} tone={volByWindow ? 'neutral' : 'muted'} />
                  <LedgerRow label="Net fees" value={lifetimeFees !== null ? `${lifetimeFees > 0 ? '+' : lifetimeFees < 0 ? '−' : ''}$${formatCompact(Math.abs(lifetimeFees))}` : '—'}
                    tone={lifetimeFees === null ? 'muted' : lifetimeFees > 0 ? 'green' : lifetimeFees < 0 ? 'red' : 'neutral'} title="BULK lifetime fee counter: negative when paid, positive when net rebates" />
                  <LedgerRow label="Funding" value={lifetimeFunding !== null ? `${lifetimeFunding >= 0 ? '+' : '−'}$${formatCompact(Math.abs(lifetimeFunding))}` : '—'} tone={lifetimeFunding === null ? 'muted' : lifetimeFunding >= 0 ? 'green' : 'red'} />
                  <LedgerRow label="Maker fills" hint={allFills.length ? `${allFills.length} loaded` : undefined}
                    value={allFills.length ? `${Math.round((allFills.filter((f) => f.maker === address).length / allFills.length) * 100)}%` : '—'} tone={allFills.length ? 'neutral' : 'muted'} />
                  <LedgerRow label="Avg fill" value={allFills.length ? `$${formatCompact(allFills.reduce((s, f) => s + Math.abs(f.size) * f.price, 0) / allFills.length)}` : '—'} tone={allFills.length ? 'neutral' : 'muted'} />
                </LedgerSection>
                <LedgerSection title="Record">
                  <LedgerRow label="Closed trades" value={bulkClosedCount.toLocaleString('en-US')} />
                  <LedgerRow label="Win rate" value={analysisStats.closedWinRate !== null ? `${(analysisStats.closedWinRate * 100).toFixed(0)}%` : '—'} tone={analysisStats.closedWinRate === null ? 'muted' : analysisStats.closedWinRate >= 0.5 ? 'green' : 'red'} />
                  <LedgerRow label="Win streak" value={analysisStats.longestStreak ? String(analysisStats.longestStreak) : '—'} tone={analysisStats.longestStreak ? 'neutral' : 'muted'} />
                  <LedgerRow label="Liquidations" value={String(tracked?.total_liquidations || 0)} tone={(tracked?.total_liquidations || 0) > 0 ? 'red' : 'neutral'} />
                  {analysisStats.tradingStyle !== 'Unknown' && <LedgerRow label="Style" value={analysisStats.tradingStyle} />}
                  <LedgerRow label="PnL cohort" value={analysisStats.pnlCohort.label} tone={analysisStats.pnlCohort.tone} />
                  <LedgerRow label="Size cohort" value={analysisStats.sizeCohort} />
                </LedgerSection>
              </aside>

              {/* CURVE */}
              <section className="order-1 lg:order-2 min-h-0 min-w-0 flex flex-col bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-[var(--radius-md)]" aria-label="PnL curve">
                <div className="px-3 border-b border-[var(--border-color)] flex items-end justify-between gap-3 flex-wrap shrink-0">
                  <div className="flex items-end -mb-px overflow-x-auto max-w-full whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0" role="tablist" aria-label="Chart view">
                    {([['pnl', 'PnL'], ['calendar', 'Calendar'], ['drawdown', 'Drawdown'], ['trade', 'Per-trade'], ['compare', 'Compare']] as const).map(([k, label]) => (
                      <button key={k} type="button" role="tab" aria-selected={chartView === k} onClick={() => setChartView(k)}
                        className={cn('px-2.5 pt-2.5 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] border-b-2 transition-colors',
                          chartView === k ? 'border-[var(--accent)] text-[var(--role-content)]' : 'border-transparent text-[var(--role-content-subtle)] hover:text-[var(--role-content-muted)]')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {chartView === 'pnl' && (
                    <div className="flex items-center gap-2 py-1.5">
                      <div className="toggle-group">
                        {(['pnl', 'value'] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setHeroMetric(m)} className={cn('toggle-btn', heroMetric === m && 'active')}>{m === 'pnl' ? 'PnL' : 'Net worth'}</button>
                        ))}
                      </div>
                      <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--border-color)] p-0.5 text-[10px] uppercase tracking-wider font-mono" title="1–4 on the keyboard">
                        {(['24h', '7d', '30d', 'all'] as const).map((r) => (
                          <button key={r} type="button" onClick={() => setChartRange(r)}
                            className={cn('px-2 py-1 rounded-[3px] transition-colors', chartRange === r ? 'text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content-muted)]')}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 flex flex-col lg:overflow-y-auto">
              {chartView === 'compare' ? (
                // MEASUREMENT: coarse snapshot realized-PnL curve vs the
                // fills-reconstructed one, overlaid. Both are cumulative
                // realized PnL (net). connectNulls draws each line across its
                // own timestamps; the reconstructed line carries far more
                // points, which is the resolution gain.
                <div className="flex flex-1 flex-col p-3 min-h-[500px]">
                  <div className="mb-2 flex flex-wrap items-center gap-4 px-1 text-[11px] text-[var(--role-content-muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0 w-4 border-t-2 border-dashed border-[var(--role-content-subtle)]" />
                      Snapshot total PnL · {pnlCompare.snapCount} pts
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0 w-4 border-t-2 border-[var(--accent)]" />
                      Fills realized (calibrated) · {pnlCompare.recCount} pts
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0 w-4 border-t-2 border-[var(--pos)]" />
                      Continuous total PnL · {pnlCompare.eqCount} pts
                    </span>
                  </div>
                  {pnlCompare.recCount < 2 ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-[var(--role-content-subtle)]">
                      Not enough fills to reconstruct a curve.
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={pnlCompare.rows} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                          <XAxis
                            dataKey="t"
                            type="number"
                            scale="time"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                            axisLine={{ stroke: 'var(--border-color)' }}
                          />
                          <YAxis
                            tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`}
                            tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                            axisLine={{ stroke: 'var(--border-color)' }}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip
                            contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                            labelStyle={{ color: 'var(--text-secondary)' }}
                            labelFormatter={(ts) => new Date(ts as number).toLocaleString('en-US')}
                            formatter={(value: number, name: string) => [`$${formatNumber(value, 2)}`, name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line
                            type="linear"
                            dataKey="snapshot"
                            name="Snapshot"
                            stroke="var(--role-content-subtle)"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="linear"
                            dataKey="reconstructed"
                            name="Fills realized"
                            stroke="var(--accent)"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="linear"
                            dataKey="equity"
                            name="Continuous total PnL"
                            stroke="var(--pos)"
                            strokeWidth={1.75}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              ) : chartView === 'calendar' ? (
                <div className="min-h-[380px]">
                  <PnlCalendarHeatmap closedPositions={closedPositions} dailyOverride={dailyPnlFromSeries} />
                </div>
              ) : chartView === 'drawdown' ? (
                <DrawdownChart history={history} address={address} />
              ) : chartView === 'trade' ? (
                <PerTradeChart closedPositions={closedPositions} address={address} />
              ) : heroPnl.data.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--role-content-subtle)] min-h-[380px]">
                  <div>
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No history data yet</p>
                    <p className="text-xs mt-1">Chart appears once the wallet has closed trades</p>
                  </div>
                </div>
              ) : (() => {
                // Source = the fills+klines continuous total-PnL curve when we
                // could reconstruct it, else the coarse snapshot (heroPnl).
                // Apply the time-range filter over its {t, v} points.
                const now = Date.now();
                const windowMs = chartRange === '24h' ? 86_400_000
                  : chartRange === '7d' ? 7 * 86_400_000
                  : chartRange === '30d' ? 30 * 86_400_000
                  : Infinity;
                const cutoff = now - windowMs;
                const filtered = chartRange === 'all'
                  ? heroPnl.data
                  : heroPnl.data.filter((p) => p.t >= cutoff);

                // Value toggle anchors the curve to the live balance for an
                // equity curve: value_t = base + totalPnl_t, base = balance − last.
                const lastNet = filtered.length ? filtered[filtered.length - 1].v : 0;
                const base = (margin?.totalBalance ?? 0) - lastNet;
                const isValue = heroMetric === 'value';
                const chartData = filtered.map((p) => ({ timestamp: p.t, series: isValue ? base + p.v : p.v }));

                // ONE x-axis tick per calendar day (or hour for 24h). Without
                // this recharts labels every data point, so a day with many
                // fills prints "Sep 6 · Sep 6 · Sep 7 · Sep 7 · Sep 7…". We take
                // the first timestamp of each distinct bucket instead.
                const dayTicks = (() => {
                  const seen = new Set<string>();
                  const ticks: number[] = [];
                  for (const d of chartData) {
                    const dt = new Date(d.timestamp);
                    const key = chartRange === '24h'
                      ? `${dt.getHours()}`
                      : `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
                    if (!seen.has(key)) { seen.add(key); ticks.push(d.timestamp); }
                  }
                  return ticks;
                })();

                const vals = chartData.map((d) => d.series);
                const minV = vals.length > 0 ? Math.min(...vals) : 0;
                const maxV = vals.length > 0 ? Math.max(...vals) : 0;
                // Where the zero line falls in the gradient (0 = top, 1 = bottom).
                const zeroPosition = maxV <= 0 ? 0 : minV >= 0 ? 1 : maxV / (maxV - minV);

                // Buy/sell markers. This wallet has hundreds of fills, so we
                // aggregate them into hourly buckets over the visible range,
                // take each bucket's NET direction (net buy vs net sell), snap
                // it onto the curve, and keep only the most significant by
                // notional so the chart stays readable instead of confetti.
                let markers: { x: number; y: number; isBuy: boolean; notional: number }[] = [];
                if (chartData.length > 0 && allFills.length > 0) {
                  const firstT = chartData[0].timestamp;
                  const lastT = chartData[chartData.length - 1].timestamp;
                  const BUCKET = 3_600_000; // 1h, matching the curve grid
                  const bmap = new Map<number, { net: number; notional: number }>();
                  for (const f of allFills) {
                    if (f.timestamp < firstT || f.timestamp > lastT) continue;
                    const bt = Math.floor(f.timestamp / BUCKET) * BUCKET;
                    const b = bmap.get(bt) ?? { net: 0, notional: 0 };
                    b.net += f.isBuy ? f.size : -f.size;
                    b.notional += Math.abs(f.size) * f.price;
                    bmap.set(bt, b);
                  }
                  // Snap a bucket time onto the curve (last point at or before).
                  const pointAt = (t: number) => {
                    let lo = 0, hi = chartData.length - 1, res: (typeof chartData)[number] | null = null;
                    while (lo <= hi) {
                      const m = (lo + hi) >> 1;
                      if (chartData[m].timestamp <= t) { res = chartData[m]; lo = m + 1; } else hi = m - 1;
                    }
                    return res;
                  };
                  markers = Array.from(bmap.entries())
                    .filter(([, b]) => Math.abs(b.net) > 1e-9)
                    .map(([bt, b]) => {
                      const pt = pointAt(bt);
                      return pt ? { x: pt.timestamp, y: pt.series, isBuy: b.net >= 0, notional: b.notional } : null;
                    })
                    .filter((m): m is { x: number; y: number; isBuy: boolean; notional: number } => m != null);
                  const MAX_MARKERS = 45;
                  if (markers.length > MAX_MARKERS) {
                    const keep = new Set(
                      [...markers].sort((a, b) => b.notional - a.notional).slice(0, MAX_MARKERS).map((m) => m.x),
                    );
                    markers = markers.filter((m) => keep.has(m.x));
                  }
                }

                if (chartData.length === 0) {
                  return (
                    <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--role-content-subtle)] min-h-[420px]">
                      <div>
                        <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>No trades in this range</p>
                        <p className="text-xs mt-1">Try a wider range above</p>
                      </div>
                    </div>
                  );
                }

                // Headline: the figure the curve ends on. For a time range it is
                // the change over that window, not the lifetime total.
                const firstV = filtered[0]?.v ?? 0;
                const headline = isValue
                  ? (margin?.totalBalance ?? base + lastNet)
                  : chartRange === 'all' ? lastNet : lastNet - firstV;
                const headlineTone = isValue ? 'var(--role-content)' : headline >= 0 ? 'var(--pos)' : 'var(--neg)';
                const rangeLabel = chartRange === 'all'
                  ? (lifetimeFillVol?.truncated ? 'Cumulative' : 'Lifetime')
                  : chartRange === '24h' ? 'Last 24h' : chartRange === '7d' ? 'Last 7 days' : 'Last 30 days';
                const sourceLabel = heroPnl.source === 'reconstructed' ? 'BULK fills + 1h marks' : heroPnl.source === 'realized' ? 'realized only' : 'collector snapshots';

                return (
                  <div className="flex-1 px-3 pb-2 pt-3 min-h-[260px] flex flex-col">
                    <div className="px-1 mb-2">
                      <div className="font-mono text-[26px] leading-none font-medium tabular-nums tracking-tight" style={{ color: headlineTone }}>
                        {isValue ? '' : headline >= 0 ? '+' : '−'}${formatNumber(Math.abs(headline), 2)}
                      </div>
                      <div className="mt-1.5 text-[11px] text-[var(--role-content-subtle)]">
                        {isValue ? 'Net worth' : `${rangeLabel} PnL`} · {sourceLabel}
                        {filtered.length > 0 && ` · from ${new Date(filtered[0].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        {chartRange === 'all' && lifetimeFillVol?.truncated && ' · fill history capped at 1,000'}
                      </div>
                    </div>
                    <ChartFrame title={isValue ? 'Account value' : 'PnL history'} className="flex-1 min-h-[220px]" yLabel={isValue ? 'Account value (USD)' : 'Cumulative PnL (USD)'} walletAddress={address}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                        <defs>
                          <linearGradient id="pnlLineGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--pos)" />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="var(--pos)" />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="var(--neg)" />
                            <stop offset="100%" stopColor="var(--neg)" />
                          </linearGradient>
                          <linearGradient id="pnlFillGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.3} />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="var(--pos)" stopOpacity={0.1} />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="var(--neg)" stopOpacity={0.1} />
                            <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.3} />
                          </linearGradient>
                          {/* Diagonal engraved hatch, laid over the gradient fill
                              for an etched, editorial texture (same language as the
                              dashboard sparklines). Neutral + faint so it reads over
                              both the green and red halves. */}
                          <pattern id="pnlHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--role-content)" strokeWidth="0.6" strokeOpacity={0.06} />
                          </pattern>
                        </defs>
                        <XAxis
                          dataKey="timestamp"
                          ticks={dayTicks}
                          tickFormatter={(ts) => {
                            const d = new Date(ts);
                            return chartRange === '24h'
                              ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
                              : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          }}
                          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                        />
                        <YAxis
                          tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`}
                          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                          labelStyle={{ color: 'var(--text-secondary)' }}
                          labelFormatter={(ts) => new Date(ts).toLocaleString('en-US')}
                          formatter={(value: number) => {
                            const color = value >= 0 ? 'var(--pos)' : 'var(--neg)';
                            return [<span style={{ color }}>${formatNumber(value, 2)}</span>, isValue ? 'Account value' : 'Total PnL'];
                          }}
                        />
                        <Area
                          // Re-key on range/metric so recharts replays its
                          // left-to-right reveal on every swap — a clean smooth
                          // transition instead of morphing the path across a
                          // completely different x-domain (which looks jumpy).
                          key={`${chartRange}-${heroMetric}`}
                          type="monotone"
                          dataKey="series"
                          stroke="url(#pnlLineGradient)"
                          strokeWidth={2}
                          fill="url(#pnlFillGradient)"
                          isAnimationActive
                          animationDuration={550}
                          animationEasing="ease-out"
                        />
                        {/* Hatch texture overlay — same curve, no line, just the
                            engraved fill on top of the gradient. */}
                        <Area
                          key={`hatch-${chartRange}-${heroMetric}`}
                          type="monotone"
                          dataKey="series"
                          stroke="none"
                          fill="url(#pnlHatch)"
                          isAnimationActive={false}
                        />
                        {/* Buy (bids) / sell (asks) markers, aggregated per hour
                            and sitting on the curve. A bg-tinted ring lifts them
                            off the line. They are NOT animated - they snap to
                            their spots instantly while the curve reveals under
                            them. */}
                        {markers.map((m) => (
                          <ReferenceDot
                            key={`${m.x}-${m.isBuy}`}
                            x={m.x}
                            y={m.y}
                            r={3.5}
                            fill={m.isBuy ? 'var(--bids)' : 'var(--asks)'}
                            stroke="var(--bg-muted)"
                            strokeWidth={1.5}
                            ifOverflow="hidden"
                            isFront
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                    </ChartFrame>
                  </div>
                );
              })()}
                </div>

                {chartView === 'pnl' && visibleRange && (
                  <PositionBands positions={positions} openTimes={positionOpenTimes} t0={visibleRange.t0} t1={visibleRange.t1} selectedSymbol={selectedSymbol} />
                )}

                {/* The figures that belong with the curve, one line. */}
                <PerformanceStrip
                  series={heroPnl.data}
                  source={heroPnl.source}
                  daily={dailyPnlFromSeries}
                  margin={margin}
                  closedPositions={closedPositions}
                  analysisStats={analysisStats}
                  tradeCount={bulkClosedCount}
                  compact
                />
              </section>

              {/* POSITIONS */}
              <div className="order-2 lg:order-3 min-h-0 min-w-0 flex flex-col">
                <PositionsPane
                  address={address}
                  positions={positions}
                  markPrices={markPrices}
                  klinesBySymbol={klinesBySymbol}
                  openTimes={positionOpenTimes}
                  closedPositions={closedPositions}
                  tab={positionsTab}
                  onTab={(t) => { setPositionsTab(t); setTabIsUserPicked(true); }}
                  selected={selectedPos}
                  onSelect={setSelectedPos}
                  onOpenChart={openLiveChart}
                  onShare={openShareCard}
                  onSelectClosed={openClosedChart}
                  loading={!hasLiveData}
                />
              </div>
            </div>

            {/* ── TAPE ───────────────────────────────────────────────────── */}
            <div className="shrink-0">
              <Tape events={tapeEvents} expanded={tapeOpen} onToggle={() => setTapeOpen((o) => !o)} />
            </div>
          </div>
        )}
      </main>

      {/* Position-detail chart modal — opened by clicking a position card.
          Renders a candle chart for the position's market with horizontal
          lines at entry / mark / liq. The BULK dev's marquee request for
          the tournament broadcast view. */}
      <PositionChartModal
        position={chartPosition}
        onClose={() => setChartPosition(null)}
      />
    </div>
  );
}
