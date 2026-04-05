'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { User, LogOut, Menu, X, ChevronDown, Wallet, Users, Mail } from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useStore } from '@/store';
import { userApi } from '@/lib/api';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/whales', label: 'Whale Tracker' },
];

export function Header() {
  const pathname = usePathname();
  const { user, setUser, logout: storeLogout, setAuthToken, following, setFollowing, claimedWallet, setClaimedWallet } = useStore();
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
  const connectedWalletAddress = solanaWallets?.[0]?.address || privyUser?.wallet?.address || '';
  
  // Get email from Privy user
  const emailAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'email'
  );
  const userEmail = emailAccount?.address || privyUser?.email?.address;
  
  // Determine if user logged in via email (no connected wallet)
  const isEmailUser = authenticated && !connectedWalletAddress && !!userEmail;
  
  // Effective wallet is either connected wallet or claimed wallet
  const effectiveWallet = connectedWalletAddress || claimedWallet || user?.claimed_wallet || '';

  // Get Twitter info from Privy user's linked accounts
  const twitterAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'twitter_oauth'
  );
  
  const twitterHandle = twitterAccount?.username || user?.twitter_handle;
  const twitterName = twitterAccount?.name || user?.twitter_name;
  const twitterAvatar = twitterAccount?.profilePictureUrl || user?.twitter_avatar;

  // Sync Privy auth with backend
  useEffect(() => {
    async function syncAuth() {
      if (authenticated && ready) {
        try {
          const token = await getAccessToken();
          if (token) {
            setAuthToken(token);
            
            // Authenticate with backend (wallet may be null for email users)
            const response = await userApi.authenticate(token, connectedWalletAddress || '', userEmail) as { user?: any };
            if (response?.user) {
              setUser(response.user);
              
              // Set claimed wallet from backend
              if (response.user.claimed_wallet) {
                setClaimedWallet(response.user.claimed_wallet);
              }
              
              // If Privy has Twitter data but backend doesn't, sync it
              if (twitterAccount && !response.user.twitter_handle) {
                console.log('[Header] Syncing Twitter data to backend...');
                try {
                  const twitterData = {
                    twitterId: twitterAccount.subject || '',
                    twitterHandle: twitterAccount.username || '',
                    twitterName: twitterAccount.name || '',
                    twitterAvatar: twitterAccount.profilePictureUrl || '',
                  };
                  
                  const linkResponse = await userApi.linkTwitter(token, twitterData) as { user?: any };
                  if (linkResponse?.user) {
                    setUser(linkResponse.user);
                    console.log('[Header] Twitter data synced successfully');
                  }
                } catch (linkError) {
                  console.error('[Header] Failed to sync Twitter:', linkError);
                }
              }
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
  }, [authenticated, connectedWalletAddress, userEmail, ready, twitterAccount?.username]);

  const handleLogout = async () => {
    try {
      await privyLogout();
      storeLogout();
      setClaimedWallet(null);
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

  // Display name priority: Twitter handle > Twitter name > email > wallet address
  const displayName = twitterHandle 
    ? `@${twitterHandle}` 
    : twitterName 
      ? twitterName
      : userEmail
        ? userEmail.split('@')[0]
        : formatAddress(effectiveWallet);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border-color)] bg-[var(--bg-base)]">
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
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
            {/* Theme Toggle */}
            <ThemeToggle />
            
            {ready && authenticated ? (
              <div className="relative profile-menu-container">
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-muted)] hover:bg-[var(--bg-secondary-20)] transition-colors"
                >
                  {twitterAvatar ? (
                    <img 
                      src={twitterAvatar} 
                      alt="" 
                      className="w-5 h-5 rounded-full"
                    />
                  ) : isEmailUser ? (
                    <Mail className="w-4 h-4 text-bulk-green" />
                  ) : (
                    <Wallet className="w-4 h-4 text-bulk-green" />
                  )}
                  
                  <span className="text-sm text-[var(--text-primary)] hidden sm:block">
                    {displayName}
                  </span>
                  
                  <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${
                    profileMenuOpen ? "rotate-180" : ""
                  }`} />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 py-2 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl">
                    <div className="px-4 py-2 border-b border-[var(--border-color)]">
                      {isEmailUser ? (
                        <>
                          <p className="text-xs text-[var(--text-tertiary)]">Logged in as</p>
                          <p className="text-sm text-[var(--text-primary)]">{userEmail}</p>
                          {effectiveWallet && (
                            <>
                              <p className="text-xs text-[var(--text-tertiary)] mt-2">Claimed Wallet</p>
                              <p className="text-sm text-[var(--text-primary)] font-mono">
                                {formatAddress(effectiveWallet)}
                              </p>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-[var(--text-tertiary)]">Connected Wallet</p>
                          <p className="text-sm text-[var(--text-primary)] font-mono">
                            {formatAddress(connectedWalletAddress)}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="py-1">
                      <Link
                        href="/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors"
                      >
                        <User className="w-4 h-4 text-[var(--text-secondary)]" />
                        My Profile
                      </Link>
                      
                      {effectiveWallet && (
                        <Link
                          href={`/whales/${effectiveWallet}`}
                          onClick={() => setProfileMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors"
                        >
                          <Wallet className="w-4 h-4 text-[var(--text-secondary)]" />
                          My Wallet Stats
                        </Link>
                      )}
                      
                      <Link
                        href="/following"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors"
                      >
                        <Users className="w-4 h-4 text-[var(--text-secondary)]" />
                        Following
                        {following.length > 0 && (
                          <span className="ml-auto px-1.5 py-0.5 text-xs bg-bulk-green/20 text-bulk-green rounded">
                            {following.length}
                          </span>
                        )}
                      </Link>
                    </div>

                    <div className="border-t border-[var(--border-color)] pt-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-[var(--bg-secondary-20)] transition-colors"
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
                <span className="text-sm font-medium text-dark-primary">Login</span>
              </button>
            ) : (
              <div className="w-32 h-9 bg-[var(--bg-muted)] rounded animate-pulse" />
            )}

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded hover:bg-[var(--bg-secondary-20)] text-[var(--text-secondary)]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden py-3 border-t border-[var(--border-color)]">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-4 py-2.5 rounded text-sm font-medium transition-all ${
                  pathname === item.href
                    ? "text-bulk-green bg-bulk-green/10"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
