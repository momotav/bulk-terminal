'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Flame } from 'lucide-react';

const menuItems = [
  {
    name: 'General',
    href: '/analytics/general',
    icon: BarChart3,
    description: 'Volume, OI, Funding, Trades'
  },
  {
    name: 'Liquidations',
    href: '/analytics/liquidations',
    icon: Flame,
    description: 'Liquidation analytics'
  },
];

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-base)]">
        <div className="sticky top-0 pt-6 pb-4">
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
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20' 
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

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
