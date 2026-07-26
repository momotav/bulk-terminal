'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Flame, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { formatCompact, formatAddress, timeAgo, cn } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

interface ActivityItem {
  type: 'liquidation' | 'trade';
  wallet_address: string | null;
  symbol: string;
  side: string;
  size: string | number;
  price: string | number;
  value: string | number;
  timestamp: string;
}

interface RecentActivityProps {
  // Drops the panel's own border so it can share hairlines with an
  // adjacent panel inside a bordered grid.
  flush?: boolean;
}

export function RecentActivity({ flush = false }: RecentActivityProps) {
  const { network } = useCurrentNetwork();
  const reduce = useReducedMotion();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'liquidations' | 'trades'>('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_BASE}${withNetwork("/api/analytics/recent-activity?limit=40")}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        
        // Parse numeric values
        const parsed: ActivityItem[] = (data.data || []).map((item: any) => ({
          ...item,
          price: parseFloat(item.price) || 0,
          value: parseFloat(item.value) || 0,
          size: parseFloat(item.size) || 0,
        }));
        
        setActivities(parsed);
      } catch (error) {
        console.error('Failed to fetch activity:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [network]);

  const filtered = activities.filter((a) => {
    if (tab === 'all') return true;
    if (tab === 'liquidations') return a.type === 'liquidation';
    if (tab === 'trades') return a.type === 'trade';
    return true;
  });

  // Assign stable, collision-free keys. The feed genuinely contains
  // duplicate events — the same wallet, symbol, side, value and timestamp
  // (a single fill reported on both legs) — which would collide as React
  // keys and break AnimatePresence (it logged "two children with the same
  // key" and dropped rows). A per-render occurrence counter disambiguates
  // the rare duplicate while keeping the key stable for the common unique
  // case, so persisting rows still don't re-animate on each 30s refresh.
  const keySeen = new Map<string, number>();
  const keyed = filtered.slice(0, 20).map((item) => {
    const base = `${item.type}-${item.timestamp}-${item.wallet_address}-${item.symbol}-${item.side}-${item.value}`;
    const n = keySeen.get(base) ?? 0;
    keySeen.set(base, n + 1);
    return { item, key: n === 0 ? base : `${base}#${n}` };
  });

  return (
    <div className={cn('glass-card h-full flex flex-col', flush && 'panel-flush')}>
      <div className="panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="panel-icon" style={{ color: 'var(--role-chrome)' }}>
            <Zap className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="panel-title t-h2 truncate">Live Activity</h2>
            <p className="t-caption truncate">Trades &amp; liquidations</p>
          </div>
        </div>

        <div className="toggle-group shrink-0">
          {(['all', 'liquidations', 'trades'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "toggle-btn capitalize",
                tab === t && "active"
              )}
            >
              {t === 'liquidations' ? 'Liqs' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Column header — mirrors the leaderboard panel so the two read as
          one system rather than two separately-designed widgets. */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--role-line-subtle)] bg-[var(--role-background)]/40">
          <span className="table-header w-7">Type</span>
          <span className="table-header flex-1">Market</span>
          {/* Wallet, time and price each earn a real column once the panel
              is wide enough. Below those breakpoints they fold back under
              the market name — no data is dropped, only re-stacked. */}
          <span className="table-header hidden w-28 lg:block">Wallet</span>
          <span className="table-header hidden w-16 text-right xl:block">Time</span>
          <span className="table-header hidden w-24 text-right lg:block">Price</span>
          <span className="table-header w-24 text-right">Value</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse p-2">
                <div className="w-8 h-8 bg-[var(--bg-secondary-20)] rounded" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-[var(--bg-secondary-20)] rounded mb-1" />
                  <div className="h-2 w-16 bg-[var(--bg-secondary-20)] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <span className="panel-icon mb-3 !h-10 !w-10 opacity-40 text-[var(--accent)]">
              <Zap className="w-5 h-5" strokeWidth={1.5} />
            </span>
            <p className="t-body text-[var(--role-content-muted)]">No recent activity</p>
            <p className="t-caption mt-1">
              {tab === 'all' ? 'The feed fills as trades settle.' : `No ${tab} in the current window.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            <AnimatePresence initial={false}>
            {keyed.map(({ item, key }) => {
              // One decision drives icon, chip tint, pill and value color,
              // so a row can never disagree with itself about direction.
              const isLiq = item.type === 'liquidation';
              const isBuy = !isLiq && item.side === 'buy';
              const accent = isLiq || !isBuy ? 'var(--asks)' : 'var(--bids)';
              const RowIcon = isLiq ? Flame : isBuy ? TrendingUp : TrendingDown;

              return (
                <motion.div
                  key={key}
                  layout={reduce ? false : 'position'}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                  style={{ '--row-accent': accent } as React.CSSProperties}
                  className="data-row flex items-center gap-3 px-4 py-2.5"
                >
                  {/* Icon chip */}
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)]"
                    style={{
                      color: accent,
                      backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 22%, transparent)`,
                    }}
                  >
                    <RowIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>

                  {/* Market */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'side-pill',
                          isLiq ? 'side-pill-rekt' : isBuy ? 'side-pill-buy' : 'side-pill-sell'
                        )}
                      >
                        {isLiq ? 'Rekt' : item.side}
                      </span>
                      <span className="truncate text-xs font-medium text-[var(--role-content)]">
                        {item.symbol}
                      </span>
                    </div>
                    {/* Narrow-panel fallback: wallet and time fold under the
                        market name when their columns are hidden. */}
                    <p className="t-caption mt-0.5 truncate font-mono lg:hidden">
                      {item.wallet_address ? formatAddress(item.wallet_address) : 'Unknown'}
                      <span className="mx-1.5 opacity-50">·</span>
                      {timeAgo(item.timestamp)}
                    </p>
                    <p className="t-caption mt-0.5 hidden truncate font-mono lg:block xl:hidden">
                      {timeAgo(item.timestamp)}
                    </p>
                  </div>

                  {/* Wallet */}
                  <p className="t-caption hidden w-28 shrink-0 truncate font-mono lg:block">
                    {item.wallet_address ? formatAddress(item.wallet_address) : 'Unknown'}
                  </p>

                  {/* Time */}
                  <p className="t-caption hidden w-16 shrink-0 truncate text-right font-mono xl:block">
                    {timeAgo(item.timestamp)}
                  </p>

                  {/* Price */}
                  <p className="t-caption hidden w-24 shrink-0 text-right font-mono tabular-nums lg:block">
                    ${Number(item.price).toLocaleString()}
                  </p>

                  {/* Value */}
                  <div className="w-24 shrink-0 text-right">
                    <p
                      className="font-mono text-xs font-bold tabular-nums tracking-tight"
                      style={{ color: isLiq ? 'var(--role-signal-negative)' : 'var(--role-content)' }}
                    >
                      ${formatCompact(item.value)}
                    </p>
                    <p className="t-caption font-mono tabular-nums lg:hidden">
                      @ ${Number(item.price).toLocaleString()}
                    </p>
                  </div>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
