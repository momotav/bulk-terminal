'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity, Flame,
  AlertCircle, BarChart3, Clock, Loader2, DollarSign, Shield, PiggyBank, UserCheck
} from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, userApi } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AccountHierarchy } from '@/components/AccountHierarchy';
import { ActivityFeed } from '@/components/ActivityFeed';
import { PositionChartModal, type PositionForChart } from '@/components/PositionChartModal';

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
  
  const { following, addFollowing, removeFollowing, user, claimedWallet, setClaimedWallet, setUser } = useStore();
  const { authenticated, login, getAccessToken, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Position currently being inspected in the price-chart modal. null means
  // closed. Set when the user clicks any position card.
  const [chartPosition, setChartPosition] = useState<PositionForChart | null>(null);

  // Get current user's wallet address from multiple sources
  const solanaWalletAddress = solanaWallets?.[0]?.address;
  const privyWalletAddress = privyUser?.wallet?.address;
  const linkedSolanaWallet = privyUser?.linkedAccounts?.find(
    (account: any) => account.type === 'wallet' && account.chainType === 'solana'
  ) as any;
  const linkedWalletAddress = linkedSolanaWallet?.address;
  const storeWalletAddress = user?.wallet_address;
  
  // Connected wallet (via Phantom etc)
  const connectedWallet = solanaWalletAddress || privyWalletAddress || linkedWalletAddress || '';
  
  // User's effective wallet (connected OR claimed)
  const currentUserWallet = connectedWallet || claimedWallet || user?.claimed_wallet || storeWalletAddress || '';
  
  // Check if user logged in via email (no connected wallet)
  const emailAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'email'
  );
  const isEmailUser = authenticated && !connectedWallet && !!emailAccount;
  
  // Check if this is user's claimed wallet
  const isClaimedWallet = !!(claimedWallet && address && 
    claimedWallet.toLowerCase() === address.toLowerCase());
  
  // Check if viewing own wallet (connected OR claimed)
  const isOwnWallet = !!(currentUserWallet && address && 
    currentUserWallet.toLowerCase() === address.toLowerCase());
  
  // Can claim: email user, no claimed wallet yet, not viewing already claimed wallet
  const canClaimWallet = isEmailUser && !claimedWallet && !user?.claimed_wallet;
  
  // Check if following this wallet
  const isFollowing = following.some(w => 
    w.wallet_address.toLowerCase() === address.toLowerCase()
  );

  useEffect(() => {
    if (!address) return;

    // Single fetch routine. The `silent` flag controls whether we trigger
    // the loading spinner — true on initial mount, false on background
    // refresh ticks (so the UI doesn't flicker every 10 seconds during a
    // stream).
    const fetchData = async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const [walletResult, tradesResult, profileResult] = await Promise.all([
          wallet.getWallet(address),
          wallet.getTrades(address, 50).catch(() => ({ data: [] })),
          userApi.getWalletProfile(address).catch(() => ({ profile: null })),
        ]);

        setData(walletResult);
        setTrades(tradesResult.data || []);
        setProfile((profileResult as any)?.profile || null);

        // Only track on first load — no need to re-track every 10s.
        if (!silent) {
          await wallet.trackWallet(address).catch(() => {});
        }
      } catch (err) {
        // On background refresh failures, keep existing data on screen
        // rather than flashing an error banner. The next tick will retry.
        if (!silent) setError('Failed to load wallet data');
      } finally {
        if (!silent) setLoading(false);
      }
    };

    // Initial load — full spinner.
    fetchData(false);

    // Background refresh every 10 seconds. Cleared on unmount or when the
    // wallet address changes. We don't visualize the refresh (no spinner,
    // no toast) — positions and PnL just update in place. This is the
    // behavior the BULK dev specifically asked for: live-feeling without
    // user action.
    const tick = window.setInterval(() => fetchData(true), 10_000);
    return () => window.clearInterval(tick);
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

  const handleClaimWallet = async () => {
    if (!authenticated) {
      login();
      return;
    }

    setClaimLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please log in again');
        return;
      }

      console.log('[Claim] Claiming wallet:', address);
      const response = await userApi.claimWallet(token, address) as { user?: any; success?: boolean };
      
      if (response?.success) {
        setClaimedWallet(address);
        if (response.user) {
          setUser(response.user);
        }
        console.log('[Claim] Wallet claimed successfully');
      }
    } catch (err: any) {
      console.error('[Claim] Failed to claim wallet:', err);
      alert(err.message || 'Failed to claim wallet');
    } finally {
      setClaimLoading(false);
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
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <Link 
          href="/whales"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Whale Tracker
        </Link>

        {error && !hasTrackedData ? (
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400 opacity-50" />
            <h2 className="text-xl font-bold mb-2">Wallet Not Found</h2>
            <p className="text-[var(--text-secondary)] mb-4">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-green text-dark-primary rounded-lg">
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Link>
          </div>
        ) : (
          <div>
            {/* Wallet Header */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  {twitterAvatar ? (
                    <img 
                      src={twitterAvatar} 
                      alt="" 
                      className="w-16 h-16 rounded-full border-2 border-[var(--border-color)]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-xl font-bold">
                      {address.slice(0, 2)}
                    </div>
                  )}
                  <div>
                    {/* Display name if available */}
                    {displayName && (
                      <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
                        {displayName}
                      </h1>
                    )}
                    
                    {/* Twitter/X handle */}
                    {twitterHandle && (
                      <a 
                        href={`https://twitter.com/${twitterHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-bulk-green transition-colors mb-2"
                      >
                        <XIcon className="w-4 h-4" />
                        @{twitterHandle}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    
                    {/* Wallet address */}
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-[var(--text-tertiary)]" />
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
                        className="p-1.5 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-bulk-green" />
                        ) : (
                          <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
                        )}
                      </button>
                      <a
                        href={`https://solscan.io/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                      </a>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {tracked?.total_trades || 0} trades &bull; ${formatCompact(tracked?.total_volume || 0)} volume
                      {!hasLiveData && hasTrackedData && (
                        <span className="text-yellow-400 ml-2">&bull; No active positions</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {/* Claim Wallet button - only for email users who haven't claimed yet */}
                  {canClaimWallet && (
                    <button
                      onClick={handleClaimWallet}
                      disabled={claimLoading}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50"
                    >
                      {claimLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <UserCheck className="w-4 h-4" />
                          This is my wallet
                        </>
                      )}
                    </button>
                  )}
                  
                  {/* Show "Your Wallet" badge if this is claimed wallet */}
                  {isClaimedWallet && (
                    <span className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-sm font-medium">
                      <UserCheck className="w-4 h-4" />
                      Your Claimed Wallet
                    </span>
                  )}

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
            </div>

            {/* Stats — restructured for at-a-glance readability on a stream.
                The streamer wants viewers to grok 'how is this trader doing
                right now' in under a second. So we lead with one large hero
                number (live unrealized PnL) and demote the supporting stats
                below it. Historical tracked metrics (volume, trade count)
                move to a smaller third row. */}

            {/* Hero PnL — the headline number. Lives only when we have live
                BULK margin data; otherwise we fall back to tracked total PnL
                from our DB. */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-6 mb-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {(hasLiveData && margin ? margin.unrealizedPnl : totalPnL) >= 0 ? (
                    <TrendingUp className="w-7 h-7 text-bulk-green" />
                  ) : (
                    <TrendingDown className="w-7 h-7 text-bulk-red" />
                  )}
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-1">
                      {hasLiveData && margin ? 'Unrealized PnL' : 'Total PnL'}
                    </p>
                    <p className={cn(
                      'text-4xl sm:text-5xl font-bold tabular-nums tracking-tight',
                      (hasLiveData && margin ? margin.unrealizedPnl : totalPnL) >= 0
                        ? 'text-bulk-green'
                        : 'text-bulk-red'
                    )}>
                      {(hasLiveData && margin ? margin.unrealizedPnl : totalPnL) >= 0 ? '+' : ''}
                      ${formatCompact(Math.abs(hasLiveData && margin ? margin.unrealizedPnl : totalPnL))}
                    </p>
                  </div>
                </div>
                {/* Auto-refresh indicator — small green dot pulse so viewers
                    know the page is live and not stale. */}
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bulk-green opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-bulk-green" />
                  </span>
                  Live · refreshes every 10s
                </div>
              </div>
            </div>

            {/* Live account stats row — only shown when we have BULK margin
                data. These are the supporting numbers behind the hero PnL:
                what they have to risk, what they're actively risking, what's
                free, and how often they've blown up historically. */}
            {hasLiveData && margin && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-bulk-green" />
                    <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Balance</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                    ${formatNumber(margin.totalBalance, 2)}
                  </p>
                </div>

                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Margin Used</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                    ${formatNumber(margin.marginUsed, 2)}
                  </p>
                </div>

                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <PiggyBank className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Available</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                    ${formatNumber(margin.availableBalance, 2)}
                  </p>
                </div>

                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="w-4 h-4 text-orange-400" />
                    <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Liquidations</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-400 tabular-nums">
                    {tracked?.total_liquidations || 0}
                  </p>
                </div>
              </div>
            )}

            {/* Historical tracked stats — smaller, demoted. These reflect
                lifetime activity from our DB (volume, trade count). Useful
                context but not what a stream viewer is looking for first. */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Total Volume</span>
                </div>
                <p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">
                  ${formatCompact(tracked?.total_volume || 0)}
                </p>
              </div>

              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Total Trades</span>
                </div>
                <p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">
                  {tracked?.total_trades || 0}
                </p>
              </div>

              {/* Realized PnL from our tracked DB — separate from live
                  unrealized in the hero card. Only shown if it differs
                  meaningfully from the hero number, otherwise it's noise. */}
              {hasLiveData && margin && (
                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {totalPnL >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-bulk-green" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-bulk-red" />
                    )}
                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Realized (lifetime)</span>
                  </div>
                  <p className={cn(
                    'text-lg font-semibold tabular-nums',
                    totalPnL >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                  )}>
                    {totalPnL >= 0 ? '+' : ''}${formatCompact(totalPnL)}
                  </p>
                </div>
              )}
            </div>

            {/* Account hierarchy — sub-account tree (only renders when this
                wallet has sub-accounts or IS a sub-account). Hidden for
                vanilla single-account wallets so the layout stays compact. */}
            <AccountHierarchy address={address} />

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Positions / Recent Trades */}
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
                <div className="p-4 border-b border-[var(--border-color)]">
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

                {/* Position cards. Click any card to open the price chart
                    modal with entry / mark / liq lines drawn on a candle
                    chart for that market — the BULK dev's headline ask.
                    The "→" arrow is persistent (not hover-only) so stream
                    viewers know the cards are interactive. */}
                <div className="divide-y divide-[var(--border-color)] max-h-[480px] overflow-y-auto">
                  {positions.length > 0 ? (
                    positions.map((pos, i) => {
                      const isLong = pos.size > 0;
                      const pnlPercent = pos.notional 
                        ? (pos.unrealizedPnl / Math.abs(pos.notional)) * 100 
                        : 0;
                      const markPrice = markPrices[pos.symbol] || 0;

                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() =>
                            setChartPosition({
                              symbol: pos.symbol,
                              side: isLong ? 'long' : 'short',
                              entryPrice: pos.price,
                              markPrice: markPrice || pos.price,
                              liquidationPrice: pos.liquidationPrice,
                              size: Math.abs(pos.size),
                              leverage: pos.leverage,
                              unrealizedPnl: pos.unrealizedPnl,
                            })
                          }
                          className="w-full text-left p-5 hover:bg-[var(--bg-secondary-20)] transition-colors group cursor-pointer"
                          aria-label={`View ${pos.symbol} chart`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                'px-2 py-0.5 rounded text-xs font-semibold tracking-wider',
                                isLong
                                  ? 'bg-bulk-green/15 text-bulk-green'
                                  : 'bg-bulk-red/15 text-bulk-red'
                              )}>
                                {isLong ? 'LONG' : 'SHORT'}
                              </span>
                              <span className="font-semibold text-[var(--text-primary)]">{pos.symbol}</span>
                              <span className="text-[var(--text-tertiary)] text-sm font-mono">{pos.leverage}x</span>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                'font-bold text-lg tabular-nums',
                                pos.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                              )}>
                                {pos.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(pos.unrealizedPnl, 2)}
                              </p>
                              <p className={cn(
                                'text-xs tabular-nums',
                                pnlPercent >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                              )}>
                                {pnlPercent >= 0 ? '+' : ''}{formatPercent(pnlPercent)}
                              </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">Size</p>
                              <p className="font-mono text-[var(--text-primary)] tabular-nums">{formatNumber(Math.abs(pos.size), 4)}</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">Entry</p>
                              <p className="font-mono text-[var(--text-primary)] tabular-nums">${formatNumber(pos.price, 2)}</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">Mark</p>
                              <p className="font-mono text-blue-400 tabular-nums">${formatNumber(markPrice, 2)}</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">Liq</p>
                              <p className="font-mono text-bulk-red tabular-nums">${formatNumber(pos.liquidationPrice, 2)}</p>
                            </div>
                          </div>

                          {/* Persistent "view chart" affordance below the
                              numbers. Subtle, but visible to anyone watching
                              a stream — they can see the cards are clickable
                              even without seeing the streamer's mouse. */}
                          <div className="mt-3 flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] group-hover:text-bulk-green transition-colors">
                            <span>View chart</span>
                            <span className="transition-transform group-hover:translate-x-0.5">→</span>
                          </div>
                        </button>
                      );
                    })
                  ) : trades.length > 0 ? (
                    trades.map((trade) => {
                      const isBuy = trade.side.toLowerCase() === 'buy' || trade.side.toLowerCase() === 'long';
                      return (
                        <div key={trade.id} className="p-4 hover:bg-[var(--bg-secondary-20)]/30 transition-colors">
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
                              <p className="text-[var(--text-tertiary)] mb-1">Value</p>
                              <p className={isBuy ? "text-green-400" : "text-red-400"}>
                                ${formatNumber(trade.value, 2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] mb-1">Size</p>
                              <p>{formatNumber(trade.size, 4)}</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] mb-1">Price</p>
                              <p>${formatNumber(trade.price, 2)}</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-tertiary)] mb-1">Time</p>
                              <p>{new Date(trade.timestamp).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-[var(--text-tertiary)]">
                      <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No positions or trades found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* PnL History Chart */}
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
                <div className="p-4 border-b border-[var(--border-color)]">
                  <h2 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    PnL History
                  </h2>
                </div>

                {history.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-center text-[var(--text-tertiary)] min-h-[300px]">
                    <div>
                      <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No history data yet</p>
                      <p className="text-xs mt-1">PnL snapshots are recorded when wallet has active positions</p>
                    </div>
                  </div>
                ) : (() => {
                  const chartData = history.map(h => ({ 
                    ...h, 
                    displayPnl: (parseFloat(String(h.pnl)) || 0) + (parseFloat(String(h.unrealized_pnl)) || 0),
                  }));
                  
                  // Find min/max for gradient stop calculation
                  const pnlValues = chartData.map(d => d.displayPnl);
                  const minPnl = Math.min(...pnlValues);
                  const maxPnl = Math.max(...pnlValues);
                  
                  // Calculate where zero line falls in the gradient (0 = top, 1 = bottom)
                  const zeroPosition = maxPnl <= 0 ? 0 : minPnl >= 0 ? 1 : maxPnl / (maxPnl - minPnl);
                  
                  return (
                    <div className="flex-1 p-4 min-h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient id="pnlLineGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#22c55e" />
                              <stop offset={`${zeroPosition * 100}%`} stopColor="#22c55e" />
                              <stop offset={`${zeroPosition * 100}%`} stopColor="#ef4444" />
                              <stop offset="100%" stopColor="#ef4444" />
                            </linearGradient>
                            <linearGradient id="pnlFillGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                              <stop offset={`${zeroPosition * 100}%`} stopColor="#22c55e" stopOpacity={0.1} />
                              <stop offset={`${zeroPosition * 100}%`} stopColor="#ef4444" stopOpacity={0.1} />
                              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                            </linearGradient>
                          </defs>
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            tick={{ fill: '#666', fontSize: 10 }}
                            axisLine={{ stroke: 'var(--border-color)' }}
                          />
                          <YAxis 
                            tickFormatter={(v) => `$${formatCompact(Math.abs(v))}`}
                            tick={{ fill: '#666', fontSize: 10 }}
                            axisLine={{ stroke: 'var(--border-color)' }}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip 
                            contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                            labelStyle={{ color: 'var(--text-secondary)' }}
                            labelFormatter={(ts) => new Date(ts).toLocaleString()}
                            formatter={(value: number) => {
                              const color = value >= 0 ? '#22c55e' : '#ef4444';
                              return [<span style={{ color }}>${formatNumber(value, 2)}</span>, 'Total PnL'];
                            }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="displayPnl" 
                            stroke="url(#pnlLineGradient)"
                            strokeWidth={2}
                            fill="url(#pnlFillGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Activity timeline — protocol-level events (deposits,
                transfers, sub-account ops, multisig ops). Sits at the
                bottom of the page because it's a chronological feed and
                most of the time the user came here for the live position
                / PnL info above; activity is supporting context. */}
            <div className="mt-6">
              <ActivityFeed address={address} />
            </div>
          </div>
        )}
      </main>

      {/* Position-detail chart modal — opened by clicking a position card.
          Renders a candle chart for the position's market with horizontal
          lines at entry / mark / liq. The BULK dev's marquee request for
          the tournament broadcast view. */}
      <PositionChartModal
        position={chartPosition}
        onClose={() => setChartPosition(null)}
      />
    </div>
  );
}
