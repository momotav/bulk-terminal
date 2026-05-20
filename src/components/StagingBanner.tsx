'use client';

// Thin amber banner that appears at the top of every page when the
// user is viewing a non-mainnet network. Reminds them constantly
// that they're looking at staging data — without it, screenshots of
// staging would be indistinguishable from mainnet and people would
// get confused (which is exactly the problem the dev described).
//
// Empty render on mainnet so it disappears for normal use.

import { AlertTriangle } from 'lucide-react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { NETWORK_LABELS } from '@/lib/network';

export function StagingBanner() {
  const { network, setNetwork } = useCurrentNetwork();

  if (network === 'mainnet') return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            <span className="font-semibold">{NETWORK_LABELS[network]} mode.</span>{' '}
            Live data only — historical charts and leaderboards may be empty.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setNetwork('mainnet')}
          className="text-amber-300 hover:text-amber-200 underline underline-offset-2 font-medium whitespace-nowrap"
        >
          Switch to Mainnet
        </button>
      </div>
    </div>
  );
}
