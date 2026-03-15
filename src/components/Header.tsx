'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, Moon, User, LogOut, Menu, X } from 'lucide-react';
import { useStore } from '@/store';
import { auth, cn } from '@/lib/api';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/whales', label: 'Whale Tracker' },
];

export function Header() {
  const pathname = usePathname();
  const { theme, toggleTheme, user, setUser } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    auth.logout();
    setUser(null);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-dark-border bg-dark-primary/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bulk-cyan to-bulk-magenta flex items-center justify-center font-display font-black text-lg">
              B
            </div>
            <div className="hidden sm:block">
              <h1 className="font-display text-xl font-bold gradient-text">BULK</h1>
              <p className="text-[9px] text-gray-500 uppercase tracking-[2px] -mt-1">Terminal</p>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  pathname === item.href
                    ? "bg-bulk-cyan/10 text-bulk-cyan"
                    : "text-gray-400 hover:text-white hover:bg-dark-tertiary"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Network Badge */}
            <div className="hidden sm:block px-3 py-1 rounded-full bg-gradient-to-r from-bulk-orange to-bulk-yellow text-dark-primary text-[10px] font-bold uppercase tracking-wider">
              Testnet
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-dark-tertiary transition-colors"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5 text-bulk-yellow" />
              ) : (
                <Moon className="w-5 h-5 text-bulk-cyan" />
              )}
            </button>

            {/* Auth */}
            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-sm text-gray-400">
                  {user.username || user.email.split('@')[0]}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg hover:bg-dark-tertiary transition-colors text-gray-400 hover:text-white"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-tertiary hover:bg-dark-border transition-colors"
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:block text-sm">Login</span>
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-dark-tertiary"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden py-4 border-t border-dark-border">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-4 py-3 rounded-lg text-sm font-medium transition-all",
                  pathname === item.href
                    ? "bg-bulk-cyan/10 text-bulk-cyan"
                    : "text-gray-400"
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
