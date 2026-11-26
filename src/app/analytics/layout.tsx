'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { ChartFocuser } from '@/components/ChartFocuser';

const SLIDE_MS = 200; // matches the sidebar's duration-200

const menuItems = [
  {
    name: 'General',
    href: '/analytics/general',
  },
  {
    name: 'Network',
    href: '/analytics/network',
  },
  {
    name: 'Liquidations',
    href: '/analytics/liquidations',
  },
  {
    name: 'Risk',
    href: '/analytics/risk',
  },
  {
    name: 'Fees',
    href: '/analytics/fees',
  },
  {
    name: 'Funding',
    href: '/analytics/funding',
  },
  {
    name: 'Order Flow',
    href: '/analytics/flow',
  },
  {
    name: 'Positioning',
    href: '/analytics/positioning',
  },
  {
    name: 'Order Book',
    href: '/analytics/orderbook',
  },
  {
    name: 'Pre-Deposit',
    href: '/analytics/predeposit',
  },
  {
    name: 'Staking',
    href: '/analytics/staking',
  },
];

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Collapsible desktop sidebar — folds away completely. Persisted so
  // the choice sticks across navigations and reloads.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('bulkstats:analytics-sidebar') === 'collapsed');
    } catch { /* private mode / disabled storage — default expanded */ }
  }, []);
  // While the sidebar slides, the content keeps its width and only moves. Letting it
  // reflow made every chart on the page re-render on every frame of the slide (General
  // has a dozen), which is what made it stutter. It takes its new width once, at the end.
  const contentRef = useRef<HTMLElement | null>(null);
  const settleRef = useRef<number | null>(null);
  const toggleCollapsed = () => {
    const content = contentRef.current;
    if (content) {
      content.style.width = `${content.getBoundingClientRect().width}px`;
      content.style.flex = 'none';
      if (settleRef.current) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => { content.style.width = ''; content.style.flex = ''; }, SLIDE_MS + 20);
    }
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('bulkstats:analytics-sidebar', next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row overflow-x-clip">
      {/* Smooth-scrolls to a chart when the command palette asks for one. */}
      <ChartFocuser />
      {/* Desktop Sidebar */}
      {/* Collapsing slides the sidebar out (its content fades and slides left, nothing
          is clipped mid-way) and leaves a thin tab on the left edge to pull it back. */}
      <aside className={`relative hidden md:block flex-shrink-0 overflow-x-clip border-r border-[var(--border-color)] bg-[var(--bg-base)] transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${collapsed ? 'w-4' : 'w-56'}`}>
        <div className={`sticky top-14 w-56 pt-6 pb-4 transition-[opacity,transform] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${collapsed ? 'pointer-events-none -translate-x-6 opacity-0' : 'translate-x-0 opacity-100'}`} aria-hidden={collapsed}>
          <div className="mb-6 flex items-center justify-between px-4">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Analytics</h2>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              tabIndex={collapsed ? -1 : 0}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <nav className="space-y-1 px-2">
            {menuItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href === '/analytics/general' && pathname === '/analytics');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  tabIndex={collapsed ? -1 : 0}
                  className={`
                    flex items-center rounded-lg text-sm font-medium transition-colors
                    gap-3 px-3 py-2.5
                    ${isActive
                      ? 'bg-bulk-accent/10 text-[var(--accent)] border-l-2 border-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                    }
                  `}
                >
                  <span className="font-sans font-medium">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {/* Edge tab: the whole thin strip reopens the menu; a small handle marks it. */}
        <button type="button" onClick={toggleCollapsed} aria-label="Show the Analytics menu" title="Show the Analytics menu"
          tabIndex={collapsed ? 0 : -1}
          className={`group absolute inset-0 flex flex-col items-stretch justify-start transition-[opacity,background-color] duration-300 hover:bg-[var(--bg-muted)] ${collapsed ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <span className="sticky top-[42vh] mt-[42vh] flex h-16 w-full items-center justify-center text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--text-primary)]">
            <span className="flex h-16 w-full items-center justify-center rounded-r-md border-y border-r border-[var(--border-color)] bg-[var(--bg-muted)]">
              <ChevronRight size={12} />
            </span>
          </span>
        </button>
      </aside>

      {/* Mobile Tab Bar.
          Horizontally scrollable so all tab items remain reachable on
          narrow viewports without wrapping or clipping (previously "Risk"
          got cut off the right edge). `whitespace-nowrap` + `flex-shrink-0`
          on items prevents compression; `overflow-x-auto` adds the scroll.
          The scrollbar is hidden via Tailwind's `scrollbar-hide` utility
          where available - falls back to a slim default scrollbar on
          browsers that don't have it. */}
      <div className="md:hidden border-b border-[var(--border-color)] bg-[var(--bg-base)]">
        <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <span className="text-sm font-medium text-[var(--text-primary)] flex-shrink-0">Analytics</span>
          <span className="text-[var(--text-tertiary)] flex-shrink-0">/</span>
          <nav className="flex items-center gap-2 flex-shrink-0">
            {menuItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href === '/analytics/general' && pathname === '/analytics');
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0
                    ${isActive 
                      ? 'bg-bulk-accent/10 text-[var(--accent)]' 
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-muted)]'
                    }
                  `}
                >
                  <span className="font-sans font-medium">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main ref={contentRef} className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
