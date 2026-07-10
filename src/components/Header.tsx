'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { User, LogOut, Menu, X, ChevronDown, Wallet, Users, Mail } from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useStore } from '@/store';
import { userApi } from '@/lib/api';
import { AppearanceMenu } from './AppearanceMenu';
import { NetworkSwitcher } from './NetworkSwitcher';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/whales', label: 'Whale Tracker' },
  { href: '/explorer', label: 'Explorer' },
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

  const connectedWalletAddress = solanaWallets?.[0]?.address || privyUser?.wallet?.address || '';
  
  const emailAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'email'
  );
  const userEmail = emailAccount?.address || privyUser?.email?.address;
  
  const isEmailUser = authenticated && !connectedWalletAddress && !!userEmail;
  const effectiveWallet = connectedWalletAddress || claimedWallet || user?.claimed_wallet || '';

  const twitterAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'twitter_oauth'
  );
  
  const twitterHandle = twitterAccount?.username || user?.twitter_handle;
  const twitterName = twitterAccount?.name || user?.twitter_name;
  const twitterAvatar = twitterAccount?.profilePictureUrl || user?.twitter_avatar;

  useEffect(() => {
    async function syncAuth() {
      if (authenticated && ready) {
        try {
          const token = await getAccessToken();
          if (token) {
            setAuthToken(token);
            
            const response = await userApi.authenticate(token, connectedWalletAddress || '', userEmail) as { user?: any };
            if (response?.user) {
              setUser(response.user);
              
              if (response.user.claimed_wallet) {
                setClaimedWallet(response.user.claimed_wallet);
              }
              
              if (twitterAccount && !response.user.twitter_handle) {
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
                  }
                } catch (linkError) {
                  console.error('[Header] Failed to sync Twitter:', linkError);
                }
              }
            }

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
      setMobileMenuOpen(false);
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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const displayName = twitterHandle 
    ? `@${twitterHandle}` 
    : twitterName 
      ? twitterName
      : userEmail
        ? userEmail.split('@')[0]
        : formatAddress(effectiveWallet);

  const [currentTheme, setCurrentTheme] = useState<'dark' | 'light'>('dark');
  
  useEffect(() => {
    const theme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light';
    if (theme) setCurrentTheme(theme);
    
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const newTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light';
          if (newTheme) setCurrentTheme(newTheme);
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border-color)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Left: Menu button (mobile) + Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-2 rounded hover:bg-[var(--bg-muted)] text-[var(--text-secondary)]"
            >
              <Menu className="w-5 h-5" />
            </button>
            
            <Link href="/" className="flex items-center shrink-0">
              <Image 
                src={currentTheme === 'light' ? '/bulkstats2.png' : '/bulkstats.png'}
                alt="BULK Stats" 
                width={140} 
                height={36} 
                className="h-7 w-auto"
                priority
              />
            </Link>
          </div>

          {/* Desktop Nav - centered */}
          <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                  pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
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
            {/* Network Switcher - hidden on mobile to save space */}
            <div className="hidden sm:block">
              <NetworkSwitcher />
            </div>

            {/* Theme Toggle - hidden on mobile */}
            <div className="hidden sm:block">
              <AppearanceMenu />
            </div>
            
            {ready && authenticated ? (
              <div className="relative profile-menu-container">
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-muted)] hover:bg-[var(--bg-secondary-20)] transition-colors"
                >
                  {twitterAvatar ? (
                    <img src={twitterAvatar} alt="" className="w-5 h-5 rounded-full" />
                  ) : isEmailUser ? (
                    <Mail className="w-4 h-4 text-bulk-green" />
                  ) : (
                    <Wallet className="w-4 h-4 text-bulk-green" />
                  )}
                  
                  <span className="text-sm text-[var(--text-primary)] hidden sm:block max-w-[100px] truncate">
                    {displayName}
                  </span>
                  
                  <ChevronDown className={`w-3 h-3 text-[var(--text-secondary)] transition-transform ${profileMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 py-2 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl z-50">
                    <div className="px-4 py-2 border-b border-[var(--border-color)]">
                      {isEmailUser ? (
                        <>
                          <p className="text-xs text-[var(--text-tertiary)]">Logged in as</p>
                          <p className="text-sm text-[var(--text-primary)]">{userEmail}</p>
                          {effectiveWallet && (
                            <>
                              <p className="text-xs text-[var(--text-tertiary)] mt-2">Claimed Wallet</p>
                              <p className="text-sm text-[var(--text-primary)] font-mono">{formatAddress(effectiveWallet)}</p>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-[var(--text-tertiary)]">Connected Wallet</p>
                          <p className="text-sm text-[var(--text-primary)] font-mono">{formatAddress(connectedWalletAddress)}</p>
                        </>
                      )}
                    </div>

                    <div className="py-1">
                      <Link href="/profile" onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors">
                        <User className="w-4 h-4 text-[var(--text-secondary)]" />
                        My Profile
                      </Link>
                      
                      {effectiveWallet && (
                        <Link href={`/whales/${effectiveWallet}`} onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors">
                          <Wallet className="w-4 h-4 text-[var(--text-secondary)]" />
                          My Wallet Stats
                        </Link>
                      )}
                      
                      <Link href="/following" onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)] transition-colors">
                        <Users className="w-4 h-4 text-[var(--text-secondary)]" />
                        Following
                        {following.length > 0 && (
                          <span className="ml-auto px-1.5 py-0.5 text-xs bg-bulk-green/20 text-bulk-green rounded">{following.length}</span>
                        )}
                      </Link>
                    </div>

                    <div className="border-t border-[var(--border-color)] pt-1">
                      <button onClick={handleLogout} className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-[var(--bg-secondary-20)] transition-colors">
                        <LogOut className="w-4 h-4" />
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : ready ? (
              <button onClick={login} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-bulk-green hover:bg-bulk-green/90 transition-colors">
                <Wallet className="w-4 h-4 text-dark-primary" />
                <span className="text-sm font-medium text-dark-primary">Login</span>
              </button>
            ) : (
              <div className="w-20 h-8 bg-[var(--bg-muted)] rounded animate-pulse" />
            )}
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop with blur */}
          <div 
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          {/* Slide-in menu */}
          <div className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-[var(--bg-base)] border-r border-[var(--border-color)] md:hidden overflow-y-auto">
            {/* Menu Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                <Image 
                  src={currentTheme === 'light' ? '/bulkstats2.png' : '/bulkstats.png'}
                  alt="BULK Stats" 
                  width={120} 
                  height={32} 
                  className="h-6 w-auto"
                />
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded hover:bg-[var(--bg-muted)] text-[var(--text-secondary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Navigation */}
            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "text-bulk-green bg-bulk-green/10"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              
              {authenticated && (
                <>
                  <Link
                    href="/following"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      pathname === '/following'
                        ? "text-bulk-green bg-bulk-green/10"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    Following {following.length > 0 && `(${following.length})`}
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      pathname === '/profile'
                        ? "text-bulk-green bg-bulk-green/10"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    Profile
                  </Link>
                </>
              )}
            </nav>
            
            {/* Theme toggle in mobile menu */}
            <div className="px-4 py-3 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between px-4">
                <span className="text-sm text-[var(--text-secondary)]">Appearance</span>
                <AppearanceMenu />
              </div>
            </div>
            
            {/* Logout in mobile menu */}
            {authenticated && (
              <div className="px-4 py-3 border-t border-[var(--border-color)]">
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-[var(--bg-muted)] rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
