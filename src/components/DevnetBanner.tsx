'use client';

// Thin amber banner that appears at the top of every page when the
// user is viewing the Devnet (non-testnet) network. Reminds them
// constantly that they're looking at devnet data — without it,
// screenshots of devnet would be indistinguishable from the public
// testnet and people would get confused (the exact problem the dev
// flagged: "Staging is already confusing the retards").
//
// Empty render on testnet so it disappears for normal use.

import { AlertTriangle } from 'lucide-react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { NETWORK_LABELS } from '@/lib/network';

export function DevnetBanner() {
  const { network, setNetwork } = useCurrentNetwork();

  if (network === 'testnet') return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-300">
      <div className="responsive-container py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            <span className="font-semibold">{NETWORK_LABELS[network]} mode.</span>{' '}
            Live data only - historical charts and leaderboards may be empty.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setNetwork('testnet')}
          className="text-amber-300 hover:text-amber-200 underline underline-offset-2 font-medium whitespace-nowrap"
        >
          Switch to Paper Trading Testnet
        </button>
      </div>
    </div>
  );
}
