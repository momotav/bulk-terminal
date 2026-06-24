'use client';

// Network switcher dropdown for the page header.
//
// Renders as a compact pill showing the current network with a chevron;
// clicking opens a small menu with Paper Trading Testnet / Devnet.
// Selecting a network updates localStorage + URL and triggers a
// page-wide re-render via the `bulkstats:network-changed` event.
//
// Visual style: matches the dark/light toggle and user menu nearby,
// so this fits the header rhythm rather than dominating it.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { NETWORK_LABELS, type NetworkId } from '@/lib/network';

// Visual treatment per network. Testnet (the default everyone uses)
// stays neutral so it doesn't scream; devnet gets an amber accent
// because users SHOULD notice they're not on the public testnet.
// they're not on the production network.
const TONE: Record<NetworkId, { dot: string; text: string }> = {
  testnet: { dot: 'bg-bulk-green', text: 'text-[var(--text-primary)]' },
  devnet: { dot: 'bg-amber-400', text: 'text-amber-400' },
};

export function NetworkSwitcher() {
  const { network, setNetwork } = useCurrentNetwork();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const tone = TONE[network];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] hover:bg-[var(--bg-secondary-20)] transition-colors"
        title={`Network: ${NETWORK_LABELS[network]}`}
      >
        <Globe className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <span className={`text-xs font-medium ${tone.text}`}>
          {NETWORK_LABELS[network]}
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)]" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-md shadow-lg overflow-hidden z-50">
          {(Object.keys(NETWORK_LABELS) as NetworkId[]).map((id) => {
            const optionTone = TONE[id];
            const selected = id === network;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setNetwork(id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  selected
                    ? 'bg-[var(--bg-secondary-20)]'
                    : 'hover:bg-[var(--bg-secondary-20)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${optionTone.dot}`} />
                  <span className={optionTone.text}>{NETWORK_LABELS[id]}</span>
                </span>
                {selected && (
                  <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                    Active
                  </span>
                )}
              </button>
            );
          })}
          <div className="px-3 py-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-tertiary)] leading-relaxed">
            Devnet shows live data from BULK's internal dev network.
            Historical data on charts/leaderboards may not be available.
          </div>
        </div>
      )}
    </div>
  );
}
