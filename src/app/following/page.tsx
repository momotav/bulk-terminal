'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Bell, BellOff, Users, TrendingUp, TrendingDown, Flame, 
  Trash2, CheckCheck, Eye
} from 'lucide-react';
import { Header } from '@/components/Header';
import { wallet, formatNumber, formatAddress, formatCompact, cn, type Notification } from '@/lib/api';
import { useStore } from '@/store';

export default function FollowingPage() {
  const router = useRouter();
  const { user } = useStore();
  
  const [watchlist, setWatchlist] = useState<Array<{ wallet_address: string; nickname: string | null; total_pnl?: number; total_volume?: number }>>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'wallets' | 'activity'>('activity');

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    
    fetchData();
  }, [user, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [watchlistData, notifData] = await Promise.all([
        wallet.getWatchlist(),
        wallet.getNotifications(100),
      ]);
      setWatchlist(watchlistData);
      setNotifications(notifData.data);
      setUnreadCount(notifData.unread_count);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async (address: string) => {
    try {
      await wallet.removeFromWatchlist(address);
      setWatchlist(prev => prev.filter(w => w.wallet_address !== address));
    } catch (error) {
      console.error('Failed to unfollow:', error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await wallet.markNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleClearAll = async () => {
    try {
      await wallet.clearNotifications();
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1">Following</h1>
            <p className="text-sm text-text-secondary">
              Track your favorite wallets and see their activity.
            </p>
          </div>
          
          {unreadCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-bulk-green/10 text-bulk-green rounded-full text-sm">
              <Bell className="w-4 h-4" />
              {unreadCount} new
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('activity')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
              activeTab === 'activity'
                ? "bg-bulk-green text-dark-primary border-bulk-green"
                : "bg-dark-secondary border-dark-border text-text-secondary hover:text-text-primary"
            )}
          >
            <Bell className="w-4 h-4" />
            Activity
            {unreadCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-bulk-red text-white text-xs rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('wallets')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
              activeTab === 'wallets'
                ? "bg-bulk-green text-dark-primary border-bulk-green"
                : "bg-dark-secondary border-dark-border text-text-secondary hover:text-text-primary"
            )}
          >
            <Users className="w-4 h-4" />
            Wallets ({watchlist.length})
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="glass-card p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-dark-tertiary rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 w-32 bg-dark-tertiary rounded mb-2" />
                    <div className="h-3 w-48 bg-dark-tertiary rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'activity' ? (
          /* Activity Tab */
          <div className="glass-card">
            {notifications.length > 0 && (
              <div className="flex items-center justify-between p-4 border-b border-dark-border">
                <span className="text-sm text-gray-500">
                  {notifications.length} notifications
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleMarkAllRead}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-dark-tertiary hover:bg-dark-border rounded-lg transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-dark-tertiary hover:bg-bulk-red/20 hover:text-bulk-red rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear all
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-dark-border/50">
              {notifications.length === 0 ? (
                <div className="p-12 text-center">
                  <BellOff className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                  <h3 className="font-display text-lg font-semibold mb-2">No Activity Yet</h3>
                  <p className="text-gray-500 text-sm mb-4">
                    When wallets you follow make trades or get liquidated, you'll see it here.
                  </p>
                  <Link 
                    href="/whales"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-cyan text-dark-primary rounded-lg font-medium hover:opacity-90 transition-opacity"
                  >
                    <Users className="w-4 h-4" />
                    Find Wallets to Follow
                  </Link>
                </div>
              ) : (
                notifications.map((notif) => {
                  const isTrade = notif.type === 'trade';
                  const isBuy = notif.side === 'buy' || notif.side === 'long';
                  
                  return (
                    <Link
                      key={notif.id}
                      href={`/whales/${notif.wallet_address}`}
                      className={cn(
                        "flex items-center gap-4 p-4 hover:bg-dark-tertiary/30 transition-colors",
                        !notif.read && "bg-bulk-cyan/5"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        isTrade 
                          ? (isBuy ? "bg-bulk-green/15 text-bulk-green" : "bg-bulk-red/15 text-bulk-red")
                          : "bg-bulk-red/15 text-bulk-red"
                      )}>
                        {isTrade ? (
                          isBuy ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />
                        ) : (
                          <Flame className="w-5 h-5" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">
                            {notif.nickname || formatAddress(notif.wallet_address)}
                          </span>
                          {!notif.read && (
                            <span className="w-2 h-2 bg-bulk-cyan rounded-full" />
                          )}
                        </div>
                        <p className="text-sm text-gray-400">
                          {isTrade ? (
                            <>
                              <span className={isBuy ? "text-bulk-green" : "text-bulk-red"}>
                                {isBuy ? 'Bought' : 'Sold'}
                              </span>
                              {' '}{formatNumber(notif.size, 4)} {notif.symbol.split('-')[0]} @ ${formatNumber(notif.price, 2)}
                            </>
                          ) : (
                            <>
                              <span className="text-bulk-red">Liquidated</span>
                              {' '}{notif.symbol} position worth ${formatCompact(notif.value)}
                            </>
                          )}
                        </p>
                      </div>
                      
                      <div className="text-right">
                        <p className={cn(
                          "font-display font-bold",
                          isTrade ? "text-white" : "text-bulk-red"
                        )}>
                          ${formatCompact(notif.value)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatTime(notif.created_at)}
                        </p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Wallets Tab */
          <div className="glass-card">
            <div className="divide-y divide-dark-border/50">
              {watchlist.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                  <h3 className="font-display text-lg font-semibold mb-2">No Wallets Followed</h3>
                  <p className="text-gray-500 text-sm mb-4">
                    Start following wallets to track their trading activity.
                  </p>
                  <Link 
                    href="/whales"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-bulk-cyan text-dark-primary rounded-lg font-medium hover:opacity-90 transition-opacity"
                  >
                    <Users className="w-4 h-4" />
                    Find Wallets to Follow
                  </Link>
                </div>
              ) : (
                watchlist.map((w) => (
                  <div
                    key={w.wallet_address}
                    className="flex items-center gap-4 p-4 hover:bg-dark-tertiary/30 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-bulk-cyan to-bulk-magenta flex items-center justify-center text-white font-bold">
                      {w.wallet_address.slice(0, 2)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {w.nickname || formatAddress(w.wallet_address)}
                      </p>
                      <p className="text-xs text-gray-500 font-mono truncate">
                        {w.wallet_address}
                      </p>
                    </div>
                    
                    <div className="text-right mr-4">
                      {w.total_pnl !== undefined && (
                        <p className={cn(
                          "font-display font-bold",
                          (w.total_pnl || 0) >= 0 ? "text-bulk-green" : "text-bulk-red"
                        )}>
                          {(w.total_pnl || 0) >= 0 ? '+' : ''}${formatCompact(w.total_pnl)}
                        </p>
                      )}
                      {w.total_volume !== undefined && (
                        <p className="text-xs text-gray-500">
                          Vol: ${formatCompact(w.total_volume)}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/whales/${w.wallet_address}`}
                        className="p-2 hover:bg-dark-tertiary rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4 text-gray-400" />
                      </Link>
                      <button
                        onClick={() => handleUnfollow(w.wallet_address)}
                        className="p-2 hover:bg-bulk-red/20 hover:text-bulk-red rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
