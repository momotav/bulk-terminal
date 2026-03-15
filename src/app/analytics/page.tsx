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
  const [price, setPrice] = useState<ChartDataPoint[]>([]);
  const [correlation, setCorrelation] = useState<{ symbols: string[]; matrix: number[][] } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [oi, fr, vol, pr, corr] = await Promise.all([
          analytics.getOpenInterest(selectedSymbol, hours),
          analytics.getFundingRate(selectedSymbol, hours),
          analytics.getVolume(selectedSymbol, hours),
          analytics.getPrice(selectedSymbol, hours),
          analytics.getCorrelation(hours),
        ]);
        setOpenInterest(oi);
        setFundingRate(fr);
        setVolume(vol);
        setPrice(pr);
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
    // For 24h view, show time. For longer views, show date
    if (hours <= 24) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (hours <= 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1">Analytics</h1>
            <p className="text-sm text-text-secondary">
              Market trends, sentiment, and historical data.
            </p>
          </div>

          <div className="flex gap-2">
            {/* Symbol selector */}
            <div className="toggle-group">
              {symbols.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSymbol(s)}
                  className={cn(
                    "toggle-btn",
                    selectedSymbol === s && "active"
                  )}
                >
                  {s.split('-')[0]}
                </button>
              ))}
            </div>

            {/* Time range */}
            <div className="toggle-group">
              {timeRanges.map((t) => (
                <button
                  key={t.hours}
                  onClick={() => setHours(t.hours)}
                  className={cn(
                    "toggle-btn",
                    hours === t.hours && "active"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="chart-card h-[280px] animate-pulse">
                <div className="h-4 w-24 bg-dark-tertiary rounded mb-4" />
                <div className="h-full bg-dark-tertiary rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Open Interest */}
            <div className="chart-card">
              <h3 className="chart-title">Open Interest</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={openInterest}>
                    <defs>
                      <linearGradient id="oiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00B482" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#00B482" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `$${formatCompact(v)}`}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`$${formatCompact(v)}`, 'OI']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#00B482" fill="url(#oiGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Funding Rate */}
            <div className="chart-card">
              <h3 className="chart-title">Funding Rate</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fundingRate}>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `${(v * 100).toFixed(3)}%`}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#1B1A13', border: '1px solid #554B4C', borderRadius: 4 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`${(v * 100).toFixed(4)}%`, 'Funding']}
                    />
                    <Bar dataKey="value">
                      {fundingRate.map((entry, index) => (
                        <Cell key={index} fill={entry.value >= 0 ? '#00B482' : '#EF4A3C'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Volume */}
            <div className="chart-card">
              <h3 className="chart-title">24h Volume</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volume}>
                    <defs>
                      <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7570B3" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#7570B3" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => `$${formatCompact(v)}`}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#1B1A13', border: '1px solid #554B4C', borderRadius: 4 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`$${formatCompact(v)}`, 'Volume']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#7570B3" fill="url(#volGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Price History */}
            <div className="chart-card">
              <h3 className="chart-title">Price</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={price}>
                    <defs>
                      <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FFB548" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#FFB548" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <YAxis 
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => `$${formatCompact(v)}`}
                      tick={{ fill: '#817778', fontSize: 9 }}
                      axisLine={{ stroke: '#554B4C' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#1B1A13', border: '1px solid #554B4C', borderRadius: 4 }}
                      labelFormatter={formatDate}
                      formatter={(v: number) => [`$${formatCompact(v)}`, 'Price']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#FFB548" fill="url(#priceGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Correlation Matrix */}
            {correlation && (
              <div className="chart-card lg:col-span-2">
                <h3 className="chart-title">Correlation Matrix</h3>
                <div className="overflow-x-auto">
                  <table className="w-full max-w-md mx-auto">
                    <thead>
                      <tr>
                        <th className="p-2"></th>
                        {correlation.symbols.map((s) => (
                          <th key={s} className="p-2 text-xs text-text-secondary font-medium">
                            {s.split('-')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {correlation.symbols.map((s, i) => (
                        <tr key={s}>
                          <td className="p-2 text-xs text-text-secondary font-medium">
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
