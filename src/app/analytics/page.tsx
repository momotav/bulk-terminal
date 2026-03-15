'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { analytics, formatCompact, cn, type ChartDataPoint } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, ComposedChart, Line, LineChart, ReferenceLine
} from 'recharts';
import { useStore } from '@/store';
import { ChevronDown } from 'lucide-react';

const MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const;

const timeRanges = [
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
  { label: 'Q', hours: 2160 },
  { label: 'Y', hours: 8760 },
  { label: 'ALL', hours: 8760 * 2 },
];

// BULK color palette - matching the screenshot style
const CHART_COLORS = {
  BTC: '#00B482',      // Primary green
  ETH: '#2271B5',      // Blue  
  SOL: '#7570B3',      // Purple
  cumulative: '#FFB548', // Orange line
  total: '#FFB548',
  grid: '#2a2a2a',
  axis: '#817778',
};

// Custom tooltip component matching Hyperscreener style
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  
  const date = new Date(label);
  const formattedDate = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-xl">
      <p className="text-sm text-gray-400 mb-2">{formattedDate}</p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div 
            className="w-3 h-3 rounded-sm" 
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-300">{entry.name}:</span>
          <span className="text-white font-medium">
            {entry.name.includes('OI') || entry.name === 'Cumulative' 
              ? `$${formatCompact(entry.value)}`
              : `$${formatCompact(entry.value)}`
            }
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const { selectedSymbol, setSelectedSymbol } = useStore();
  const [hours, setHours] = useState(720);
  const [loading, setLoading] = useState(true);
  const [selectedCoins, setSelectedCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [volumeDropdownOpen, setVolumeDropdownOpen] = useState(false);
  const [oiDropdownOpen, setOiDropdownOpen] = useState(false);
  
  // Volume data per market
  const [volumeData, setVolumeData] = useState<Record<string, ChartDataPoint[]>>({
    BTC: [], ETH: [], SOL: []
  });
  
  // OI data per market
  const [oiData, setOiData] = useState<Record<string, ChartDataPoint[]>>({
    BTC: [], ETH: [], SOL: []
  });
  
  const [fundingData, setFundingData] = useState<Record<string, ChartDataPoint[]>>({
    BTC: [], ETH: [], SOL: []
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [btcVol, ethVol, solVol, btcOi, ethOi, solOi, btcFr, ethFr, solFr] = await Promise.all([
          analytics.getVolume('BTC-USD', hours),
          analytics.getVolume('ETH-USD', hours),
          analytics.getVolume('SOL-USD', hours),
          analytics.getOpenInterest('BTC-USD', hours),
          analytics.getOpenInterest('ETH-USD', hours),
          analytics.getOpenInterest('SOL-USD', hours),
          analytics.getFundingRate('BTC-USD', hours),
          analytics.getFundingRate('ETH-USD', hours),
          analytics.getFundingRate('SOL-USD', hours),
        ]);
        
        setVolumeData({ BTC: btcVol, ETH: ethVol, SOL: solVol });
        setOiData({ BTC: btcOi, ETH: ethOi, SOL: solOi });
        setFundingData({ BTC: btcFr, ETH: ethFr, SOL: solFr });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hours]);

  // Combined volume data for stacked bars
  const combinedVolumeData = useMemo(() => {
    const btc = volumeData.BTC;
    if (!btc.length) return [];
    
    let cumulative = 0;
    return btc.map((item, i) => {
      const btcVal = selectedCoins.includes('BTC') ? item.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? (volumeData.ETH[i]?.value || 0) : 0;
      const solVal = selectedCoins.includes('SOL') ? (volumeData.SOL[i]?.value || 0) : 0;
      cumulative += btcVal + ethVal + solVal;
      
      return {
        timestamp: item.timestamp,
        BTC: btcVal,
        ETH: ethVal,
        SOL: solVal,
        cumulative,
      };
    });
  }, [volumeData, selectedCoins]);

  // Combined OI data for multi-line
  const combinedOIData = useMemo(() => {
    const btc = oiData.BTC;
    if (!btc.length) return [];
    
    return btc.map((item, i) => {
      const btcVal = selectedCoins.includes('BTC') ? item.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? (oiData.ETH[i]?.value || 0) : 0;
      const solVal = selectedCoins.includes('SOL') ? (oiData.SOL[i]?.value || 0) : 0;
      
      return {
        timestamp: item.timestamp,
        BTC: btcVal,
        ETH: ethVal,
        SOL: solVal,
        total: btcVal + ethVal + solVal,
      };
    });
  }, [oiData, selectedCoins]);

  // Combined funding rate data
  const combinedFundingData = useMemo(() => {
    const btc = fundingData.BTC;
    if (!btc.length) return [];
    
    return btc.map((item, i) => ({
      timestamp: item.timestamp,
      BTC: selectedCoins.includes('BTC') ? (item.value * 100) : null,
      ETH: selectedCoins.includes('ETH') ? ((fundingData.ETH[i]?.value || 0) * 100) : null,
      SOL: selectedCoins.includes('SOL') ? ((fundingData.SOL[i]?.value || 0) * 100) : null,
    }));
  }, [fundingData, selectedCoins]);

  const toggleCoin = useCallback((coin: string) => {
    setSelectedCoins(prev => 
      prev.includes(coin) ? prev.filter(c => c !== coin) : [...prev, coin]
    );
  }, []);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Coin filter button component
  const CoinButton = ({ coin, color }: { coin: string; color: string }) => (
    <button
      onClick={() => toggleCoin(coin)}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all",
        selectedCoins.includes(coin)
          ? "bg-[#1a1a1a] border-[#333] text-white"
          : "bg-transparent border-transparent text-gray-500 hover:text-gray-300"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {coin}
    </button>
  );

  // Timeframe selector
  const TimeframeButtons = () => (
    <div className="flex items-center gap-0.5">
      {timeRanges.map((t) => (
        <button
          key={t.hours}
          onClick={() => setHours(t.hours)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded transition-all",
            hours === t.hours
              ? "bg-[#1a1a1a] text-white border border-[#00B482]"
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // Dropdown for coin selection
  const CoinDropdown = ({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (v: boolean) => void }) => (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white"
      >
        {selectedCoins.length} coins selected
        <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="absolute top-full mt-1 left-0 bg-[#1a1a1a] border border-[#333] rounded-lg py-1 z-20 min-w-[140px] shadow-xl">
          <input 
            type="text" 
            placeholder="Search coins..."
            className="w-full px-3 py-2 text-xs bg-transparent border-b border-[#333] text-white placeholder-gray-500 focus:outline-none"
          />
          <button 
            onClick={() => setSelectedCoins([])}
            className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-[#252525] hover:text-white"
          >
            Deselect All
          </button>
          {['BTC', 'ETH', 'SOL'].map(coin => (
            <button
              key={coin}
              onClick={() => toggleCoin(coin)}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-[#252525]",
                selectedCoins.includes(coin) ? "text-white" : "text-gray-500"
              )}
            >
              {coin}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Range slider (visual representation)
  const RangeSlider = ({ data }: { data: any[] }) => {
    if (!data.length) return null;
    return (
      <div className="mt-3 mx-2">
        <div className="relative h-6 bg-[#1a1a1a] rounded overflow-hidden border border-[#333]">
          {/* Mini chart preview */}
          <div className="absolute inset-0 flex items-end px-1">
            {data.slice(-50).map((_, i) => (
              <div 
                key={i}
                className="flex-1 mx-px bg-[#00B482]/30 rounded-t"
                style={{ height: `${20 + Math.random() * 60}%` }}
              />
            ))}
          </div>
          {/* Selection range */}
          <div 
            className="absolute top-0 bottom-0 bg-[#00B482]/10 border-l-2 border-r-2 border-[#00B482]"
            style={{ left: '10%', right: '10%' }}
          />
          {/* Handles */}
          <div className="absolute left-[10%] top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-5 bg-[#333] rounded cursor-ew-resize flex items-center justify-center">
            <div className="w-0.5 h-2 bg-gray-500 rounded" />
          </div>
          <div className="absolute right-[10%] top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-5 bg-[#333] rounded cursor-ew-resize flex items-center justify-center">
            <div className="w-0.5 h-2 bg-gray-500 rounded" />
          </div>
        </div>
      </div>
    );
  };

  const totalVolume = combinedVolumeData[combinedVolumeData.length - 1]?.cumulative || 0;
  const totalOI = combinedOIData[combinedOIData.length - 1]?.total || 0;

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Page Title */}
        <h1 className="text-3xl font-bold text-white mb-6">Analytics</h1>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#333] mb-6">
          {[
            { label: 'Total Volume', value: `$${formatCompact(totalVolume)}` },
            { label: 'Open Interest', value: `$${formatCompact(totalOI)}` },
            { label: 'Active Markets', value: '3' },
            { label: '24h Trades', value: '—' },
          ].map((stat, i) => (
            <div key={i} className="bg-dark-primary p-4">
              <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-lg p-4 h-[420px] animate-pulse border border-[#222]" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Volume & OI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Total Volume */}
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Total Volume</h3>
                
                {/* Coin toggles */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <CoinButton coin="BTC" color={CHART_COLORS.BTC} />
                  <CoinButton coin="ETH" color={CHART_COLORS.ETH} />
                  <CoinButton coin="SOL" color={CHART_COLORS.SOL} />
                  <button className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white">
                    <div className="w-3 h-3 rounded-sm bg-[#FFB548]" />
                    Cumulative Volume
                  </button>
                  <button 
                    onClick={() => setSelectedCoins([])}
                    className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white"
                  >
                    Deselect all
                  </button>
                </div>

                {/* Controls row */}
                <div className="flex items-center justify-between mb-4">
                  <CoinDropdown isOpen={volumeDropdownOpen} setIsOpen={setVolumeDropdownOpen} />
                  <TimeframeButtons />
                </div>

                {/* Chart */}
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={combinedVolumeData} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="volume"
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                        width={45}
                      />
                      <YAxis 
                        yAxisId="cumulative"
                        orientation="right"
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      
                      {/* Stacked bars - order matters for stacking */}
                      <Bar yAxisId="volume" dataKey="SOL" stackId="stack" fill={CHART_COLORS.SOL} radius={[0, 0, 0, 0]} />
                      <Bar yAxisId="volume" dataKey="ETH" stackId="stack" fill={CHART_COLORS.ETH} radius={[0, 0, 0, 0]} />
                      <Bar yAxisId="volume" dataKey="BTC" stackId="stack" fill={CHART_COLORS.BTC} radius={[2, 2, 0, 0]} />
                      
                      {/* Cumulative line */}
                      <Line 
                        yAxisId="cumulative"
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke={CHART_COLORS.cumulative} 
                        strokeWidth={2}
                        dot={false}
                        name="Cumulative"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider data={combinedVolumeData} />
              </div>

              {/* Open Interest */}
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Open Interest</h3>
                
                {/* Coin toggles */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <CoinButton coin="BTC" color={CHART_COLORS.BTC} />
                  <CoinButton coin="ETH" color={CHART_COLORS.ETH} />
                  <CoinButton coin="SOL" color={CHART_COLORS.SOL} />
                  <button className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white">
                    <div className="w-3 h-3 rounded-sm bg-[#FFB548]" />
                    Total Open Interest
                  </button>
                  <button 
                    onClick={() => setSelectedCoins([])}
                    className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white"
                  >
                    Deselect all
                  </button>
                </div>

                {/* Controls row */}
                <div className="flex items-center justify-between mb-4">
                  <CoinDropdown isOpen={oiDropdownOpen} setIsOpen={setOiDropdownOpen} />
                  <TimeframeButtons />
                </div>

                {/* Chart */}
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedOIData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                      />
                      <YAxis 
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                        width={45}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      
                      <Line 
                        type="monotone" 
                        dataKey="BTC" 
                        stroke={CHART_COLORS.BTC} 
                        strokeWidth={2}
                        dot={false}
                        name="BTC OI"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="ETH" 
                        stroke={CHART_COLORS.ETH} 
                        strokeWidth={2}
                        dot={false}
                        name="ETH OI"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="SOL" 
                        stroke={CHART_COLORS.SOL} 
                        strokeWidth={2}
                        dot={false}
                        name="SOL OI"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke={CHART_COLORS.total} 
                        strokeWidth={2}
                        dot={false}
                        name="Total OI"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider data={combinedOIData} />
              </div>
            </div>

            {/* Row 2: Funding Rate */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Annualized Funding Rate */}
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Annualized Funding Rate</h3>
                
                {/* Coin toggles */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <CoinButton coin="BTC" color={CHART_COLORS.BTC} />
                  <CoinButton coin="ETH" color={CHART_COLORS.ETH} />
                  <CoinButton coin="SOL" color={CHART_COLORS.SOL} />
                  <button 
                    onClick={() => setSelectedCoins([])}
                    className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white"
                  >
                    Deselect all
                  </button>
                </div>

                {/* Controls row */}
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs text-gray-500">{selectedCoins.length} coins selected</div>
                  <TimeframeButtons />
                </div>

                {/* Chart */}
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedFundingData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                      />
                      <YAxis 
                        tickFormatter={(v) => `${v?.toFixed(2) || 0}%`}
                        tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                        axisLine={{ stroke: '#333' }}
                        tickLine={false}
                        width={45}
                        domain={['auto', 'auto']}
                      />
                      <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const date = new Date(label);
                          return (
                            <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3">
                              <p className="text-sm text-gray-400 mb-2">
                                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                              {payload.filter((p: any) => p.value !== null).map((entry: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                                  <span className="text-gray-300">{entry.name}:</span>
                                  <span className={cn("font-medium", entry.value >= 0 ? "text-green-400" : "text-red-400")}>
                                    {entry.value?.toFixed(4)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      
                      <Line 
                        type="monotone" 
                        dataKey="BTC" 
                        stroke={CHART_COLORS.BTC} 
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="ETH" 
                        stroke={CHART_COLORS.ETH} 
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="SOL" 
                        stroke={CHART_COLORS.SOL} 
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider data={combinedFundingData} />
              </div>

              {/* Coming Soon */}
              <div className="bg-[#111] rounded-lg border border-[#222] p-4 flex flex-col items-center justify-center min-h-[380px]">
                <div className="text-center">
                  <p className="text-xl font-semibold text-white mb-2">More Analytics Coming</p>
                  <p className="text-sm text-gray-500 max-w-xs">
                    Liquidation heatmaps, long/short ratio, and more market insights
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
