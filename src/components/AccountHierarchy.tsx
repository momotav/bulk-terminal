'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ArrowUp, Users, Folder } from 'lucide-react';
import { wallet, formatAddress, formatNumber, formatCompact, cn } from '@/lib/api';

// ----------------------------------------------------------------------------
// AccountHierarchy
//
// Renders a compact dropdown that lets users see and navigate between a
// master account and its sub-accounts. Replaces the older inline-card
// design which took a lot of vertical space.
//
// Pill button → click → popover listing every account in the family.
// Clicking a row navigates to that account's wallet page.
//
// Three render states:
//   1. Loading             → ghost pill (animated skeleton)
//   2. SubAccount (child)  → "Sub-account of <master> ↑" pill — click goes
//                            to the master, no dropdown (only one parent)
//   3. MasterEOA with subs → "Master Account ▾" pill with full dropdown
//   4. MasterEOA, no subs  → renders nothing (nothing meaningful to show)
//
// Defensive: if the hierarchy fetch fails or returns weird data, we render
// nothing rather than a broken pill.
// ----------------------------------------------------------------------------

interface HierarchyData {
  kind: 'MasterEOA' | 'SubAccount' | 'Multisig' | 'Unknown';
  parent?: string;
  subAccounts: { pubkey: string; name?: string }[];
  summaries: Record<
    string,
    {
      totalBalance: number;
      notional: number;
      unrealizedPnl: number;
      positionsCount: number;
    }
  >;
}

export function AccountHierarchy({ address }: { address: string }) {
  const router = useRouter();
  const [data, setData] = useState<HierarchyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch hierarchy once per address. The backend resolver returns the
  // family in a single round-trip (see /api/wallet/:address/hierarchy).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    wallet
      .getHierarchy(address)
      .then((res) => {
        if (cancelled) return;
        setData(res as HierarchyData);
      })
      .catch(() => {
        // Hierarchy is purely informational. On error, don't break the
        // wallet page — just render nothing.
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Close the popover on outside click / Esc. Standard popover hygiene.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ----- Loading ghost ------------------------------------------------------
  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-color)]">
        <div className="h-3 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
      </div>
    );
  }

  // ----- Sub-account: simple "Master account ↑" pill, no dropdown ----------
  if (data?.kind === 'SubAccount' && data.parent) {
    return (
      <Link
        href={`/whales/${data.parent}`}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-color)] hover:border-bulk-green/60 transition-colors text-sm group"
      >
        <ArrowUp className="w-3.5 h-3.5 text-bulk-green" />
        <span className="text-[var(--text-secondary)]">Sub-account of</span>
        <span className="font-mono text-[var(--text-primary)] group-hover:text-bulk-green">
          {formatAddress(data.parent)}
        </span>
      </Link>
    );
  }

  // ----- Master with no sub-accounts: render nothing -----------------------
  if (data?.kind !== 'MasterEOA' || data.subAccounts.length === 0) {
    return null;
  }

  // ----- Master with sub-accounts: dropdown --------------------------------
  // Build rows: master first, then each sub-account in input order.
  const rows = [
    {
      pubkey: address,
      label: 'Master Account',
      isMaster: true,
      summary: data.summaries[address],
    },
    ...data.subAccounts.map((sa) => ({
      pubkey: sa.pubkey,
      label: sa.name || 'Unnamed sub-account',
      isMaster: false,
      summary: data.summaries[sa.pubkey],
    })),
  ];

  // Aggregate row for the footer ("All accounts" total).
  let totalBalance = 0;
  let totalNotional = 0;
  let totalUnrealized = 0;
  let totalPositions = 0;
  let anyMissing = false;
  for (const r of rows) {
    if (!r.summary) {
      anyMissing = true;
      continue;
    }
    totalBalance += r.summary.totalBalance;
    totalNotional += r.summary.notional;
    totalUnrealized += r.summary.unrealizedPnl;
    totalPositions += r.summary.positionsCount;
  }

  const subCount = rows.length - 1;

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger pill — matches the visual language of the Long/Short and
          regime toggles elsewhere on the site. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
          'bg-[var(--bg-muted)] border',
          open
            ? 'border-bulk-green/60 text-[var(--text-primary)]'
            : 'border-[var(--border-color)] text-[var(--text-primary)] hover:border-bulk-green/60'
        )}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Users className="w-3.5 h-3.5 text-bulk-green" />
        <span>Master Account</span>
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
          +{subCount} sub
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Popover. Width is capped so the rows don't stretch absurdly on
          large screens, and shrinks to fit narrow viewports. */}
      {open && (
        <div className="absolute left-0 mt-2 w-[min(420px,calc(100vw-32px))] bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="p-3 border-b border-[var(--border-color)] flex items-center gap-2 text-xs">
            <Users className="w-3.5 h-3.5 text-bulk-green" />
            <span className="font-medium text-[var(--text-primary)]">
              Account family
            </span>
            <span className="text-[var(--text-tertiary)]">
              {rows.length} accounts · {totalPositions} open positions
              {anyMissing && ' (partial)'}
            </span>
          </div>

          {/* Account rows. Each is a clickable button that closes the popover
              and navigates. The currently-viewed account gets a subtle bg
              tint so the user can see "you are here". */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border-color)]">
            {rows.map((r) => {
              const isCurrent = r.pubkey === address;
              const pnl = r.summary?.unrealizedPnl ?? 0;
              return (
                <button
                  key={r.pubkey}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!isCurrent) router.push(`/whales/${r.pubkey}`);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[var(--bg-secondary-20)] transition-colors',
                    isCurrent && 'bg-[var(--bg-secondary-20)]/60'
                  )}
                >
                  {r.isMaster ? (
                    <Users className="w-4 h-4 text-bulk-green flex-shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'text-sm font-medium truncate',
                        isCurrent ? 'text-bulk-green' : 'text-[var(--text-primary)]'
                      )}>
                        {r.label}
                      </span>
                      {isCurrent && (
                        <span className="text-[9px] uppercase tracking-wider text-bulk-green/80 bg-bulk-green/10 px-1.5 py-0.5 rounded">
                          viewing
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-[var(--text-tertiary)] truncate mt-0.5">
                      {formatAddress(r.pubkey)}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                      {r.summary
                        ? `$${formatNumber(r.summary.totalBalance, 0)}`
                        : '—'}
                    </p>
                    <p
                      className={cn(
                        'text-[10px] tabular-nums',
                        pnl > 0
                          ? 'text-bulk-green'
                          : pnl < 0
                          ? 'text-bulk-red'
                          : 'text-[var(--text-tertiary)]'
                      )}
                    >
                      {r.summary
                        ? `${pnl >= 0 ? '+' : ''}$${formatCompact(Math.abs(pnl))} PnL`
                        : 'no data'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Aggregate footer — total balance / notional / pnl across the
              whole family. Useful for "how big is this whale really?" */}
          <div className="px-3 py-2.5 border-t border-[var(--border-color)] bg-[var(--bg-base)]/50 grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Total balance
              </p>
              <p className="font-semibold tabular-nums text-[var(--text-primary)]">
                ${formatCompact(totalBalance)}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Total notional
              </p>
              <p className="font-semibold tabular-nums text-[var(--text-primary)]">
                ${formatCompact(totalNotional)}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Total PnL
              </p>
              <p
                className={cn(
                  'font-semibold tabular-nums',
                  totalUnrealized > 0
                    ? 'text-bulk-green'
                    : totalUnrealized < 0
                    ? 'text-bulk-red'
                    : 'text-[var(--text-primary)]'
                )}
              >
                {totalUnrealized >= 0 ? '+' : ''}$
                {formatCompact(Math.abs(totalUnrealized))}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
