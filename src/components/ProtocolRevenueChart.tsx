'use client';

import { useState, useEffect, useMemo } from 'react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { analytics, formatCompact, cn } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, BarChart, Line, ComposedChart
} from 'recharts';
import { ChartFrame } from '@/components/ChartFrame';

const COLORS = {
  protocol: 'var(--pos)',
  maker: 'var(--coin-1)',
  taker: 'var(--neg)',
  cumulative: 'var(--accent)',
};

const timeRanges = [
  { label: '1D', hours: 24 },
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
];

// Custom tooltip
const RevenueTooltip = ({ active, payload, label, showTime }: any) => {
  if (!active || !payload?.length) return null;
  
  const formatDate = (ts: string) => {
    const date = new Date(ts);
    if (showTime) {
      return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    }
    // Aggregated daily bucket — day only
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">{formatDate(label)}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-[var(--text-secondary)]">{entry.name}:</span>
          <span className="text-[var(--text-primary)] font-medium">
            {formatCompact(Math.abs(entry.value))}
          </span>
        </div>
      ))}
    </div>
  );
};

export function ProtocolRevenueChart() {
  const { network } = useCurrentNetwork();
  const [revenueHours, setRevenueHours] = useState(168);
  const [revenueData, setRevenueData] = useState<{ 
    timestamp: string; 
    cumulativeRevenue: number; 
    periodRevenue: number;
    makerFees: number;
    takerFees: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Toggle state for which series to show
  const [showProtocol, setShowProtocol] = useState(true);
  const [showMaker, setShowMaker] = useState(true);
  const [showTaker, setShowTaker] = useState(true);
  const [showCumulative, setShowCumulative] = useState(true);

  // Fetch fee state for current totals
  const [feeState, setFeeState] = useState<{
    totalProtocolSettlement: number;
    totalMakerFees: number;
    totalTakerFees: number;
    settledFills: number;
  } | null>(null);

  useEffect(() => {
    const fetchRevenue = async () => {
      setLoading(true);
      try {
        const data = await analytics.getProtocolRevenueChart(revenueHours);
        // Transform data to make all values positive for display
        const transformed = (data.data || []).map(d => ({
          ...d,
          makerFees: Math.abs(d.makerFees),
          takerFees: Math.abs(d.takerFees),
          periodRevenue: Math.abs(d.periodRevenue),
        }));
        setRevenueData(transformed);
      } catch (error) {
        console.error('Failed to fetch revenue:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchRevenue();
  }, [revenueHours, network]);

  useEffect(() => {
    const fetchFeeState = async () => {
      try {
        const data = await analytics.getFeeTiers();
        setFeeState({
          totalProtocolSettlement: data.totalProtocolSettlement,
          totalMakerFees: data.totalMakerFees,
          totalTakerFees: data.totalTakerFees,
          settledFills: data.settledFills,
        });
      } catch (error) {
        console.error('Failed to fetch fee state:', error);
      }
    };
    fetchFeeState();
    const interval = setInterval(fetchFeeState, 60000);
    return () => clearInterval(interval);
  }, [network]);

  const formatDateForChart = (ts: string) => {
    const date = new Date(ts);
    if (revenueHours <= 24) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (revenueHours <= 168) {
      // W: daily buckets → show weekday (Mon, Tue, ...)
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    // M: daily buckets → show month + day
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const Toggle = ({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all duration-200",
        active
          ? "bg-[var(--bg-muted)] border-[var(--border-color)] text-[var(--text-primary)]"
          : "bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-gray-300"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </button>
  );

  // For W and M: aggregate hourly data into daily buckets so we get 1 bar per day.
  // For 1D: keep the raw hourly resolution.
  // cumulativeRevenue is a running total, so we take the LAST value of each day
  // (not the sum). periodRevenue, makerFees, takerFees are per-period flows, so we sum them.
  const displayData = useMemo(() => {
    if (revenueHours <= 24) return revenueData;
    if (revenueData.length === 0) return revenueData;

    const buckets = new Map<string, {
      timestamp: string;
      periodRevenue: number;
      makerFees: number;
      takerFees: number;
      cumulativeRevenue: number;
      lastTs: number;
    }>();

    for (const d of revenueData) {
      const date = new Date(d.timestamp);
      // Day key in UTC so it matches how the backend stores timestamps
      const dayKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
      const existing = buckets.get(dayKey);
      const ts = date.getTime();

      if (!existing) {
        // Normalize the bucket timestamp to start-of-day UTC so bars are evenly spaced
        const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
        buckets.set(dayKey, {
          timestamp: dayStart,
          periodRevenue: d.periodRevenue,
          makerFees: d.makerFees,
          takerFees: d.takerFees,
          cumulativeRevenue: d.cumulativeRevenue,
          lastTs: ts,
        });
      } else {
        existing.periodRevenue += d.periodRevenue;
        existing.makerFees += d.makerFees;
        existing.takerFees += d.takerFees;
        // cumulative is a running total — take the latest sample in the bucket
        if (ts >= existing.lastTs) {
          existing.cumulativeRevenue = d.cumulativeRevenue;
          existing.lastTs = ts;
        }
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(({ lastTs, ...rest }) => rest);
  }, [revenueData, revenueHours]);

  // Count active bar series for bar size calculation
  const activeBarCount = [showProtocol, showMaker, showTaker].filter(Boolean).length;

  // Dynamic bar size + category gap based on how many day buckets we have.
  // Goal: when few days (e.g. 2), bars should be FAT and groups close together;
  // when many days (30), bars are thin with more breathing room.
  const { dynamicBarSize, dynamicCategoryGap } = useMemo(() => {
    const n = displayData.length || 1;
    const series = Math.max(1, activeBarCount);

    // Max bar width in px — shrinks as data count grows
    let maxBar: number;
    if (n <= 2) maxBar = 80;
    else if (n <= 3) maxBar = 65;
    else if (n <= 5) maxBar = 50;
    else if (n <= 7) maxBar = 40;
    else if (n <= 14) maxBar = 28;
    else maxBar = 20;

    // With fewer bar series visible, each can be a bit fatter
    if (series === 1) maxBar = Math.round(maxBar * 1.4);
    else if (series === 2) maxBar = Math.round(maxBar * 1.15);

    // Category gap (percentage of a group's slot) — smaller when fewer days
    let gap: string;
    if (n <= 2) gap = '10%';
    else if (n <= 3) gap = '15%';
    else if (n <= 7) gap = '25%';
    else gap = '30%';

    return { dynamicBarSize: maxBar, dynamicCategoryGap: gap };
  }, [displayData.length, activeBarCount]);

  return (
    <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4">
      {/* Header: title left, timeframe + toggles stacked on the right */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] pt-1">Fees</h3>

        <div className="flex flex-col items-end gap-2 min-w-0">
          {/* Time range selector - pill style like liquidations */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
            {timeRanges.map(r => (
              <button
                key={r.label}
                onClick={() => setRevenueHours(r.hours)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded transition-colors",
                  revenueHours === r.hours 
                    ? "bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]" 
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Toggle label="Protocol" color={COLORS.protocol} active={showProtocol} onClick={() => setShowProtocol(!showProtocol)} />
            <Toggle label="Maker" color={COLORS.maker} active={showMaker} onClick={() => setShowMaker(!showMaker)} />
            <Toggle label="Taker" color={COLORS.taker} active={showTaker} onClick={() => setShowTaker(!showTaker)} />
            <Toggle label="Cumulative Protocol Revenue" color={COLORS.cumulative} active={showCumulative} onClick={() => setShowCumulative(!showCumulative)} />
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="h-[350px] flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-primary)]" />
        </div>
      ) : displayData.length > 0 ? (
        <div className="flex">
          {/* Left Y-axis label - aligned with chart area (350px) */}
          <div className="relative w-6 shrink-0">
            <div className="absolute top-0 h-[350px] flex items-center justify-center w-full">
              <span 
                className="transform -rotate-90 whitespace-nowrap text-[14px] text-[var(--text-secondary)] tracking-wide origin-center"
                style={{ fontFamily: '"Overused Grotesk", sans-serif' }}
              >
                Fees (USD)
              </span>
            </div>
          </div>

          {/* Chart content */}
          <div className="flex-1 min-w-0">
            <div className="h-[350px]">
              <ChartFrame
                title="Protocol Revenue"
                className="h-full"
                legend={[
                  showProtocol && { label: 'Protocol', color: COLORS.protocol },
                  showMaker && { label: 'Maker', color: COLORS.maker },
                  showTaker && { label: 'Taker', color: COLORS.taker },
                  showCumulative && { label: 'Cumulative', color: COLORS.cumulative },
                ].filter(Boolean) as { label: string; color: string }[]}
              >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart 
                  data={displayData} 
                  margin={{ top: 5, right: 10, bottom: 5, left: 5 }}
                  barGap={4}
                  barCategoryGap={dynamicCategoryGap}
                >
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={formatDateForChart}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    tickLine={false}
                  />
                  <YAxis 
                    yAxisId="left"
                    tickFormatter={(v) => formatCompact(v)}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    tickLine={false}
                    width={60}
                  />
                  {showCumulative && (
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(v) => formatCompact(v)}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                      axisLine={{ stroke: 'var(--border-color)' }}
                      tickLine={false}
                      width={65}
                    />
                  )}
                  <Tooltip content={<RevenueTooltip showTime={revenueHours <= 24} />} />
                  
                  {/* Grouped bars - NOT stacked, side by side with gaps */}
                  {showMaker && (
                    <Bar 
                      yAxisId="left"
                      dataKey="makerFees" 
                      name="Maker Rebates"
                      fill={COLORS.maker}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={dynamicBarSize}
                    />
                  )}
                  {showTaker && (
                    <Bar 
                      yAxisId="left"
                      dataKey="takerFees" 
                      name="Taker Fees"
                      fill={COLORS.taker}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={dynamicBarSize}
                    />
                  )}
                  {showProtocol && (
                    <Bar 
                      yAxisId="left"
                      dataKey="periodRevenue" 
                      name="Protocol Revenue"
                      fill={COLORS.protocol}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={dynamicBarSize}
                    />
                  )}
                  {showCumulative && (
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="cumulativeRevenue" 
                      name="Cumulative Protocol Revenue"
                      stroke={COLORS.cumulative} 
                      strokeWidth={2}
                      dot={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              </ChartFrame>
            </div>
          </div>

          {/* Right Y-axis label - only visible when cumulative toggle is on */}
          {showCumulative && (
            <div className="relative w-6 shrink-0">
              <div className="absolute top-0 h-[350px] flex items-center justify-center w-full">
                <span 
                  className="transform rotate-90 whitespace-nowrap text-[14px] text-[var(--text-secondary)] tracking-wide origin-center"
                  style={{ fontFamily: '"Overused Grotesk", sans-serif' }}
                >
                  Cumulative (USD)
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="h-[350px] flex items-center justify-center text-[var(--text-tertiary)]">
          <p className="text-sm">No fee data yet. Data will appear as it&apos;s collected.</p>
        </div>
      )}
      
      {/* Stats row */}
      {feeState && (
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-[var(--text-tertiary)] mb-1">Protocol Revenue</p>
            <p className="text-xl font-bold text-[var(--pos)]">{formatCompact(feeState.totalProtocolSettlement)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-tertiary)] mb-1">Maker Rebates</p>
            <p className="text-xl font-bold text-[var(--coin-1)]">{formatCompact(Math.abs(feeState.totalMakerFees))}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-tertiary)] mb-1">Taker Fees</p>
            <p className="text-xl font-bold text-[var(--neg)]">{formatCompact(Math.abs(feeState.totalTakerFees))}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-tertiary)] mb-1">Settled Fills</p>
            <p className="text-xl font-bold text-[var(--text-primary)]">{feeState.settledFills.toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProtocolRevenueChart;
