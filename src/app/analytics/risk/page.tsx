'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/Header';
import { analytics, formatCompact, cn } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Line, LineChart, Area, AreaChart, ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, Percent, Gauge } from 'lucide-react';

const COLORS = {
  BTC: '#00B482',
  ETH: '#2271B5',
  SOL: '#7570B3',
  positive: '#00B482',
  negative: '#EF4A3C',
  neutral: '#FFB548',
  accent: '#FFB548',
};

// Regime labels based on value
const getRegimeLabel = (regime: number): { label: string; color: string } => {
  if (regime <= -8) return { label: 'Strong Bearish', color: '#EF4A3C' };
  if (regime <= -4) return { label: 'Bearish', color: '#F87171' };
  if (regime <= -1) return { label: 'Slightly Bearish', color: '#FBBF24' };
  if (regime === 0) return { label: 'Neutral', color: '#9CA3AF' };
  if (regime <= 3) return { label: 'Slightly Bullish', color: '#86EFAC' };
  if (regime <= 7) return { label: 'Bullish', color: '#4ADE80' };
  return { label: 'Strong Bullish', color: '#00B482' };
};

// Market Regime Gauge Component
const RegimeGauge = ({ value, symbol }: { value: number; symbol: string }) => {
  const { label, color } = getRegimeLabel(value);
  const percentage = ((value + 12) / 24) * 100; // Convert -12 to +12 range to 0-100%
  
  return (
    <div className="flex flex-col items-center p-4 bg-[var(--bg-muted)] rounded-lg">
      <p className="text-sm text-[var(--text-tertiary)] mb-2">{symbol}</p>
      <div className="relative w-32 h-16 overflow-hidden">
        {/* Background arc */}
        <div className="absolute inset-0">
          <svg viewBox="0 0 100 50" className="w-full h-full">
            <defs>
              <linearGradient id={`gauge-gradient-${symbol}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#EF4A3C" />
                <stop offset="50%" stopColor="#FFB548" />
                <stop offset="100%" stopColor="#00B482" />
              </linearGradient>
            </defs>
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="var(--border-color)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={`url(#gauge-gradient-${symbol})`}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="126"
              strokeDashoffset={126 - (126 * percentage / 100)}
            />
          </svg>
        </div>
        {/* Needle */}
        <div 
          className="absolute bottom-0 left-1/2 w-1 h-12 origin-bottom transition-transform duration-500"
          style={{ 
            transform: `translateX(-50%) rotate(${(percentage - 50) * 1.8}deg)`,
            background: `linear-gradient(to top, ${color}, transparent)`
          }}
        />
      </div>
      <p className="text-lg font-bold mt-2" style={{ color }}>{value > 0 ? '+' : ''}{value}</p>
      <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
    </div>
  );
};

// Fee Tier Card
const FeeTierCard = ({ tier, isActive }: { tier: { thresholdVolume: number; makerBps: number; takerBps: number }; isActive?: boolean }) => (
  <div className={cn(
    "p-3 rounded-lg border transition-all",
    isActive 
      ? "bg-[var(--accent-muted)] border-[var(--accent-primary)]" 
      : "bg-[var(--bg-muted)] border-[var(--border-color)]"
  )}>
    <p className="text-xs text-[var(--text-tertiary)] mb-1">
      {tier.thresholdVolume === 0 ? 'Base Tier' : `≥ $${formatCompact(tier.thresholdVolume)}`}
    </p>
    <div className="flex justify-between items-center">
      <div>
        <p className="text-xs text-[var(--text-tertiary)]">Maker</p>
        <p className={cn("text-sm font-medium", tier.makerBps <= 0 ? "text-[#00B482]" : "text-[var(--text-primary)]")}>
          {tier.makerBps <= 0 ? `${tier.makerBps}` : tier.makerBps} bps
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-[var(--text-tertiary)]">Taker</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">{tier.takerBps} bps</p>
      </div>
    </div>
  </div>
);

// Custom tooltip
const ChartTooltip = ({ active, payload, label }: any) => {
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
            {entry.name.includes('Price') || entry.name.includes('Revenue') 
              ? `$${formatCompact(entry.value)}` 
              : entry.name.includes('bps') || entry.name.includes('Spread')
              ? `${entry.value.toFixed(2)} bps`
              : formatCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function RiskFeesPage() {
  const [loading, setLoading] = useState(true);
  
  // Regime data
  const [regimeData, setRegimeData] = useState<{
    aggregateRegime: number;
    markets: { symbol: string; regime: number; regimeDt: number; regimeVol: number; fairBookPx: number; markPrice: number }[];
  } | null>(null);
  
  // Volatility chart
  const [volatilityHours, setVolatilityHours] = useState(24);
  const [volatilityData, setVolatilityData] = useState<{ timestamp: string; BTC: number; ETH: number; SOL: number }[]>([]);
  const [volatilityCoins, setVolatilityCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  
  // Fair spread chart
  const [fairSpreadHours, setFairSpreadHours] = useState(24);
  const [fairSpreadSymbol, setFairSpreadSymbol] = useState('BTC-USD');
  const [fairSpreadData, setFairSpreadData] = useState<{ timestamp: string; markPrice: number; fairPrice: number; spreadBps: number }[]>([]);
  
  // Fee data
  const [feeTiers, setFeeTiers] = useState<{
    tiers: { thresholdVolume: number; makerBps: number; takerBps: number }[];
    totalProtocolSettlement: number;
    settledFills: number;
  } | null>(null);
  
  // Protocol revenue chart
  const [revenueHours, setRevenueHours] = useState(168);
  const [revenueData, setRevenueData] = useState<{ timestamp: string; cumulativeRevenue: number; periodRevenue: number }[]>([]);

  // Fetch regime data (live)
  useEffect(() => {
    const fetchRegime = async () => {
      try {
        const data = await analytics.getRegimeData();
        setRegimeData(data);
      } catch (error) {
        console.error('Failed to fetch regime:', error);
      }
    };
    
    fetchRegime();
    const interval = setInterval(fetchRegime, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  // Fetch volatility chart
  useEffect(() => {
    const fetchVolatility = async () => {
      try {
        const data = await analytics.getVolatilityChart(volatilityHours);
        setVolatilityData(data.data || []);
      } catch (error) {
        console.error('Failed to fetch volatility:', error);
      }
    };
    fetchVolatility();
  }, [volatilityHours]);

  // Fetch fair spread chart
  useEffect(() => {
    const fetchFairSpread = async () => {
      try {
        const data = await analytics.getFairSpreadChart(fairSpreadSymbol, fairSpreadHours);
        setFairSpreadData(data.data || []);
      } catch (error) {
        console.error('Failed to fetch fair spread:', error);
      }
    };
    fetchFairSpread();
  }, [fairSpreadHours, fairSpreadSymbol]);

  // Fetch fee tiers
  useEffect(() => {
    const fetchFees = async () => {
      try {
        const data = await analytics.getFeeTiers();
        setFeeTiers(data);
      } catch (error) {
        console.error('Failed to fetch fees:', error);
      }
    };
    fetchFees();
  }, []);

  // Fetch protocol revenue chart
  useEffect(() => {
    const fetchRevenue = async () => {
      try {
        const data = await analytics.getProtocolRevenueChart(revenueHours);
        setRevenueData(data.data || []);
      } catch (error) {
        console.error('Failed to fetch revenue:', error);
      }
    };
    fetchRevenue();
  }, [revenueHours]);

  // Initial load
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const timeRanges = [
    { label: '1D', hours: 24 },
    { label: 'W', hours: 168 },
    { label: 'M', hours: 720 },
  ];

  const formatDateForChart = (ts: string, hours: number) => {
    const date = new Date(ts);
    if (hours <= 24) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (hours <= 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', hour12: false });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const CoinToggle = ({ coin, coins, setCoins }: { coin: string; coins: string[]; setCoins: (c: string[]) => void }) => (
    <button
      onClick={() => setCoins(coins.includes(coin) ? coins.filter(c => c !== coin) : [...coins, coin])}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all",
        coins.includes(coin)
          ? "bg-[var(--bg-muted)] border-[var(--border-color)] text-[var(--text-primary)]"
          : "bg-transparent border-transparent text-[var(--text-tertiary)]"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[coin as keyof typeof COLORS] }} />
      {coin}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 w-full px-6 lg:px-10 py-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Risk & Fees</h1>
        <p className="text-[var(--text-tertiary)] mb-6">Market regime, volatility metrics, and fee structure</p>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-[350px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Market Regime Section - Enhanced */}
            <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-6">
              <div className="flex items-center gap-2 mb-4">
                <Gauge className="w-5 h-5 text-[var(--accent-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Market Regime</h2>
              </div>
              
              {regimeData ? (
                <div className="space-y-4">
                  {/* Top row: Aggregate + Gauges */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Aggregate Regime */}
                    <div className="col-span-1 flex flex-col items-center justify-center p-4 bg-[var(--bg-muted)] rounded-lg">
                      <p className="text-sm text-[var(--text-tertiary)] mb-2">Aggregate</p>
                      <p className="text-4xl font-bold" style={{ color: getRegimeLabel(Math.round(regimeData.aggregateRegime)).color }}>
                        {regimeData.aggregateRegime > 0 ? '+' : ''}{regimeData.aggregateRegime.toFixed(1)}
                      </p>
                      <p className="text-sm text-[var(--text-tertiary)] mt-1">
                        {getRegimeLabel(Math.round(regimeData.aggregateRegime)).label}
                      </p>
                    </div>
                    
                    {/* Per-asset gauges */}
                    {regimeData.markets.map(market => (
                      <RegimeGauge 
                        key={market.symbol} 
                        value={market.regime} 
                        symbol={market.symbol.replace('-USD', '')} 
                      />
                    ))}
                  </div>

                  {/* Bottom row: Detailed metrics table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-color)]/30">
                          <th className="text-left py-2 px-3 text-[var(--text-tertiary)] font-medium">Asset</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Mark Price</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Fair Price</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Spread</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Volatility</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Regime Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regimeData.markets.map(market => {
                          const spread = market.fairBookPx > 0 
                            ? ((market.markPrice - market.fairBookPx) / market.fairBookPx) * 10000 
                            : 0;
                          const durationMins = Math.floor(market.regimeDt / 60);
                          const durationHrs = Math.floor(durationMins / 60);
                          const durationStr = durationHrs > 0 
                            ? `${durationHrs}h ${durationMins % 60}m` 
                            : `${durationMins}m`;
                          
                          return (
                            <tr key={market.symbol} className="border-b border-[var(--border-color)]/20 hover:bg-[var(--bg-muted)]/50">
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-2 h-2 rounded-full" 
                                    style={{ backgroundColor: COLORS[market.symbol.replace('-USD', '') as keyof typeof COLORS] || COLORS.BTC }} 
                                  />
                                  <span className="font-medium text-[var(--text-primary)]">{market.symbol.replace('-USD', '')}</span>
                                </div>
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-primary)] font-mono">
                                ${market.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-secondary)] font-mono">
                                ${market.fairBookPx.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className={cn(
                                "text-right py-2 px-3 font-mono",
                                spread >= 0 ? "text-[#00B482]" : "text-[#EF4A3C]"
                              )}>
                                {spread >= 0 ? '+' : ''}{spread.toFixed(2)} bps
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-primary)] font-mono">
                                {market.regimeVol.toFixed(2)}%
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-secondary)]">
                                {durationStr}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center text-[var(--text-tertiary)]">
                  Loading regime data...
                </div>
              )}
            </div>

            {/* Row 2: Volatility + Fair Spread */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Volatility Chart */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">Volatility</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <CoinToggle coin="BTC" coins={volatilityCoins} setCoins={setVolatilityCoins} />
                    <CoinToggle coin="ETH" coins={volatilityCoins} setCoins={setVolatilityCoins} />
                    <CoinToggle coin="SOL" coins={volatilityCoins} setCoins={setVolatilityCoins} />
                    <div className="flex gap-1 ml-2">
                      {timeRanges.map(r => (
                        <button
                          key={r.label}
                          onClick={() => setVolatilityHours(r.hours)}
                          className={cn(
                            "px-2 py-1 text-xs rounded",
                            volatilityHours === r.hours 
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
                
                {volatilityData.length > 0 ? (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={volatilityData}>
                        <XAxis 
                          dataKey="timestamp" 
                          tickFormatter={(ts) => formatDateForChart(ts, volatilityHours)}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <YAxis 
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        {volatilityCoins.includes('BTC') && <Line type="monotone" dataKey="BTC" stroke={COLORS.BTC} strokeWidth={2} dot={false} />}
                        {volatilityCoins.includes('ETH') && <Line type="monotone" dataKey="ETH" stroke={COLORS.ETH} strokeWidth={2} dot={false} />}
                        {volatilityCoins.includes('SOL') && <Line type="monotone" dataKey="SOL" stroke={COLORS.SOL} strokeWidth={2} dot={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-[var(--text-tertiary)]">
                    <p className="text-sm">No volatility data yet. Data will appear as it&apos;s collected.</p>
                  </div>
                )}
              </div>

              {/* Fair Price vs Mark Price Spread */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">Fair vs Mark Spread</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={fairSpreadSymbol}
                      onChange={(e) => setFairSpreadSymbol(e.target.value)}
                      className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-[var(--text-primary)]"
                    >
                      <option value="BTC-USD">BTC</option>
                      <option value="ETH-USD">ETH</option>
                      <option value="SOL-USD">SOL</option>
                    </select>
                    <div className="flex gap-1">
                      {timeRanges.map(r => (
                        <button
                          key={r.label}
                          onClick={() => setFairSpreadHours(r.hours)}
                          className={cn(
                            "px-2 py-1 text-xs rounded",
                            fairSpreadHours === r.hours 
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
                
                {fairSpreadData.length > 0 ? (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={fairSpreadData}>
                        <defs>
                          <linearGradient id="spreadGradientPos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00B482" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00B482" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="spreadGradientNeg" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="5%" stopColor="#EF4A3C" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EF4A3C" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="timestamp" 
                          tickFormatter={(ts) => formatDateForChart(ts, fairSpreadHours)}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <YAxis 
                          tickFormatter={(v) => `${v.toFixed(1)}`}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="3 3" />
                        <Area 
                          type="monotone"
                          dataKey="spreadBps" 
                          name="Spread (bps)"
                          stroke={fairSpreadData[fairSpreadData.length - 1]?.spreadBps >= 0 ? '#00B482' : '#EF4A3C'}
                          fill={fairSpreadData[fairSpreadData.length - 1]?.spreadBps >= 0 ? 'url(#spreadGradientPos)' : 'url(#spreadGradientNeg)'}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-[var(--text-tertiary)]">
                    <p className="text-sm">No spread data yet. Data will appear as it&apos;s collected.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Fee Tiers + Protocol Revenue */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Fee Tiers */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Percent className="w-5 h-5 text-[var(--accent-primary)]" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Fee Tiers</h3>
                </div>
                
                {feeTiers ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {feeTiers.tiers.slice(0, 8).map((tier, i) => (
                        <FeeTierCard key={i} tier={tier} isActive={i === 0} />
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--text-tertiary)]">Total Settled Fills</span>
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {feeTiers.settledFills.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-sm text-[var(--text-tertiary)]">Protocol Revenue</span>
                        <span className="text-sm font-medium text-[#00B482]">
                          ${formatCompact(feeTiers.totalProtocolSettlement)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-[var(--text-tertiary)]">
                    Loading fee data...
                  </div>
                )}
              </div>

              {/* Protocol Revenue Chart */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">Protocol Revenue</h3>
                  </div>
                  <div className="flex gap-1">
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
                
                {revenueData.length > 0 ? (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueData}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00B482" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00B482" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="timestamp" 
                          tickFormatter={(ts) => formatDateForChart(ts, revenueHours)}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <YAxis 
                          tickFormatter={(v) => `$${formatCompact(v)}`}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Area 
                          type="monotone" 
                          dataKey="cumulativeRevenue" 
                          name="Cumulative Revenue"
                          stroke="#00B482" 
                          fill="url(#revenueGradient)" 
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-[var(--text-tertiary)]">
                    <p className="text-sm">No revenue data yet. Data will appear as it&apos;s collected.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
