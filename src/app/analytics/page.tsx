'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { analytics, leaderboard, formatCompact, formatAddress, cn, type ChartDataPoint, type LeaderboardEntry } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, ComposedChart, Line, LineChart, ReferenceLine, BarChart
} from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import Link from 'next/link';

const MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const;

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
  Others: '#555555',
  cumulative: '#FFB548',
  positive: '#00B482',
  negative: '#EF4A3C',
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
  
  // Data states
  const [volumeData, setVolumeData] = useState<Record<string, ChartDataPoint[]>>({ BTC: [], ETH: [], SOL: [] });
  const [oiData, setOiData] = useState<Record<string, ChartDataPoint[]>>({ BTC: [], ETH: [], SOL: [] });
  const [fundingData, setFundingData] = useState<Record<string, ChartDataPoint[]>>({ BTC: [], ETH: [], SOL: [] });
  const [topUsers, setTopUsers] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [btcVol, ethVol, solVol, btcOi, ethOi, solOi, btcFr, ethFr, solFr, users] = await Promise.all([
          analytics.getVolume('BTC-USD', hours),
          analytics.getVolume('ETH-USD', hours),
          analytics.getVolume('SOL-USD', hours),
          analytics.getOpenInterest('BTC-USD', hours),
          analytics.getOpenInterest('ETH-USD', hours),
          analytics.getOpenInterest('SOL-USD', hours),
          analytics.getFundingRate('BTC-USD', hours),
          analytics.getFundingRate('ETH-USD', hours),
          analytics.getFundingRate('SOL-USD', hours),
          leaderboard.getMostActive('all', 100),
        ]);
        
        setVolumeData({ BTC: btcVol, ETH: ethVol, SOL: solVol });
        setOiData({ BTC: btcOi, ETH: ethOi, SOL: solOi });
        setFundingData({ BTC: btcFr, ETH: ethFr, SOL: solFr });
        setTopUsers(users);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [hours]);

  // Combined data generators
  const combinedVolumeData = useMemo(() => {
    const btc = volumeData.BTC;
    if (!btc.length) return [];
    let cumulative = 0;
    return btc.map((item, i) => {
      const btcVal = selectedCoins.includes('BTC') ? item.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? (volumeData.ETH[i]?.value || 0) : 0;
      const solVal = selectedCoins.includes('SOL') ? (volumeData.SOL[i]?.value || 0) : 0;
      cumulative += btcVal + ethVal + solVal;
      return { timestamp: item.timestamp, BTC: btcVal, ETH: ethVal, SOL: solVal, Cumulative: cumulative };
    });
  }, [volumeData, selectedCoins]);

  const combinedOIData = useMemo(() => {
    const btc = oiData.BTC;
    if (!btc.length) return [];
    return btc.map((item, i) => {
      const btcVal = selectedCoins.includes('BTC') ? item.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? (oiData.ETH[i]?.value || 0) : 0;
      const solVal = selectedCoins.includes('SOL') ? (oiData.SOL[i]?.value || 0) : 0;
      return { timestamp: item.timestamp, BTC: btcVal, ETH: ethVal, SOL: solVal, 'Total OI': btcVal + ethVal + solVal };
    });
  }, [oiData, selectedCoins]);

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

  // For liquidations and trades, we'll simulate with volume data pattern
  const liquidationsData = useMemo(() => {
    return combinedVolumeData.map(item => ({
      ...item,
      BTC: item.BTC * 0.02,
      ETH: item.ETH * 0.025,
      SOL: item.SOL * 0.03,
      Cumulative: item.Cumulative * 0.02,
    }));
  }, [combinedVolumeData]);

  const tradesData = useMemo(() => {
    return combinedVolumeData.map(item => ({
      timestamp: item.timestamp,
      BTC: Math.floor(item.BTC / 5000),
      ETH: Math.floor(item.ETH / 3000),
      SOL: Math.floor(item.SOL / 1000),
      Cumulative: Math.floor(item.Cumulative / 3000),
    }));
  }, [combinedVolumeData]);

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

  const RangeSlider = ({ color = COLORS.BTC }: { color?: string }) => (
    <div className="mt-3 h-6 bg-[#1a1a1a] rounded border border-[#282828] relative overflow-hidden">
      <div className="absolute inset-y-0 left-[5%] right-[5%] flex items-end gap-px px-1">
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-t" style={{ height: `${15 + Math.random() * 70}%`, backgroundColor: `${color}40` }} />
        ))}
      </div>
      <div className="absolute inset-y-0 left-[10%] right-[10%] border-l-2 border-r-2" style={{ borderColor: color }} />
    </div>
  );

  const ChartCard = ({ title, children, toggles, extraControls }: { 
    title: string; 
    children: React.ReactNode; 
    toggles?: React.ReactNode;
    extraControls?: React.ReactNode;
  }) => (
    <div className="bg-[#111] rounded-lg border border-[#222] p-4">
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
      {toggles && <div className="flex flex-wrap items-center gap-2 mb-3">{toggles}</div>}
      <div className="flex items-center justify-between mb-4">
        <CoinsDropdown />
        <div className="flex items-center gap-2">
          {extraControls}
          <TimeframeButtons />
        </div>
      </div>
      {children}
    </div>
  );

  const paginatedUsers = topUsers.slice((topUsersPage - 1) * 10, topUsersPage * 10);
  const totalPages = Math.ceil(topUsers.length / 10);

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <h1 className="text-3xl font-bold text-white mb-6">Analytics</h1>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-lg border border-[#222] p-4 h-[420px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Total Volume & Open Interest */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Total Volume */}
              <ChartCard 
                title="Total Volume"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Volume" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">
                    Deselect all
                  </button>
                </>}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={combinedVolumeData} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
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
                <RangeSlider />
              </ChartCard>

              {/* Open Interest */}
              <ChartCard 
                title="Open Interest"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Total Open Interest" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">
                    Deselect all
                  </button>
                </>}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedOIData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
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
                <RangeSlider color={COLORS.cumulative} />
              </ChartCard>
            </div>

            {/* Row 2: Funding Rate & Liquidations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Annualized Funding Rate */}
              <ChartCard 
                title="Annualized Funding Rate"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">
                    Deselect all
                  </button>
                </>}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedFundingData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
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
                <RangeSlider color={COLORS.ETH} />
              </ChartCard>

              {/* Liquidations */}
              <ChartCard 
                title="Liquidations"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Liquidated" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">
                    Deselect all
                  </button>
                </>}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={liquidationsData} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
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
                <RangeSlider color={COLORS.negative} />
              </ChartCard>
            </div>

            {/* Row 3: Number of Trades & Top Users */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Number of Trades */}
              <ChartCard 
                title="Number Of Trades"
                toggles={<>
                  <CoinToggle coin="BTC" />
                  <CoinToggle coin="ETH" />
                  <CoinToggle coin="SOL" />
                  <CumulativeToggle label="Cumulative Trades" />
                  <button onClick={() => setSelectedCoins([])} className="px-3 py-1.5 rounded border border-[#333] text-xs text-gray-500 hover:text-white">
                    Deselect all
                  </button>
                </>}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={tradesData} margin={{ top: 5, right: 50, bottom: 5, left: 0 }}>
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
                <RangeSlider />
              </ChartCard>

              {/* Top Users By Volume */}
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Top Users By Volume</h3>
                
                {/* Table Header */}
                <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wider pb-3 border-b border-[#222]">
                  <span>Address</span>
                  <span className="flex items-center gap-1">
                    Volume USD
                    <ChevronDown className="w-3 h-3" />
                  </span>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-[#222]">
                  {paginatedUsers.map((user, i) => (
                    <div key={user.wallet_address} className="flex items-center justify-between py-3 hover:bg-[#1a1a1a] -mx-4 px-4 transition-colors">
                      <div className="flex items-center gap-2">
                        <Link 
                          href={`/whales/${user.wallet_address}`}
                          className="text-sm text-gray-300 hover:text-white font-mono transition-colors"
                        >
                          {formatAddress(user.wallet_address)}
                        </Link>
                        <button 
                          onClick={() => copyAddress(user.wallet_address)}
                          className="p-1 hover:bg-[#333] rounded transition-colors"
                        >
                          {copiedAddress === user.wallet_address ? (
                            <Check className="w-3 h-3 text-green-500" />
                          ) : (
                            <Copy className="w-3 h-3 text-gray-500" />
                          )}
                        </button>
                      </div>
                      <span className="text-sm text-white font-medium">
                        ${formatCompact(user.value)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#222]">
                  <span className="text-xs text-gray-500">
                    Showing {(topUsersPage - 1) * 10 + 1} - {Math.min(topUsersPage * 10, topUsers.length)} of {topUsers.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setTopUsersPage(p => Math.max(1, p - 1))}
                      disabled={topUsersPage === 1}
                      className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-3 py-1 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white">
                      {topUsersPage} of {totalPages}
                    </span>
                    <button 
                      onClick={() => setTopUsersPage(p => Math.min(totalPages, p + 1))}
                      disabled={topUsersPage === totalPages}
                      className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
