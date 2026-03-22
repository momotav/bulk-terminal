'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity, Flame,
  AlertCircle, BarChart3, Clock, Loader2
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
      
      console.log('[Follow] Got Privy token, length:', token.length);
      // Log token header to verify it's ES256
      try {
        const header = JSON.parse(atob(token.split('.')[0]));
        console.log('[Follow] Token header:', header);
      } catch (e) {
        console.log('[Follow] Could not decode token header');
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
      
      // Check for specific error types
      if (err.message?.includes('401') || err.message?.includes('expired') || err.message?.includes('Invalid')) {
        alert('Session expired. Please reconnect your wallet.');
      } else {
        alert(err.message || 'Failed to update follow status');
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const positions = data?.live?.positions || [];
  const margin = data?.live?.margin || {
    totalBalance: 0,
    availableBalance: 0,
    marginUsed: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
  };
  const markPrices = data?.markPrices || {};
  const tracked = data?.tracked || { total_pnl: 0, total_volume: 0, total_trades: 0, total_liquidations: 0 };
  const history = data?.history || [];

  // Calculate totals
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
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Back button */}
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {error ? (
          <div className="bg-dark-secondary border border-red-500/30 rounded-lg p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <p className="text-red-400 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-dark-tertiary rounded hover:bg-dark-tertiary/80"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-dark-secondary border border-dark-border rounded-lg p-6">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  {profile?.twitter_avatar ? (
                    <img 
                      src={profile.twitter_avatar} 
                      alt={profile.twitter_name || 'Profile'} 
                      className="w-16 h-16 rounded-full border-2 border-dark-border"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-bulk-green/30 to-blue-500/30 flex items-center justify-center">
                      <Wallet className="w-8 h-8 text-bulk-green" />
                    </div>
                  )}
                  
                  <div>
                    {/* Name and Twitter */}
                    {profile?.twitter_handle ? (
                      <div className="mb-1">
                        <h1 className="text-xl font-bold flex items-center gap-2">
                          {profile.twitter_name || profile.twitter_handle}
                          {isOwnWallet && (
                            <span className="px-2 py-0.5 bg-bulk-green/20 text-bulk-green text-xs rounded-full">
                              You
                            </span>
                          )}
                        </h1>
                        <a 
                          href={`https://x.com/${profile.twitter_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-text-secondary hover:text-bulk-green flex items-center gap-1 text-sm"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                          @{profile.twitter_handle}
                        </a>
                      </div>
                    ) : (
                      <h1 className="text-xl font-bold mb-1 flex items-center gap-2">
                        {formatAddress(address)}
                        {isOwnWallet && (
                          <span className="px-2 py-0.5 bg-bulk-green/20 text-bulk-green text-xs rounded-full">
                            You
                          </span>
                        )}
                      </h1>
                    )}
                    
                    {/* Address */}
                    <div className="flex items-center gap-2 mt-2">
                      <code className="text-sm text-text-tertiary font-mono bg-dark-tertiary px-2 py-1 rounded">
                        {formatAddress(address)}
                      </code>
                      <button 
                        onClick={copyAddress}
                        className="p-1.5 rounded hover:bg-dark-tertiary transition-colors"
                        title="Copy address"
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
                        className="p-1.5 rounded hover:bg-dark-tertiary transition-colors"
                        title="View on Solscan"
                      >
                        <ExternalLink className="w-4 h-4 text-text-tertiary" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Follow button - only show if not own wallet */}
                {!isOwnWallet && (
                  <button
                    onClick={toggleFollow}
                    disabled={followLoading}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                      isFollowing
                        ? "border border-dark-border bg-dark-tertiary text-text-secondary hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
                        : "bg-bulk-green text-dark-primary hover:bg-bulk-green/90",
                      followLoading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {followLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isFollowing ? (
                      <>
                        <StarOff className="w-4 h-4" />
                        Following
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

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-dark-border">
                <div>
                  <p className="text-text-tertiary text-sm mb-1">Total PnL</p>
                  <p className={cn(
                    "text-lg font-semibold",
                    (tracked.total_pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {(tracked.total_pnl || 0) >= 0 ? '+' : ''}${formatCompact(tracked.total_pnl || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-text-tertiary text-sm mb-1">Volume</p>
                  <p className="text-lg font-semibold">${formatCompact(tracked.total_volume || 0)}</p>
                </div>
                <div>
                  <p className="text-text-tertiary text-sm mb-1">Trades</p>
                  <p className="text-lg font-semibold">{tracked.total_trades || 0}</p>
                </div>
                <div>
                  <p className="text-text-tertiary text-sm mb-1">Liquidations</p>
                  <p className="text-lg font-semibold text-red-400">{tracked.total_liquidations || 0}</p>
                </div>
              </div>
            </div>

            {/* Live Stats (only if has positions) */}
            {positions.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <p className="text-text-tertiary text-sm mb-1">Balance</p>
                  <p className="text-lg font-semibold">${formatNumber(margin.totalBalance, 2)}</p>
                </div>
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <p className="text-text-tertiary text-sm mb-1">Available</p>
                  <p className="text-lg font-semibold text-green-400">${formatNumber(margin.availableBalance, 2)}</p>
                </div>
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <p className="text-text-tertiary text-sm mb-1">Margin Used</p>
                  <p className="text-lg font-semibold text-yellow-400">${formatNumber(margin.marginUsed, 2)}</p>
                </div>
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <p className="text-text-tertiary text-sm mb-1">Unrealized PnL</p>
                  <p className={cn(
                    "text-lg font-semibold",
                    totalUnrealizedPnl >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {totalUnrealizedPnl >= 0 ? '+' : ''}${formatNumber(totalUnrealizedPnl, 2)}
                  </p>
                </div>
                <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
                  <p className="text-text-tertiary text-sm mb-1">Notional</p>
                  <p className="text-lg font-semibold">${formatCompact(totalNotional)}</p>
                </div>
              </div>
            )}

            {/* Two columns: Positions/Trades + Chart */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Positions/Trades */}
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
