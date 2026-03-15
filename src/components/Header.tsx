'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, LogOut, Menu, X } from 'lucide-react';
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
  const { user, setUser } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    auth.logout();
    setUser(null);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-dark-border bg-dark-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-bulk-orange text-xl">✦</span>
              <span className="font-display text-lg font-bold text-text-primary tracking-wide">BULK</span>
            </div>
            <span className="text-[10px] text-text-secondary uppercase tracking-widest border-l border-dark-border pl-2 ml-1">
              Terminal
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-0.5">
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

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Network Badge */}
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded border border-dark-border bg-dark-secondary">
              <div className="w-1.5 h-1.5 rounded-full bg-bulk-green animate-pulse" />
              <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Alphanet</span>
            </div>

            {/* Auth */}
            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-sm text-text-secondary">
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
