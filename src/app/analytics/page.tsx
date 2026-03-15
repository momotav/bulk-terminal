'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { analytics, formatCompact, cn, type ChartDataPoint, type LongShortDataPoint } from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell } from 'recharts';
import { useStore } from '@/store';

const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const timeRanges = [
  { label: '24H', hours: 24 },
  { label: '7D', hours: 168 },
  { label: '30D', hours: 720 },
];

export default function AnalyticsPage() {
  const { selectedSymbol, setSelectedSymbol } = useStore();
  const [hours, setHours] = useState(168);
  const [loading, setLoading] = useState(true);
  
  const [openInterest, setOpenInterest] = useState<ChartDataPoint[]>([]);
  const [fundingRate, setFundingRate] = useState<ChartDataPoint[]>([]);
  const [volume, setVolume] = useState<ChartDataPoint[]>([]);
  const [longShort, setLongShort] = useState<LongShortDataPoint[]>([]);
  const [correlation, setCorrelation] = useState<{ symbols: string[]; matrix: number[][] } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [oi, fr, vol, ls, corr] = await Promise.all([
          analytics.getOpenInterest(selectedSymbol, hours),
          analytics.getFundingRate(selectedSymbol, hours),
          analytics.getVolume(selectedSymbol, hours),
          analytics.getLongShortRatio(selectedSymbol, hours),
          analytics.getCorrelation(hours),
        ]);
        setOpenInterest(oi);
        setFundingRate(fr);
        setVolume(vol);
        setLongShort(ls);
        setCorrelation(corr);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedSymbol, hours]);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold mb-2">Analytics</h1>
            <p className="text-gray-500">
              Market trends, sentiment, and historical data.
            </p>
          </div>

          <div className="flex gap-2">
            {/* Symbol selector */}
            <div className="flex gap-1 bg-dark-tertiary rounded-lg p-1">
              {symbols.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSymbol(s)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                    selectedSymbol === s
                      ? "bg-bulk-cyan text-dark-primary"
                      : "text-gray-400 hover:text-white"
                  )}
                >
                  {s.split('-')[0]}
                </button>
              ))}
            </div>

            {/* Time range */}
            <div className="flex gap-1 bg-dark-tertiary rounded-lg p-1">
              {timeRanges.map((t) => (
                <button
                  key={t.hours}
                  onClick={() => setHours(t.hours)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                    hours === t.hours
                      ? "bg-bulk-magenta text-white"
                      : "text-gray-400 hover:text-white"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="glass-card p-6 h-[300px] animate-pulse">
                <div className="h-6 w-32 bg-dark-tertiary rounded mb-4" />
                <div className="h-full bg-dark-tertiary rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Open Interest */}
            <div className="glass-card p-6">
              <h3 className="font-display text-sm font-semibold mb-4">Open Interest</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={openInterest}>
                    <defs>
                      <linearGradient id="oiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#00f0ff" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `$${formatCompact(v)}`}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`$${formatCompact(v)}`, 'OI']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#00f0ff" fill="url(#oiGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Funding Rate */}
            <div className="glass-card p-6">
              <h3 className="font-display text-sm font-semibold mb-4">Funding Rate</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fundingRate}>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `${(v * 100).toFixed(3)}%`}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`${(v * 100).toFixed(4)}%`, 'Funding']}
                    />
                    <Bar dataKey="value">
                      {fundingRate.map((entry, index) => (
                        <Cell key={index} fill={entry.value >= 0 ? '#00ff88' : '#ff3366'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Volume */}
            <div className="glass-card p-6">
              <h3 className="font-display text-sm font-semibold mb-4">24h Volume</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volume}>
                    <defs>
                      <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff00aa" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ff00aa" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `$${formatCompact(v)}`}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`$${formatCompact(v)}`, 'Volume']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#ff00aa" fill="url(#volGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Long/Short Ratio */}
            <div className="glass-card p-6">
              <h3 className="font-display text-sm font-semibold mb-4">Long vs Short Ratio</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={longShort}>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fill: '#666', fontSize: 10 }}
                      axisLine={{ stroke: '#2a2a40' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                      labelFormatter={formatDate}
                      formatter={(v: number, name: string) => [
                        `${v.toFixed(1)}%`, 
                        name === 'long_ratio' ? 'Long' : 'Short'
                      ]}
                    />
                    <Area type="monotone" dataKey="long_ratio" stackId="1" stroke="#00ff88" fill="#00ff88" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="short_ratio" stackId="1" stroke="#ff3366" fill="#ff3366" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-bulk-green" />
                  <span className="text-xs text-gray-400">Long</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-bulk-red" />
                  <span className="text-xs text-gray-400">Short</span>
                </div>
              </div>
            </div>

            {/* Correlation Matrix */}
            {correlation && (
              <div className="glass-card p-6 lg:col-span-2">
                <h3 className="font-display text-sm font-semibold mb-4">Correlation Matrix</h3>
                <div className="overflow-x-auto">
                  <table className="w-full max-w-md mx-auto">
                    <thead>
                      <tr>
                        <th className="p-2"></th>
                        {correlation.symbols.map((s) => (
                          <th key={s} className="p-2 text-xs text-gray-500 font-medium">
                            {s.split('-')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {correlation.symbols.map((s, i) => (
                        <tr key={s}>
                          <td className="p-2 text-xs text-gray-500 font-medium">
                            {s.split('-')[0]}
                          </td>
                          {correlation.matrix[i].map((val, j) => (
                            <td key={j} className="p-2">
                              <div 
                                className={cn(
                                  "w-16 h-16 rounded-lg flex items-center justify-center font-mono text-sm font-bold",
                                  val === 1 
                                    ? "bg-bulk-cyan/30 text-bulk-cyan"
                                    : val > 0.7 
                                    ? "bg-bulk-green/30 text-bulk-green"
                                    : val > 0.3 
                                    ? "bg-bulk-yellow/30 text-bulk-yellow"
                                    : "bg-gray-700/30 text-gray-400"
                                )}
                              >
                                {val.toFixed(2)}
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
