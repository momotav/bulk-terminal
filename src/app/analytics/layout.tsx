'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Flame, Gauge } from 'lucide-react';

const menuItems = [
  {
    name: 'General',
    href: '/analytics/general',
    icon: BarChart3,
  },
  {
    name: 'Liquidations',
    href: '/analytics/liquidations',
    icon: Flame,
  },
  {
    name: 'Risk',
    href: '/analytics/risk',
    icon: Gauge,
  },
];

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-56 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-base)]">
        <div className="sticky top-14 pt-6 pb-4">
          <div className="px-4 mb-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Analytics</h2>
          </div>
          
          <nav className="space-y-1 px-2">
            {menuItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href === '/analytics/general' && pathname === '/analytics');
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive 
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-l-2 border-[var(--accent)]' 
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                    }
                  `}
                >
                  <Icon size={18} className={isActive ? 'text-[var(--accent)]' : ''} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Mobile Tab Bar */}
      <div className="md:hidden border-b border-[var(--border-color)] bg-[var(--bg-base)]">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-primary)]">Analytics</span>
          <span className="text-[var(--text-tertiary)]">/</span>
          <nav className="flex items-center gap-2">
            {menuItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href === '/analytics/general' && pathname === '/analytics');
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive 
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]' 
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-muted)]'
                    }
                  `}
                >
                  <Icon size={14} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
