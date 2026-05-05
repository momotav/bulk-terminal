'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, 
  TrendingUp, TrendingDown, Wallet, Activity,
  AlertCircle, Clock, Loader2, UserCheck
} from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, userApi } from '@/lib/api';
import { computePositionOpenTime, formatDuration, type PositionOpenInfo } from '@/lib/positionWalk';
import { ClosedPositionsList } from '@/components/ClosedPositionsList';
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

// Compact label/value pair for the integrated stats panel. Uppercase 10px
// label on top, big tabular-nums value below. Optional accent color tints
// the value (used for liquidations count when > 0).
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'orange';
}) {
  return (
    <div>
      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1">{label}</p>
      <p
        className={cn(
          'text-lg sm:text-xl font-semibold tabular-nums truncate',
          accent === 'orange' ? 'text-orange-400' : 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </p>
    </div>
  );
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

  // Per-symbol "when did this position open" map. We compute this client-side
  // by walking the wallet's fill history for each symbol — BULK doesn't
  // expose a per-position timestamp on the position object. Null entries
  // mean we tried but couldn't determine (e.g. no fills, or position is
  // older than BULK's 5000-fill window). Undefined means we haven't fetched
  // yet, so the UI shows "—" instead of a wrong value.
  const [positionOpenTimes, setPositionOpenTimes] = useState<
    Record<string, PositionOpenInfo | null>
  >({});

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

  // Fetch fills for each open position and compute when it was opened.
  // BULK doesn't expose a per-position open timestamp on the position
  // object, so we derive it client-side from the wallet's fill history:
  // walk fills chronologically and find the most recent moment net size
  // went from 0 to non-zero. That timestamp is the position's open time.
  //
  // We fire one /fills request per open symbol. Backend caches 60s so
  // re-renders are cheap. We don't refetch on the 10s tick because open
  // times don't change for an existing position — only when a new one
  // is added or an old one is closed, which the dependency on the
  // joined symbol list handles.
  const openSymbolKey = (data?.live?.positions || [])
    .map((p) => p.symbol)
    .sort()
    .join(',');

  useEffect(() => {
    if (!address) return;
    const positions = data?.live?.positions || [];
    if (positions.length === 0) return;

    let cancelled = false;
    const next: Record<string, PositionOpenInfo | null> = {};

    Promise.all(
      positions.map(async (pos) => {
        try {
          const res = await wallet.getFills(address, {
            symbol: pos.symbol,
            limit: 500,
          });
          // computePositionOpenTime returns null when fills don't include
          // a flat→nonflat transition for the current position (e.g. the
          // wallet is a master-account whose sub-accounts did the trading,
          // or the position is older than BULK's 5000-fill window).
          const info = computePositionOpenTime(res.fills || []);
          next[pos.symbol] = info;
        } catch {
          next[pos.symbol] = null;
        }
      })
    ).then(() => {
      if (!cancelled) setPositionOpenTimes(next);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, openSymbolKey]);

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
            {/* Wallet Header.
                Compact identity card — small avatar + address + meta.
                The AccountHierarchy dropdown lives in the right-hand action
                row so users can switch between master and sub-accounts
                without scrolling. */}
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-5 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar — smaller than before. The full-bleed gradient
                      square at 64px was visually overpowering for what is
                      really just a placeholder. We render a round wallet
                      icon at 40px instead unless we have a real Twitter
                      avatar to show. */}
                  {twitterAvatar ? (
                    <img
                      src={twitterAvatar}
                      alt=""
                      className="w-10 h-10 rounded-full border border-[var(--border-color)] flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-bulk-green/15 border border-bulk-green/30 flex items-center justify-center flex-shrink-0">
                      <Wallet className="w-5 h-5 text-bulk-green" />
                    </div>
                  )}
                  <div className="min-w-0">
                    {/* Display name if available */}
                    {displayName && (
                      <h1 className="text-lg font-semibold text-[var(--text-primary)] truncate">
                        {displayName}
                      </h1>
                    )}

                    {/* Twitter/X handle */}
                    {twitterHandle && (
                      <a 
                        href={`https://twitter.com/${twitterHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-bulk-green transition-colors"
                      >
                        <XIcon className="w-3 h-3" />
                        @{twitterHandle}
                      </a>
                    )}
                    
                    {/* Wallet address */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="font-mono text-base sm:text-lg text-[var(--text-primary)]">{formatAddress(address)}</h2>
                      {isOwnWallet && (
                        <span className="px-1.5 py-0.5 bg-bulk-green/20 text-bulk-green text-[10px] font-semibold rounded uppercase tracking-wider border border-bulk-green/30">
                          You
                        </span>
                      )}
                      {address === '7DHvrCZMMLZ2ovNfKaGpvJZXAQyydbTz6dM7w7qXtzX5' && (
                        <span className="px-1.5 py-0.5 bg-bulk-green/20 text-bulk-green text-[10px] font-semibold rounded uppercase tracking-wider border border-bulk-green/30">
                          BULK MM
                        </span>
                      )}
                      <button
                        onClick={copyAddress}
                        className="p-1 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                        aria-label="Copy address"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-bulk-green" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                        )}
                      </button>
                      <a
                        href={`https://solscan.io/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 hover:bg-[var(--bg-secondary-20)] rounded transition-colors"
                        aria-label="View on Solscan"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                      </a>
                    </div>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      {tracked?.total_trades || 0} trades · ${formatCompact(tracked?.total_volume || 0)} volume
                      {!hasLiveData && hasTrackedData && (
                        <span className="text-yellow-400 ml-1.5">· No active positions</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Right side: account-family dropdown + action buttons.
                    The hierarchy lives here so it's always one click away
                    without taking a whole row of vertical space. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <AccountHierarchy address={address} />
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

            {/* Stats panel. One integrated card containing everything live
                from BULK: PnL on the left as the visual anchor, supporting
                numbers (balance, margin used, available, liqs) gridded next
                to it. Single block keeps the visual weight grouped instead
                of stacking two boxes on top of each other. */}
            {hasLiveData && margin ? (
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-5 mb-4 space-y-5">
                {/* Row 1: PnL hero. Full-width with the live pulse on the
                    right. No more vertical-divider awkwardness. */}
                <div className="flex items-end justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {margin.unrealizedPnl >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-bulk-green" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-bulk-red" />
                      )}
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Unrealized PnL</span>
                    </div>
                    <p className={cn(
                      'text-3xl sm:text-4xl font-bold tabular-nums tracking-tight',
                      margin.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                    )}>
                      {margin.unrealizedPnl >= 0 ? '+' : ''}
                      ${formatCompact(Math.abs(margin.unrealizedPnl))}
                    </p>
                  </div>
                  {/* Live pulse — small dot + label, right-aligned. Tells
                      stream viewers the page is auto-updating. */}
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bulk-green opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-bulk-green" />
                    </span>
                    Live · 10s refresh
                  </div>
                </div>

                {/* Row 2: 4 supporting stats in a clean grid. No nested
                    cards, no vertical dividers, no orphan rows. Just a
                    horizontal divider above to separate from the PnL hero. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[var(--border-color)]">
                  <Stat label="Balance" value={`$${formatNumber(margin.totalBalance, 0)}`} />
                  <Stat label="Margin Used" value={`$${formatNumber(margin.marginUsed, 0)}`} />
                  <Stat label="Available" value={`$${formatNumber(margin.availableBalance, 0)}`} />
                  <Stat
                    label="Liquidations"
                    value={String(tracked?.total_liquidations || 0)}
                    accent={(tracked?.total_liquidations || 0) > 0 ? 'orange' : undefined}
                  />
                </div>
              </div>
            ) : (
              /* No live BULK data path — fall back to tracked PnL. Same
                 two-row structure but with historical metrics. */
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-5 mb-4 space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {totalPnL >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-bulk-green" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-bulk-red" />
                    )}
                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Total PnL (lifetime)</span>
                  </div>
                  <p className={cn(
                    'text-3xl sm:text-4xl font-bold tabular-nums tracking-tight',
                    totalPnL >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                  )}>
                    {totalPnL >= 0 ? '+' : ''}${formatCompact(Math.abs(totalPnL))}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-[var(--border-color)]">
                  <Stat label="Total Volume" value={`$${formatCompact(tracked?.total_volume || 0)}`} />
                  <Stat label="Total Trades" value={String(tracked?.total_trades || 0)} />
                  <Stat
                    label="Liquidations"
                    value={String(tracked?.total_liquidations || 0)}
                    accent={(tracked?.total_liquidations || 0) > 0 ? 'orange' : undefined}
                  />
                </div>
              </div>
            )}

            {/* Lifetime stats line. When live data is shown above, this row
                gives the streamer historical context without adding more
                cards. Inline text — small, secondary, easily scannable.
                Skip it entirely when we already showed lifetime as the
                hero (no live data path). */}
            {hasLiveData && margin && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 text-sm text-[var(--text-secondary)]">
                <span>
                  <span className="text-[var(--text-tertiary)]">Lifetime volume </span>
                  <span className="font-mono text-[var(--text-primary)]">${formatCompact(tracked?.total_volume || 0)}</span>
                </span>
                <span>
                  <span className="text-[var(--text-tertiary)]">Lifetime trades </span>
                  <span className="font-mono text-[var(--text-primary)]">{tracked?.total_trades || 0}</span>
                </span>
                <span>
                  <span className="text-[var(--text-tertiary)]">Realized </span>
                  <span className={cn(
                    'font-mono',
                    totalPnL >= 0 ? 'text-bulk-green' : 'text-bulk-red'
                  )}>
                    {totalPnL >= 0 ? '+' : ''}${formatCompact(totalPnL)}
                  </span>
                </span>
              </div>
            )}

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Positions / Recent Trades */}
              <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
                <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
                  <h2 className="font-semibold flex items-center gap-2">
                    {positions.length > 0 ? (
                      <>
                        <Activity className="w-4 h-4 text-bulk-green" />
                        Open Positions ({positions.length})
                      </>
                    ) : !hasLiveData ? (
                      // Distinct visual state for "BULK API didn't return
                      // live data" — most likely a transient timeout. The
                      // 10s background poll will retry and likely succeed.
                      // Without this branch we silently fell through to
                      // closed positions and users assumed positions = 0.
                      <>
                        <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                        Fetching positions…
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 text-blue-400" />
                        Recent Trades
                      </>
                    )}
                  </h2>
                  {/* Tiny hint for the "Fetching" state so a streamer /
                      viewer knows what's happening rather than thinking
                      the page froze. */}
                  {!hasLiveData && positions.length === 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                      auto-retries every 10s
                    </span>
                  )}
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
                              walletAddress: address,
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

                          {/* Open time — derived client-side from the
                              wallet's fill history (BULK doesn't expose
                              per-position timestamps). Renders as
                              "Opened 2h 14m ago" when we have data, falls
                              back to a placeholder otherwise. */}
                          {(() => {
                            const openInfo = positionOpenTimes[pos.symbol];
                            if (openInfo === undefined) {
                              // Still fetching — render nothing rather than
                              // a flashing placeholder.
                              return null;
                            }
                            if (openInfo === null) {
                              return null;
                            }
                            const ago = Date.now() - openInfo.openedAt;
                            return (
                              <p className="mt-2 text-[10px] text-[var(--text-tertiary)] tabular-nums">
                                Opened {formatDuration(ago)} ago
                                <span className="text-[var(--text-tertiary)]/70 ml-2">
                                  · {new Date(openInfo.openedAt).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </p>
                            );
                          })()}

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
                  ) : (
                    // No open positions: show recent closed-position history
                    // instead of raw fills. Closed positions are far more
                    // useful — each row is one open→close lifecycle with
                    // realized PnL pre-computed by BULK.
                    <ClosedPositionsList address={address} limit={50} />
                  )}
                </div>
              </div>

              {/* Closed Positions panel — always visible when there ARE
                  open positions (so users see the recent trade history
                  alongside the live state). Skipped when there are no
                  open positions, since the panel above already shows
                  closed positions in that case. */}
              {positions.length > 0 && (
                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
                  <div className="p-4 border-b border-[var(--border-color)]">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-400" />
                      Recent Trades
                    </h2>
                  </div>
                  <div className="max-h-[480px] overflow-y-auto">
                    <ClosedPositionsList address={address} limit={50} />
                  </div>
                </div>
              )}

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
