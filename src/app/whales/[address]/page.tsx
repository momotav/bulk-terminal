'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity, Flame,
  AlertCircle, BarChart3, Clock
} from 'lucide-react';
import { Header } from '@/components/Header';
import { wallet, formatNumber, formatCompact, formatAddress, formatPercent, cn, type WalletData } from '@/lib/api';
import { useStore } from '@/store';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface Trade {
  id: number;
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  timestamp: string;
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;
  
  const { watchlist, addToWatchlist, removeFromWatchlist, user } = useStore();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isWatched = watchlist.includes(address);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      
      try {
        // Fetch wallet data and trades in parallel
        const [walletResult, tradesResult] = await Promise.all([
          wallet.getWallet(address),
          wallet.getTrades(address, 50).catch(() => ({ data: [] })),
        ]);
        
        setData(walletResult);
        setTrades(tradesResult.data || []);
        
        // Auto-track wallet when viewed
        await wallet.trackWallet(address).catch(() => {});
      } catch (err) {
        setError('Failed to load wallet data');
      } finally {
        setLoading(false);
      }
    };

    if (address) {
      fetchData();
    }
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleWatchlist = async () => {
    if (!user) {
      router.push('/login');
      return;
    }

    try {
      if (isWatched) {
        await wallet.removeFromWatchlist(address);
        removeFromWatchlist(address);
      } else {
        await wallet.addToWatchlist(address);
        addToWatchlist(address);
      }
    } catch (err) {
      console.error('Failed to update watchlist:', err);
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatShortDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Live data from BULK API
  const margin = data?.live?.margin;
  const positions = data?.live?.positions || [];
  const markPrices = data?.markPrices || {};
  const history = data?.history || [];
  
  // Database tracked data (always available if wallet has traded)
  const tracked = data?.tracked;

  // Use live PnL if available, otherwise use tracked PnL from database
  const totalPnL = margin 
    ? (margin.realizedPnl || 0) + (margin.unrealizedPnl || 0)
    : (tracked?.total_pnl || 0);

  const hasLiveData = margin !== null && margin !== undefined;
  const hasTrackedData = tracked !== null && tracked !== undefined;

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Back button */}
        <Link 
          href="/whales"
          className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Whale Tracker
        </Link>

        {loading ? (
          <div className="space-y-6">
            <div className="glass-card p-6 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-dark-tertiary rounded-full" />
                <div className="flex-1">
                  <div className="h-6 w-64 bg-dark-tertiary rounded mb-2" />
                  <div className="h-4 w-32 bg-dark-tertiary rounded" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="glass-card p-4 animate-pulse">
                  <div className="h-4 w-20 bg-dark-tertiary rounded mb-2" />
                  <div className="h-8 w-24 bg-dark-tertiary rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : error && !hasTrackedData ? (
          <div className="glass-card p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-bulk-red opacity-50" />
            <h2 className="font-display text-xl font-bold mb-2">Wallet Not Found</h2>
            <p className="text-gray-500 mb-4">{error}</p>
            <Link href="/whales" className="btn-primary inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Link>
          </div>
        ) : (
          <>
            {/* Wallet Header */}
            <div className="glass-card p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bulk-cyan to-bulk-magenta flex items-center justify-center text-white text-xl font-bold">
                    {address.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="font-mono text-lg sm:text-xl">{formatAddress(address)}</h1>
                      {/* BULK MM Tag */}
                      {address === '7DHvrCZMMLZ2ovNfKaGpvJZXAQyydbTz6dM7w7qXtzX5' && (
                        <span className="px-2 py-0.5 bg-bulk-green/20 text-bulk-green text-xs font-semibold rounded-full border border-bulk-green/30">
                          BULK MM
                        </span>
                      )}
                      <button
                        onClick={copyAddress}
                        className="p-1.5 hover:bg-dark-tertiary rounded transition-colors"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-bulk-green" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <a
                        href={`https://solscan.io/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-dark-tertiary rounded transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-gray-400" />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500">
                      {tracked?.total_trades || 0} trades • ${formatCompact(tracked?.total_volume || 0)} volume
                      {!hasLiveData && hasTrackedData && (
                        <span className="text-bulk-yellow ml-2">• No active positions</span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  onClick={toggleWatchlist}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                    isWatched
                      ? "bg-bulk-yellow/10 text-bulk-yellow border border-bulk-yellow/30"
                      : "bg-dark-tertiary hover:bg-dark-border"
                  )}
                >
                  {isWatched ? (
                    <>
                      <StarOff className="w-4 h-4" />
                      Remove from Watchlist
                    </>
                  ) : (
                    <>
                      <Star className="w-4 h-4" />
                      Add to Watchlist
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-4 h-4 text-bulk-cyan" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Total Volume</span>
                </div>
                <p className="font-display text-2xl font-bold text-bulk-cyan">
                  ${formatCompact(tracked?.total_volume || 0)}
                </p>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-bulk-magenta" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Total Trades</span>
                </div>
                <p className="font-display text-2xl font-bold text-bulk-magenta">
                  {tracked?.total_trades || 0}
                </p>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  {totalPnL >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-bulk-green" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-bulk-red" />
                  )}
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Total PnL</span>
                </div>
                <p className={cn(
                  "font-display text-2xl font-bold",
                  totalPnL >= 0 ? "text-bulk-green" : "text-bulk-red"
                )}>
                  {totalPnL >= 0 ? '+' : ''}${formatNumber(totalPnL, 2)}
                </p>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-bulk-red" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Liquidations</span>
                </div>
                <p className="font-display text-2xl font-bold">
                  {tracked?.total_liquidations || 0}
                </p>
              </div>
            </div>

            {/* Live Account Stats (if available) */}
            {hasLiveData && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="glass-card p-4 border border-bulk-cyan/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-bulk-cyan" />
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Live Balance</span>
                  </div>
                  <p className="font-display text-xl font-bold text-bulk-cyan">
                    ${formatNumber(margin?.totalBalance, 2)}
                  </p>
                </div>

                <div className="glass-card p-4 border border-bulk-magenta/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-bulk-magenta" />
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Margin Used</span>
                  </div>
                  <p className="font-display text-xl font-bold text-bulk-magenta">
                    ${formatNumber(margin?.marginUsed, 2)}
                  </p>
                </div>

                <div className="glass-card p-4 border border-bulk-green/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-bulk-green" />
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Unrealized PnL</span>
                  </div>
                  <p className={cn(
                    "font-display text-xl font-bold",
                    (margin?.unrealizedPnl || 0) >= 0 ? "text-bulk-green" : "text-bulk-red"
                  )}>
                    {(margin?.unrealizedPnl || 0) >= 0 ? '+' : ''}${formatNumber(margin?.unrealizedPnl, 2)}
                  </p>
                </div>

                <div className="glass-card p-4 border border-bulk-yellow/20">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-bulk-yellow" />
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Available</span>
                  </div>
                  <p className="font-display text-xl font-bold text-bulk-yellow">
                    ${formatNumber(margin?.availableBalance, 2)}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Positions or Recent Trades */}
              <div className="glass-card">
                <div className="panel-header">
                  <h2 className="panel-title">
                    {positions.length > 0 ? (
                      <>
                        <Activity className="w-4 h-4 text-bulk-cyan" />
                        Open Positions ({positions.length})
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 text-bulk-cyan" />
                        Recent Trades ({trades.length})
                      </>
                    )}
                  </h2>
                </div>

                <div className="divide-y divide-dark-border/50 max-h-[400px] overflow-y-auto">
                  {positions.length > 0 ? (
                    // Show positions if available
                    positions.map((pos, i) => {
                      const isLong = pos.size > 0;
                      const pnlPercent = pos.notional 
                        ? (pos.unrealizedPnl / Math.abs(pos.notional)) * 100 
                        : 0;
                      const markPrice = markPrices[pos.symbol] || 0;

                      return (
                        <div key={i} className="p-4 hover:bg-dark-tertiary/30 transition-colors">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-xs font-medium",
                                isLong ? "bg-bulk-green/15 text-bulk-green" : "bg-bulk-red/15 text-bulk-red"
                              )}>
                                {isLong ? 'LONG' : 'SHORT'}
                              </span>
                              <span className="font-medium">{pos.symbol}</span>
                              <span className="text-gray-500 text-sm">{pos.leverage}x</span>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                "font-medium",
                                pos.unrealizedPnl >= 0 ? "text-bulk-green" : "text-bulk-red"
                              )}>
                                {pos.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(pos.unrealizedPnl, 2)}
                              </p>
                              <p className={cn(
                                "text-xs",
                                pnlPercent >= 0 ? "text-bulk-green" : "text-bulk-red"
                              )}>
                                {pnlPercent >= 0 ? '+' : ''}{formatPercent(pnlPercent)}
                              </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-gray-500">Size</p>
                              <p className="font-mono">{formatNumber(Math.abs(pos.size), 4)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Entry</p>
                              <p className="font-mono">${formatNumber(pos.price, 2)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Mark</p>
                              <p className="font-mono text-bulk-cyan">${formatNumber(markPrice, 2)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Liq. Price</p>
                              <p className="font-mono text-bulk-red">${formatNumber(pos.liquidationPrice, 2)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : trades.length > 0 ? (
                    // Show recent trades from database
                    trades.map((trade) => {
                      const isBuy = trade.side.toLowerCase() === 'buy' || trade.side.toLowerCase() === 'long';
                      return (
                        <div key={trade.id} className="p-4 hover:bg-dark-tertiary/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-xs font-medium",
                                isBuy ? "bg-bulk-green/15 text-bulk-green" : "bg-bulk-red/15 text-bulk-red"
                              )}>
                                {trade.side.toUpperCase()}
                              </span>
                              <span className="font-medium">{trade.symbol}</span>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">${formatCompact(trade.value)}</p>
                              <p className="text-xs text-gray-500">{formatShortDate(trade.timestamp)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span>Size: {formatNumber(trade.size, 4)}</span>
                            <span>Price: ${formatNumber(trade.price, 2)}</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No positions or trades found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* PnL History Chart */}
              <div className="glass-card">
                <div className="panel-header">
                  <h2 className="panel-title">
                    <TrendingUp className="w-4 h-4 text-bulk-green" />
                    PnL History
                  </h2>
                </div>

                {history.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No history data yet</p>
                    <p className="text-xs mt-1">PnL snapshots are recorded when wallet has active positions</p>
                  </div>
                ) : (
                  <div className="p-4 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history.map(h => ({ 
                        ...h, 
                        displayPnl: (h.pnl || 0) + (h.unrealized_pnl || 0) 
                      }))}>
                        <defs>
                          <linearGradient id="pnlGradientPositive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00B482" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00B482" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="pnlGradientNegative" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="timestamp" 
                          tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: '#2a2a40' }}
                        />
                        <YAxis 
                          tickFormatter={(v) => `$${formatCompact(v)}`}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: '#2a2a40' }}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ background: '#12121a', border: '1px solid #2a2a40', borderRadius: 8 }}
                          labelFormatter={(ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          formatter={(v: number) => [`$${formatNumber(v, 2)}`, 'Total PnL']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="displayPnl" 
                          stroke="#00B482" 
                          fill="url(#pnlGradientPositive)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
