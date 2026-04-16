'use client';

import { useState, useEffect } from 'react';
import { analytics, formatCompact, cn } from '@/lib/api';
import { DollarSign } from 'lucide-react';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, BarChart, Line, ComposedChart
} from 'recharts';

const COLORS = {
  protocol: '#00B482',
  maker: '#2271B5',
  taker: '#EF4A3C',
  cumulative: '#FFB548',
};

const timeRanges = [
  { label: '1D', hours: 24 },
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
];

// Custom tooltip
const RevenueTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  
  const formatDate = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg p-3 shadow-lg">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">{formatDate(label)}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-[var(--text-secondary)]">{entry.name}:</span>
          <span className="text-[var(--text-primary)] font-medium">
            ${formatCompact(Math.abs(entry.value))}
          </span>
        </div>
      ))}
    </div>
  );
};

export function ProtocolRevenueChart() {
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
  }, [revenueHours]);

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
  }, []);

  const formatDateForChart = (ts: string) => {
    const date = new Date(ts);
    if (revenueHours <= 24) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (revenueHours <= 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const Toggle = ({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all",
        active
          ? "bg-[var(--bg-muted)] border-[var(--border-color)] text-[var(--text-primary)]"
          : "bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </button>
  );

  // Count active bar series for bar size calculation
  const activeBarCount = [showProtocol, showMaker, showTaker].filter(Boolean).length;

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[var(--accent-primary)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Protocol Revenue</h3>
          {feeState && (
            <span className="text-sm text-[#00B482] font-medium ml-2">
              ${formatCompact(feeState.totalProtocolSettlement)}
            </span>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label="Protocol" color={COLORS.protocol} active={showProtocol} onClick={() => setShowProtocol(!showProtocol)} />
          <Toggle label="Maker" color={COLORS.maker} active={showMaker} onClick={() => setShowMaker(!showMaker)} />
          <Toggle label="Taker" color={COLORS.taker} active={showTaker} onClick={() => setShowTaker(!showTaker)} />
          <Toggle label="Cumulative" color={COLORS.cumulative} active={showCumulative} onClick={() => setShowCumulative(!showCumulative)} />
          
          <div className="flex gap-1 ml-2 border-l border-[var(--border-color)] pl-2">
            {timeRanges.map(r => (
              <button
                key={r.label}
                onClick={() => setRevenueHours(r.hours)}
                className={cn(
                  "px-2 py-1 text-xs rounded",
                  revenueHours === r.hours 
                    ? "bg-[var(--accent-primary)] text-white" 
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="h-[350px] flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-primary)]" />
        </div>
      ) : revenueData.length > 0 ? (
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart 
              data={revenueData} 
              margin={{ top: 5, right: 10, bottom: 5, left: 5 }}
              barGap={4}
              barCategoryGap="20%"
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
                tickFormatter={(v) => `$${formatCompact(v)}`}
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--border-color)' }}
                tickLine={false}
                width={60}
              />
              {showCumulative && (
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `$${formatCompact(v)}`}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--border-color)' }}
                  tickLine={false}
                  width={65}
                />
              )}
              <Tooltip content={<RevenueTooltip />} />
              
              {/* Grouped bars - NOT stacked, side by side with gaps */}
              {showMaker && (
                <Bar 
                  yAxisId="left"
                  dataKey="makerFees" 
                  name="Maker Rebates"
                  fill={COLORS.maker}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={activeBarCount === 1 ? 60 : activeBarCount === 2 ? 40 : 30}
                />
              )}
              {showTaker && (
                <Bar 
                  yAxisId="left"
                  dataKey="takerFees" 
                  name="Taker Fees"
                  fill={COLORS.taker}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={activeBarCount === 1 ? 60 : activeBarCount === 2 ? 40 : 30}
                />
              )}
              {showProtocol && (
                <Bar 
                  yAxisId="left"
                  dataKey="periodRevenue" 
                  name="Protocol Revenue"
                  fill={COLORS.protocol}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={activeBarCount === 1 ? 60 : activeBarCount === 2 ? 40 : 30}
                />
              )}
              {showCumulative && (
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="cumulativeRevenue" 
                  name="Cumulative"
                  stroke={COLORS.cumulative} 
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[350px] flex items-center justify-center text-[var(--text-tertiary)]">
          <p className="text-sm">No revenue data yet. Data will appear as it&apos;s collected.</p>
        </div>
      )}
      
      {/* Stats row */}
      {feeState && (
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Protocol Revenue</p>
            <p className="text-sm font-medium text-[#00B482]">${formatCompact(feeState.totalProtocolSettlement)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Maker Rebates</p>
            <p className="text-sm font-medium text-[#2271B5]">${formatCompact(Math.abs(feeState.totalMakerFees))}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Taker Fees</p>
            <p className="text-sm font-medium text-[#EF4A3C]">${formatCompact(Math.abs(feeState.totalTakerFees))}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Settled Fills</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">{feeState.settledFills.toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProtocolRevenueChart;
