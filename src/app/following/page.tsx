'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Bell, BellOff, Users, TrendingUp, TrendingDown, Flame, 
  Trash2, Eye, Loader2
} from 'lucide-react';
import { formatNumber, formatAddress, formatCompact, cn, userApi } from '@/lib/api';
import { useStore, type FollowedWallet } from '@/store';
import { usePrivy } from '@privy-io/react-auth';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface FollowedWalletWithProfile extends FollowedWallet {
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
}

export default function FollowingPage() {
  const router = useRouter();
  const { following, setFollowing, removeFollowing } = useStore();
  const { authenticated, ready, getAccessToken, login } = usePrivy();
  
  const [wallets, setWallets] = useState<FollowedWalletWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unfollowingAddress, setUnfollowingAddress] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !authenticated) {
      // Redirect to whales page if not logged in
      router.push('/whales');
      return;
    }
    
    if (ready && authenticated) {
      fetchFollowing();
    }
  }, [ready, authenticated, router]);

  const fetchFollowing = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        console.error('No access token');
        setLoading(false);
        return;
      }

      // Get following list from API
      const response = await userApi.getFollowing(token) as { following?: FollowedWalletWithProfile[] };
      
      if (response?.following) {
        setWallets(response.following);
        setFollowing(response.following);
      }
    } catch (error) {
      console.error('Failed to fetch following:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async (address: string) => {
    setUnfollowingAddress(address);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please reconnect your wallet');
        return;
      }

      await userApi.unfollowWallet(token, address);
      setWallets(prev => prev.filter(w => w.wallet_address !== address));
      removeFollowing(address);
    } catch (error) {
      console.error('Failed to unfollow:', error);
      alert('Failed to unfollow wallet');
    } finally {
      setUnfollowingAddress(null);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-primary">
        <Loader2 className="w-8 h-8 animate-spin text-bulk-green" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex flex-col bg-dark-primary">
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
          <div className="bg-dark-secondary border border-dark-border rounded-lg p-12 text-center">
            <Users className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h2 className="text-xl font-bold mb-2">Connect to View Following</h2>
            <p className="text-text-secondary mb-6">
              Connect your wallet to see the wallets you're following.
            </p>
            <button
              onClick={login}
              className="inline-flex items-center gap-2 px-6 py-3 bg-bulk-green text-dark-primary rounded-lg font-medium hover:bg-bulk-green/90"
            >
              Connect Wallet
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1 flex items-center gap-2">
              <Users className="w-6 h-6 text-bulk-green" />
              Following
            </h1>
            <p className="text-sm text-text-secondary">
              Track your favorite wallets and see their trading activity.
            </p>
          </div>
          
          <Link
            href="/whales"
            className="flex items-center gap-2 px-4 py-2 bg-bulk-green text-dark-primary rounded-lg font-medium hover:bg-bulk-green/90"
          >
            <Users className="w-4 h-4" />
            Find Wallets
          </Link>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-dark-secondary border border-dark-border rounded-lg p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-dark-tertiary rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 w-32 bg-dark-tertiary rounded mb-2" />
                    <div className="h-3 w-48 bg-dark-tertiary rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : wallets.length === 0 ? (
          <div className="bg-dark-secondary border border-dark-border rounded-lg p-12 text-center">
            <Users className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">No Wallets Followed</h3>
            <p className="text-text-secondary text-sm mb-6">
              Start following wallets to track their trading activity.
            </p>
            <Link 
              href="/whales"
              className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-green text-dark-primary rounded-lg font-medium hover:bg-bulk-green/90"
            >
              <Users className="w-4 h-4" />
              Find Wallets to Follow
            </Link>
          </div>
        ) : (
          <div className="bg-dark-secondary border border-dark-border rounded-lg divide-y divide-dark-border">
            {wallets.map((w) => (
              <div
                key={w.wallet_address}
                className="flex items-center gap-4 p-4 hover:bg-dark-tertiary/30 transition-colors"
              >
                {/* Avatar */}
                {w.twitter_avatar ? (
                  <img 
                    src={w.twitter_avatar} 
                    alt="" 
                    className="w-12 h-12 rounded-full border border-dark-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary font-bold">
                    {w.wallet_address.slice(0, 2)}
                  </div>
                )}
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {w.twitter_name ? (
                      <p className="font-medium truncate">{w.twitter_name}</p>
                    ) : w.nickname ? (
                      <p className="font-medium truncate">{w.nickname}</p>
                    ) : (
                      <p className="font-medium font-mono">{formatAddress(w.wallet_address)}</p>
                    )}
                    
                    {w.twitter_handle && (
                      <span className="flex items-center gap-1 text-text-secondary text-sm">
                        <XIcon className="w-3 h-3" />
                        @{w.twitter_handle}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary font-mono truncate">
                    {w.wallet_address}
                  </p>
                </div>
                
                {/* Stats */}
                <div className="text-right mr-4 hidden sm:block">
                  {w.total_pnl !== undefined && w.total_pnl !== null && (
                    <p className={cn(
                      "font-bold",
                      (w.total_pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {(w.total_pnl || 0) >= 0 ? '+' : ''}${formatCompact(w.total_pnl)}
                    </p>
                  )}
                  {w.total_volume !== undefined && w.total_volume !== null && (
                    <p className="text-xs text-text-tertiary">
                      Vol: ${formatCompact(w.total_volume)}
                    </p>
                  )}
                  {w.trade_count !== undefined && (
                    <p className="text-xs text-text-tertiary">
                      {w.trade_count} trades
                    </p>
                  )}
                </div>
                
                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/whales/${w.wallet_address}`}
                    className="p-2 hover:bg-dark-tertiary rounded-lg transition-colors"
                    title="View wallet"
                  >
                    <Eye className="w-4 h-4 text-text-secondary" />
                  </Link>
                  <button
                    onClick={() => handleUnfollow(w.wallet_address)}
                    disabled={unfollowingAddress === w.wallet_address}
                    className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors disabled:opacity-50"
                    title="Unfollow"
                  >
                    {unfollowingAddress === w.wallet_address ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
