'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { User, LogOut, Menu, X, Search } from 'lucide-react';
import { useStore } from '@/store';
import { auth, cn } from '@/lib/api';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/whales', label: 'Whale Tracker' },
  { href: '/following', label: 'Following' },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const handleLogout = () => {
    auth.logout();
    setUser(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      router.push(`/whales/${query}`);
      setSearchQuery('');
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-dark-border bg-dark-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14 gap-4">
          {/* Logo - Left */}
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

          {/* Desktop Nav - Center */}
          <nav className="hidden lg:flex items-center justify-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1.5 rounded text-sm font-medium transition-all",
                  pathname === item.href
                    ? "text-bulk-green"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side - Search & Login */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="hidden sm:block">
              <div className={cn(
                "relative flex items-center transition-all duration-200",
                searchFocused ? "w-64" : "w-44"
              )}>
                <Search className="absolute left-3 w-4 h-4 text-text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder="Search wallet..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-dark-secondary border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
                />
              </div>
            </form>

            {/* Auth */}
            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden md:block text-sm text-text-secondary">
                  {user.username || user.email.split('@')[0]}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded hover:bg-dark-tertiary transition-colors text-text-secondary hover:text-text-primary"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-dark-border bg-dark-secondary hover:bg-dark-tertiary transition-colors"
              >
                <User className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-primary">Login</span>
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded hover:bg-dark-tertiary text-text-secondary"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="lg:hidden py-3 border-t border-dark-border">
            {/* Mobile Search */}
            <form onSubmit={handleSearch} className="px-4 mb-3">
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-4 h-4 text-text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search wallet address..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-dark-secondary border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
                />
              </div>
            </form>
            
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-4 py-2.5 rounded text-sm font-medium transition-all",
                  pathname === item.href
                    ? "text-bulk-green bg-bulk-green/10"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
