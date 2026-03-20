'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { User, LogOut, Menu, X, ChevronDown, Wallet, Users } from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useStore } from '@/store';
import { userApi } from '@/lib/api';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/whales', label: 'Whale Tracker' },
];

export function Header() {
  const pathname = usePathname();
  const { user, setUser, logout: storeLogout, setAuthToken, following, setFollowing } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const { 
    ready, 
    authenticated, 
    login, 
    logout: privyLogout, 
    getAccessToken,
    user: privyUser,
  } = usePrivy();
  
  const { wallets: solanaWallets } = useSolanaWallets();

  // Get the first connected Solana wallet address
  const walletAddress = solanaWallets?.[0]?.address || privyUser?.wallet?.address;

  // Sync Privy auth with backend
  useEffect(() => {
    async function syncAuth() {
      if (authenticated && walletAddress && ready) {
        try {
          const token = await getAccessToken();
          if (token) {
            setAuthToken(token);
            
            const response = await userApi.authenticate(token, walletAddress) as { user?: any };
            if (response?.user) {
              setUser(response.user);
            }

            // Load following
            const followingResponse = await userApi.getFollowing(token) as { following?: any[] };
            if (followingResponse?.following) {
              setFollowing(followingResponse.following);
            }
          }
        } catch (error) {
          console.error('Failed to sync auth:', error);
        }
      } else if (!authenticated && user) {
        storeLogout();
      }
    }

    syncAuth();
  }, [authenticated, walletAddress, ready]);

  const handleLogout = async () => {
    try {
      await privyLogout();
      storeLogout();
      setProfileMenuOpen(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return '...';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-menu-container')) {
        setProfileMenuOpen(false);
      }
    };

    if (profileMenuOpen) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [profileMenuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-dark-border bg-dark-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0">
            <Image 
              src="/bulkstats.png" 
              alt="BULK Stats" 
              width={140} 
              height={36} 
              className="h-8 w-auto"
              priority
            />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center justify-center gap-1 absolute left-1/2 -translate-x-1/2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                  pathname === item.href
                    ? "text-bulk-green"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {authenticated && (
              <Link
                href="/following"
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                  pathname === '/following'
                    ? "text-bulk-green"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Following
                {following.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-bulk-green/20 text-bulk-green rounded">
                    {following.length}
                  </span>
                )}
              </Link>
            )}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            {ready && authenticated && walletAddress ? (
              <div className="relative profile-menu-container">
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-dark-border bg-dark-secondary hover:bg-dark-tertiary transition-colors"
                >
                  {user?.twitter_avatar ? (
                    <img 
                      src={user.twitter_avatar} 
                      alt="" 
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <Wallet className="w-4 h-4 text-bulk-green" />
                  )}
                  
                  <span className="text-sm text-text-primary hidden sm:block">
                    {user?.twitter_handle 
                      ? `@${user.twitter_handle}` 
                      : user?.display_name 
                        ? user.display_name
                        : formatAddress(walletAddress)
                    }
                  </span>
                  
                  <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${
                    profileMenuOpen ? "rotate-180" : ""
                  }`} />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 py-2 bg-dark-secondary border border-dark-border rounded-lg shadow-xl">
                    <div className="px-4 py-2 border-b border-dark-border">
                      <p className="text-xs text-text-tertiary">Connected Wallet</p>
                      <p className="text-sm text-text-primary font-mono">
                        {formatAddress(walletAddress)}
                      </p>
                    </div>

                    <div className="py-1">
                      <Link
                        href="/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-dark-tertiary transition-colors"
                      >
                        <User className="w-4 h-4 text-text-secondary" />
                        My Profile
                      </Link>
                      
                      <Link
                        href={`/whales/${walletAddress}`}
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-dark-tertiary transition-colors"
                      >
                        <Wallet className="w-4 h-4 text-text-secondary" />
                        My Wallet Stats
                      </Link>
                      
                      <Link
                        href="/following"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-text-primary hover:bg-dark-tertiary transition-colors"
                      >
                        <Users className="w-4 h-4 text-text-secondary" />
                        Following
                        {following.length > 0 && (
                          <span className="ml-auto px-1.5 py-0.5 text-xs bg-bulk-green/20 text-bulk-green rounded">
                            {following.length}
                          </span>
                        )}
                      </Link>
                    </div>

                    <div className="border-t border-dark-border pt-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-dark-tertiary transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : ready ? (
              <button
                onClick={login}
                className="flex items-center gap-2 px-4 py-2 rounded bg-bulk-green hover:bg-bulk-green/90 transition-colors"
              >
                <Wallet className="w-4 h-4 text-dark-primary" />
                <span className="text-sm font-medium text-dark-primary">Connect Wallet</span>
              </button>
            ) : (
              <div className="w-32 h-9 bg-dark-secondary rounded animate-pulse" />
            )}

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded hover:bg-dark-tertiary text-text-secondary"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden py-3 border-t border-dark-border">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-4 py-2.5 rounded text-sm font-medium transition-all ${
                  pathname === item.href
                    ? "text-bulk-green bg-bulk-green/10"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {authenticated && (
              <>
                <Link
                  href="/following"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-4 py-2.5 rounded text-sm font-medium transition-all ${
                    pathname === '/following'
                      ? "text-bulk-green bg-bulk-green/10"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Following {following.length > 0 && `(${following.length})`}
                </Link>
                <Link
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-4 py-2.5 rounded text-sm font-medium transition-all ${
                    pathname === '/profile'
                      ? "text-bulk-green bg-bulk-green/10"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Profile
                </Link>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
