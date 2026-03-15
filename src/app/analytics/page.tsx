'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/Header';
import { analytics, formatCompact, cn, type ChartDataPoint } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, ComposedChart, Line, LineChart
} from 'recharts';
import { useStore } from '@/store';
import { ChevronDown } from 'lucide-react';

const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const timeRanges = [
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
  { label: 'Q', hours: 2160 },
  { label: 'Y', hours: 8760 },
  { label: 'ALL', hours: 8760 * 2 },
];

const COLORS: Record<string, string> = {
  BTC: '#00B482',
  ETH: '#4A9079',
  SOL: '#6B8068',
  cumulative: '#FFB548',
  total: '#FFB548',
};

export default function AnalyticsPage() {
  const { selectedSymbol, setSelectedSymbol } = useStore();
  const [hours, setHours] = useState(720);
  const [loading, setLoading] = useState(true);
  const [selectedCoins, setSelectedCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);
  
  const [btcVolume, setBtcVolume] = useState<ChartDataPoint[]>([]);
  const [ethVolume, setEthVolume] = useState<ChartDataPoint[]>([]);
  const [solVolume, setSolVolume] = useState<ChartDataPoint[]>([]);
  
  const [btcOI, setBtcOI] = useState<ChartDataPoint[]>([]);
  const [ethOI, setEthOI] = useState<ChartDataPoint[]>([]);
  const [solOI, setSolOI] = useState<ChartDataPoint[]>([]);
  
  const [fundingRate, setFundingRate] = useState<ChartDataPoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [btcVol, ethVol, solVol, btcOi, ethOi, solOi, fr] = await Promise.all([
          analytics.getVolume('BTC-USD', hours),
          analytics.getVolume('ETH-USD', hours),
          analytics.getVolume('SOL-USD', hours),
          analytics.getOpenInterest('BTC-USD', hours),
          analytics.getOpenInterest('ETH-USD', hours),
          analytics.getOpenInterest('SOL-USD', hours),
          analytics.getFundingRate(selectedSymbol, hours),
        ]);
        setBtcVolume(btcVol);
        setEthVolume(ethVol);
        setSolVolume(solVol);
        setBtcOI(btcOi);
        setEthOI(ethOi);
        setSolOI(solOi);
        setFundingRate(fr);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedSymbol, hours]);

  // Combine volume data for stacked chart
  const combinedVolumeData = useMemo(() => {
    if (!btcVolume.length) return [];
    
    let cumulative = 0;
    return btcVolume.map((btc, i) => {
      const eth = ethVolume[i]?.value || 0;
      const sol = solVolume[i]?.value || 0;
      const btcVal = selectedCoins.includes('BTC') ? btc.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? eth : 0;
      const solVal = selectedCoins.includes('SOL') ? sol : 0;
      cumulative += btcVal + ethVal + solVal;
      
      return {
        timestamp: btc.timestamp,
        BTC: btcVal,
        ETH: ethVal,
        SOL: solVal,
        cumulative,
      };
    });
  }, [btcVolume, ethVolume, solVolume, selectedCoins]);

  // Combine OI data for multi-line chart
  const combinedOIData = useMemo(() => {
    if (!btcOI.length) return [];
    
    return btcOI.map((btc, i) => {
      const eth = ethOI[i]?.value || 0;
      const sol = solOI[i]?.value || 0;
      const btcVal = selectedCoins.includes('BTC') ? btc.value : 0;
      const ethVal = selectedCoins.includes('ETH') ? eth : 0;
      const solVal = selectedCoins.includes('SOL') ? sol : 0;
      
      return {
        timestamp: btc.timestamp,
        BTC: btcVal,
        ETH: ethVal,
        SOL: solVal,
        total: btcVal + ethVal + solVal,
      };
    });
  }, [btcOI, ethOI, solOI, selectedCoins]);

  const toggleCoin = (coin: string) => {
    setSelectedCoins(prev => 
      prev.includes(coin) 
        ? prev.filter(c => c !== coin)
        : [...prev, coin]
    );
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const totalVolume = combinedVolumeData.length > 0 
    ? combinedVolumeData[combinedVolumeData.length - 1]?.cumulative || 0 : 0;
  
  const currentOI = combinedOIData.length > 0
    ? combinedOIData[combinedOIData.length - 1]?.total || 0 : 0;

  const CoinToggles = ({ showCumulative = true, cumulativeLabel = 'Cumulative Volume' }) => (
    <div className="flex flex-wrap items-center gap-2">
      {['BTC', 'ETH', 'SOL'].map((coin) => (
        <button
          key={coin}
          onClick={() => toggleCoin(coin)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
            selectedCoins.includes(coin)
              ? "bg-dark-secondary border-dark-border text-text-primary"
              : "bg-transparent border-transparent text-text-secondary hover:text-text-primary"
          )}
        >
          <div 
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: COLORS[coin] }}
          />
          {coin}
        </button>
      ))}
      {showCumulative && (
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-dark-secondary border border-dark-border text-text-primary">
          <div className="w-3 h-3 rounded-sm bg-bulk-orange" />
          {cumulativeLabel}
        </button>
      )}
      <button 
        onClick={() => setSelectedCoins([])}
        className="px-3 py-1.5 rounded-md text-xs font-medium border border-dark-border text-text-secondary hover:text-text-primary transition-all"
      >
        Deselect all
      </button>
    </div>
  );

  const TimeframeSelector = () => (
    <div className="flex items-center gap-1">
      {timeRanges.map((t) => (
        <button
          key={t.hours}
          onClick={() => setHours(t.hours)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded transition-all",
            hours === t.hours
              ? "bg-dark-tertiary text-text-primary border border-bulk-green"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const CoinsSelectedDropdown = () => (
    <div className="relative">
      <button 
        onClick={() => setShowCoinDropdown(!showCoinDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-dark-secondary border border-dark-border text-text-primary"
      >
        {selectedCoins.length} coins selected
        <ChevronDown className="w-3 h-3" />
      </button>
      {showCoinDropdown && (
        <div className="absolute top-full mt-1 left-0 bg-dark-secondary border border-dark-border rounded-lg p-2 z-10 min-w-[150px]">
          <input 
            type="text" 
            placeholder="Search coins..."
            className="w-full px-2 py-1.5 text-xs bg-dark-tertiary border border-dark-border rounded mb-2 text-text-primary placeholder-text-secondary"
          />
          <button 
            onClick={() => setSelectedCoins([])}
            className="w-full text-left px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary"
          >
            Deselect All
          </button>
          {['BTC', 'ETH', 'SOL'].map(coin => (
            <button
              key={coin}
              onClick={() => toggleCoin(coin)}
              className={cn(
                "w-full text-left px-2 py-1.5 text-xs",
                selectedCoins.includes(coin) ? "text-text-primary" : "text-text-secondary"
              )}
            >
              {coin}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const RangeSlider = () => (
    <div className="mt-4 px-2">
      <div className="relative h-8 bg-dark-tertiary rounded-lg overflow-hidden">
        <div 
          className="absolute h-full bg-bulk-green/30 rounded"
          style={{ left: '10%', width: '80%' }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <div className="w-4 h-4 bg-dark-border rounded cursor-ew-resize" />
          <div className="w-4 h-4 bg-dark-border rounded cursor-ew-resize" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="text-center">
            <p className="text-xs text-text-secondary mb-1">Total Volume</p>
            <p className="text-2xl font-bold text-text-primary">${formatCompact(totalVolume)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-secondary mb-1">Open Interest</p>
            <p className="text-2xl font-bold text-text-primary">${formatCompact(currentOI)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-secondary mb-1">Active Markets</p>
            <p className="text-2xl font-bold text-text-primary">3</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-secondary mb-1">24h Trades</p>
            <p className="text-2xl font-bold text-text-primary">—</p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="glass-card p-4 h-[400px] animate-pulse">
                <div className="h-4 w-32 bg-dark-tertiary rounded mb-4" />
                <div className="h-full bg-dark-tertiary rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Volume & OI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Total Volume Chart */}
              <div className="glass-card p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Total Volume</h3>
                
                <CoinToggles showCumulative={true} cumulativeLabel="Cumulative Volume" />
                
                <div className="flex items-center justify-between mt-4 mb-2">
                  <CoinsSelectedDropdown />
                  <TimeframeSelector />
                </div>

                <div className="h-[280px] mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={combinedVolumeData}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="volume"
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                        width={50}
                      />
                      <YAxis 
                        yAxisId="cumulative"
                        orientation="right"
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          background: '#1B1A13', 
                          border: '1px solid #554B4C', 
                          borderRadius: 8,
                          padding: '8px 12px'
                        }}
                        labelStyle={{ color: '#C7B6BA', marginBottom: 4, fontSize: 12 }}
                        labelFormatter={formatDate}
                        formatter={(value: number, name: string) => [
                          `$${formatCompact(value)}`, 
                          name === 'cumulative' ? 'Cumulative' : name
                        ]}
                      />
                      
                      {selectedCoins.includes('SOL') && (
                        <Bar yAxisId="volume" dataKey="SOL" stackId="a" fill={COLORS.SOL} />
                      )}
                      {selectedCoins.includes('ETH') && (
                        <Bar yAxisId="volume" dataKey="ETH" stackId="a" fill={COLORS.ETH} />
                      )}
                      {selectedCoins.includes('BTC') && (
                        <Bar yAxisId="volume" dataKey="BTC" stackId="a" fill={COLORS.BTC} />
                      )}
                      <Line 
                        yAxisId="cumulative"
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke={COLORS.cumulative} 
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider />
              </div>

              {/* Open Interest Chart */}
              <div className="glass-card p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Open Interest</h3>
                
                <CoinToggles showCumulative={true} cumulativeLabel="Total Open Interest" />
                
                <div className="flex items-center justify-between mt-4 mb-2">
                  <CoinsSelectedDropdown />
                  <TimeframeSelector />
                </div>

                <div className="h-[280px] mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedOIData}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                      />
                      <YAxis 
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          background: '#1B1A13', 
                          border: '1px solid #554B4C', 
                          borderRadius: 8,
                          padding: '8px 12px'
                        }}
                        labelStyle={{ color: '#C7B6BA', marginBottom: 4, fontSize: 12 }}
                        labelFormatter={formatDate}
                        formatter={(value: number, name: string) => [
                          `$${formatCompact(value)}`, 
                          name === 'total' ? 'Total OI' : `${name} OI`
                        ]}
                      />
                      
                      {selectedCoins.includes('BTC') && (
                        <Line 
                          type="monotone" 
                          dataKey="BTC" 
                          stroke={COLORS.BTC} 
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                      {selectedCoins.includes('ETH') && (
                        <Line 
                          type="monotone" 
                          dataKey="ETH" 
                          stroke={COLORS.ETH} 
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                      {selectedCoins.includes('SOL') && (
                        <Line 
                          type="monotone" 
                          dataKey="SOL" 
                          stroke={COLORS.SOL} 
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke={COLORS.total} 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider />
              </div>
            </div>

            {/* Row 2: Funding Rate */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Funding Rate Chart */}
              <div className="glass-card p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Funding Rate</h3>
                
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {symbols.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSymbol(s)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
                        selectedSymbol === s
                          ? "bg-dark-secondary border-dark-border text-text-primary"
                          : "bg-transparent border-transparent text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <div 
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: COLORS[s.split('-')[0]] }}
                      />
                      {s.split('-')[0]}
                    </button>
                  ))}
                  <button className="px-3 py-1.5 rounded-md text-xs font-medium border border-dark-border text-text-secondary hover:text-text-primary">
                    Deselect all
                  </button>
                </div>
                
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-text-secondary">
                    Showing {selectedSymbol}
                  </div>
                  <TimeframeSelector />
                </div>

                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fundingRate}>
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={formatDate}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                      />
                      <YAxis 
                        tickFormatter={(v) => `${(v * 100).toFixed(2)}%`}
                        tick={{ fill: '#817778', fontSize: 10 }}
                        axisLine={{ stroke: '#554B4C' }}
                        tickLine={false}
                        width={50}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          background: '#1B1A13', 
                          border: '1px solid #554B4C', 
                          borderRadius: 8 
                        }}
                        labelStyle={{ color: '#C7B6BA' }}
                        labelFormatter={formatDate}
                        formatter={(v: number) => [`${(v * 100).toFixed(4)}%`, 'Funding Rate']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke={COLORS[selectedSymbol.split('-')[0]]} 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <RangeSlider />
              </div>

              {/* Placeholder for another chart */}
              <div className="glass-card p-4 flex items-center justify-center">
                <div className="text-center text-text-secondary">
                  <p className="text-lg mb-2">More Charts Coming</p>
                  <p className="text-sm">Long/Short Ratio, Liquidations Heatmap, etc.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
