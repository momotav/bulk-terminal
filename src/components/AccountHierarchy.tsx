'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Wallet, FolderOpen, Loader2, ArrowUp, Users } from 'lucide-react';
import { formatNumber, formatAddress } from '@/lib/api';

// ---------------------------------------------------------------------------
// AccountHierarchy
//
// Renders the new BULK v1.0.14 account hierarchy on the wallet detail page.
// For any address, the BULK `/account` endpoint with type=fullAccount returns:
//
//   - kind: "MasterEOA" | "SubAccount"
//   - parent: <pubkey>            (only on sub-accounts)
//   - subAccounts: [{pubkey, name?}]  (only on masters with children)
//   - margin: { totalBalance, marginUsed, notional, unrealizedPnl, ... }
//   - positions: [...]
//   - feeTiers, leverageSettings, authorizedAgentWallets ...
//
// We fetch BULK directly (no backend involvement) for two reasons:
// 1. The data is publicly readable and changes infrequently — backend caching
//    would just add latency for the first iteration.
// 2. Lets us ship hierarchy detection without coordinating a backend deploy.
// Phase 2 of this work moves the resolver to the backend with proper caching
// once we know the UX is right.
//
// Behavior depends on which kind of address the user is viewing:
//
//   MasterEOA with sub-accounts:
//     Show a card listing the master + each sub-account with per-account
//     balance and notional. Clicking a sub-account navigates to its own
//     /whales/[pubkey] page.
//
//   MasterEOA with NO sub-accounts:
//     We still render nothing (empty card would be noise). Could add an
//     "Eligible for sub-accounts" hint later, but most masters fit here so
//     a quiet absence is fine.
//
//   SubAccount:
//     Show a small banner with an "↑ View master account" link back up the
//     tree. Helps users understand they're looking at one slice of someone's
//     bigger portfolio.
// ---------------------------------------------------------------------------

const BULK_API = 'https://exchange-api.bulk.trade/api/v1';

interface BulkMargin {
  totalBalance: number;
  availableBalance: number;
  marginUsed: number;
  notional: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  funding: number;
}

interface BulkSubAccountRef {
  pubkey: string;
  name?: string;
}

interface BulkFullAccount {
  kind: 'MasterEOA' | 'SubAccount';
  parent?: string;
  subAccounts?: BulkSubAccountRef[];
  multisigAccounts?: string[];
  authorizedAgentWallets?: string[];
  margin: BulkMargin;
  positions: { symbol: string; notional: number; unrealizedPnl: number }[];
  openOrders: unknown[];
}

// BULK returns POST /account responses as `[{ "fullAccount": {...} }]` —
// an array of single-key wrappers. Unwrap to the inner object.
async function fetchFullAccount(address: string): Promise<BulkFullAccount | null> {
  try {
    const res = await fetch(`${BULK_API}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fullAccount', user: address }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<Record<string, BulkFullAccount>>;
    return json?.[0]?.fullAccount ?? null;
  } catch {
    return null;
  }
}

// Display row used for both master and sub-account lines.
interface AccountRow {
  pubkey: string;
  label: string;          // "Master account" or sub-account name
  isMaster: boolean;
  isCurrent: boolean;     // is this the address the user is currently viewing
  loading: boolean;
  totalBalance?: number;
  notional?: number;
  unrealizedPnl?: number;
  positionsCount?: number;
}

export function AccountHierarchy({ address }: { address: string }) {
  const [self, setSelf] = useState<BulkFullAccount | null>(null);
  const [selfLoading, setSelfLoading] = useState(true);

  // For masters: fetch each sub-account's fullAccount in parallel so the table
  // shows real balances per sub-account, not just names.
  const [subAccountData, setSubAccountData] = useState<Map<string, BulkFullAccount>>(new Map());
  const [subsLoading, setSubsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelfLoading(true);
    setSelf(null);
    setSubAccountData(new Map());

    fetchFullAccount(address).then((data) => {
      if (cancelled) return;
      setSelf(data);
      setSelfLoading(false);

      // If this is a master with sub-accounts, kick off parallel fetches
      // for each child. Each call is independent so we render rows
      // progressively rather than waiting for all to finish.
      if (data?.kind === 'MasterEOA' && data.subAccounts && data.subAccounts.length > 0) {
        setSubsLoading(true);
        Promise.all(
          data.subAccounts.map(async (sa) => {
            const subData = await fetchFullAccount(sa.pubkey);
            return [sa.pubkey, subData] as const;
          })
        ).then((entries) => {
          if (cancelled) return;
          const next = new Map<string, BulkFullAccount>();
          for (const [pk, sub] of entries) {
            if (sub) next.set(pk, sub);
          }
          setSubAccountData(next);
          setSubsLoading(false);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Normalize master + each sub into a flat list for rendering. Computed via
  // useMemo so we don't rebuild on unrelated state changes.
  const rows: AccountRow[] = useMemo(() => {
    if (!self) return [];
    if (self.kind !== 'MasterEOA') return [];

    const masterRow: AccountRow = {
      pubkey: address,
      label: 'Master account',
      isMaster: true,
      isCurrent: true,
      loading: false,
      totalBalance: self.margin.totalBalance,
      notional: self.margin.notional,
      unrealizedPnl: self.margin.unrealizedPnl,
      positionsCount: self.positions.length,
    };

    const subRows: AccountRow[] = (self.subAccounts || []).map((sa) => {
      const data = subAccountData.get(sa.pubkey);
      return {
        pubkey: sa.pubkey,
        label: sa.name || 'Unnamed sub-account',
        isMaster: false,
        isCurrent: false,
        loading: !data && subsLoading,
        totalBalance: data?.margin.totalBalance,
        notional: data?.margin.notional,
        unrealizedPnl: data?.margin.unrealizedPnl,
        positionsCount: data?.positions.length,
      };
    });

    return [masterRow, ...subRows];
  }, [self, subAccountData, subsLoading, address]);

  // Aggregate "Total" row across master + all sub-accounts. Only useful when
  // there's at least one sub-account; for solo masters this row would just
  // duplicate the master row.
  const totals = useMemo(() => {
    if (rows.length <= 1) return null;
    let totalBalance = 0;
    let totalNotional = 0;
    let totalUnrealized = 0;
    let totalPositions = 0;
    let anyMissing = false;
    for (const r of rows) {
      if (r.totalBalance === undefined || r.notional === undefined) {
        anyMissing = true;
        continue;
      }
      totalBalance += r.totalBalance;
      totalNotional += r.notional;
      totalUnrealized += r.unrealizedPnl ?? 0;
      totalPositions += r.positionsCount ?? 0;
    }
    return { totalBalance, totalNotional, totalUnrealized, totalPositions, anyMissing };
  }, [rows]);

  // ----- Loading state -----------------------------------------------------
  if (selfLoading) {
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
  if (self?.kind === 'SubAccount' && self.parent) {
    return (
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <FolderOpen className="w-4 h-4 text-bulk-green" />
            <span className="text-[var(--text-secondary)]">This is a sub-account.</span>
          </div>
          <Link
            href={`/whales/${self.parent}`}
            className="flex items-center gap-1.5 text-sm text-bulk-green hover:underline"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            View master account
            <span className="font-mono text-xs text-[var(--text-tertiary)]">
              ({formatAddress(self.parent)})
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // ----- Master view: render only when there's at least one sub-account ----
  // A master with zero sub-accounts has nothing meaningful to show in this
  // section, so we render null and let the rest of the page take the space.
  if (self?.kind === 'MasterEOA' && rows.length > 1) {
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
          {totals && (
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-[var(--bg-base)]/40 text-sm">
              <div className="col-span-4 font-medium text-[var(--text-primary)]">
                Total across all accounts
                {totals.anyMissing && (
                  <span className="ml-2 text-xs text-[var(--text-tertiary)]">(partial)</span>
                )}
              </div>
              <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
                ${formatNumber(totals.totalBalance, 2)}
              </div>
              <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
                ${formatNumber(totals.totalNotional, 0)}
              </div>
              <div
                className={
                  'col-span-2 text-right font-mono ' +
                  (totals.totalUnrealized >= 0 ? 'text-bulk-green' : 'text-red-400')
                }
              >
                {totals.totalUnrealized >= 0 ? '+' : ''}${formatNumber(totals.totalUnrealized, 2)}
              </div>
              <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
                {totals.totalPositions}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Master with no sub-accounts (or BULK call failed) — render nothing.
  return null;
}

// Single account row. Pulled into its own component so the parent's render
// stays scannable. The "current" row gets a subtle accent so users know
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

      {row.loading ? (
        <div className="col-span-8 flex items-center justify-end text-[var(--text-tertiary)] text-xs">
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
          loading…
        </div>
      ) : (
        <>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            {row.totalBalance !== undefined ? `$${formatNumber(row.totalBalance, 2)}` : '—'}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
            {row.notional !== undefined ? `$${formatNumber(row.notional, 0)}` : '—'}
          </div>
          <div
            className={
              'col-span-2 text-right font-mono ' +
              (row.unrealizedPnl === undefined
                ? 'text-[var(--text-tertiary)]'
                : row.unrealizedPnl >= 0
                ? 'text-bulk-green'
                : 'text-red-400')
            }
          >
            {row.unrealizedPnl !== undefined
              ? `${row.unrealizedPnl >= 0 ? '+' : ''}$${formatNumber(row.unrealizedPnl, 2)}`
              : '—'}
          </div>
          <div className="col-span-2 text-right font-mono text-[var(--text-primary)]">
            {row.positionsCount ?? '—'}
          </div>
        </>
      )}
    </div>
  );

  // The current row is not clickable (no point linking to itself). Other rows
  // navigate to their own /whales/[pubkey] page when clicked.
  if (row.isCurrent) return inner;
  return (
    <Link href={`/whales/${row.pubkey}`} className="block">
      {inner}
    </Link>
  );
}
