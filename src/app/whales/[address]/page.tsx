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
  size = 36,
  date,
  pnl,
  bg,
  isNoTrade,
  isWin,
}: {
  size?: number;
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
        className="rounded-[4px] cursor-pointer transition-transform hover:scale-110 hover:ring-1 hover:ring-[var(--text-secondary)]/40"
        style={{
          width: size,
          height: size,
          ...(isNoTrade ? { backgroundColor: 'var(--border-color)', opacity: 0.5 } : { backgroundColor: bg }),
        }}
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

function PnlCalendarHeatmap({ closedPositions, dailyOverride, compact = false }: { closedPositions: ClosedPosition[]; dailyOverride?: Map<string, number> | null; compact?: boolean }) {
  // Compact = the Daily-performance card: small cells, no side bar chart.
  const CELL = compact ? 18 : 36;
  const GAP = compact ? 3 : 5;
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
  // Floor: show at least 16 weeks even for a brand-new wallet, so the grid
  // reads as a calendar (empty cells are information too) rather than a
  // couple of orphan squares.
  const sixteenWeeksAgo = new Date(today);
  sixteenWeeksAgo.setDate(sixteenWeeksAgo.getDate() - 16 * 7);
  const naturalStart = earliestDate > fourteenMonthsAgo ? earliestDate : fourteenMonthsAgo;
  const rangeStart = naturalStart < sixteenWeeksAgo ? naturalStart : sixteenWeeksAgo;
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
    <div className={cn("flex-1", compact ? "h-full px-5 pt-4 pb-3 overflow-x-auto flex flex-col justify-center" : "p-4 min-h-[420px]")}>
      {/* Summary strip — gives context for the heatmap below. */}
      <div className={cn("flex items-center gap-x-5 gap-y-1 mb-4 text-xs flex-wrap", compact && "mb-3 text-[11px]")}>
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
      <div className={cn("flex flex-col gap-6", !compact && "lg:flex-row lg:items-stretch")}>
      <div className="shrink-0">
        <div className="inline-flex items-start gap-2">
          {/* Weekday labels — 14px rows + 3px gaps to line up with cells. */}
          <div className="flex flex-col shrink-0 pr-1" style={{ gap: GAP }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div
                key={d}
                className="text-[10px] text-[var(--text-tertiary)] tabular-nums"
                style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden', height: CELL, lineHeight: `${CELL}px` }}
              >
                {d}
              </div>
            ))}
          </div>
          {/* Week columns — 36px cells, 5px gaps. */}
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((week, col) => (
              <div key={col} className="flex flex-col" style={{ gap: GAP }}>
                {week.map((day, row) => {
                  if (day.isFuture) {
                    return <div key={row} style={{ width: CELL, height: CELL }} />;
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
                      size={CELL}
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
        <div className="flex mt-2 text-[10px] text-[var(--text-tertiary)] tabular-nums uppercase tracking-wider" style={{ marginLeft: compact ? '34px' : '41px' }}>
          {monthLabels.map((m, idx) => {
            const nextCol = idx + 1 < monthLabels.length ? monthLabels[idx + 1].col : weeks.length;
            const widthCols = nextCol - m.col;
            return (
              <div key={`${m.col}-${m.label}`} style={{ width: `${widthCols * (CELL + GAP)}px` }}>
                {m.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily-PnL bars — fills the space beside the heatmap with a real
          readout of each trading day's realized PnL, green up / red down. */}
      {!compact && dailyBars.length > 0 && (
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
/** Thin track with one fill (and an optional second fill from the right). */
/** Label/value row for the rail ledger. Hairlines come from the parent `divide-y`. */
/** One figure in the ticker line. */
/**
 * Who this trader is, as one factual sentence built only from clauses the
 * data supports. No adjectives the numbers didn't earn.
 */
/**
 * Right pane: the live list. One row per open position with a 24h price
 * sparkline oriented to the position's side, keyboard-navigable (j/k, ↵
 * opens the chart, s opens the share card, esc clears). Tabs swap the list
 * for closed trades, liquidations and the account activity feed.
 */
/**
 * Position bands under the curve: one thin bar per open position from the
 * moment it opened to now, on the SAME time axis as the visible chart, so you
 * can read "this leg of the curve happened while BTC was open" directly.
 */
/** The bottom tape: what the wallet just did, newest first, one line each. */
// ============================================================================
// Portfolio-style wallet page
//
// Calm, card-based, few numbers. Modelled on BULK's own Portfolio view so a
// trader landing here from the exchange already knows how to read it:
//   rail   — identity, follow, two KPI tiles, Overview + Performance lists
//   top    — account value / PnL chart with three cells beneath · daily calendar
//   middle — risk gauges · net positions exposure
//   bottom — one tabbed table
// Labels are sentence case at reading size; the big figure carries the card.
// ============================================================================

type OpenPos = NonNullable<WalletData['live']>['positions'][number];

function Card({ title, right, children, className, bodyClassName }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col min-w-0', className)}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-x-3 gap-y-2 px-5 min-h-12 py-2 flex-wrap border-b border-[var(--border-color)] shrink-0">
          <h2 className="text-[15px] font-medium text-[var(--role-content)] truncate">{title}</h2>
          {right}
        </div>
      )}
      <div className={cn('flex-1 min-h-0', bodyClassName)}>{children}</div>
    </section>
  );
}

function toneColor(tone?: 'green' | 'red' | 'orange' | 'neutral' | 'muted') {
  return tone === 'green' ? 'var(--pos)' : tone === 'red' ? 'var(--neg)' : tone === 'orange' ? 'var(--warn, var(--neg))' : tone === 'muted' ? 'var(--role-content-subtle)' : 'var(--role-content)';
}

/** Big-figure metric with an optional thin bar and a context line. */
function Metric({ label, value, sub, tone = 'neutral', bar, className }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'orange' | 'neutral' | 'muted';
  bar?: { pct: number; color?: string } | null; className?: string;
}) {
  return (
    <div className={cn('min-w-0 flex flex-col gap-1.5', className)}>
      <div className="text-[13px] text-[var(--role-content-muted)]">{label}</div>
      <div className="font-mono text-[22px] leading-none font-medium tabular-nums tracking-tight truncate" style={{ color: toneColor(tone) }}>{value}</div>
      {bar && (
        <div className="h-1.5 w-full rounded-full bg-[var(--role-surface-raised)] overflow-hidden mt-0.5">
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, bar.pct)) * 100}%`, background: bar.color ?? 'var(--accent)' }} />
        </div>
      )}
      {sub && <div className="text-[12px] text-[var(--role-content-subtle)] truncate">{sub}</div>}
    </div>
  );
}

/** Plain label/value row for the rail lists. */
function Row({ label, value, tone = 'neutral', title }: { label: string; value: ReactNode; tone?: 'green' | 'red' | 'neutral' | 'muted'; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px] text-[14px]" title={title}>
      <span className="text-[var(--role-content-muted)] truncate">{label}</span>
      <span className="font-mono tabular-nums shrink-0" style={{ color: toneColor(tone) }}>{value}</span>
    </div>
  );
}

/** Muted KPI tile (the rail's "Volume (14d)" / "Fees" style). */
function Tile({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg bg-[var(--role-surface-raised)] px-4 py-3.5" title={title}>
      <div className="text-[13px] text-[var(--role-content-muted)]">{label}</div>
      <div className="mt-1 font-mono text-[22px] leading-none font-medium tabular-nums tracking-tight text-[var(--role-content)] truncate">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-[var(--role-content-subtle)]">{sub}</div>}
    </div>
  );
}

/** Net positions exposure: one bar per market, long in brand gold, short in red. */
function ExposureBars({ positions }: { positions: OpenPos[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { long: number; short: number }>();
    for (const p of positions) {
      const n = Math.abs((p.size || 0) * (p.price || 0));
      const r = m.get(p.symbol) ?? { long: 0, short: 0 };
      if ((p.size || 0) > 0) r.long += n; else r.short += n;
      m.set(p.symbol, r);
    }
    const list = [...m.entries()].map(([symbol, r]) => ({ symbol, ...r, total: r.long + r.short }));
    const max = Math.max(1, ...list.map((r) => r.total));
    return { list: list.sort((a, b) => b.total - a.total), max };
  }, [positions]);
  if (rows.list.length === 0) {
    return <div className="flex-1 grid place-items-center p-8 text-[13px] text-[var(--role-content-subtle)]">No open positions</div>;
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 px-5 py-4 flex flex-col gap-3.5">
        {rows.list.map((r) => (
          <div key={r.symbol} className="grid grid-cols-[96px_1fr_auto] items-center gap-4">
            <span className="text-[14px] text-[var(--role-content)] truncate">{r.symbol}</span>
            <div className="flex h-2.5 w-full rounded-sm overflow-hidden bg-transparent">
              <div className="h-full rounded-sm" style={{ width: `${(r.long / rows.max) * 100}%`, background: 'var(--accent)' }} />
              <div className="h-full rounded-sm" style={{ width: `${(r.short / rows.max) * 100}%`, background: 'var(--neg)', opacity: 0.85 }} />
            </div>
            <span className="font-mono text-[13px] tabular-nums text-[var(--role-content-muted)] w-20 text-right">${formatCompact(r.total)}</span>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center justify-end gap-5 text-[12px] text-[var(--role-content-muted)]">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-6 rounded-sm" style={{ background: 'var(--accent)' }} />Net long exposure</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-6 rounded-sm" style={{ background: 'var(--neg)', opacity: 0.85 }} />Net short exposure</span>
      </div>
    </div>
  );
}

/** Longest / current win streak, in trades, from the closed history. */
function streaks(closed: ClosedPosition[]) {
  const chrono = [...closed].sort((a, b) => a.closedAt - b.closedAt);
  let longest = 0, run = 0, from = 0, to = 0, bestFrom = 0, bestTo = 0;
  for (const p of chrono) {
    if (p.realizedPnl >= 0) { if (run === 0) from = p.closedAt; run++; to = p.closedAt; if (run > longest) { longest = run; bestFrom = from; bestTo = to; } }
    else run = 0;
  }
  // Current streak: sign-consistent run at the tail (wins or losses).
  let current = 0, currentWin = true;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const w = chrono[i].realizedPnl >= 0;
    if (current === 0) { currentWin = w; current = 1; }
    else if (w === currentWin) current++;
    else break;
  }
  return { longest, bestFrom, bestTo, current, currentWin };
}

/** The tabbed positions table (open positions markup lives here; other tabs delegate). */
function PositionsTable({ positions, markPrices, openTimes, onOpen, onShare }: {
  positions: OpenPos[]; markPrices: Record<string, number>; openTimes: Record<string, PositionOpenInfo | null>;
  onOpen: (p: OpenPos) => void; onShare: (symbol: string) => void;
}) {
  if (positions.length === 0) {
    return <div className="p-10 text-center text-[13px] text-[var(--role-content-subtle)]">No open positions</div>;
  }
  const rows = [...positions].sort((a, b) => Math.abs(b.notional || 0) - Math.abs(a.notional || 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-[12px] text-[var(--role-content-muted)] border-b border-[var(--border-color)]">
            <th className="text-left font-normal px-5 py-3">Market</th>
            <th className="text-left font-normal px-4 py-3">Side</th>
            <th className="text-right font-normal px-4 py-3">Size</th>
            <th className="text-right font-normal px-4 py-3">Entry</th>
            <th className="text-right font-normal px-4 py-3">Mark</th>
            <th className="text-right font-normal px-4 py-3 hidden md:table-cell">Liq. price</th>
            <th className="text-right font-normal px-4 py-3">Unrealized PnL</th>
            <th className="text-right font-normal px-4 py-3 hidden lg:table-cell">Opened</th>
            <th className="w-px px-3 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--role-line-subtle)]">
          {rows.map((p) => {
            const isLong = p.size > 0;
            const mark = markPrices[p.symbol] || p.price;
            const notional = Math.abs(p.size * mark);
            const pct = notional ? (p.unrealizedPnl / notional) * 100 : 0;
            const opened = openTimes[p.symbol];
            const dp = (x: number) => (x < 1 ? 4 : x < 100 ? 2 : 0);
            return (
              <tr key={p.symbol} className="cursor-pointer hover:bg-[var(--role-surface-raised)]/50 transition-colors" onClick={() => onOpen(p)}>
                <td className="px-5 py-3.5 font-medium text-[var(--role-content)] whitespace-nowrap">{p.symbol}<span className="ml-2 font-mono text-[12px] text-[var(--role-content-subtle)]">{p.leverage}×</span></td>
                <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: isLong ? 'var(--pos)' : 'var(--neg)' }}>{isLong ? 'Long' : 'Short'}</td>
                <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[var(--role-content)] whitespace-nowrap">{formatNumber(Math.abs(p.size), 4)}<span className="block text-[11px] text-[var(--role-content-subtle)]">${formatCompact(notional)}</span></td>
                <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[var(--role-content-muted)]">{formatNumber(p.price, dp(p.price))}</td>
                <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[var(--role-content)]">{formatNumber(mark, dp(mark))}</td>
                <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[var(--role-content-muted)] hidden md:table-cell">{p.liquidationPrice ? formatNumber(p.liquidationPrice, dp(p.liquidationPrice)) : '—'}</td>
                <td className="px-4 py-3.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ color: p.unrealizedPnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {p.unrealizedPnl >= 0 ? '+' : '−'}${formatNumber(Math.abs(p.unrealizedPnl), 2)}<span className="block text-[11px] opacity-80">{formatPercent(pct)}</span>
                </td>
                <td className="px-4 py-3.5 text-right text-[12px] text-[var(--role-content-subtle)] whitespace-nowrap hidden lg:table-cell">{opened ? `${formatDuration(Date.now() - opened.openedAt)} ago` : '—'}</td>
                <td className="px-3 py-3.5 text-right">
                  <button type="button" title="Share card" aria-label={`Share ${p.symbol}`} onClick={(e) => { e.stopPropagation(); onShare(p.symbol); }}
                    className="p-1.5 rounded-md text-[var(--role-content-subtle)] hover:text-[var(--accent)] hover:bg-[var(--role-surface-raised)] transition-colors"><ImageIcon className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

  const streakInfo = useMemo(() => streaks(closedPositions), [closedPositions]);
  // Max drawdown of EQUITY (starting equity + cumulative PnL), peak → trough.
  // The old realized-only figure divided by a tiny early peak and printed
  // nonsense like 156%; equity-based is what a trader means by drawdown.
  const equityDrawdown = useMemo(() => {
    const series = heroPnl.data;
    if (series.length < 2 || !margin) return null;
    const base = margin.totalBalance - series[series.length - 1].v;
    if (base <= 0) return null;
    let peak = -Infinity, dd = 0;
    for (const p of series) {
      const eq = base + p.v;
      if (eq > peak) peak = eq;
      if (peak > 0) dd = Math.max(dd, (peak - eq) / peak);
    }
    return dd;
  }, [heroPnl.data, margin]);

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
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] animate-[whale-reveal_0.45s_ease-out]">
      {cardData && <TradeShareCard data={cardData} onClose={() => setCardData(null)} />}
      <main className="flex-1 w-full px-4 sm:px-5 py-4">
        <div className="max-w-[1600px] mx-auto">
        {error && !hasTrackedData ? (
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-10 text-center max-w-xl mx-auto mt-8">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-bulk-red opacity-60" />
            <h2 className="text-lg font-medium mb-1">Wallet not found</h2>
            <p className="text-[14px] text-[var(--role-content-muted)] mb-5">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[14px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors"><ArrowLeft className="w-4 h-4" /> Whale Tracker</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-3 items-start">

            {/* ── RAIL ─────────────────────────────────────────────────── */}
            <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
              <Card bodyClassName="p-5">
                <Link href="/whales" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--role-content-subtle)] hover:text-[var(--role-content)] transition-colors mb-4"><ArrowLeft className="w-3.5 h-3.5" />Whale Tracker</Link>
                <div className="flex items-center gap-3">
                  {twitterAvatar ? (
                    <img src={twitterAvatar} alt="" width={44} height={44} loading="eager" decoding="async" className="w-11 h-11 rounded-lg border border-[var(--border-color)] object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <span className="w-11 h-11 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/30 grid place-items-center shrink-0"><Wallet className="w-5 h-5 text-[var(--accent)]" /></span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h1 className="font-mono text-[18px] font-medium text-[var(--role-content)] truncate">{displayName || formatAddress(address)}</h1>
                      <button onClick={copyAddress} className="p-1 shrink-0 rounded hover:bg-[var(--role-surface-raised)] transition-colors" title="Copy address" aria-label="Copy address">
                        {copied ? <Check className="w-3.5 h-3.5 text-bulk-green" /> : <Copy className="w-3.5 h-3.5 text-[var(--role-content-subtle)]" />}
                      </button>
                      {isOwnWallet && <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-[var(--accent)]/15 text-[var(--accent)]">You</span>}
                    </div>
                    {twitterHandle ? (
                      <a href={`https://twitter.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[var(--role-content-muted)] hover:text-[var(--role-content)]"><XIcon className="w-3 h-3" />@{twitterHandle}</a>
                    ) : (
                      <div className="font-mono text-[11px] text-[var(--role-content-subtle)] truncate" title={address}>{address}</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {isSystemWallet(address) ? (
                    <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]" title="Operated by the BULK exchange protocol"><Shield className="w-3.5 h-3.5" />BULK System</span>
                  ) : <BulkRankBadge address={address} />}
                  <AccountHierarchy address={address} />
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {!isOwnWallet && (
                    <button onClick={toggleFollow} disabled={followLoading}
                      className={cn('w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[14px] font-medium border transition-colors disabled:opacity-50',
                        isFollowing ? 'border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15' : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110')}>
                      {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowing ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                  {canClaimWallet && (
                    <button onClick={handleClaimWallet} disabled={claimLoading} className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[14px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors disabled:opacity-50">
                      {claimLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}This is my wallet
                    </button>
                  )}
                  {isClaimedWallet && <span className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[14px] border border-[var(--accent)]/30 text-[var(--accent)]"><UserCheck className="w-4 h-4" />Your claimed wallet</span>}
                  <div className="flex items-center gap-2">
                    <a href={`https://explorer.bulk.trade/address/${address}`} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Explorer<ExternalLink className="w-3.5 h-3.5" /></a>
                    <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Solscan<ExternalLink className="w-3.5 h-3.5" /></a>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2.5">
                  <Tile label="Volume (30d)" value={volByWindow ? `$${formatNumber(volByWindow.d30, 2)}` : '—'} sub={lifetimeFillVol?.truncated ? 'from the latest 1,000 fills' : undefined} />
                  <Tile label="Net fees" value={lifetimeFees !== null ? `${lifetimeFees > 0 ? '+' : lifetimeFees < 0 ? '−' : ''}$${formatNumber(Math.abs(lifetimeFees), 2)}` : '—'} sub={lifetimeFees !== null ? (lifetimeFees > 0 ? 'net maker rebates received' : 'paid, lifetime') : undefined} />
                </div>
              </Card>

              <Card bodyClassName="px-5 py-4">
                <h2 className="text-[15px] font-medium text-[var(--role-content)] mb-2">Overview</h2>
                <Row label="Total equity" value={margin ? `$${formatNumber(margin.totalBalance, 2)}` : '—'} tone={margin ? 'neutral' : 'muted'} />
                <Row label="Available" value={margin ? `$${formatNumber(margin.availableBalance, 2)}` : '—'} tone={margin ? 'neutral' : 'muted'} />
                <Row label="All-time volume" value={`$${formatNumber(bulkVolume, 2)}`} />
                <Row label="All-time PnL" value={`${bulkRealizedPnL >= 0 ? '+' : '−'}$${formatNumber(Math.abs(bulkRealizedPnL), 2)}`} tone={bulkRealizedPnL >= 0 ? 'green' : 'red'} title="Net realized PnL after fees and funding" />
                <Row label="Unrealized PnL" value={margin ? `${margin.unrealizedPnl >= 0 ? '+' : '−'}$${formatNumber(Math.abs(margin.unrealizedPnl), 2)}` : '—'} tone={!margin ? 'muted' : margin.unrealizedPnl >= 0 ? 'green' : 'red'} />
                <Row label="Open position size" value={`$${formatNumber(totalNotional, 2)}`} />
                <Row label="Open positions" value={String(positions.length)} />
              </Card>

              <Card bodyClassName="px-5 py-4">
                <h2 className="text-[15px] font-medium text-[var(--role-content)] mb-2">Performance</h2>
                <Row label="Closed trades" value={bulkClosedCount.toLocaleString('en-US')} />
                <Row label="Win rate" value={analysisStats.closedWinRate !== null ? `${(analysisStats.closedWinRate * 100).toFixed(1)}%` : '—'} tone={analysisStats.closedWinRate === null ? 'muted' : analysisStats.closedWinRate >= 0.5 ? 'green' : 'red'} />
                <Row label="Max drawdown" value={equityDrawdown !== null ? `${(equityDrawdown * 100).toFixed(2)}%` : '—'} tone={equityDrawdown === null ? 'muted' : equityDrawdown >= 0.5 ? 'red' : 'neutral'} title="Largest fall of equity below an earlier high on the PnL curve" />
                <Row label="Fees" value={lifetimeFees !== null ? `${lifetimeFees > 0 ? '+' : lifetimeFees < 0 ? '−' : ''}$${formatNumber(Math.abs(lifetimeFees), 2)}` : '—'} tone={lifetimeFees === null ? 'muted' : 'neutral'} />
                <Row label="Funding" value={lifetimeFunding !== null ? `${lifetimeFunding >= 0 ? '+' : '−'}$${formatNumber(Math.abs(lifetimeFunding), 2)}` : '—'} tone={lifetimeFunding === null ? 'muted' : lifetimeFunding >= 0 ? 'green' : 'red'} />
                <Row label="Liquidations" value={String(tracked?.total_liquidations || 0)} tone={(tracked?.total_liquidations || 0) > 0 ? 'red' : 'neutral'} />
                {analysisStats.tradingStyle !== 'Unknown' && <Row label="Trading style" value={analysisStats.tradingStyle} />}
                <Row label="Size cohort" value={analysisStats.sizeCohort} />
              </Card>
            </aside>

            {/* ── MAIN ─────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 min-w-0">

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,452px)] gap-3">
                {/* Account value / PnL */}
                <Card
                  title={
                    <div className="flex items-center gap-1 -ml-2 overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0" role="tablist">
                      {([['value', 'Account value'], ['pnl', 'PnL']] as const).map(([m, label]) => (
                        <button key={m} type="button" role="tab" aria-selected={chartView === 'pnl' && heroMetric === m}
                          onClick={() => { setChartView('pnl'); setHeroMetric(m); }}
                          className={cn('relative px-2 py-1 text-[15px] font-medium transition-colors', chartView === 'pnl' && heroMetric === m ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                          {label}
                          {chartView === 'pnl' && heroMetric === m && <span className="absolute left-2 right-2 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent)]" />}
                        </button>
                      ))}
                      {([['drawdown', 'Drawdown'], ['trade', 'Per-trade']] as const).map(([v, label]) => (
                        <button key={v} type="button" role="tab" aria-selected={chartView === v} onClick={() => setChartView(v)}
                          className={cn('relative px-2 py-1 text-[15px] font-medium transition-colors', chartView === v ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                          {label}
                          {chartView === v && <span className="absolute left-2 right-2 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent)]" />}
                        </button>
                      ))}
                    </div>
                  }
                  right={chartView === 'pnl' && (
                    <div className="flex items-center rounded-lg border border-[var(--border-color)] p-0.5 text-[12px]">
                      {(['24h', '7d', '30d', 'all'] as const).map((r) => (
                        <button key={r} type="button" onClick={() => setChartRange(r)}
                          className={cn('px-2.5 py-1 rounded-md transition-colors', chartRange === r ? 'text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                          {r === 'all' ? 'All' : r}
                        </button>
                      ))}
                    </div>
                  )}
                  bodyClassName="flex flex-col"
                >
                  <div className="flex-1 min-h-0 flex flex-col">
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
                <div className="min-h-[360px]">
                  <PnlCalendarHeatmap closedPositions={closedPositions} dailyOverride={dailyPnlFromSeries} />
                </div>
              ) : chartView === 'drawdown' ? (
                <DrawdownChart history={history} address={address} />
              ) : chartView === 'trade' ? (
                <PerTradeChart closedPositions={closedPositions} address={address} />
              ) : heroPnl.data.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--role-content-subtle)] min-h-[360px]">
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
                  <div className="flex-1 px-5 pb-3 pt-5 min-h-[360px] flex flex-col">
                    <div className="mb-3">
                      <div className="font-mono text-[30px] leading-none font-medium tabular-nums tracking-tight" style={{ color: headlineTone }}>
                        {isValue ? '' : headline >= 0 ? '+' : '−'}${formatNumber(Math.abs(headline), 2)}
                      </div>
                      <div className="mt-2 text-[13px] text-[var(--role-content-muted)]" title={`${sourceLabel}${filtered.length > 0 ? ` · from ${new Date(filtered[0].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`}>
                        {chartRange === 'all' ? (lifetimeFillVol?.truncated ? 'Since the earliest loaded fill' : 'All time') : rangeLabel}
                        {chartRange === 'all' && lifetimeFillVol?.truncated && <span className="text-[var(--role-content-subtle)]"> · history capped at 1,000 fills</span>}
                      </div>
                    </div>
                    <ChartFrame title={isValue ? 'Account value' : 'PnL history'} className="flex-1 min-h-[260px]" yLabel={isValue ? 'Account value (USD)' : 'Cumulative PnL (USD)'} walletAddress={address}>
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-color)] border-t border-[var(--border-color)]">
                    <Metric className="px-5 py-4" label="Margin used" value={margin ? `$${formatNumber(margin.marginUsed, 2)}` : '—'} tone={margin ? 'neutral' : 'muted'}
                      bar={margin && margin.totalBalance > 0 ? { pct: margin.marginUsed / margin.totalBalance, color: 'var(--accent)' } : null}
                      sub={margin && margin.totalBalance > 0 ? `${((margin.marginUsed / margin.totalBalance) * 100).toFixed(1)}% of $${formatCompact(margin.totalBalance)} equity` : undefined} />
                    <Metric className="px-5 py-4" label="Unrealized PnL" value={margin ? `${margin.unrealizedPnl >= 0 ? '+' : '−'}$${formatNumber(Math.abs(margin.unrealizedPnl), 2)}` : '—'} tone={!margin ? 'muted' : margin.unrealizedPnl >= 0 ? 'green' : 'red'}
                      sub={`${positions.length} open position${positions.length === 1 ? '' : 's'}`} />
                    <Metric className="px-5 py-4" label="Account leverage" value={effectiveLeverage !== null ? `${effectiveLeverage.toFixed(1)}x` : '—'} tone={effectiveLeverage === null ? 'muted' : 'neutral'}
                      sub={margin ? `$${formatCompact(totalNotional)} notional · $${formatCompact(margin.totalBalance)} equity` : undefined} />
                  </div>
                </Card>

                {/* Daily performance */}
                <Card title="Daily performance" right={<span className="text-[12px] text-[var(--role-content-subtle)]">closed-trade PnL by day</span>} bodyClassName="flex flex-col">
                  <div className="flex-1 min-h-[220px]">
                    <PnlCalendarHeatmap closedPositions={closedPositions} dailyOverride={dailyPnlFromSeries} compact />
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-[var(--border-color)] border-t border-[var(--border-color)]">
                    <Metric className="px-5 py-4" label="Longest win streak" value={streakInfo.longest ? `${streakInfo.longest} trade${streakInfo.longest === 1 ? '' : 's'}` : '—'} tone={streakInfo.longest ? 'green' : 'muted'}
                      sub={streakInfo.longest ? `${new Date(streakInfo.bestFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(streakInfo.bestTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'no closed trades yet'} />
                    <Metric className="px-5 py-4" label="Current streak" value={streakInfo.current ? `${streakInfo.current} ${streakInfo.currentWin ? 'win' : 'loss'}${streakInfo.current === 1 ? '' : streakInfo.currentWin ? 's' : 'es'}` : '—'} tone={!streakInfo.current ? 'muted' : streakInfo.currentWin ? 'green' : 'red'}
                      sub={streakInfo.current ? 'consecutive closed trades' : undefined} />
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3">
                {/* Risk */}
                <Card title="Risk" bodyClassName="flex flex-col divide-y divide-[var(--border-color)]">
                  <Metric className="px-5 py-5 flex-1 justify-center" label="Distance to liquidation" value={distanceToLiq ? `${(distanceToLiq.pct * 100).toFixed(2)}%` : '—'}
                    tone={!distanceToLiq ? 'muted' : distanceToLiq.pct < 0.05 ? 'red' : distanceToLiq.pct < 0.15 ? 'orange' : 'green'}
                    bar={distanceToLiq ? { pct: distanceToLiq.pct, color: distanceToLiq.pct < 0.05 ? 'var(--neg)' : distanceToLiq.pct < 0.15 ? 'var(--warn, var(--neg))' : 'var(--pos)' } : null}
                    sub={distanceToLiq ? `Closest: ${distanceToLiq.symbol}` : 'No open positions'} />
                  <Metric className="px-5 py-5 flex-1 justify-center" label="Direction bias" value={directionBias ? directionBias.label : '—'}
                    tone={!directionBias ? 'muted' : directionBias.longPct > 0.6 ? 'green' : directionBias.longPct < 0.4 ? 'red' : 'neutral'}
                    bar={directionBias ? { pct: directionBias.longPct, color: 'var(--pos)' } : null}
                    sub={directionBias ? `${(directionBias.longPct * 100).toFixed(0)}% long $${formatCompact(directionBias.longNotional)} · ${((1 - directionBias.longPct) * 100).toFixed(0)}% short $${formatCompact(directionBias.shortNotional)}` : 'No open positions'} />
                </Card>
                {/* Net positions exposure */}
                <Card title="Net positions exposure" right={positions.length > 0 ? <span className="text-[12px] text-[var(--role-content-subtle)]">{positions.length} market{positions.length === 1 ? '' : 's'} · ${formatCompact(totalNotional)}</span> : undefined} bodyClassName="flex flex-col">
                  <ExposureBars positions={positions} />
                </Card>
              </div>

              {/* Tabbed table */}
              <Card bodyClassName="flex flex-col">
                <div className="px-5 border-b border-[var(--border-color)] flex items-end gap-1" role="tablist">
                  {([
                    ['open', `Positions (${positions.length})`],
                    ['recent', `Closed (${closedPositions.length})`],
                    ['liquidations', 'Liquidations'],
                    ['activity', 'Account history'],
                  ] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={positionsTab === k} onClick={() => { setPositionsTab(k); setTabIsUserPicked(true); }}
                      className={cn('px-3 pt-3.5 pb-3 text-[15px] font-medium border-b-2 transition-colors whitespace-nowrap', positionsTab === k ? 'border-[var(--accent)] text-[var(--role-content)]' : 'border-transparent text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="max-h-[560px] overflow-y-auto">
                  {positionsTab === 'open' ? (
                    !hasLiveData && positions.length === 0 ? (
                      <div className="p-6 text-[13px] text-[var(--role-content-muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />Fetching positions…</div>
                    ) : <PositionsTable positions={positions} markPrices={markPrices} openTimes={positionOpenTimes} onOpen={openLiveChart} onShare={openShareCard} />
                  ) : positionsTab === 'recent' ? (
                    <ClosedPositionsList address={address} provided={closedPositions} limit={100} density="table" onSelect={openClosedChart} />
                  ) : positionsTab === 'liquidations' ? (
                    <RiskEventsList address={address} bare />
                  ) : (
                    <ActivityFeed address={address} />
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}
        </div>
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
