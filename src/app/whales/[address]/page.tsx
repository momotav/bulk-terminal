'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity, Flame,
  AlertCircle, BarChart3, Clock
} from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, userApi } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy } from '@privy-io/react-auth';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Trade {
  id: number;
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  timestamp: string;
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;
  
  const { following, addFollowing, removeFollowing, user, authToken } = useStore();
  const { authenticated, login } = usePrivy();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isFollowing = following.some(w => w.wallet_address === address);
  const isOwnWallet = user?.wallet_address === address;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      
      try {
        const [walletResult, tradesResult] = await Promise.all([
          wallet.getWallet(address),
          wallet.getTrades(address, 50).catch(() => ({ data: [] })),
        ]);
        
        setData(walletResult);
        setTrades(tradesResult.data || []);
        
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

  const toggleFollow = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!authToken) return;

    try {
      if (isFollowing) {
        await userApi.unfollowWallet(authToken, address);
        removeFollowing(address);
      } else {
        await userApi.followWallet(authToken, address);
        addFollowing({
          wallet_address: address,
          followed_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to update follow:', err);
    }
  };

  const margin = data?.live?.margin;
  const positions = data?.live?.positions || [];
  const markPrices = data?.markPrices || {};
  const history = data?.history || [];
  const tracked = data?.tracked;

  const totalPnL = margin 
    ? (margin.realizedPnl || 0) + (margin.unrealizedPnl || 0)
    : (tracked?.total_pnl || 0);

  const hasLiveData = margin !== null && margin !== undefined;
  const hasTrackedData = tracked !== null && tracked !== undefined;

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <Link 
          href="/whales"
          className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Whale Tracker
        </Link>

        {loading ? (
          <div className="space-y-6">
            <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-dark-tertiary rounded-full" />
                <div className="flex-1">
                  <div className="h-6 w-64 bg-dark-tertiary rounded mb-2" />
                  <div className="h-4 w-32 bg-dark-tertiary rounded" />
                </div>
              </div>
            </div>
          </div>
        ) : error && !hasTrackedData ? (
          <div className="bg-dark-secondary border border-dark-border rounded-lg p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400 opacity-50" />
            <h2 className="text-xl font-bold mb-2">Wallet Not Found</h2>
            <p className="text-text-secondary mb-4">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-green text-dark-primary rounded-lg">
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Link>
          </div>
        ) : (
          <>
            {/* Wallet Header */}
            <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-xl font-bold">
                    {address.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="font-mono text-lg sm:text-xl">{formatAddress(address)}</h1>
                      {isOwnWallet && (
                        <span className="px-2 py-0.5 bg-bulk-green/20 text-bulk-green text-xs font-semibold rounded-full border border-bulk-green/30">
                          You
                        </span>
                      )}
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
                          <Copy className="w-4 h-4 text-text-tertiary" />
                        )}
                      </button>
                      
                        href={`https://solscan.io/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-dark-tertiary rounded transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-text-tertiary" />
                      </a>
                    </div>
                    <p className="text-xs text-text-tertiary">
                      {tracked?.total_trades || 0} trades • ${formatCompact(tracked?.total_volume || 0)} volume
                      {!hasLiveData && hasTrackedData && (
                        <span className="text-yellow-400 ml-2">• No active positions</span>
                      )}
                    </p>
                  </div>
                </div>

                {!isOwnWallet && (
                  <button
                    onClick={toggleFollow}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                      isFollowing
                        ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                        : "bg-bulk-green text-dark-primary hover:bg-bulk-green/90"
                    )}
                  >
                    {isFollowing ? (
                      <>
                        <StarOff className="w-4 h-4" />
                        Unfollow
                      </>
                    ) : (
                      <>
                        <Star className="w-4 h-4" />
                        Follow
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Total Volume</span>
                </div>
                <p className="text-2xl font-bold text-blue-400">
                  ${formatCompact(tracked?.total_volume || 0)}
                </p>
              </div>

              <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Total Trades</span>
                </div>
                <p className="text-2xl font-bold text-purple-400">
                  {tracked?.total_trades || 0}
                </p>
              </div>

              <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {totalPnL >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Total PnL</span>
                </div>
                <p className={cn(
                  "text-2xl font-bold",
                  totalPnL >= 0 ? "text-green-400" : "text-red-400"
                )}>
                  {totalPnL >= 0 ? '+' : ''}${formatNumber(totalPnL, 2)}
                </p>
              </div>

              <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Liquidations</span>
                </div>
                <p className="text-2xl font-bold">
                  {tracked?.total_liquidations || 0}
                </p>
              </div>
            </div>

            {/* Live Account Stats */}
            {hasLiveData && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-dark-secondary border border-blue-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Live Balance</span>
                  </div>
                  <p className="text-xl font-bold text-blue-400">
                    ${formatNumber(margin?.totalBalance, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-purple-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Margin Used</span>
                  </div>
                  <p className="text-xl font-bold text-purple-400">
                    ${formatNumber(margin?.marginUsed, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-green-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Unrealized PnL</span>
                  </div>
                  <p className={cn(
                    "text-xl font-bold",
                    (margin?.unrealizedPnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {(margin?.unrealizedPnl || 0) >= 0 ? '+' : ''}${formatNumber(margin?.unrealizedPnl, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-yellow-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Available</span>
                  </div>
                  <p className="text-xl font-bold text-yellow-400">
                    ${formatNumber(margin?.availableBalance, 2)}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Positions or Recent Trades */}
              <div className="bg-dark-secondary border border-dark-border rounded-lg">
                <div className="p-4 border-b border-dark-border">
                  <h2 className="font-semibold flex items-center gap-2">
                    {positions.length > 0 ? (
                      <>
                        <Activity className="w-4 h-4 text-blue-400" />
                        Open Positions ({positions.length})
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 text-blue-400" />
                        Recent Trades ({trades.length})
                      </>
                    )}
                  </h2>
                </div>

                <div className="divide-y divide-dark-border max-h-[400px] overflow-y-auto">
                  {positions.length > 0 ? (
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
                                isLong ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                              )}>
                                {isLong ? 'LONG' : 'SHORT'}
                              </span>
                              <span className="font-medium">{pos.symbol}</span>
                              <span className="text-text-tertiary text-sm">{pos.leverage}x</span>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                "font-medium",
                                pos.unrealizedPnl >= 0 ? "text-green-400" : "text-red-400"
                              )}>
                                {pos.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(pos.unrealizedPnl, 2)}
                              </p>
                              <p className={cn(
                                "text-xs",
                                pnlPercent >= 0 ? "text-green-400" : "text-red-400"
                              )}>
                                {pnlPercent >= 0 ? '+' : ''}{formatPercent(pnlPercent)}
                              </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-text-tertiary">Size</p>
                              <p className="font-mono">{formatNumber(Math.abs(pos.size), 4)}</p>
                            </div>
                            <div>
                              <p className="text-text-tertiary">Entry</p>
                              <p className="font-mono">${formatNumber(pos.price, 2)}</p>
                            </div>
                            <div>
                              <p className="text-text-tertiary">Mark</p>
                              <p className="font-mono text-blue-400">${formatNumber(markPrice, 2)}</p>
                            </div>
                            <div>
                              <p className="text-text-tertiary">Liq. Price</p>
                              <p className="font-mono text-red-400">${formatNumber(pos.liquidationPrice, 2)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : trades.length > 0 ? (
                    trades.map((trade) => {
                      const isBuy = trade.side.toLowerCase() === 'buy' || trade.side.toLowerCase() === 'long';
                      return (
                        <div key={trade.id} className="p-4 hover:bg-dark-tertiary/30 transition-colors">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="font-semibold">{trade.symbol}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium",
                              isBuy ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                            )}>
                              {isBuy ? 'Buy' : 'Sell'}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-text-tertiary mb-1">Value</p>
                              <p className={isBuy ? "text-green-400" : "text-red-400"}>
                                ${formatNumber(trade.value, 2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-text-tertiary mb-1">Size</p>
                              <p>{formatNumber(trade.size, 4)}</p>
                            </div>
                            <div>
                              <p className="text-text-tertiary mb-1">Price</p>
                              <p>${formatNumber(trade.price, 2)}</p>
                            </div>
                            <div>
                              <p className="text-text-tertiary mb-1">Time</p>
                              <p>{new Date(trade.timestamp).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-text-tertiary">
                      <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No positions or trades found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* PnL History Chart */}
              <div className="bg-dark-secondary border border-dark-border rounded-lg flex flex-col">
                <div className="p-4 border-b border-dark-border">
                  <h2 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    PnL History
                  </h2>
                </div>

                {history.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-center text-text-tertiary min-h-[300px]">
                    <div>
                      <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No history data yet</p>
                      <p className="text-xs mt-1">PnL snapshots are recorded when wallet has active positions</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 p-4 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history.map(h => ({ 
                        ...h, 
                        displayPnl: (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0) 
                      }))}>
                        <defs>
                          <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="timestamp" 
                          tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: '#333' }}
                        />
                        <YAxis 
                          tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`}
                          tick={{ fill: '#666', fontSize: 10 }}
                          axisLine={{ stroke: '#333' }}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
                          labelFormatter={(ts) => new Date(ts).toLocaleString()}
                          formatter={(v: number) => [`$${formatNumber(v, 2)}`, 'Total PnL']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="displayPnl" 
                          stroke="#22c55e" 
                          fill="url(#pnlGradient)" 
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
