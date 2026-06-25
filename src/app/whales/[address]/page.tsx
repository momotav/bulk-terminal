'use client';

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity,
  AlertCircle, Clock, Loader2, UserCheck,
  BarChart3, Flame, Shield, PiggyBank, DollarSign,
  Receipt, Repeat, Share2
} from 'lucide-react';
import { wallet, leaderboard, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, type BulkLeaderboardRankResponse, type ClosedPosition, userApi } from '@/lib/api';
import { isSystemWallet } from '@/lib/systemWallets';
import { computePositionOpenTime, formatDuration, type PositionOpenInfo } from '@/lib/positionWalk';
import { ClosedPositionsList } from '@/components/ClosedPositionsList';
import { useStore } from '@/store';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { AreaChart, Area, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AccountHierarchy } from '@/components/AccountHierarchy';
import { BulkRankBadge } from '@/components/BulkRankBadge';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskEventsList } from '@/components/RiskEventsList';
import { PositionChartModal, type PositionForChart } from '@/components/PositionChartModal';
import { ChartFrame } from '@/components/ChartFrame';
import { getCoinColor } from '@/lib/coins';

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

// Compact label/value pair for the integrated stats panel. Uppercase 10px
// label on top, big tabular-nums value below. Optional accent color tints
// the value (used for liquidations count when > 0).
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'orange';
}) {
  return (
    <div>
      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1">{label}</p>
      <p
        className={cn(
          'text-lg sm:text-xl font-semibold tabular-nums truncate',
          accent === 'orange' ? 'text-orange-400' : 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </p>
    </div>
  );
}

// Compact inline variant of Stat. Used in the dense single-row stats
// strip on the wallet page header. Smaller value text and tighter spacing
// than the full Stat — suitable for sitting alongside several siblings
// in one horizontal row without needing a grid layout.
function InlineStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'orange';
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider leading-tight">
        {label}
      </span>
      <span
        className={cn(
          'text-base font-semibold tabular-nums leading-tight mt-0.5',
          accent === 'orange' ? 'text-orange-400' : 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Color-coded stat card. One card per metric; each metric has its own
// accent color so users can scan the panel by color (volume is always
// blue, balance is always green, etc.) instead of reading every label.
//
// The `tone` controls icon + label + value color collectively. For PnL
// metrics where the value's sign should flip color (positive=green,
// negative=red), pass `valueTone` as well — that lets us keep the
// label/icon at their semantic color while the number itself responds
// to its sign.
//
// Each card is self-contained (own border, own padding) so the panel
// reads as a grid of independent tiles rather than a continuous strip.
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  valueTone,
  tooltip,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** Color tone for icon + label + value. Use 'neutral' for reference
   *  numbers (volume, balance, etc.) where color carries no semantic
   *  meaning. Use the colored tones only for metrics whose sign or
   *  identity matters at a glance — PnL is the obvious case. */
  tone: 'neutral' | 'green' | 'red' | 'orange';
  /** Override color of the value alone. Used by PnL cards where the
   *  number's sign drives its color but the label stays semantic. */
  valueTone?: 'green' | 'red';
  /** Optional rich breakdown content shown in a popover on hover. When
   *  provided, the card gets a `cursor-help` affordance and the popover
   *  anchors to the card. Used by Total PnL to show gross/fees/net. */
  tooltip?: ReactNode;
}) {
  // Tone → Tailwind color classes. Kept as a static map (not template
  // strings) because Tailwind's JIT only includes classes it can see at
  // build time; dynamically-built class names get purged.
  //
  // The 'neutral' tone uses the standard text colors so non-semantic
  // metrics (volume, trades, balance, margin, available) read as
  // reference numbers rather than competing for attention. PnL keeps
  // tinted icon/label so it stands out from neutrals at a glance.
  const toneClasses: Record<typeof tone, { icon: string; label: string; value: string }> = {
    neutral: {
      icon: 'text-[var(--text-tertiary)]',
      label: 'text-[var(--text-tertiary)]',
      value: 'text-[var(--text-primary)]',
    },
    green:  { icon: 'text-bulk-green', label: 'text-bulk-green/80', value: 'text-bulk-green' },
    red:    { icon: 'text-bulk-red',   label: 'text-bulk-red/80',   value: 'text-bulk-red' },
    orange: { icon: 'text-bulk-orange',label: 'text-bulk-orange/80',value: 'text-bulk-orange' },
  };
  const c = toneClasses[tone];
  // valueTone overrides the value color when given (PnL sign flip).
  const valueColor =
    valueTone === 'green' ? 'text-bulk-green' :
    valueTone === 'red' ? 'text-bulk-red' :
    c.value;

  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={cn(
        'bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4',
        // Anchor for the optional popover; cursor-help signals interactivity.
        Boolean(tooltip) && 'relative cursor-help',
      )}
      onMouseEnter={tooltip ? () => setHovered(true) : undefined}
      onMouseLeave={tooltip ? () => setHovered(false) : undefined}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', c.icon)} />
        <span className={cn('text-[10px] uppercase tracking-wider font-medium', c.label)}>
          {label}
        </span>
      </div>
      <p className={cn('text-2xl font-bold tabular-nums tracking-tight truncate', valueColor)}>
        {value}
      </p>
      {tooltip && hovered && (
        // Popover anchored below the card, left-aligned (cards live in a
        // grid; left-align avoids clipping at the right edge of the row).
        // pointer-events-none so the hover stays attached to the card,
        // not the popover, preventing flicker as the cursor moves.
        <div
          role="tooltip"
          className={cn(
            'absolute left-0 top-full mt-1.5 z-30',
            'rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)]',
            'shadow-lg shadow-black/30',
            'min-w-[200px] px-3 py-2.5',
            'pointer-events-none',
          )}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
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
          <span className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px]">
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
          <span className="text-[var(--text-secondary)] uppercase tracking-wider text-[10px] font-semibold">
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
// PlaceholderCard
//
// Lightweight placeholder that matches BarMetricCard's geometry — used
// in the top strip to fill slots that can't compute (e.g. Direction Bias
// when the wallet has no open positions). Keeps the 4-card strip shape
// stable instead of letting it collapse to 1/2/3 cards depending on
// wallet state, which would look broken.
//
// Visual: same border + padding + label as a real card, but the primary
// value is "—" and the bar is muted.
// ----------------------------------------------------------------------------
function PlaceholderCard({
  label,
  subtitle = 'No data',
}: {
  label: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 opacity-60">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-tight text-[var(--text-tertiary)] mb-2">
        —
      </div>
      <div className="relative h-1.5 rounded-full bg-[var(--bg-secondary-20)]/40 overflow-hidden mb-2" />
      <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
        {subtitle}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// OverviewRow
//
// Compact label/value pair used inside the left-rail Overview and
// Analysis sections. Renders as a single flex line so the rail stays
// scan-able vertically. Optional tone tints just the value, leaving
// the label muted.
//
// When `tooltip` is provided, the value gets a help-cursor and shows
// the popover content on hover — used for Total PnL's gross/fees/net
// breakdown. Tooltip anchors below the row so it doesn't overflow
// the rail's narrow width.
// ----------------------------------------------------------------------------
function OverviewRow({
  label,
  value,
  tone = 'neutral',
  tooltip,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red' | 'neutral';
  tooltip?: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const valueColor =
    tone === 'green' ? 'text-bulk-green' :
    tone === 'red' ? 'text-bulk-red' :
    'text-[var(--text-primary)]';
  return (
    <div
      className={cn('relative flex items-center justify-between gap-3 text-sm', Boolean(tooltip) && 'cursor-help')}
      onMouseEnter={tooltip ? () => setHovered(true) : undefined}
      onMouseLeave={tooltip ? () => setHovered(false) : undefined}
    >
      {/* Label: secondary text (not tertiary) for stronger contrast
          against the value. The whole row uses text-sm — bumped from
          text-xs — to give the rail more presence on the page. */}
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={cn('font-mono tabular-nums font-medium', valueColor)}>{value}</span>
      {tooltip && hovered && (
        <div
          role="tooltip"
          className={cn(
            'absolute left-0 top-full mt-1 z-30',
            'rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)]',
            'shadow-lg shadow-black/30',
            'min-w-[200px] px-3 py-2.5',
            'pointer-events-none',
          )}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

// Format ms duration as "Xd Yh" / "Xh Ym" / "Xm" / "—". Shared helper
// between the left-rail Analysis section and any other place that needs
// the same short-form duration format.
function formatDurationShort(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) {
    const remainingHours = Math.floor((ms - days * 86_400_000) / 3_600_000);
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    const remainingMinutes = Math.floor((ms - hours * 3_600_000) / 60_000);
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

// ----------------------------------------------------------------------------
// PerformanceCard
//
// Top-strip variant of the performance visualization. Renders as a
// full-size card matching BarMetricCard's dimensions so the 4-card top
// strip (Performance / Direction Bias / Distance to Liq / Leverage)
// reads as one unified row.
//
// Compared to a small inline strip: bigger bars (so they're legible at
// glance), bigger value text (the win rate number leads), explicit
// "Performance" label header to match the strip neighbors.
// ----------------------------------------------------------------------------
function PerformanceCard({
  recentWinLoss,
  winRate,
  totalTrades,
}: {
  recentWinLoss: boolean[];
  winRate: number | null;
  totalTrades: number;
}) {
  const winRateColor =
    winRate === null ? 'text-[var(--text-tertiary)]' :
    winRate >= 0.6 ? 'text-bulk-green' :
    winRate >= 0.4 ? 'text-[var(--text-primary)]' :
    'text-bulk-red';

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2">
        Performance
      </div>
      <div className={cn('text-2xl font-bold tabular-nums tracking-tight mb-2', winRateColor)}>
        {winRate !== null ? `${(winRate * 100).toFixed(0)}%` : 'N/A'}
      </div>
      {/* Single win-rate fill bar — matches the BarMetricCard treatment on
          the neighbouring cards so the top strip reads as one coordinated
          row rather than four different visual styles. */}
      <div className="h-1.5 w-full rounded-full bg-[var(--bg-secondary-20)]/40 overflow-hidden mb-2">
        <div
          className={cn('h-full rounded-full', winRate !== null && winRate < 0.4 ? 'bg-bulk-red' : 'bg-bulk-green')}
          style={{ width: `${Math.round((winRate ?? 0) * 100)}%` }}
        />
      </div>
      <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
        {winRate !== null ? `${(winRate * 100).toFixed(0)}% Win Rate` : 'N/A Win Rate'} · {totalTrades} {totalTrades === 1 ? 'Trade' : 'Trades'}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// BarMetricCard
//
// Card for a metric that has a meaningful 0-100% bar visualization:
// Direction Bias (long vs short %), Distance to Liquidation (% headroom
// before forced close), Effective Leverage (% of max safe leverage).
//
// The visual structure mirrors Hyperdash's Performance/Leverage/Margin
// Usage/Direction Bias cards in their wallet view: small label at top,
// large primary value, then a thin filled bar, then a secondary line
// of context. The `barColor` and `fillPct` are computed by the caller
// since each metric has different sign semantics.
// ----------------------------------------------------------------------------
function BarMetricCard({
  label,
  value,
  valueTone,
  barColor,
  fillPct,
  subtitle,
  secondaryFillPct,
  secondaryBarColor,
}: {
  label: string;
  value: string;
  valueTone?: 'green' | 'red' | 'orange' | 'neutral';
  /** Tailwind class for the bar fill, e.g. "bg-bulk-green". */
  barColor: string;
  /** Primary bar fill 0..1. */
  fillPct: number;
  /** Subtitle line — context like "$1.8M Notional · $477.2K Equity". */
  subtitle?: string;
  /** Optional second bar fill (used by Direction Bias to show long+short
   *  as a split — long fills from the left, short from the right). */
  secondaryFillPct?: number;
  secondaryBarColor?: string;
}) {
  const valueColor =
    valueTone === 'green' ? 'text-bulk-green' :
    valueTone === 'red' ? 'text-bulk-red' :
    valueTone === 'orange' ? 'text-bulk-orange' :
    'text-[var(--text-primary)]';
  // Clamp to [0, 1] so a bug doesn't cause the bar to overflow the track.
  const clampedFill = Math.max(0, Math.min(1, fillPct));
  const clampedSecondary = secondaryFillPct !== undefined
    ? Math.max(0, Math.min(1, secondaryFillPct))
    : null;
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2">
        {label}
      </div>
      <div className={cn('text-2xl font-bold tabular-nums tracking-tight mb-2', valueColor)}>
        {value}
      </div>
      {/* Bar track. We use a single 8px-tall rounded track with two
          potential fills overlaid — the secondary fill renders from the
          RIGHT (justify-end via absolute right-0) so long/short splits
          read intuitively. */}
      <div className="relative h-1.5 rounded-full bg-[var(--bg-secondary-20)]/40 overflow-hidden mb-2">
        <div
          className={cn('absolute left-0 top-0 h-full rounded-full', barColor)}
          style={{ width: `${clampedFill * 100}%` }}
        />
        {clampedSecondary !== null && secondaryBarColor && (
          <div
            className={cn('absolute right-0 top-0 h-full rounded-full', secondaryBarColor)}
            style={{ width: `${clampedSecondary * 100}%` }}
          />
        )}
      </div>
      {subtitle && (
        <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// AnalysisCard
//
// Vertical key/value list of derived analysis stats. Sits in the left
// column above the positions panel as a compact ~140px-tall summary.
// Mirrors the "Analysis" sidebar in Hyperdash's wallet view (Longest
// Win Streak, Avg Trade Duration, Median Trade Duration, PnL Cohort,
// Size Cohort) but renders horizontally compact since vertical space
// in our layout is more contested.
// ----------------------------------------------------------------------------
function AnalysisCard({
  longestStreak,
  avgDuration,
  medianDuration,
  pnlCohort,
  sizeCohort,
}: {
  longestStreak: number;
  avgDuration: number | null;
  medianDuration: number | null;
  pnlCohort: { label: string; tone: 'green' | 'red' | 'neutral' };
  sizeCohort: string;
}) {
  // Format ms duration as "Xd Yh" / "Xh Ym" / "Xm" — depending on scale.
  // Matches Hyperdash's "19d 19h" style. Returns "—" for null/zero.
  const formatDuration = (ms: number | null): string => {
    if (ms === null || ms <= 0) return '—';
    const minutes = Math.floor(ms / 60_000);
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(ms / 86_400_000);
    if (days > 0) {
      const remainingHours = Math.floor((ms - days * 86_400_000) / 3_600_000);
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) {
      const remainingMinutes = Math.floor((ms - hours * 3_600_000) / 60_000);
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  };

  const cohortToneClass =
    pnlCohort.tone === 'green' ? 'text-bulk-green' :
    pnlCohort.tone === 'red' ? 'text-bulk-red' :
    'text-[var(--text-secondary)]';

  // Each row is a label/value pair. Two-column flex layout — left
  // justified label, right justified value — gives a clean read.
  const rows: { label: string; value: string; valueClass?: string }[] = [
    { label: 'Longest Win Streak', value: longestStreak > 0 ? `${longestStreak} Trade${longestStreak === 1 ? '' : 's'}` : '—' },
    { label: 'Avg Trade Duration', value: formatDuration(avgDuration) },
    { label: 'Median Trade Duration', value: formatDuration(medianDuration) },
    { label: 'PnL Cohort', value: pnlCohort.label, valueClass: cohortToneClass + ' font-semibold' },
    { label: 'Size Cohort', value: sizeCohort, valueClass: 'text-bulk-green font-semibold' },
  ];

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-3">
        Analysis
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px]">
              {row.label}
            </span>
            <span className={cn('font-mono tabular-nums', row.valueClass ?? 'text-[var(--text-primary)]')}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
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
  const dateStr = date.toLocaleDateString(undefined, {
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
        className="w-[25px] h-[25px] rounded-sm cursor-pointer transition-transform hover:scale-110 hover:ring-1 hover:ring-[var(--text-secondary)]/40"
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
                  isWin ? 'text-bulk-green' : 'text-red-400',
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

function PnlCalendarHeatmap({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  if (closedPositions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
        <div>
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No trade history yet</p>
          <p className="text-xs mt-1">Calendar view appears once the wallet has closed trades</p>
        </div>
      </div>
    );
  }

  // Bucket positions by day (YYYY-MM-DD in local time). Use a Map so
  // insertion order is irrelevant — we collect all days then render.
  const dayBuckets = new Map<string, number>();
  let earliest = Infinity;
  let latest = -Infinity;
  for (const p of closedPositions) {
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
    if (closedMs < earliest) earliest = closedMs;
    if (closedMs > latest) latest = closedMs;
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
        label: firstDay.toLocaleDateString(undefined, { month: 'short' }),
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
          gaps, left-aligned. Cells do NOT stretch to fill the panel — a
          wallet with one week of data shows a few small squares in the
          corner, not giant blocks. The panel scrolls horizontally if a
          very long history overflows. */}
      <div className="w-full">
        <div className="inline-flex items-start gap-2">
          {/* Weekday labels — 14px rows + 3px gaps to line up with cells. */}
          <div className="flex flex-col gap-[4px] shrink-0 pr-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div
                key={d}
                className="h-[25px] text-[10px] text-[var(--text-tertiary)] leading-[25px] tabular-nums"
                style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}
              >
                {d}
              </div>
            ))}
          </div>
          {/* Week columns — fixed 25px cells, 4px gaps. */}
          <div className="flex gap-[4px]">
            {weeks.map((week, col) => (
              <div key={col} className="flex flex-col gap-[4px]">
                {week.map((day, row) => {
                  if (day.isFuture) {
                    return <div key={row} className="w-[25px] h-[25px]" />;
                  }
                  const i = day.pnl !== null && day.pnl !== 0 ? intensity(day.pnl) : 0;
                  const isWin = day.pnl !== null && day.pnl > 0;
                  const isNoTrade = day.pnl === 0;
                  const bg = isNoTrade
                    ? undefined
                    : isWin
                      ? `rgba(34, 197, 94, ${0.2 + i * 0.8})`
                      : `rgba(239, 68, 68, ${0.2 + i * 0.8})`;
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
        <div className="flex mt-2 text-[10px] text-[var(--text-tertiary)] tabular-nums uppercase tracking-wider" style={{ marginLeft: '32px' }}>
          {monthLabels.map((m, idx) => {
            const nextCol = idx + 1 < monthLabels.length ? monthLabels[idx + 1].col : weeks.length;
            const widthCols = nextCol - m.col;
            return (
              <div key={`${m.col}-${m.label}`} style={{ width: `${widthCols * 29}px` }}>
                {m.label}
              </div>
            );
          })}
        </div>
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
function DrawdownChart({ history }: { history: WalletData['history'] }) {
  const data = useMemo(() => {
    let peak = -Infinity;
    return history.map((h) => {
      const cum = (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0);
      peak = Math.max(peak, cum);
      return { timestamp: h.timestamp, dd: cum - peak };
    });
  }, [history]);
  if (!history.length) return <ChartEmpty label="No history data yet" />;
  return (
    <div className="flex-1 p-4 min-h-[420px]">
      <ChartFrame title="Drawdown" className="h-full" yLabel="Drawdown (USD)">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <XAxis dataKey="timestamp" tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} minTickGap={40} />
            <YAxis tickFormatter={(v) => (v === 0 ? '$0' : `-$${formatCompact(Math.abs(v))}`)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} domain={[(min: number) => (min < 0 ? min * 1.1 : -1), 0]} />
            <Tooltip
              cursor={{ stroke: 'var(--text-tertiary)', strokeOpacity: 0.3 }}
              contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--text-secondary)' }}
              itemStyle={{ color: 'var(--text-primary)' }}
              labelFormatter={(ts) => new Date(ts).toLocaleDateString()}
              formatter={(v: number) => [Math.abs(v) < 0.005 ? '$0.00' : `-$${formatNumber(Math.abs(v), 2)}`, 'Drawdown']}
            />
            <Area type="monotone" dataKey="dd" stroke="#ef4444" strokeWidth={2} fill="url(#ddGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

// Per-trade realized PnL — one bar per closed position, chronological.
function PerTradeChart({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  const data = useMemo(() =>
    [...closedPositions].sort((a, b) => a.closedAt - b.closedAt).map((p, i) => ({ i, v: p.realizedPnl })),
  [closedPositions]);
  if (!data.length) return <ChartEmpty label="No closed trades yet" />;
  return (
    <div className="flex-1 p-4 min-h-[420px]">
      <ChartFrame title="Per-Trade PnL" className="h-full" yLabel="Trade PnL (USD)">
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
              {data.map((d, i) => <Cell key={i} fill={d.v >= 0 ? '#22c55e' : '#ef4444'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

// Position Intelligence: per-coin exposure donut + net long/short +
// concentration. Computed from the wallet's live open positions.
function PositionExposure({ positions }: { positions: NonNullable<WalletData['live']>['positions'] }) {
  const intel = useMemo(() => {
    if (!positions?.length) return null;
    let long = 0, short = 0;
    const byCoin = new Map<string, number>();
    for (const p of positions) {
      const n = Math.abs((p.size || 0) * (p.price || 0));
      if ((p.size || 0) > 0) long += n; else short += n;
      const c = p.symbol.replace(/-USD$/, '');
      byCoin.set(c, (byCoin.get(c) || 0) + n);
    }
    const total = long + short;
    if (total <= 0) return null;
    const coins = [...byCoin.entries()]
      .map(([coin, n]) => ({ coin, share: n / total, color: getCoinColor(coin) }))
      .sort((a, b) => b.share - a.share);
    return { coins, netSide: long >= short ? 'Long' : 'Short', netPct: Math.abs(long - short) / total, concentration: coins[0]?.share ?? 0 };
  }, [positions]);

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 h-full flex flex-col">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-4">Position Intelligence</div>
      {intel ? (
        <div className="flex-1 flex flex-col justify-center gap-4">
          <div className="flex items-center gap-5">
            {(() => {
              let acc = 0;
              const stops = intel.coins.map((c) => { const f = acc * 100; acc += c.share; return `${c.color} ${f}% ${acc * 100}%`; }).join(', ');
              return (
                <div className="relative h-24 w-24 shrink-0">
                  <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${stops})` }} />
                  <div className="absolute inset-[26%] rounded-full bg-[var(--bg-muted)]" />
                </div>
              );
            })()}
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Net Exposure</div>
                <div className={cn('font-mono font-semibold text-base', intel.netSide === 'Long' ? 'text-bulk-green' : 'text-bulk-red')}>
                  {(intel.netPct * 100).toFixed(0)}% {intel.netSide}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Concentration</div>
                <div className="font-mono font-semibold text-base text-[var(--text-primary)]">{(intel.concentration * 100).toFixed(0)}%</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">{intel.coins[0]?.coin}</div>
              </div>
            </div>
          </div>

          {/* Stacked exposure bar — fills the card width and reads at a glance. */}
          <div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full">
              {intel.coins.map((c) => (
                <div key={c.coin} style={{ width: `${c.share * 100}%`, background: c.color }} title={`${c.coin} ${(c.share * 100).toFixed(0)}%`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {intel.coins.slice(0, 5).map((c) => (
                <span key={c.coin} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.coin} {(c.share * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : <div className="flex-1 flex items-center justify-center py-6 text-center text-xs text-[var(--text-tertiary)]">No open positions</div>}
    </div>
  );
}

// Trade Timeline: recent closed positions rendered as plain-language events.
function TradeTimeline({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  const items = useMemo(() =>
    [...closedPositions].sort((a, b) => b.closedAt - a.closedAt).slice(0, 8),
  [closedPositions]);
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-3 flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Trade Timeline
      </div>
      {items.length ? (
        <ol className="relative space-y-2.5 pl-4">
          {items.map((p, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full" style={{ background: p.realizedPnl >= 0 ? '#22c55e' : '#ef4444' }} />
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-primary)]">Closed {p.symbol.replace(/-USD$/, '')} {p.side === 'short' ? 'Short' : 'Long'}</span>
                <span className={cn('font-mono font-semibold tabular-nums', p.realizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red')}>
                  {p.realizedPnl >= 0 ? '+' : '-'}${formatCompact(Math.abs(p.realizedPnl))}
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-tertiary)]">
                {new Date(p.closedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · held {formatDuration(p.closedAt - p.openedAt)}
                {p.liquidated && ' · liquidated'}
              </div>
            </li>
          ))}
        </ol>
      ) : <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">No closed trades yet</div>}
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
  const [positionsTab, setPositionsTab] = useState<'open' | 'recent' | 'liquidations'>('open');
  // PnL History chart: switch between the line chart ('pnl') and a
  // day-by-day P&L heatmap calendar ('calendar'). Hyperdash signature
  // pattern — gives the user two complementary views of the same data
  // (continuous trend vs day-level resolution).
  const [chartView, setChartView] = useState<'pnl' | 'calendar' | 'drawdown' | 'trade'>('pnl');
  // Time range filter for the PnL line chart. Affects what slice of
  // history is rendered. Default 'all' so users see the full curve on
  // first load; they can narrow to 24h/7d/30d for recent activity.
  const [chartRange, setChartRange] = useState<'24h' | '7d' | '30d' | 'all'>('all');
  // Tracks which position row's share button was just clicked, to flash a
  // checkmark for ~1.5s as copy confirmation.
  const [sharedSymbol, setSharedSymbol] = useState<string | null>(null);

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

    // Single fetch routine. The `silent` flag controls whether we trigger
    // the loading spinner — true on initial mount, false on background
    // refresh ticks (so the UI doesn't flicker every 10 seconds during a
    // stream).
    const fetchData = async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        // Three parallel fetches:
        //  - wallet.getWallet:        live BULK account + tracked DB row
        //  - userApi.getWalletProfile: claimed username if any
        //  - wallet.getClosedPositions: closed-position history for the
        //    derived analysis stats (performance bar, win streak, etc.).
        //    Backend has a 60s server-side cache so this is cheap; the
        //    Recent Trades panel hits the same endpoint and shares the
        //    cache hit.
        const [walletResult, profileResult, closedResult] = await Promise.all([
          wallet.getWallet(address),
          userApi.getWalletProfile(address).catch(() => ({ profile: null })),
          wallet.getClosedPositions(address, { limit: 200 }).catch(() => ({ positions: [] })),
        ]);

        setData(walletResult);
        setProfile((profileResult as any)?.profile || null);
        setClosedPositions(closedResult.positions || []);

        // Only track on first load — no need to re-track every 10s.
        if (!silent) {
          await wallet.trackWallet(address).catch(() => {});
        }
      } catch (err) {
        // On background refresh failures, keep existing data on screen
        // rather than flashing an error banner. The next tick will retry.
        if (!silent) setError('Failed to load wallet data');
      } finally {
        if (!silent) setLoading(false);
      }
    };

    // Initial load — full spinner.
    fetchData(false);

    // Background refresh every 10 seconds. Cleared on unmount or when the
    // wallet address changes. We don't visualize the refresh (no spinner,
    // no toast) — positions and PnL just update in place. This is the
    // behavior the BULK dev specifically asked for: live-feeling without
    // user action.
    const tick = window.setInterval(() => fetchData(true), 10_000);
    return () => window.clearInterval(tick);
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

  useEffect(() => {
    if (!address) return;
    const positions = data?.live?.positions || [];
    if (positions.length === 0) return;

    let cancelled = false;
    const next: Record<string, PositionOpenInfo | null> = {};

    Promise.all(
      positions.map(async (pos) => {
        try {
          const res = await wallet.getFills(address, {
            symbol: pos.symbol,
            limit: 500,
          });
          // computePositionOpenTime returns null when fills don't include
          // a flat→nonflat transition for the current position (e.g. the
          // wallet is a master-account whose sub-accounts did the trading,
          // or the position is older than BULK's 5000-fill window).
          const info = computePositionOpenTime(res.fills || []);
          next[pos.symbol] = info;
        } catch {
          next[pos.symbol] = null;
        }
      })
    ).then(() => {
      if (!cancelled) setPositionOpenTimes(next);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, openSymbolKey, network]);

  // Compute traded volume per trailing window from the wallet's recent
  // fills. One unfiltered /fills call (capped at 1000) covers most wallets;
  // for extremely active accounts the longer windows are a lower bound,
  // which we flag in the UI. Volume per fill = |size| × price.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    wallet.getFills(address, { limit: 1000 })
      .then((res) => {
        if (cancelled) return;
        const now = Date.now();
        const D = 86_400_000;
        const acc = { d7: 0, d14: 0, d30: 0, d90: 0 };
        for (const f of res.fills || []) {
          const v = Math.abs(f.size || 0) * (f.price || 0);
          const age = now - f.timestamp;
          if (age <= 7 * D) acc.d7 += v;
          if (age <= 14 * D) acc.d14 += v;
          if (age <= 30 * D) acc.d30 += v;
          if (age <= 90 * D) acc.d90 += v;
        }
        setVolByWindow(acc);
      })
      .catch(() => { if (!cancelled) setVolByWindow(null); });
    return () => { cancelled = true; };
  }, [address, network]);

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
  const bulkVolume = bulkRow?.volume ?? tracked?.total_volume ?? 0;
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-bulk-green" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 w-full px-4 sm:px-6 py-6">
        {/* Page-level width: capped at 1600px and centered. Edge-to-edge
            felt right at 1280px but looks unbounded on 4K / ultrawide
            displays where the chart stretches to ~3000px and reads as
            empty whitespace. The 1600px cap matches the dashboard
            sidebar convention used by peer trading dashboards (e.g.
            Hyperdash) — wide enough that left rail + main both breathe,
            narrow enough that lines of stat rows aren't visually broken
            by their own length. */}
        <div className="max-w-[1600px] mx-auto">
        <Link 
          href="/whales"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Whale Tracker
        </Link>

        {error && !hasTrackedData ? (
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400 opacity-50" />
            <h2 className="text-xl font-bold mb-2">Wallet Not Found</h2>
            <p className="text-[var(--text-secondary)] mb-4">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-green text-dark-primary rounded-lg">
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
            {/* ──────────────────────────────────────────────────────
                LEFT RAIL — identity + headline value + Overview list +
                Analysis list. Mirrors Hyperdash's wallet view sidebar:
                thin vertical strip of identity and stats that frames
                the main content area without competing with it for
                visual weight.

                Stacks above the main column on lg: breakpoint and below
                (mobile/tablet), so phones see a normal vertical scroll
                with all the rail content at the top.
                ────────────────────────────────────────────────────── */}
            <aside className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-5 flex flex-col lg:self-start">
              {/* Card-style left rail matching Hyperdash's sidebar
                  treatment. Single bordered panel, sections inside
                  divided by border-t lines. Sections control their own
                  vertical spacing via border-t + pt-5 so the section
                  dividers visually align with the section starts.
                  `lg:self-start` prevents the rail from stretching to
                  match the main column's height — important on wallets
                  with long activity feeds where the rail would otherwise
                  have huge empty space at the bottom. */}
              {/* Identity block — avatar + names + address. Compact
                  vertical stack since the rail is narrow (~300px). The
                  pb-5 mirrors the pt-5 that subsequent sections use, so
                  the visual rhythm of the rail stays consistent. */}
              <div className="flex flex-col items-start gap-3 pb-5">
                {twitterAvatar ? (
                  <img
                    src={twitterAvatar}
                    alt=""
                    width={56}
                    height={56}
                    loading="eager"
                    decoding="async"
                    // Explicit width/height + a solid placeholder background
                    // reserve the circle's space immediately, so the avatar
                    // no longer "pops in" and shoves the name down when it
                    // finishes loading (the lag you saw). The bg shows while
                    // loading; on error we hide the broken img and the ring
                    // + bg remain as a clean fallback.
                    className="w-14 h-14 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary-20)]/40 object-cover shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-bulk-green/15 border border-bulk-green/30 flex items-center justify-center shrink-0">
                    <Wallet className="w-7 h-7 text-bulk-green" />
                  </div>
                )}
                <div className="w-full min-w-0">
                  {displayName && (
                    <h1 className="text-lg font-semibold text-[var(--text-primary)] truncate">
                      {displayName}
                    </h1>
                  )}
                  {twitterHandle && (
                    <a
                      href={`https://twitter.com/${twitterHandle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-bulk-green transition-colors mb-1"
                    >
                      <XIcon className="w-3 h-3" />
                      @{twitterHandle}
                    </a>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="font-mono text-sm text-[var(--text-primary)]">{formatAddress(address)}</h2>
                    <button
                      onClick={copyAddress}
                      className="p-1 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                      title="Copy address"
                    >
                      {copied ? <Check className="w-3 h-3 text-bulk-green" /> : <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />}
                    </button>
                    <a
                      href={`https://explorer.bulk.trade/address/${address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                      title="View on BULK explorer"
                    >
                      <ExternalLink className="w-3 h-3 text-[var(--text-tertiary)]" />
                    </a>
                  </div>
                  {isOwnWallet && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-bulk-green/20 text-bulk-green text-[10px] font-semibold rounded uppercase tracking-wider border border-bulk-green/30">
                      You
                    </span>
                  )}
                </div>
                {/* Hierarchy + rank stacked beneath identity. They're
                    contextual to the wallet itself, not actions. */}
                <div className="flex flex-col gap-2 w-full">
                  {isSystemWallet(address) ? (
                    <div
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-purple-500/10 border-purple-500/30 text-purple-400 self-start"
                      title="This wallet is operated by the BULK exchange protocol"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span className="font-semibold">BULK System</span>
                    </div>
                  ) : (
                    <BulkRankBadge address={address} />
                  )}
                  <AccountHierarchy address={address} />
                </div>
                {/* Follow / Claim buttons stacked below. Full width so
                    they fill the rail. */}
                {canClaimWallet && (
                  <button
                    onClick={handleClaimWallet}
                    disabled={claimLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50"
                  >
                    {claimLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><UserCheck className="w-4 h-4" />This is my wallet</>)}
                  </button>
                )}
                {isClaimedWallet && (
                  <span className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-sm font-medium">
                    <UserCheck className="w-4 h-4" />
                    Your Claimed Wallet
                  </span>
                )}
                {!isOwnWallet && (
                  <button
                    onClick={toggleFollow}
                    disabled={followLoading}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full font-medium transition-all disabled:opacity-50",
                      isFollowing
                        ? "bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/20"
                        : "bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110 shadow-[0_0_16px_rgba(255,181,71,0.25)]"
                    )}
                  >
                    {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowing ? (<><StarOff className="w-4 h-4" />Unfollow</>) : (<><Star className="w-4 h-4" />Follow</>)}
                  </button>
                )}
              </div>

              {/* Account Value — the huge headline number. Mimics
                  Hyperdash's left-rail anchor. Falls back to "—" when
                  live balance hasn't loaded; the small skeleton-y
                  treatment is intentional rather than a spinner so the
                  rail layout stays stable. */}
              <div className="border-t border-[var(--border-color)] pt-5">
                <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-2">
                  Account Value
                </div>
                <div className="text-4xl font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {margin ? `$${formatNumber(margin.totalBalance, 2)}` : '—'}
                </div>
              </div>

              {/* Overview — compact key:value list. Each row uses the
                  same flex layout (label left, value right) so the
                  column reads cleanly. Tone applied to the value side
                  only when it carries semantic meaning (PnL sign). */}
              <div className="border-t border-[var(--border-color)] pt-5">
                <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-3">
                  Overview
                </div>
                <div className="flex flex-col gap-2.5">
                  <OverviewRow
                    label="Unrealized PnL"
                    value={margin ? `${margin.unrealizedPnl >= 0 ? '+' : '-'}$${formatNumber(Math.abs(margin.unrealizedPnl), 2)}` : '—'}
                    tone={margin ? (margin.unrealizedPnl >= 0 ? 'green' : 'red') : 'neutral'}
                  />
                  <OverviewRow
                    label="Account Leverage"
                    value={effectiveLeverage !== null ? `${effectiveLeverage.toFixed(2)}x` : '—'}
                  />
                  <OverviewRow
                    label="Margin Usage"
                    value={
                      margin && margin.totalBalance > 0
                        ? `${((margin.marginUsed / margin.totalBalance) * 100).toFixed(2)}%`
                        : '—'
                    }
                  />
                  <OverviewRow
                    label="All Time PnL"
                    value={`${bulkRealizedPnL >= 0 ? '+' : '-'}$${formatCompact(Math.abs(bulkRealizedPnL))}`}
                    tone={bulkRealizedPnL >= 0 ? 'green' : 'red'}
                    tooltip={totalPnlTooltip}
                  />
                  <OverviewRow
                    label="Volume"
                    value={`$${formatCompact(bulkVolume)}`}
                  />
                  <OverviewRow
                    label="Fees Paid"
                    value={lifetimeFees !== null ? `$${formatCompact(Math.abs(lifetimeFees))}` : '—'}
                  />
                  <OverviewRow
                    label="Liquidations"
                    value={String(tracked?.total_liquidations || 0)}
                  />
                </div>
              </div>

              {/* Volume by period — traded volume over trailing windows,
                  derived from recent fills. Complements the lifetime Volume
                  row above with a recency view of how active the wallet is. */}
              <div className="border-t border-[var(--border-color)] pt-5">
                <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-3">
                  Volume
                </div>
                <div className="flex flex-col gap-2.5">
                  <OverviewRow label="7D" value={volByWindow ? `$${formatCompact(volByWindow.d7)}` : '—'} />
                  <OverviewRow label="14D" value={volByWindow ? `$${formatCompact(volByWindow.d14)}` : '—'} />
                  <OverviewRow label="30D" value={volByWindow ? `$${formatCompact(volByWindow.d30)}` : '—'} />
                  <OverviewRow label="90D" value={volByWindow ? `$${formatCompact(volByWindow.d90)}` : '—'} />
                </div>
              </div>

              {/* Analysis — derived stats from closed positions. Same
                  layout vocabulary as Overview so the rail reads as
                  one cohesive sidebar with topical sub-sections. */}
              {closedPositions.length > 0 && (
                <div className="border-t border-[var(--border-color)] pt-5">
                  <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-3">
                    Analysis
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <OverviewRow
                      label="Longest Win Streak"
                      value={analysisStats.longestStreak > 0 ? `${analysisStats.longestStreak} Trade${analysisStats.longestStreak === 1 ? '' : 's'}` : '—'}
                    />
                    {/* Trading Style — only shown when we have valid hold
                        durations (BULK's openTime bug zeroes them; falls
                        back to 'Unknown' which we hide rather than show). */}
                    {analysisStats.tradingStyle !== 'Unknown' && (
                      <OverviewRow label="Trading Style" value={analysisStats.tradingStyle} />
                    )}
                    {/* "Avg Trade Duration" + "Median Trade Duration"
                        rows hidden — BULK currently reports
                        openTime === closeTime on closed positions, so
                        every duration computes to 0 and both rows would
                        always show "—". Re-enable when BULK ships the
                        timestamp fix post-competition. */}
                    <OverviewRow
                      label="PnL Cohort"
                      value={analysisStats.pnlCohort.label}
                      tone={analysisStats.pnlCohort.tone}
                    />
                    <OverviewRow
                      label="Size Cohort"
                      value={analysisStats.sizeCohort}
                      tone="green"
                    />
                  </div>
                </div>
              )}

              {/* Performance — Drawdown / Win Rate / Sharpe, mirroring
                  Hyperdash's performance sub-panel. All derived from the
                  closed-position series, so available for any wallet with
                  trade history. */}
              {closedPositions.length > 0 && (
                <div className="border-t border-[var(--border-color)] pt-5">
                  <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-3">
                    Performance
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <OverviewRow
                      label="Max Drawdown"
                      value={analysisStats.drawdown !== null ? `${analysisStats.drawdown.toFixed(1)}%` : '—'}
                      tone={
                        analysisStats.drawdown === null ? 'neutral'
                          : analysisStats.drawdown >= 50 ? 'red'
                          : 'neutral'
                      }
                    />
                    <OverviewRow
                      label="Win Rate"
                      value={analysisStats.closedWinRate !== null ? `${(analysisStats.closedWinRate * 100).toFixed(0)}%` : '—'}
                      tone={
                        analysisStats.closedWinRate === null ? 'neutral'
                          : analysisStats.closedWinRate >= 0.5 ? 'green'
                          : 'red'
                      }
                    />
                    <OverviewRow
                      label="Profit Factor"
                      value={(() => {
                        const gp = closedPositions.filter((p) => p.realizedPnl > 0).reduce((s, p) => s + p.realizedPnl, 0);
                        const gl = Math.abs(closedPositions.filter((p) => p.realizedPnl < 0).reduce((s, p) => s + p.realizedPnl, 0));
                        if (gp === 0 && gl === 0) return '—';
                        return gl > 0 ? (gp / gl).toFixed(2) : '∞';
                      })()}
                      tone="neutral"
                    />
                  </div>
                </div>
              )}
            </aside>

            {/* ──────────────────────────────────────────────────────
                MAIN COLUMN — top strip, chart, positions, risk events,
                activity. The bulk of the page content lives here in a
                vertical stack so each block gets the full main-column
                width.
                ────────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 min-w-0">

            {/* Top strip — 4 bar-style cards that read as the Hyperdash
                signature: Performance, Direction Bias, Distance to
                Liquidation, Effective Leverage. Each card carries a
                primary value + bar viz + footer subtitle in the same
                visual treatment, so the row reads as one coordinated
                strip rather than 4 unrelated stats.
                
                Cards with no data (e.g. closed wallet with no open
                positions → Distance to Liq has nothing to compute)
                render as a placeholder "—" rather than collapsing.
                Keeps the 4-card strip shape stable across wallets. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {!isSystemWallet(address) ? (
                <PerformanceCard
                  recentWinLoss={recentWinLoss}
                  winRate={winRate}
                  totalTrades={bulkRow?.closed_count ?? closedPositions.length}
                />
              ) : (
                <PlaceholderCard label="Performance" />
              )}
              {directionBias ? (
                <BarMetricCard
                  label="Direction Bias"
                  value={directionBias.label}
                  valueTone={
                    directionBias.label === 'Very Bullish' || directionBias.label === 'Bullish' ? 'green' :
                    directionBias.label === 'Very Bearish' || directionBias.label === 'Bearish' ? 'red' :
                    'neutral'
                  }
                  barColor="bg-bulk-green"
                  fillPct={directionBias.longPct}
                  secondaryBarColor="bg-bulk-red"
                  secondaryFillPct={1 - directionBias.longPct}
                  subtitle={
                    `${(directionBias.longPct * 100).toFixed(0)}% Long $${formatCompact(directionBias.longNotional)} · ` +
                    `${((1 - directionBias.longPct) * 100).toFixed(0)}% Short $${formatCompact(directionBias.shortNotional)}`
                  }
                />
              ) : (
                <PlaceholderCard label="Direction Bias" subtitle="No open positions" />
              )}
              {distanceToLiq ? (
                <BarMetricCard
                  label="Distance to Liquidation"
                  value={`${(distanceToLiq.pct * 100).toFixed(2)}%`}
                  valueTone={
                    distanceToLiq.pct < 0.05 ? 'red' :
                    distanceToLiq.pct < 0.15 ? 'orange' :
                    'green'
                  }
                  barColor={
                    distanceToLiq.pct < 0.05 ? 'bg-bulk-red' :
                    distanceToLiq.pct < 0.15 ? 'bg-bulk-orange' :
                    'bg-bulk-green'
                  }
                  fillPct={distanceToLiq.pct}
                  subtitle={`Closest: ${distanceToLiq.symbol}`}
                />
              ) : (
                <PlaceholderCard label="Distance to Liquidation" subtitle="No open positions" />
              )}
              {effectiveLeverage !== null && margin ? (
                <BarMetricCard
                  label="Effective Leverage"
                  value={`${effectiveLeverage.toFixed(1)}x`}
                  valueTone={
                    effectiveLeverage > 10 ? 'red' :
                    effectiveLeverage > 5 ? 'orange' :
                    'green'
                  }
                  barColor={
                    effectiveLeverage > 10 ? 'bg-bulk-red' :
                    effectiveLeverage > 5 ? 'bg-bulk-orange' :
                    'bg-bulk-green'
                  }
                  fillPct={Math.min(effectiveLeverage / 10, 1)}
                  subtitle={`$${formatCompact(totalNotional)} Notional · $${formatCompact(margin.totalBalance)} Equity`}
                />
              ) : (
                <PlaceholderCard label="Effective Leverage" subtitle="No open positions" />
              )}
            </div>

            {/* Position Intelligence (per-coin exposure) + Trade Timeline. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              <PositionExposure positions={data?.live?.positions ?? []} />
              <TradeTimeline closedPositions={closedPositions} />
            </div>



            {/* PnL chart — full width of the main column, prominent
                visual anchor. Moved above positions in the Hyperdash-
                style layout because the chart tells the wallet's story
                first; positions detail comes after. */}
            {/* PnL History Chart — tabbed between line view (PNL) and
                day-by-day calendar heatmap. Range toggle controls the
                line view's time window. Mimics Hyperdash's chart panel
                with two visualizations of the same closed-position data. */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
              <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3 flex-wrap">
                {/* Left side: view tabs (PNL vs Calendar). */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setChartView('pnl')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                      chartView === 'pnl'
                        ? 'bg-[var(--bg-secondary-20)]/40 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                    PnL History
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView('calendar')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                      chartView === 'calendar'
                        ? 'bg-[var(--bg-secondary-20)]/40 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                    Calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView('drawdown')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                      chartView === 'drawdown'
                        ? 'bg-[var(--bg-secondary-20)]/40 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Activity className="w-3.5 h-3.5 text-red-400" />
                    Drawdown
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView('trade')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                      chartView === 'trade'
                        ? 'bg-[var(--bg-secondary-20)]/40 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                    Per-Trade
                  </button>
                </div>

                {/* Right side: time range pills, only relevant for the
                    line view. Hidden in calendar mode since the heatmap
                    already spans all available history. */}
                {chartView === 'pnl' && (
                  <div className="flex items-center gap-0.5 text-[10px] uppercase tracking-wider">
                    {(['24h', '7d', '30d', 'all'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setChartRange(r)}
                        className={cn(
                          'px-2 py-1 rounded transition-colors font-mono',
                          chartRange === r
                            ? 'text-[var(--text-primary)] bg-[var(--bg-secondary-20)]/40'
                            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {chartView === 'calendar' ? (
                <PnlCalendarHeatmap closedPositions={closedPositions} />
              ) : chartView === 'drawdown' ? (
                <DrawdownChart history={history} />
              ) : chartView === 'trade' ? (
                <PerTradeChart closedPositions={closedPositions} />
              ) : history.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
                  <div>
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No history data yet</p>
                    <p className="text-xs mt-1">Chart appears once the wallet has closed trades</p>
                  </div>
                </div>
              ) : (() => {
                // Apply time-range filter. 'all' means show everything;
                // other ranges cut the series to the last N days from
                // now. The synthetic "now" row at the end of `history`
                // is always included so the right edge of the chart
                // reflects live state regardless of range.
                const now = Date.now();
                const windowMs = chartRange === '24h' ? 86_400_000
                  : chartRange === '7d' ? 7 * 86_400_000
                  : chartRange === '30d' ? 30 * 86_400_000
                  : Infinity;
                const cutoff = now - windowMs;
                const filtered = chartRange === 'all'
                  ? history
                  : history.filter((h) => new Date(h.timestamp).getTime() >= cutoff);

                const chartData = filtered.map(h => ({
                  ...h,
                  displayPnl: (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0),
                }));

                // Find min/max for gradient stop calculation
                const pnlValues = chartData.map(d => d.displayPnl);
                const minPnl = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
                const maxPnl = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;

                // Calculate where zero line falls in the gradient (0 = top, 1 = bottom)
                const zeroPosition = maxPnl <= 0 ? 0 : minPnl >= 0 ? 1 : maxPnl / (maxPnl - minPnl);

                // Empty-after-filter guard: if the user picks 24h on a
                // wallet whose only history is older, show a helpful
                // hint instead of an empty chart.
                if (chartData.length === 0) {
                  return (
                    <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[420px]">
                      <div>
                        <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>No trades in this range</p>
                        <p className="text-xs mt-1">Try a wider range above</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex-1 p-4 min-h-[420px]">
                    <ChartFrame title="PnL History" className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="pnlLineGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="#22c55e" />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="#ef4444" />
                            <stop offset="100%" stopColor="#ef4444" />
                          </linearGradient>
                          <linearGradient id="pnlFillGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="#22c55e" stopOpacity={0.1} />
                            <stop offset={`${zeroPosition * 100}%`} stopColor="#ef4444" stopOpacity={0.1} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => {
                            const d = new Date(ts);
                            // 24h range: show hour:minute. Longer ranges: show date.
                            return chartRange === '24h'
                              ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
                              : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          }}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                        />
                        <YAxis
                          tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                          labelStyle={{ color: 'var(--text-secondary)' }}
                          labelFormatter={(ts) => new Date(ts).toLocaleString()}
                          formatter={(value: number) => {
                            const color = value >= 0 ? '#22c55e' : '#ef4444';
                            return [<span style={{ color }}>${formatNumber(value, 2)}</span>, 'Total PnL'];
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="displayPnl"
                          stroke="url(#pnlLineGradient)"
                          strokeWidth={2}
                          fill="url(#pnlFillGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                    </ChartFrame>
                  </div>
                );
              })()}
            </div>

            {/* Positions panel — full width below the chart with
                Open / Recent tab toggle. Hyperdash convention: a
                wide table sits under the chart so the eye reads
                chart-then-positions naturally as a top-to-bottom
                story. The Recent tab uses a dense table format. */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
              <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3 flex-wrap">
                {/* Loading state takes precedence over tabs — if BULK
                    hasn't returned yet, show the spinner instead of
                    tabs (which would be empty anyway). */}
                {!hasLiveData && positions.length === 0 ? (
                  <h2 className="font-semibold flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    Fetching positions…
                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider ml-2">
                      auto-retries every 10s
                    </span>
                  </h2>
                ) : (
                  <div className="flex items-center gap-0.5 bg-[var(--bg-base)] rounded-lg p-0.5 border border-[var(--border-color)]">
                    <button
                      type="button"
                      onClick={() => {
                        setPositionsTab('open');
                        setTabIsUserPicked(true);
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                        positionsTab === 'open'
                          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] border border-[var(--border-color)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      <Activity className="w-3.5 h-3.5 text-bulk-green" />
                      Open
                      {positions.length > 0 && (
                        <span className="text-[var(--text-tertiary)] tabular-nums">
                          {positions.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPositionsTab('recent');
                        setTabIsUserPicked(true);
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                        positionsTab === 'recent'
                          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] border border-[var(--border-color)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      Recent Trades
                    </button>
                    {/* Liquidations tab — surfaces the riskHistory feed
                        (force-close events, ADL events) that used to sit
                        as a standalone panel below the chart. Tabbing
                        it tightens the page: the user pivots between
                        live positions / lifetime closes / forced exits
                        in one place. */}
                    <button
                      type="button"
                      onClick={() => {
                        setPositionsTab('liquidations');
                        setTabIsUserPicked(true);
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
                        positionsTab === 'liquidations'
                          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] border border-[var(--border-color)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      <Flame className="w-3.5 h-3.5 text-bulk-orange" />
                      Liquidations
                    </button>
                  </div>
                )}
              </div>

              {/* Panel body — unified table treatment across all three
                  tabs. Open positions, closed positions, and risk
                  events all render as dense single-row-per-item tables
                  so the panel reads as a consistent surface no matter
                  which tab is active. Clicking any row in Open or
                  Recent opens the chart modal. */}
              <div className="max-h-[480px] overflow-y-auto">
                {positionsTab === 'open' ? (
                  positions.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                          <th className="text-left font-medium px-4 py-2.5">Market</th>
                          <th className="text-right font-medium px-4 py-2.5">Size</th>
                          <th className="text-right font-medium px-4 py-2.5">Entry</th>
                          <th className="text-right font-medium px-4 py-2.5">Mark</th>
                          <th className="text-right font-medium px-4 py-2.5">PnL</th>
                          <th className="text-right font-medium px-4 py-2.5 hidden md:table-cell">PnL %</th>
                          <th className="text-right font-medium px-4 py-2.5 hidden lg:table-cell">Liq</th>
                          <th className="text-right font-medium px-4 py-2.5 hidden lg:table-cell">Opened</th>
                          <th className="text-right font-medium px-4 py-2.5 w-px"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-color)]">
                        {positions.map((pos, i) => {
                          const isLong = pos.size > 0;
                          const pnlPercent = pos.notional
                            ? (pos.unrealizedPnl / Math.abs(pos.notional)) * 100
                            : 0;
                          const markPrice = markPrices[pos.symbol] || 0;
                          const openInfo = positionOpenTimes[pos.symbol];
                          const ago = openInfo ? Date.now() - openInfo.openedAt : null;
                          return (
                            <tr
                              key={i}
                              className="cursor-pointer hover:bg-[var(--bg-secondary-20)]/30 transition-colors"
                              onClick={() =>
                                setChartPosition({
                                  kind: 'live',
                                  walletAddress: address,
                                  symbol: pos.symbol,
                                  side: isLong ? 'long' : 'short',
                                  entryPrice: pos.price,
                                  markPrice: markPrice || pos.price,
                                  liquidationPrice: pos.liquidationPrice,
                                  size: Math.abs(pos.size),
                                  leverage: pos.leverage,
                                  unrealizedPnl: pos.unrealizedPnl,
                                })
                              }
                            >
                              {/* Market cell — side badge + symbol + leverage chip. */}
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider',
                                      isLong
                                        ? 'bg-bulk-green/15 text-bulk-green'
                                        : 'bg-bulk-red/15 text-bulk-red',
                                    )}
                                  >
                                    {isLong ? 'LONG' : 'SHORT'}
                                  </span>
                                  <span className="font-medium text-[var(--text-primary)]">{pos.symbol}</span>
                                  <span className="text-[var(--text-tertiary)] text-xs font-mono">{pos.leverage}x</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                                {formatNumber(Math.abs(pos.size), 4)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                                ${formatNumber(pos.price, 4)}
                              </td>
                              {/* Mark — colored to indicate live-data
                                  status. Blue accent stays consistent
                                  with the original card rendering. */}
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-blue-400">
                                ${formatNumber(markPrice, 4)}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span
                                  className={cn(
                                    'font-bold font-mono tabular-nums',
                                    pos.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red',
                                  )}
                                >
                                  {pos.unrealizedPnl >= 0 ? '+' : '-'}${formatNumber(Math.abs(pos.unrealizedPnl), 2)}
                                </span>
                              </td>
                              <td
                                className={cn(
                                  'px-4 py-2.5 text-right font-mono tabular-nums hidden md:table-cell',
                                  pnlPercent >= 0 ? 'text-bulk-green/80' : 'text-bulk-red/80',
                                )}
                              >
                                {pnlPercent >= 0 ? '+' : ''}{formatPercent(pnlPercent)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-bulk-red hidden lg:table-cell">
                                ${formatNumber(pos.liquidationPrice, 4)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs text-[var(--text-tertiary)] tabular-nums whitespace-nowrap hidden lg:table-cell">
                                {ago !== null ? `${formatDuration(ago)} ago` : '—'}
                              </td>
                              {/* Per-row share — copies a deep link to this
                                  wallet + asset. stopPropagation so it
                                  doesn't also fire the row's open-chart
                                  click. Mirrors Hyperdash's per-position
                                  share affordance. */}
                              <td className="px-2 py-2.5 text-right">
                                <button
                                  type="button"
                                  title="Copy link to this position"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const url = `${window.location.origin}/whales/${address}?asset=${encodeURIComponent(pos.symbol)}`;
                                    navigator.clipboard?.writeText(url).catch(() => {});
                                    setSharedSymbol(pos.symbol);
                                    setTimeout(() => setSharedSymbol(null), 1500);
                                  }}
                                  className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--bg-secondary-20)]/40 transition-colors"
                                >
                                  {sharedSymbol === pos.symbol ? (
                                    <Check className="w-3.5 h-3.5 text-bulk-green" />
                                  ) : (
                                    <Share2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    // "Open" tab selected but no open positions exist.
                    <div className="p-8 text-center text-[var(--text-tertiary)]">
                      <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No open positions</p>
                      <p className="text-xs mt-1">
                        Switch to Recent Trades to see closed positions
                      </p>
                    </div>
                  )
                ) : positionsTab === 'recent' ? (
                  // "Recent" tab — closed-position table.
                  <ClosedPositionsList
                    address={address}
                    limit={50}
                    density="table"
                    onSelect={(p) =>
                      setChartPosition({
                        kind: 'closed',
                        walletAddress: address,
                        symbol: p.symbol,
                        side: p.side,
                        entryPrice: p.openPrice,
                        closePrice: p.closePrice,
                        size: p.size,
                        leverage: p.leverage,
                        realizedPnl: p.realizedPnl,
                        fees: p.fees,
                        funding: p.funding,
                        openedAt: p.openedAt,
                        closedAt: p.closedAt,
                        liquidated: p.liquidated,
                      })
                    }
                  />
                ) : (
                  // "Liquidations" tab — riskHistory feed. RiskEventsList
                  // brings its own internal "Show N more" toggle so we
                  // don't need pagination wrappers here. `bare` mode
                  // skips the component's own card chrome since we're
                  // already inside the positions panel card.
                  <RiskEventsList address={address} bare />
                )}
              </div>
            </div>

            {/* Activity timeline — protocol-level events (deposits,
                transfers, sub-account ops, multisig ops). Sits at the
                bottom of the page because it's a chronological feed and
                most of the time the user came here for the live position
                / PnL info above; activity is supporting context. */}
            <ActivityFeed address={address} />
            </div>{/* end main-column wrapper */}
          </div>
        )}
        </div>{/* end max-width container */}
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
