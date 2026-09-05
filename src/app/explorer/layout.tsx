'use client';

// The Explorer section renders BULK CHAIN data (blocks, transactions, rounds,
// throughput). BULK isn't running a mainnet explorer WS for mainnet's first
// ~30 days (the load is too high), and the old node streams the TESTNET chain —
// which must not be shown on the mainnet site. So on mainnet we render a
// "coming soon" placeholder for the whole section instead of the child pages.
// Non-mainnet (?net=…) still renders the real explorer for debugging.
//
// A layout (not per-page checks) covers /explorer, /explorer/block/[hash] and
// /explorer/tx/[hash] in one place, and their data-fetching effects never run
// because the child pages aren't mounted on mainnet.

import { Timer } from 'lucide-react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  const { network } = useCurrentNetwork();

  if (network === 'mainnet') {
    return (
      <div className="w-full p-4 md:p-6">
        <div className="mb-4 flex items-center gap-3 md:mb-6">
          <h1 className="page-title text-[var(--text-primary)]">Explorer</h1>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: 'var(--accent)' }}
            title="Coming soon"
          />
        </div>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--role-surface)] px-6 py-20 text-center">
          <Timer className="h-8 w-8 text-[var(--text-tertiary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Chain explorer is coming soon</h2>
          <p className="max-w-md text-sm text-[var(--text-secondary)]">
            Blocks, transactions and live chain activity will appear here once BULK&apos;s mainnet
            explorer goes live — expected within mainnet&apos;s first ~30 days. Market analytics —
            volume, open interest, liquidations and fees — are live now.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
