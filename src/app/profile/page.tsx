'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, Wallet, ExternalLink, Copy, Check, 
  TrendingUp, TrendingDown, Activity, Users, Calendar,
  Loader2
} from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useStore, FollowedWallet } from '@/store';
import { userApi, formatCompact } from '@/lib/api';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, following, setFollowing, authToken } = useStore();
  const { ready, authenticated, linkTwitter, unlinkTwitter, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  
  const [copied, setCopied] = useState(false);
  const [linkingTwitter, setLinkingTwitter] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(false);

  // Get wallet address from Solana wallets or Privy user
  const walletAddress = solanaWallets?.[0]?.address || privyUser?.wallet?.address || '';

  // Get Twitter info from Privy user's linked accounts
  const twitterAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'twitter_oauth'
  );
  
  const twitterHandle = twitterAccount?.username || user?.twitter_handle;
  const twitterName = twitterAccount?.name || user?.twitter_name;
  const twitterAvatar = twitterAccount?.profilePictureUrl || user?.twitter_avatar;
  const hasTwitter = !!twitterAccount || !!user?.twitter_handle;

  useEffect(() => {
    if (ready && !authenticated) {
      router.push('/');
    }
  }, [ready, authenticated, router]);

  // Sync Twitter data to backend when it changes
  useEffect(() => {
    async function syncTwitter() {
      if (twitterAccount && authToken && !user?.twitter_handle) {
        try {
          const response = await userApi.linkTwitter(authToken, {
            twitterId: twitterAccount.subject || '',
            twitterHandle: twitterAccount.username || '',
            twitterName: twitterAccount.name || '',
            twitterAvatar: twitterAccount.profilePictureUrl || '',
          }) as { user?: any };
          
          if (response?.user) {
            setUser(response.user);
          }
        } catch (error) {
          console.error('Failed to sync Twitter:', error);
        }
      }
    }
    syncTwitter();
  }, [twitterAccount, authToken, user?.twitter_handle, setUser]);

  useEffect(() => {
    async function loadFollowing() {
      if (authToken) {
        setLoadingFollowing(true);
        try {
          const response = await userApi.getFollowing(authToken) as { following?: FollowedWallet[] };
          if (response?.following) {
            setFollowing(response.following);
          }
        } catch (error) {
          console.error('Failed to load following:', error);
        } finally {
          setLoadingFollowing(false);
        }
      }
    }
    loadFollowing();
  }, [authToken, setFollowing]);

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLinkTwitter = async () => {
    if (hasTwitter) return; // Already linked
    
    setLinkingTwitter(true);
    try {
      await linkTwitter();
    } catch (error) {
      console.error('Failed to link Twitter:', error);
    } finally {
      setLinkingTwitter(false);
    }
  };

  const handleUnlinkTwitter = async () => {
    if (!twitterAccount) return;
    
    try {
      await unlinkTwitter(twitterAccount.subject);
      
      if (authToken) {
        const response = await userApi.unlinkTwitter(authToken) as { user?: any };
        if (response?.user) {
          setUser(response.user);
        }
      }
    } catch (error) {
      console.error('Failed to unlink Twitter:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatAddress = (address: string) => {
    if (!address) return '...';
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-bulk-green animate-spin" />
      </div>
    );
  }

  // Display name priority: Twitter name > display name > Anonymous
  const displayName = twitterName || user?.display_name || 'Anonymous Trader';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary mb-2">My Profile</h1>
        <p className="text-text-secondary">Manage your account and connected wallets</p>
      </div>

      {/* Profile Card */}
      <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 mb-6">
        <div className="flex items-start gap-6">
          <div className="shrink-0">
            {twitterAvatar ? (
              <img 
                src={twitterAvatar} 
                alt="" 
                className="w-20 h-20 rounded-full border-2 border-dark-border"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-dark-tertiary flex items-center justify-center">
                <User className="w-10 h-10 text-text-tertiary" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-text-primary mb-1">
              {displayName}
            </h2>
            
            {twitterHandle && (
              <a 
                href={`https://twitter.com/${twitterHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-text-secondary hover:text-bulk-green transition-colors mb-3"
              >
                <XIcon className="w-4 h-4" />
                @{twitterHandle}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <div className="flex items-center gap-2 mb-4">
              <Wallet className="w-4 h-4 text-text-tertiary" />
              <code className="text-sm text-text-secondary font-mono">
                {formatAddress(walletAddress)}
              </code>
              <button
                onClick={copyAddress}
                className="p-1 hover:bg-dark-tertiary rounded transition-colors"
                title="Copy full address"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-bulk-green" />
                ) : (
                  <Copy className="w-4 h-4 text-text-tertiary hover:text-text-primary" />
                )}
              </button>
            </div>

            {user?.created_at && (
              <div className="flex items-center gap-2 text-sm text-text-tertiary">
                <Calendar className="w-4 h-4" />
                Member since {formatDate(user.created_at)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trading Stats */}
      {user?.stats && (
        <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-bulk-green" />
            Trading Stats
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-dark-tertiary rounded-lg p-4">
              <p className="text-sm text-text-tertiary mb-1">Total Trades</p>
              <p className="text-xl font-semibold text-text-primary">
                {user.stats.trade_count || 0}
              </p>
            </div>
            
            <div className="bg-dark-tertiary rounded-lg p-4">
              <p className="text-sm text-text-tertiary mb-1">Total Volume</p>
              <p className="text-xl font-semibold text-text-primary">
                ${formatCompact(user.stats.total_volume)}
              </p>
            </div>
            
            <div className="bg-dark-tertiary rounded-lg p-4">
              <p className="text-sm text-text-tertiary mb-1">Total PnL</p>
              <p className={`text-xl font-semibold flex items-center gap-1 ${
                (user.stats.total_pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {(user.stats.total_pnl || 0) >= 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                ${formatCompact(Math.abs(user.stats.total_pnl || 0))}
              </p>
            </div>
            
            <div className="bg-dark-tertiary rounded-lg p-4">
              <p className="text-sm text-text-tertiary mb-1">Win Rate</p>
              <p className="text-xl font-semibold text-text-primary">
                {user.stats.win_rate ? `${(user.stats.win_rate * 100).toFixed(1)}%` : '-'}
              </p>
            </div>
          </div>

          {walletAddress && (
            <Link
              href={`/whales/${walletAddress}`}
              className="inline-flex items-center gap-2 mt-4 text-sm text-bulk-green hover:underline"
            >
              View detailed wallet stats
              <ExternalLink className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}

      {/* Connected Accounts */}
      <div className="bg-dark-secondary border border-dark-border rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4">
          Connected Accounts
        </h3>

        {/* Twitter/X */}
        <div className="flex items-center justify-between py-4 border-b border-dark-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
              <XIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-text-primary">X (Twitter)</p>
              {hasTwitter ? (
                <p className="text-sm text-text-secondary">@{twitterHandle}</p>
              ) : (
                <p className="text-sm text-text-tertiary">Not connected</p>
              )}
            </div>
          </div>
          
          {hasTwitter ? (
            <button
              onClick={handleUnlinkTwitter}
              className="px-4 py-2 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleLinkTwitter}
              disabled={linkingTwitter}
              className="flex items-center gap-2 px-4 py-2 rounded bg-white text-black hover:bg-white/90 transition-colors text-sm disabled:opacity-50"
            >
              {linkingTwitter ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XIcon className="w-4 h-4" />
              )}
              Connect X
            </button>
          )}
        </div>

        {/* Wallet */}
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-bulk-green/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-bulk-green" />
            </div>
            <div>
              <p className="font-medium text-text-primary">Solana Wallet</p>
              <p className="text-sm text-text-secondary font-mono">
                {formatAddress(walletAddress)}
              </p>
            </div>
          </div>
          
          <span className="flex items-center gap-2 px-3 py-1.5 rounded bg-bulk-green/10 text-bulk-green text-sm">
            <Check className="w-4 h-4" />
            Connected
          </span>
        </div>
      </div>

      {/* Following */}
      <div className="bg-dark-secondary border border-dark-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Users className="w-5 h-5 text-bulk-green" />
            Following ({following.length})
          </h3>
          
          <Link href="/following" className="text-sm text-bulk-green hover:underline">
            View all
          </Link>
        </div>

        {loadingFollowing ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-bulk-green animate-spin" />
          </div>
        ) : following.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
            <p className="text-text-secondary mb-2">You&apos;re not following any wallets yet</p>
            <Link
              href="/whales"
              className="inline-flex items-center gap-2 text-sm text-bulk-green hover:underline"
            >
              Discover wallets to follow
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {following.slice(0, 5).map((wallet) => (
              <Link
                key={wallet.wallet_address}
                href={`/whales/${wallet.wallet_address}`}
                className="flex items-center justify-between p-3 rounded-lg bg-dark-tertiary hover:bg-dark-tertiary/80 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-dark-secondary flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-text-tertiary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary font-mono">
                      {wallet.nickname || `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`}
                    </p>
                    {wallet.total_pnl !== undefined && (
                      <p className={`text-xs ${
                        (wallet.total_pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        PnL: ${formatCompact(wallet.total_pnl)}
                      </p>
                    )}
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
