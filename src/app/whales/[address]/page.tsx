'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity, Flame,
  AlertCircle, BarChart3, Clock, Loader2, DollarSign, Shield, PiggyBank
} from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, userApi } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface Trade {
  id: number;
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  timestamp: string;
}

interface WalletProfile {
  wallet_address: string;
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;
  
  const { following, addFollowing, removeFollowing, user } = useStore();
  const { authenticated, login, getAccessToken, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Get current user's wallet address from multiple sources
  const solanaWalletAddress = solanaWallets?.[0]?.address;
  const privyWalletAddress = privyUser?.wallet?.address;
  const linkedSolanaWallet = privyUser?.linkedAccounts?.find(
    (account: any) => account.type === 'wallet' && account.chainType === 'solana'
  ) as any;
  const linkedWalletAddress = linkedSolanaWallet?.address;
  const storeWalletAddress = user?.wallet_address;
  
  const currentUserWallet = solanaWalletAddress || privyWalletAddress || linkedWalletAddress || storeWalletAddress || '';
  
  // Check if viewing own wallet
  const isOwnWallet = !!(currentUserWallet && address && 
    currentUserWallet.toLowerCase() === address.toLowerCase());
  
  // Check if following this wallet
  const isFollowing = following.some(w => 
    w.wallet_address.toLowerCase() === address.toLowerCase()
  );

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      
      try {
        const [walletResult, tradesResult, profileResult] = await Promise.all([
          wallet.getWallet(address),
          wallet.getTrades(address, 50).catch(() => ({ data: [] })),
          userApi.getWalletProfile(address).catch(() => ({ profile: null })),
        ]);
        
        setData(walletResult);
        setTrades(tradesResult.data || []);
        setProfile((profileResult as any)?.profile || null);
        
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
    // If not authenticated, prompt login
    if (!authenticated) {
      console.log('[Follow] Not authenticated, prompting login');
      login();
      return;
    }

    setFollowLoading(true);
    
    try {
      // ALWAYS get fresh token from Privy (ES256 signed)
      console.log('[Follow] Getting fresh Privy access token...');
      const token = await getAccessToken();
      
      if (!token) {
        console.error('[Follow] Failed to get Privy access token');
        alert('Please reconnect your wallet to follow users');
        setFollowLoading(false);
        return;
      }

      if (isFollowing) {
        console.log('[Follow] Unfollowing wallet:', address);
        await userApi.unfollowWallet(token, address);
        removeFollowing(address);
        console.log('[Follow] Successfully unfollowed');
      } else {
        console.log('[Follow] Following wallet:', address);
        await userApi.followWallet(token, address);
        addFollowing({
          wallet_address: address,
          followed_at: new Date().toISOString(),
        });
        console.log('[Follow] Successfully followed');
      }
    } catch (err: any) {
      console.error('[Follow] Failed to update follow:', err);
      
      if (err.message?.includes('401') || err.message?.includes('expired') || err.message?.includes('Invalid')) {
        alert('Session expired. Please reconnect your wallet.');
      } else {
        alert(err.message || 'Failed to update follow status');
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const margin = data?.live?.margin;
  const positions = data?.live?.positions || [];
  const markPrices = data?.markPrices || {};
  const tracked = data?.tracked;
  const history = data?.history || [];

  // Get the most recent PnL from history (snapshots) - this matches the chart
  const latestSnapshot = history.length > 0 ? history[history.length - 1] : null;
  const latestSnapshotPnL = latestSnapshot 
    ? (parseFloat(String(latestSnapshot.pnl)) || 0) + (parseFloat(String(latestSnapshot.unrealized_pnl)) || 0)
    : null;

  // For Total PnL stat: Use latest snapshot to match chart, fallback to live or tracked
  const totalPnL = latestSnapshotPnL !== null 
    ? latestSnapshotPnL
    : margin 
      ? (margin.realizedPnl || 0) + (margin.unrealizedPnl || 0)
      : (tracked?.total_pnl || 0);

  const hasLiveData = margin !== null && margin !== undefined;
  const hasTrackedData = tracked !== null && tracked !== undefined;

  // Display name priority: Twitter name > display name > null
  const displayName = profile?.twitter_name || profile?.display_name || null;
  const twitterHandle = profile?.twitter_handle;
  const twitterAvatar = profile?.twitter_avatar;

  // Calculate totals for positions
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  const totalNotional = positions.reduce((sum, p) => sum + Math.abs(p.notional || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-bulk-green" />
      </div>
    );
  }

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

        {error && !hasTrackedData ? (
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
          <div>
            {/* Wallet Header */}
            <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  {twitterAvatar ? (
                    <img 
                      src={twitterAvatar} 
                      alt="" 
                      className="w-16 h-16 rounded-full border-2 border-dark-border"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-xl font-bold">
                      {address.slice(0, 2)}
                    </div>
                  )}
                  <div>
                    {/* Display name if available */}
                    {displayName && (
                      <h1 className="text-xl font-semibold text-text-primary mb-1">
                        {displayName}
                      </h1>
                    )}
                    
                    {/* Twitter/X handle */}
                    {twitterHandle && (
                      <a 
                        href={`https://twitter.com/${twitterHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-text-secondary hover:text-bulk-green transition-colors mb-2"
                      >
                        <XIcon className="w-4 h-4" />
                        @{twitterHandle}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    
                    {/* Wallet address */}
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-text-tertiary" />
                      <h2 className="font-mono text-lg sm:text-xl">{formatAddress(address)}</h2>
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
                      <a
                        href={`https://solscan.io/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-dark-tertiary rounded transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-text-tertiary" />
                      </a>
                    </div>
                    <p className="text-xs text-text-tertiary">
                      {tracked?.total_trades || 0} trades &bull; ${formatCompact(tracked?.total_volume || 0)} volume
                      {!hasLiveData && hasTrackedData && (
                        <span className="text-yellow-400 ml-2">&bull; No active positions</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Follow button - ONLY show if NOT own wallet */}
                {!isOwnWallet && (
                  <button
                    onClick={toggleFollow}
                    disabled={followLoading}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50",
                      isFollowing
                        ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20"
                        : "bg-bulk-green text-dark-primary hover:bg-bulk-green/90"
                    )}
                  >
                    {followLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isFollowing ? (
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

            {/* Tracked Stats Cards - Always show */}
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
                  {totalPnL >= 0 ? '+' : ''}${formatCompact(totalPnL)}
                </p>
              </div>

              <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Liquidations</span>
                </div>
                <p className="text-2xl font-bold text-orange-400">
                  {tracked?.total_liquidations || 0}
                </p>
              </div>
            </div>

            {/* Live Account Stats - Only show if has live data */}
            {hasLiveData && margin && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-bulk-green" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Live Balance</span>
                  </div>
                  <p className="text-2xl font-bold text-bulk-green">
                    ${formatNumber(margin.totalBalance, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Margin Used</span>
                  </div>
                  <p className="text-2xl font-bold text-yellow-400">
                    ${formatNumber(margin.marginUsed, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {margin.unrealizedPnl >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Unrealized PnL</span>
                  </div>
                  <p className={cn(
                    "text-2xl font-bold",
                    margin.unrealizedPnl >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {margin.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(margin.unrealizedPnl, 2)}
                  </p>
                </div>

                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <PiggyBank className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-text-tertiary uppercase tracking-wider">Available</span>
                  </div>
                  <p className="text-2xl font-bold text-cyan-400">
                    ${formatNumber(margin.availableBalance, 2)}
                  </p>
                </div>
              </div>
            )}

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Positions / Recent Trades */}
              <div className="bg-dark-secondary border border-dark-border rounded-lg flex flex-col">
                <div className="p-4 border-b border-dark-border">
                  <h2 className="font-semibold flex items-center gap-2">
                    {positions.length > 0 ? (
                      <>
                        <Activity className="w-4 h-4 text-bulk-green" />
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
          </div>
        )}
      </main>
    </div>
  );
}
