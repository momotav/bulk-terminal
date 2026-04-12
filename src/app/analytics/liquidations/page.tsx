'use client';

import { useState, useEffect, useMemo } from 'react';
import { analytics, formatCurrency, formatCompact, formatAddress, formatNumber } from '@/lib/api';
import { 
  ComposedChart, Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Cell, ReferenceLine, Legend
} from 'recharts';
import { Flame, TrendingUp, TrendingDown, ChevronDown, ExternalLink } from 'lucide-react';

// Time period options
const PERIODS = [
  { label: '4H', value: '4h' },
  { label: 'D', value: '24h' },
  { label: '3D', value: '3d' },
  { label: 'W', value: '7d' },
  { label: 'ALL', value: 'all' },
];

const COINS = ['BTC', 'ETH', 'SOL'];

// Colors
const COLORS = {
  long: '#00B481',  // Green (bids)
  short: '#EF4A3C', // Red (asks)
  BTC: '#F7931A',
  ETH: '#627EEA',
  SOL: '#00FFA3',
  XRP: '#23292F',
  GOLD: '#FFD700',
};

// Treemap component
function LiquidationTreemap({ 
  data, 
  totalValue, 
  assets 
}: { 
  data: { symbol: string; side: string; value: number; count: number }[];
  totalValue: number;
  assets: number;
}) {
  // Group by symbol and calculate layout
  const symbolGroups = useMemo(() => {
    const groups: Record<string, { long: number; short: number; total: number }> = {};
    const allowedSymbols = ['BTC', 'ETH', 'SOL'];
    
    for (const item of data) {
      // Filter to only BTC, ETH, SOL
      if (!allowedSymbols.includes(item.symbol)) continue;
      
      if (!groups[item.symbol]) {
        groups[item.symbol] = { long: 0, short: 0, total: 0 };
      }
      if (item.side === 'long') {
        groups[item.symbol].long = item.value;
      } else {
        groups[item.symbol].short = item.value;
      }
      groups[item.symbol].total += item.value;
    }
    
    return Object.entries(groups)
      .map(([symbol, values]) => ({ symbol, ...values }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  if (symbolGroups.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
        No liquidation data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">Assets: <span className="text-[var(--text-primary)] font-medium">{assets}</span></span>
        <span className="text-[var(--text-secondary)]">Total Liquidations: <span className="text-[var(--text-primary)] font-medium">{formatCurrency(totalValue)}</span></span>
      </div>
      
      {/* Treemap - proportional boxes */}
      <div className="relative w-full h-64 flex gap-1">
        {symbolGroups.map((group, index) => {
          const widthPct = totalValue > 0 ? (group.total / totalValue) * 100 : 33;
          const longPct = group.total > 0 ? (group.long / group.total) * 100 : 50;
          const shortPct = 100 - longPct;
          
          return (
            <div 
              key={group.symbol}
              className="relative h-full rounded-lg overflow-hidden border border-[var(--border-color)]"
              style={{ width: `${widthPct}%`, minWidth: '80px' }}
            >
              {/* Background split - vertical for long/short */}
              <div className="absolute inset-0 flex">
                <div 
                  className="h-full transition-all duration-300" 
                  style={{ width: `${longPct}%`, backgroundColor: COLORS.long }}
                />
                <div 
                  className="h-full transition-all duration-300" 
                  style={{ width: `${shortPct}%`, backgroundColor: COLORS.short }}
                />
              </div>
              
              {/* Content */}
              <div className="relative z-10 p-4 h-full flex flex-col justify-center items-center text-white">
                <div className="font-bold text-2xl">{group.symbol}</div>
                <div className="font-semibold text-xl mt-1">{formatCurrency(group.total)}</div>
                <div className="text-sm opacity-90 mt-2">
                  L: {formatCompact(group.long)} | S: {formatCompact(group.short)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.long }} />
          <span className="text-[var(--text-secondary)]">Long Liquidations</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.short }} />
          <span className="text-[var(--text-secondary)]">Short Liquidations</span>
        </div>
      </div>
    </div>
  );
}

// Period selector component
function PeriodSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-[var(--bg-muted)] rounded-lg p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
            value === p.value
              ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// Coin selector dropdown
function CoinSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-muted)] rounded-lg border border-[var(--border-color)] hover:border-[var(--text-secondary)] transition-colors"
      >
        <span className="font-medium text-[var(--text-primary)]">{value}</span>
        <ChevronDown size={16} className="text-[var(--text-secondary)]" />
      </button>
      
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--bg-base)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 min-w-[120px]">
            {COINS.map((coin) => (
              <button
                key={coin}
                onClick={() => { onChange(coin); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-muted)] transition-colors ${
                  value === coin ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'
                }`}
              >
                {coin}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Custom tooltip for charts
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  
  return (
    <div className="bg-[var(--bg-overlay)] border border-[var(--border-color)] rounded-lg p-3 shadow-lg">
      <div className="text-xs text-[var(--text-secondary)] mb-2">
        {new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center justify-between gap-4 text-sm">
          <span style={{ color: entry.color }}>{entry.name}:</span>
          <span className="font-medium text-[var(--text-primary)]">{formatCurrency(Math.abs(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

export default function LiquidationsPage() {
  // State
  const [treemapPeriod, setTreemapPeriod] = useState('24h');
  const [chartPeriod, setChartPeriod] = useState('all');
  const [summaryPeriod, setSummaryPeriod] = useState('7d');
  const [marketPeriod, setMarketPeriod] = useState('all');
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [featuredFilter, setFeaturedFilter] = useState('ALL');
  
  // Data state
  const [treemapData, setTreemapData] = useState<any>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [marketData, setMarketData] = useState<any>(null);
  const [featuredData, setFeaturedData] = useState<any>(null);
  
  // Loading states
  const [loading, setLoading] = useState({
    treemap: true,
    chart: true,
    summary: true,
    market: true,
    featured: true,
  });

  // Fetch treemap data
  useEffect(() => {
    setLoading(l => ({ ...l, treemap: true }));
    analytics.getLiquidationsTreemap(treemapPeriod)
      .then(setTreemapData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, treemap: false })));
  }, [treemapPeriod]);

  // Fetch chart data
  useEffect(() => {
    setLoading(l => ({ ...l, chart: true }));
    analytics.getLiquidationsLongShortChart(chartPeriod)
      .then(setChartData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, chart: false })));
  }, [chartPeriod]);

  // Fetch summary data
  useEffect(() => {
    setLoading(l => ({ ...l, summary: true }));
    analytics.getLiquidationsSummary(selectedCoin, summaryPeriod)
      .then(setSummaryData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, summary: false })));
  }, [selectedCoin, summaryPeriod]);

  // Fetch market data
  useEffect(() => {
    setLoading(l => ({ ...l, market: true }));
    analytics.getLiquidationsMarket(selectedCoin, marketPeriod)
      .then(setMarketData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, market: false })));
  }, [selectedCoin, marketPeriod]);

  // Fetch featured liquidations
  useEffect(() => {
    setLoading(l => ({ ...l, featured: true }));
    analytics.getLiquidationsFeatured(10, featuredFilter === 'ALL' ? undefined : featuredFilter)
      .then(setFeaturedData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, featured: false })));
  }, [featuredFilter]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Flame className="text-[var(--asks)]" size={28} />
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Liquidations</h1>
      </div>

      {/* Two Column Section: Treemap + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Treemap Section */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Liquidations by Asset</h2>
            <PeriodSelector value={treemapPeriod} onChange={setTreemapPeriod} />
          </div>
          
          {loading.treemap ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : treemapData ? (
            <LiquidationTreemap 
              data={treemapData.data} 
              totalValue={treemapData.totalValue} 
              assets={treemapData.assets} 
            />
          ) : null}
        </div>

        {/* Chart Section */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Total Liquidations Chart</h2>
            <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
          </div>
          
          {/* Legend */}
          <div className="flex items-center gap-4 text-sm mb-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.long }} />
              <span className="text-[var(--text-secondary)]">Long Liquidations</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.short }} />
              <span className="text-[var(--text-secondary)]">Short Liquidations</span>
            </div>
          </div>
          
          {loading.chart ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : chartData?.data?.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={chartData.data.map((d: any) => ({
                    ...d,
                    shortValueNegative: -d.shortValue
                  }))} 
                  margin={{ top: 10, right: 10, bottom: 20, left: 10 }}
                  barGap={-16}
                  barSize={16}
                >
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    tickLine={false}
                  />
                  <YAxis 
                    tickFormatter={(v) => formatCompact(Math.abs(v))}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={false} />
                  <ReferenceLine y={0} stroke="var(--text-secondary)" strokeWidth={1} />
                  <Bar dataKey="longValue" name="Long" fill={COLORS.long} />
                  <Bar dataKey="shortValueNegative" name="Short" fill={COLORS.short} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--text-secondary)]">
              No chart data available
            </div>
          )}
        </div>
      </div>

      {/* Two Column Section: Summary + Market */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Liquidations Summary */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Liquidations Summary</h2>
            <div className="flex items-center gap-3">
              <CoinSelector value={selectedCoin} onChange={setSelectedCoin} />
              <PeriodSelector value={summaryPeriod} onChange={setSummaryPeriod} />
            </div>
          </div>
          
          {loading.summary ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : summaryData ? (
            <div className="space-y-4">
              {/* Total Liquidations */}
              <div className="p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-sm text-[var(--text-secondary)] mb-1">TOTAL LIQUIDATIONS</div>
                <div className="text-2xl font-bold text-[var(--text-primary)]">
                  {formatNumber(summaryData.totalCount, 0)} trades
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {formatCurrency(summaryData.totalValue)}
                </div>
              </div>

              {/* Long Liquidations */}
              <div className="p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-sm text-[var(--text-secondary)] mb-1">LONG LIQUIDATIONS</div>
                <div className="text-2xl font-bold" style={{ color: COLORS.long }}>
                  {formatCurrency(summaryData.longValue)}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {summaryData.longPercent.toFixed(2)}%
                </div>
              </div>

              {/* Short Liquidations */}
              <div className="p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-sm text-[var(--text-secondary)] mb-1">SHORT LIQUIDATIONS</div>
                <div className="text-2xl font-bold" style={{ color: COLORS.short }}>
                  {formatCurrency(summaryData.shortValue)}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {summaryData.shortPercent.toFixed(2)}%
                </div>
              </div>

              {/* Largest Liquidation */}
              <div className="p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-sm text-[var(--text-secondary)] mb-1">LARGEST LIQUIDATION</div>
                <div className="text-2xl font-bold text-[var(--text-primary)]">
                  {formatNumber(summaryData.largestSize, 2)} {selectedCoin}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {formatCurrency(summaryData.largestValue)}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Market Summary */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Market Summary – {selectedCoin}
            </h2>
            <div className="flex items-center gap-3">
              <CoinSelector value={selectedCoin} onChange={setSelectedCoin} />
              <PeriodSelector value={marketPeriod} onChange={setMarketPeriod} />
            </div>
          </div>
          
          {loading.market ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : marketData ? (
            <div className="space-y-5">
              {/* Dominant badge */}
              <div 
                className="inline-block px-3 py-1 rounded-md text-sm font-medium"
                style={{ 
                  backgroundColor: marketData.dominant === 'LONGS' ? `${COLORS.long}20` : `${COLORS.short}20`,
                  color: marketData.dominant === 'LONGS' ? COLORS.long : COLORS.short
                }}
              >
                {marketData.dominant} DOMINANT
              </div>

              {/* Price and Value row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-[var(--text-secondary)] mb-1">Current Market Price</div>
                  <div className="text-2xl font-bold text-[var(--text-primary)]">
                    ${formatNumber(marketData.markPrice, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-[var(--text-secondary)] mb-1">USD Value of Liquidations</div>
                  <div className="text-2xl font-bold text-[var(--text-primary)]">
                    {formatCurrency(marketData.totalValue)}
                  </div>
                </div>
              </div>

              {/* Density and Trend row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-[var(--text-secondary)] mb-2">Liquidation Density</div>
                  <div className="space-y-1">
                    <div className="text-sm" style={{ color: COLORS.long }}>
                      LONGS: {formatNumber(marketData.longCount, 0)} liquidations
                    </div>
                    <div className="text-sm" style={{ color: COLORS.short }}>
                      SHORTS: {formatNumber(marketData.shortCount, 0)} liquidations
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-[var(--text-secondary)] mb-1">Price Trend (24h)</div>
                  <div className={`text-2xl font-bold flex items-center gap-2 ${
                    marketData.priceChange24h >= 0 ? 'text-[var(--bids)]' : 'text-[var(--asks)]'
                  }`}>
                    {marketData.priceChange24h >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                    {marketData.priceChange24h >= 0 ? '+' : ''}{marketData.priceChange24h.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* L/S Distribution bar */}
              <div>
                <div className="text-sm text-[var(--text-secondary)] mb-2">L/S Notional Distribution</div>
                <div className="h-3 rounded-full overflow-hidden flex">
                  <div 
                    style={{ width: `${marketData.longPercent}%`, backgroundColor: COLORS.long }}
                    className="transition-all duration-500"
                  />
                  <div 
                    style={{ width: `${marketData.shortPercent}%`, backgroundColor: COLORS.short }}
                    className="transition-all duration-500"
                  />
                </div>
                <div className="flex justify-between mt-2 text-sm">
                  <div style={{ color: COLORS.long }}>
                    {marketData.longPercent.toFixed(2)}% LONGS<br />
                    <span className="text-[var(--text-secondary)]">{formatCurrency(marketData.longValue)}</span>
                  </div>
                  <div className="text-right" style={{ color: COLORS.short }}>
                    {marketData.shortPercent.toFixed(2)}% SHORTS<br />
                    <span className="text-[var(--text-secondary)]">{formatCurrency(marketData.shortValue)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Featured Liquidations Table */}
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Featured Liquidations</h2>
          <div className="flex items-center gap-2 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] px-3 py-1.5">
            <select
              value={featuredFilter}
              onChange={(e) => setFeaturedFilter(e.target.value)}
              className="bg-transparent text-sm text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="ALL">ALL</option>
              {COINS.map(coin => (
                <option key={coin} value={coin}>{coin}</option>
              ))}
            </select>
          </div>
        </div>
        
        {loading.featured ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
          </div>
        ) : featuredData?.data?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                  <th className="pb-3 font-medium">ASSET</th>
                  <th className="pb-3 font-medium">POSITION SIZE</th>
                  <th className="pb-3 font-medium">LIQUIDATION PRICE</th>
                  <th className="pb-3 font-medium">WALLET</th>
                </tr>
              </thead>
              <tbody>
                {featuredData.data.map((liq: any) => (
                  <tr key={liq.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-base)] transition-colors">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--bg-base)] flex items-center justify-center text-sm font-medium">
                          {liq.symbol.charAt(0)}
                        </div>
                        <span className="font-medium text-[var(--text-primary)]">{liq.symbol}</span>
                      </div>
                    </td>
                    <td className="py-4">
                      <div className="font-medium text-[var(--text-primary)]">{formatCurrency(liq.value)}</div>
                      {liq.isHighImpact && (
                        <div className="flex items-center gap-1 text-xs text-[var(--asks)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--asks)]" />
                          HIGH IMPACT
                        </div>
                      )}
                    </td>
                    <td className="py-4">
                      <div className={`font-medium ${liq.side === 'long' ? 'text-[var(--bids)]' : 'text-[var(--asks)]'}`}>
                        ${formatNumber(liq.price, 2)}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] uppercase">{liq.side}</div>
                    </td>
                    <td className="py-4">
                      <a 
                        href={`/whales/${liq.wallet}`}
                        className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1"
                      >
                        {formatAddress(liq.wallet)}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64 flex items-center justify-center text-[var(--text-secondary)]">
            No featured liquidations available
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="text-center text-sm text-[var(--text-secondary)] py-4">
        Data sourced from BULK Exchange. Updated in real-time via WebSocket. 
        For informational purposes only.
      </div>
    </div>
  );
}
