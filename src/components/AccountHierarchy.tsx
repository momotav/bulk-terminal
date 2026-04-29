'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wallet, FolderOpen, Loader2, ArrowUp, Users } from 'lucide-react';
import { wallet, formatNumber, formatAddress, type HierarchyResponse, type HierarchySummary } from '@/lib/api';

// ---------------------------------------------------------------------------
// AccountHierarchy
//
// Renders BULK v1.0.14 account hierarchy on the wallet detail page.
//
// Single backend round-trip: GET /api/wallet/:address/hierarchy returns the
// kind (Master/Sub/Multisig/Unknown), parent and sub-account references,
// PLUS a per-pubkey financial summary so we can populate the table without
// making N separate calls for each sub-account.
//
// Backend resolver caches hierarchy 24h (it changes rarely — protocol-level
// state) and per-account summaries 60s (these drift continuously with mark
// price). On the frontend we just consume the unified shape.
//
// Behavior depends on which kind of address the user is viewing:
//
//   MasterEOA with sub-accounts:
//     Show a card listing the master + each sub-account with per-account
//     balance, notional, unrealized PnL, position count, plus an aggregate
//     "total" row. Clicking a sub-account navigates to its own /whales/
//     [pubkey] page.
//
//   MasterEOA with NO sub-accounts:
//     Render nothing — an empty hierarchy table would be visual noise.
//
//   SubAccount:
//     Show a small banner with an "↑ View master account" link. Helps users
//     understand they're looking at one slice of someone's bigger portfolio.
// ---------------------------------------------------------------------------

interface AccountRow {
  pubkey: string;
  label: string;             // "Master account" or sub-account name
  isMaster: boolean;
  isCurrent: boolean;        // is this the address the user is currently viewing
  summary?: HierarchySummary;
}

export function AccountHierarchy({ address }: { address: string }) {
  const [data, setData] = useState<HierarchyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Single fetch, single setState. Much simpler than the previous version
  // that orchestrated N parallel BULK requests in the browser.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    wallet
      .getHierarchy(address)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        // Backend errors here aren't user-facing — the wallet page works
        // fine without the hierarchy section. Log and move on.
        console.warn('[AccountHierarchy] hierarchy fetch failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // ----- Loading state -----------------------------------------------------
  if (loading) {
    return (
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 text-[var(--text-tertiary)] text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading account hierarchy…</span>
        </div>
      </div>
    );
  }

  // ----- Sub-account view: small banner pointing back to master ------------
  if (data?.kind === 'SubAccount' && data.parent) {
    return (
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <FolderOpen className="w-4 h-4 text-bulk-green" />
            <span className="text-[var(--text-secondary)]">This is a sub-account.</span>
          </div>
          <Link
            href={`/whales/${data.parent}`}
            className="flex items-center gap-1.5 text-sm text-bulk-green hover:underline"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            View master account
            <span className="font-mono text-xs text-[var(--text-tertiary)]">
              ({formatAddress(data.parent)})
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // ----- Master view: only render when there's at least one sub-account ----
  if (data?.kind !== 'MasterEOA' || data.subAccounts.length === 0) {
    // A master with no sub-accounts has nothing meaningful to show.
    return null;
  }

  // Build the list of rows: master first, then each sub-account.
  const rows: AccountRow[] = [
    {
      pubkey: address,
      label: 'Master account',
      isMaster: true,
      isCurrent: true,
      summary: data.summaries[address],
    },
    ...data.subAccounts.map((sa) => ({
      pubkey: sa.pubkey,
      label: sa.name || 'Unnamed sub-account',
      isMaster: false,
      isCurrent: false,
      summary: data.summaries[sa.pubkey],
    })),
  ];

  // Aggregate "Total" row across master + all sub-accounts. anyMissing flags
  // partial sums when one or more summaries didn't come back from BULK.
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

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg mb-6 overflow-hidden">
      <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-bulk-green" />
          Account hierarchy
          <span className="text-xs text-[var(--text-tertiary)] font-normal">
            {rows.length - 1} sub-account{rows.length - 1 === 1 ? '' : 's'}
          </span>
        </h2>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-color)]/50">
        <div className="col-span-4">Account</div>
        <div className="col-span-2 text-right">Balance</div>
        <div className="col-span-2 text-right">Notional</div>
        <div className="col-span-2 text-right">Unrealized PnL</div>
        <div className="col-span-2 text-right">Positions</div>
      </div>

      {/* Account rows */}
      <div className="divide-y divide-[var(--border-color)]/40">
        {rows.map((row) => (
          <AccountRowView key={row.pubkey} row={row} />
        ))}

        {/* Aggregate totals */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-[var(--bg-base)]/40 text-sm">
          <div className="col-span-4 font-medium text-[var(--text-primary)]">
            Total across all accounts
            {anyMissing && (
              <span className="ml-2 text-xs text-[var(--text-tertiary)]">(partial)</span>
            )}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            ${formatNumber(totalBalance, 2)}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            ${formatNumber(totalNotional, 0)}
          </div>
          <div
            className={
              'col-span-2 text-right font-mono ' +
              (totalUnrealized >= 0 ? 'text-bulk-green' : 'text-red-400')
            }
          >
            {totalUnrealized >= 0 ? '+' : ''}${formatNumber(totalUnrealized, 2)}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            {totalPositions}
          </div>
        </div>
      </div>
    </div>
  );
}

// Single account row — kept as its own component so the parent's render
// stays readable. The "current" row gets a subtle accent so users know
// which line corresponds to the page they're already on.
function AccountRowView({ row }: { row: AccountRow }) {
  const inner = (
    <div
      className={
        'grid grid-cols-12 gap-2 px-4 py-3 text-sm items-center ' +
        (row.isCurrent
          ? 'bg-bulk-green/10'
          : 'hover:bg-[var(--bg-secondary-20)]/30 transition-colors')
      }
    >
      <div className="col-span-4 flex items-center gap-2 min-w-0">
        {row.isMaster ? (
          <Wallet className="w-4 h-4 text-bulk-green flex-shrink-0" />
        ) : (
          <FolderOpen className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-[var(--text-primary)] truncate">{row.label}</div>
          <div className="font-mono text-xs text-[var(--text-tertiary)] truncate">
            {formatAddress(row.pubkey)}
          </div>
        </div>
      </div>

      {row.summary ? (
        <>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            ${formatNumber(row.summary.totalBalance, 2)}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
            ${formatNumber(row.summary.notional, 0)}
          </div>
          <div
            className={
              'col-span-2 text-right font-mono ' +
              (row.summary.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-red-400')
            }
          >
            {row.summary.unrealizedPnl >= 0 ? '+' : ''}$
            {formatNumber(row.summary.unrealizedPnl, 2)}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            {row.summary.positionsCount}
          </div>
        </>
      ) : (
        <div className="col-span-8 text-right text-xs text-[var(--text-tertiary)]">—</div>
      )}
    </div>
  );

  // The current row is not clickable (would link to itself).
  if (row.isCurrent) return inner;
  return (
    <Link href={`/whales/${row.pubkey}`} className="block">
      {inner}
    </Link>
  );
}
