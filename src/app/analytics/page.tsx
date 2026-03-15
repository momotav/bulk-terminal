'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { analytics, leaderboard, formatCompact, formatAddress, cn, type LeaderboardEntry } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, ComposedChart, Line, LineChart, ReferenceLine, AreaChart, Area
} from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import Link from 'next/link';

const timeRanges = [
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
  { label: 'Q', hours: 2160 },
  { label: 'Y', hours: 8760 },
  { label: 'ALL', hours: 8760 * 2 },
];

// BULK color palette
const COLORS = {
  BTC: '#00B482',
  ETH: '#2271B5',
  SOL: '#7570B3',
  cumulative: '#FFB548',
  total: '#FFB548',
};

// Chart data type
type ChartData = { timestamp: string; BTC: number; ETH: number; SOL: number; total: number };

// Interactive Range Slider Component
const InteractiveRangeSlider = ({ 
  data, 
  color = COLORS.BTC,
  rangeStart,
  rangeEnd,
  onRangeChange,
}: { 
  data: any[];
  color?: string;
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | 'middle' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartRange, setDragStartRange] = useState({ start: 0, end: 100 });

  // If only 1 day of data, disable slider
  const isDisabled = data.length <= 1;

  const getPositionFromEvent = (e: React.MouseEvent | MouseEvent) => {
    if (!sliderRef.current) return 0;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  };

  const handleMouseDown = (e: React.MouseEvent, type: 'left' | 'right' | 'middle') => {
    if (isDisabled) return;
    e.preventDefault();
    setDragging(type);
    setDragStartX(e.clientX);
    setDragStartRange({ start: rangeStart, end: rangeEnd });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX;
      const deltaPercent = (deltaX / rect.width) * 100;

      if (dragging === 'left') {
        const newStart = Math.max(0, Math.min(dragStartRange.start + deltaPercent, rangeEnd - 5));
        onRangeChange(newStart, rangeEnd);
      } else if (dragging === 'right') {
        const newEnd = Math.max(rangeStart + 5, Math.min(100, dragStartRange.end + deltaPercent));
        onRangeChange(rangeStart, newEnd);
      } else if (dragging === 'middle') {
        const rangeWidth = dragStartRange.end - dragStartRange.start;
        let newStart = dragStartRange.start + deltaPercent;
        let newEnd = dragStartRange.end + deltaPercent;
        
        if (newStart < 0) {
          newStart = 0;
          newEnd = rangeWidth;
        }
        if (newEnd > 100) {
          newEnd = 100;
          newStart = 100 - rangeWidth;
        }
        onRangeChange(newStart, newEnd);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartX, dragStartRange, rangeStart, rangeEnd, onRangeChange]);

  // Calculate bar heights from data
  const maxValue = Math.max(...data.map(d => d.total || d.BTC + d.ETH + d.SOL || 0), 1);
  const barHeights = data.map(d => ((d.total || d.BTC + d.ETH + d.SOL || 0) / maxValue) * 100);

  return (
    <div 
      ref={sliderRef}
      className={cn(
        "mt-3 h-8 bg-[#1a1a1a] rounded border border-[#282828] relative overflow-hidden select-none",
        isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      {/* Mini bar chart preview */}
      <div className="absolute inset-y-1 left-1 right-1 flex items-end gap-px">
        {(data.length > 0 ? barHeights : Array(30).fill(20)).map((height, i) => (
          <div 
            key={i} 
            className="flex-1 rounded-t transition-opacity"
            style={{ 
              height: `${Math.max(10, height)}%`, 
              backgroundColor: `${color}30`,
              opacity: !isDisabled && (i / data.length * 100 >= rangeStart && i / data.length * 100 <= rangeEnd) ? 1 : 0.3
            }} 
          />
        ))}
      </div>

      {!isDisabled && (
        <>
          {/* Selected range highlight */}
          <div 
            className="absolute top-0 bottom-0 bg-transparent border-l-2 border-r-2 cursor-grab active:cursor-grabbing"
            style={{ 
              left: `${rangeStart}%`, 
              right: `${100 - rangeEnd}%`,
              borderColor: color,
            }}
            onMouseDown={(e) => handleMouseDown(e, 'middle')}
          />

          {/* Left handle */}
          <div 
            className="absolute top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center z-10 group"
            style={{ left: `calc(${rangeStart}% - 6px)` }}
            onMouseDown={(e) => handleMouseDown(e, 'left')}
          >
            <div 
              className="w-1.5 h-4 rounded-full transition-colors"
              style={{ backgroundColor: dragging === 'left' ? color : '#666' }}
            />
          </div>

          {/* Right handle */}
          <div 
            className="absolute top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center z-10 group"
            style={{ left: `calc(${rangeEnd}% - 6px)` }}
            onMouseDown={(e) => handleMouseDown(e, 'right')}
          >
            <div 
              className="w-1.5 h-4 rounded-full transition-colors"
              style={{ backgroundColor: dragging === 'right' ? color : '#666' }}
            />
          </div>
        </>
      )}
    </div>
  );
};

// Shared tooltip component
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const date = new Date(label);
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-gray-400 mb-2 border-b border-[#333] pb-2">{formattedDate}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-400">{entry.name}</span>
          </div>
          <span className="text-white font-medium">
            {typeof entry.value === 'number' 
              ? entry.name.includes('%') || entry.name.includes('Rate')
                ? `${entry.value.toFixed(4)}%`
                : `$${formatCompact(entry.value)}`
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [hours, setHours] = useState(720);
  const [loading, setLoading] = useState(true);
  const [selectedCoins, setSelectedCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [topUsersPage, setTopUsersPage] = useState(1);
  
  // Range slider states for each chart
  const [volumeRange, setVolumeRange] = useState({ start: 0, end: 100 });
  const [oiRange, setOiRange] = useState({ start: 0, end: 100 });
  const [fundingRange, setFundingRange] = useState({ start: 0, end: 100 });
  const [liquidationsRange, setLiquidationsRange] = useState({ start: 0, end: 100 });
  const [tradesRange, setTradesRange] = useState({ start: 0, end: 100 });
  const [adlRange, setAdlRange] = useState({ start: 0, end: 100 });
  
  // Real data from BULK API
  const [oiData, setOiData] = useState<Record<string, { timestamp: string; value: number }[]>>({ BTC: [], ETH: [], SOL: [] });
  const [fundingData, setFundingData] = useState<Record<string, { timestamp: string; value: number }[]>>({ BTC: [], ETH: [], SOL: [] });
  
  // Real data from our database (testnet activity)
  const [tradesChart, setTradesChart] = useState<ChartData[]>([]);
  const [liquidationsChart, setLiquidationsChart] = useState<ChartData[]>([]);
  const [adlChart, setAdlChart] = useState<ChartData[]>([]);
  const [volumeChart, setVolumeChart] = useState<ChartData[]>([]);
  const [stats, setStats] = useState<{ trades: { count: number; volume: number }; liquidations: { count: number; volume: number }; adl: { count: number; volume: number }; uniqueTraders: number } | null>(null);
  const [topUsers, setTopUsers] = useState<LeaderboardEntry[]>([]);

  // Reset ranges when timeframe changes
  useEffect(() => {
    setVolumeRange({ start: 0, end: 100 });
    setOiRange({ start: 0, end: 100 });
    setFundingRange({ start: 0, end: 100 });
    setLiquidationsRange({ start: 0, end: 100 });
    setTradesRange({ start: 0, end: 100 });
    setAdlRange({ start: 0, end: 100 });
  }, [hours]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [
          btcOi, ethOi, solOi,
          btcFr, ethFr, solFr,
          trades, liquidations, adl, volume,
          statsData, users
        ] = await Promise.all([
          analytics.getOpenInterest('BTC-USD', hours),
          analytics.getOpenInterest('ETH-USD', hours),
          analytics.getOpenInterest('SOL-USD', hours),
          analytics.getFundingRate('BTC-USD', hours),
          analytics.getFundingRate('ETH-USD', hours),
          analytics.getFundingRate('SOL-USD', hours),
          analytics.getTradesChart(hours),
          analytics.getLiquidationsChart(hours),
          analytics.getADLChart(hours),
          analytics.getVolumeChart(hours),
          analytics.getStats(),
          leaderboard.getMostActive('all', 100),
        ]);
        
        setOiData({ BTC: btcOi, ETH: ethOi, SOL: solOi });
        setFundingData({ BTC: btcFr, ETH: ethFr, SOL: solFr });
        setTradesChart(trades);
        setLiquidationsChart(liquidations);
        setAdlChart(adl);
        setVolumeChart(volume);
        setStats(statsData);
        setTopUsers(users);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [hours]);

  // Helper to slice data based on range
  const sliceDataByRange = <T,>(data: T[], range: { start: number; end: number }): T[] => {
    if (data.length <= 1) return data;
    const startIdx = Math.floor((range.start / 100) * data.length);
    const endIdx = Math.ceil((range.end / 100) * data.length);
    return data.slice(startIdx, endIdx);
  };

  // Add cumulative to chart data
  const withCumulative = (data: ChartData[]) => {
    let cumulative = 0;
    return data.map(item => {
      const btc = selectedCoins.includes('BTC') ? item.BTC : 0;
      const eth = selectedCoins.includes('ETH') ? item.ETH : 0;
      const sol = selectedCoins.includes('SOL') ? item.SOL : 0;
      cumulative += btc + eth + sol;
      return { ...item, BTC: btc, ETH: eth, SOL: sol, Cumulative: cumulative };
    });
  };

  // Combined OI data for multi-line
  const combinedOIData = useMemo(() => {
    const btc = oiData.BTC;
    if (!btc.length) return [];
    return btc.map((item, i) => ({
      timestamp: item.timestamp,
      BTC: selectedCoins.includes('BTC') ? item.value : 0,
      ETH: selectedCoins.includes('ETH') ? (oiData.ETH[i]?.value || 0) : 0,
      SOL: selectedCoins.includes('SOL') ? (oiData.SOL[i]?.value || 0) : 0,
      'Total OI': (selectedCoins.includes('BTC') ? item.value : 0) +
                  (selectedCoins.includes('ETH') ? (oiData.ETH[i]?.value || 0) : 0) +
                  (selectedCoins.includes('SOL') ? (oiData.SOL[i]?.value || 0) : 0),
    }));
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
    setSelectedCoins(prev => prev.includes(coin) ? prev.filter(c => c !== coin) : [...prev, coin]);
  }, []);

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const formatDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Reusable components
  const CoinToggle = ({ coin }: { coin: string }) => (
    <button
      onClick={() => toggleCoin(coin)}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all",
        selectedCoins.includes(coin)
          ? "bg-[#1f1f1f] border-[#333] text-white"
          : "bg-transparent border-transparent text-gray-500 hover:text-gray-300"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[coin as keyof typeof COLORS] }} />
      {coin}
    </button>
  );

  const CumulativeToggle = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1f1f1f] border border-[#333] text-xs text-white">
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.cumulative }} />
      {label}
    </div>
  );

  const TimeframeButtons = () => (
    <div className="flex items-center">
      {timeRanges.map((t) => (
        <button
          key={t.hours}
          onClick={() => setHours(t.hours)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-all",
            hours === t.hours
              ? "text-white border border-[#00B482] rounded bg-[#1a1a1a]"
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const CoinsDropdown = () => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1f1f1f] border border-[#333] text-xs text-white cursor-pointer">
      {selectedCoins.length} coins selected
      <ChevronDown className="w-3 h-3" />
    </div>
  );

  const NoDataMessage = ({ title }: { title: string }) => (
    <div className="h-[260px] flex flex-col items-center justify-center text-gray-500">
      <p className="text-sm">No {title} data yet</p>
      <p className="text-xs mt-1">Data will appear as users trade on testnet</p>
    </div>
  );

  const ChartCard = ({ title, children, toggles }: { 
    title: string; 
    children: React.ReactNode; 
    toggles?: React.ReactNode;
  }) => (
    <div className="bg-[#111] rounded-lg border border-[#222] p-4">
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
      {toggles && <div className="flex flex-wrap items-center gap-2 mb-3">{toggles}</div>}
      <div className="flex items-center justify-between mb-4">
        <CoinsDropdown />
        <TimeframeButtons />
      </div>
      {children}
    </div>
  );

  const paginatedUsers = topUsers.slice((topUsersPage - 1) * 10, topUsersPage * 10);
  const totalPages = Math.ceil(topUsers.length / 10) || 1;

  // Apply range filters and cumulative
  const volumeDataFull = withCumulative(volumeChart);
  const volumeDataFiltered = sliceDataByRange(volumeDataFull, volumeRange);
  
  const tradesDataFull = withCumulative(tradesChart);
  const tradesDataFiltered = sliceDataByRange(tradesDataFull, tradesRange);
  
  const liquidationsDataFull = withCumulative(liquidationsChart);
  const liquidationsDataFiltered = sliceDataByRange(liquidationsDataFull, liquidationsRange);
  
  const adlDataFull = withCumulative(adlChart);
  const adlDataFiltered = sliceDataByRange(adlDataFull, adlRange);
  
  const oiDataFiltered = sliceDataByRange(combinedOIData, oiRange);
  const fundingDataFiltered = sliceDataByRange(combinedFundingData, fundingRange);

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <h1 className="text-3xl font-bold text-white mb-6">Analytics</h1>

        {/* Stats Row - Real data */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#333] mb-6 rounded-lg overflow-hidden">
          {[
            { label: 'Total Trades', value: stats?.trades.count || 0, format: 'number' },
            { label: 'Total Volume', value: stats?.trades.volume || 0, format: 'currency' },
            { label: 'Liquidations', value: stats?.liquidations.count || 0, format: 'number' },
            { label: 'Unique Traders', value: stats?.uniqueTraders || 0, format: 'number' },
          ].map((stat, i) => (
            <div key={i} className="bg-dark-primary p-4">
              <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-white">
                {stat.format === 'currency' ? `$${formatCompact(stat.value)}` : stat.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-lg border border-[#222] p-4 h-[420px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Volume & Open Interest */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Total Volume */}
              <ChartCard 
                title="Total Volume"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Volume" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {volumeDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={volumeDataFiltered} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={50} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={volumeDataFull} 
                      color={COLORS.BTC}
                      rangeStart={volumeRange.start}
                      rangeEnd={volumeRange.end}
                      onRangeChange={(start, end) => setVolumeRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="volume" />}
              </ChartCard>

              {/* Open Interest */}
              <ChartCard 
                title="Open Interest"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Total Open Interest" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {combinedOIData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={oiDataFiltered} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="BTC" stroke={COLORS.BTC} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="ETH" stroke={COLORS.ETH} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="SOL" stroke={COLORS.SOL} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="Total OI" stroke={COLORS.cumulative} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={combinedOIData} 
                      color={COLORS.cumulative}
                      rangeStart={oiRange.start}
                      rangeEnd={oiRange.end}
                      onRangeChange={(start, end) => setOiRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="open interest" />}
              </ChartCard>
            </div>

            {/* Row 2: Funding Rate & Liquidations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Funding Rate */}
              <ChartCard 
                title="Annualized Funding Rate"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {combinedFundingData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={fundingDataFiltered} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis tickFormatter={v => `${v?.toFixed(2) || 0}%`} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} domain={['auto', 'auto']} />
                          <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="BTC" stroke={COLORS.BTC} strokeWidth={2} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="ETH" stroke={COLORS.ETH} strokeWidth={2} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="SOL" stroke={COLORS.SOL} strokeWidth={2} dot={false} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={combinedFundingData} 
                      color={COLORS.ETH}
                      rangeStart={fundingRange.start}
                      rangeEnd={fundingRange.end}
                      onRangeChange={(start, end) => setFundingRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="funding rate" />}
              </ChartCard>

              {/* Liquidations */}
              <ChartCard 
                title="Liquidations"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Liquidated" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {liquidationsDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={liquidationsDataFiltered} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={50} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={liquidationsDataFull} 
                      color="#EF4A3C"
                      rangeStart={liquidationsRange.start}
                      rangeEnd={liquidationsRange.end}
                      onRangeChange={(start, end) => setLiquidationsRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="liquidation" />}
              </ChartCard>
            </div>

            {/* Row 3: Number of Trades & ADL */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Number of Trades */}
              <ChartCard 
                title="Number Of Trades"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Trades" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {tradesDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={tradesDataFiltered} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={50} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={tradesDataFull} 
                      color={COLORS.BTC}
                      rangeStart={tradesRange.start}
                      rangeEnd={tradesRange.end}
                      onRangeChange={(start, end) => setTradesRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="trades" />}
              </ChartCard>

              {/* ADL Events */}
              <ChartCard 
                title="Auto-Deleveraging (ADL)"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative ADL" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">Deselect all</button>
                </>}
              >
                {adlDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={adlDataFiltered} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
                          <XAxis dataKey="timestamp" tickFormatter={formatDate} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={45} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#666', fontSize: 10 }} axisLine={{ stroke: '#333' }} tickLine={false} width={50} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={adlDataFull} 
                      color={COLORS.SOL}
                      rangeStart={adlRange.start}
                      rangeEnd={adlRange.end}
                      onRangeChange={(start, end) => setAdlRange({ start, end })}
                    />
                  </>
                ) : <NoDataMessage title="ADL" />}
              </ChartCard>
            </div>

            {/* Row 4: Top Users By Volume */}
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Top Users By Volume</h3>
                
                {topUsers.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wider pb-3 border-b border-[#222]">
                      <span>Address</span>
                      <span className="flex items-center gap-1">Volume USD<ChevronDown className="w-3 h-3" /></span>
                    </div>
                    <div className="divide-y divide-[#222]">
                      {paginatedUsers.map((user) => (
                        <div key={user.wallet_address} className="flex items-center justify-between py-3 hover:bg-[#1a1a1a] -mx-4 px-4 transition-colors">
                          <div className="flex items-center gap-2">
                            <Link href={`/whales/${user.wallet_address}`} className="text-sm text-gray-300 hover:text-white font-mono transition-colors">
                              {formatAddress(user.wallet_address)}
                            </Link>
                            <button onClick={() => copyAddress(user.wallet_address)} className="p-1 hover:bg-[#333] rounded transition-colors">
                              {copiedAddress === user.wallet_address ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-500" />}
                            </button>
                          </div>
                          <span className="text-sm text-white font-medium">${formatCompact(user.value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#222]">
                      <span className="text-xs text-gray-500">Showing {(topUsersPage - 1) * 10 + 1} - {Math.min(topUsersPage * 10, topUsers.length)} of {topUsers.length}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setTopUsersPage(p => Math.max(1, p - 1))} disabled={topUsersPage === 1} className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-3 py-1 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white">{topUsersPage} of {totalPages}</span>
                        <button onClick={() => setTopUsersPage(p => Math.min(totalPages, p + 1))} disabled={topUsersPage === totalPages} className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-[200px] flex flex-col items-center justify-center text-gray-500">
                    <p className="text-sm">No traders yet</p>
                    <p className="text-xs mt-1">Data will appear as users trade on testnet</p>
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
