'use client';

// React hook for components that need to read or react to the
// active BULK network. Returns the current value and a setter.
//
// Use in components that should re-render when the user switches
// networks — e.g. the dropdown badge, the staging banner, anything
// that displays network-dependent state.
//
// For pure API calls (lib/api.ts), use `getCurrentNetwork()` from
// `lib/network.ts` directly — no hook needed there.

import { useEffect, useState, useCallback } from 'react';
import {
  getCurrentNetwork,
  setCurrentNetwork,
  onNetworkChange,
  DEFAULT_NETWORK,
  type NetworkId,
} from '@/lib/network';

export function useCurrentNetwork(): {
  network: NetworkId;
  setNetwork: (net: NetworkId) => void;
} {
  // SSR-safe initial value. The real value is hydrated on mount via
  // the effect below — we can't read localStorage during SSR. This
  // means the very first paint shows mainnet even if the user's
  // saved choice is staging; the switch happens within ~1 frame.
  const [network, setNetworkState] = useState<NetworkId>(DEFAULT_NETWORK);

  useEffect(() => {
    // Sync on mount (post-hydration).
    setNetworkState(getCurrentNetwork());

    // Listen for changes from elsewhere (the dropdown, etc.).
    const unsubscribe = onNetworkChange((net) => {
      setNetworkState(net);
    });
    return unsubscribe;
  }, []);

  const setNetwork = useCallback((net: NetworkId) => {
    setCurrentNetwork(net, { updateUrl: true });
    // State update happens via the onNetworkChange listener above —
    // single source of truth.
  }, []);

  return { network, setNetwork };
}
