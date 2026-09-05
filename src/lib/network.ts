// Frontend network state.
//
// Tracks which BULK network the user is currently viewing — the
// Paper Trading Testnet (the public testnet where the trading comp
// runs, the default) or Devnet (the dev's internal environment for
// testing new features). The choice is persisted in localStorage and
// overridable via URL query param `?net=devnet` for shareable deep
// links.
//
// Every API call from the frontend appends `?net=<current>` so the
// backend can route to the right BULK upstream. This keeps the
// frontend dumb — it doesn't need to know URLs, just the selected
// network ID.
//
// Three "publication" mechanisms:
//
//   1. localStorage key 'bulkstats:network' — persists across reloads
//      and tabs
//   2. URL `?net=` query — takes precedence over localStorage on a
//      given page load (lets you share a link to "see this page on
//      devnet" without changing the recipient's default)
//   3. window event 'bulkstats:network-changed' — fired when the user
//      picks a new network from the switcher. Components subscribe
//      to re-render or refetch when network changes.
//
// A "use" hook would normally manage this in React, but here we keep
// it framework-agnostic so it can be read from `lib/api.ts` too
// (which doesn't have access to hooks). React components use the
// `useCurrentNetwork()` hook in `hooks/useCurrentNetwork.ts`.

export type NetworkId = 'mainnet' | 'testnet' | 'devnet';

// BULK is live on mainnet (v1.0.19). Mainnet is the default and the network the
// site tracks; testnet (the old Paper Trading competition) stays reachable via
// ?net=testnet for debugging but is no longer surfaced in the UI.
export const DEFAULT_NETWORK: NetworkId = 'mainnet';

// v2: bumped for the mainnet cutover so anyone with an old stored 'testnet'
// value starts fresh on the new mainnet default instead of sticking on testnet.
const LS_KEY = 'bulkstats:network:v2';
const CHANGE_EVENT = 'bulkstats:network-changed';

export const NETWORK_LABELS: Record<NetworkId, string> = {
  mainnet: 'Mainnet',
  testnet: 'Paper Trading Testnet',
  devnet: 'Devnet',
};

function isValidNetwork(s: unknown): s is NetworkId {
  return s === 'mainnet' || s === 'testnet' || s === 'devnet';
}

// Returns the active network. Checks URL param first, then
// localStorage, then defaults to testnet. Safe to call during SSR
// (returns default when window is unavailable).
export function getCurrentNetwork(): NetworkId {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;

  // URL param wins. Useful for shared links.
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('net');
    if (isValidNetwork(fromUrl)) return fromUrl;
  } catch {
    // URL parsing failed — fall through.
  }

  // Persisted choice.
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (isValidNetwork(stored)) return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through.
  }

  return DEFAULT_NETWORK;
}

// Set the active network. Updates localStorage and broadcasts a
// change event so all listening components re-render/refetch.
// Optionally also updates the URL bar (without a navigation) to
// reflect the new state — handy for keeping shared links in sync.
export function setCurrentNetwork(net: NetworkId, opts?: { updateUrl?: boolean }): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LS_KEY, net);
  } catch {
    // ignore
  }

  if (opts?.updateUrl) {
    try {
      const url = new URL(window.location.href);
      if (net === DEFAULT_NETWORK) {
        url.searchParams.delete('net');
      } else {
        url.searchParams.set('net', net);
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  }

  // Broadcast so all consumers refetch with the new network.
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: net }));
  } catch {
    // ignore
  }
}

// Subscribe to network changes. Returns an unsubscribe function.
// Used by the React hook and by lib/api.ts's listeners.
export function onNetworkChange(handler: (net: NetworkId) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (isValidNetwork(detail)) handler(detail);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

// Returns the query-string fragment for the active network, ready to
// append to a URL. Returns empty string when on testnet to keep URLs
// clean (default doesn't need to be explicit in the URL).
//
// Example:
//   fetch(`/api/analytics/foo${netQueryString()}`)
//   → "/api/analytics/foo?net=devnet" on devnet
//   → "/api/analytics/foo" on testnet
export function netQueryString(separator: '?' | '&' = '?'): string {
  const net = getCurrentNetwork();
  if (net === DEFAULT_NETWORK) return '';
  return `${separator}net=${net}`;
}

// Appends the network query param to a URL, handling the case where
// the URL already has query params (uses & instead of ?). Mainnet
// returns the URL unchanged.
export function withNetwork(url: string): string {
  const net = getCurrentNetwork();
  if (net === DEFAULT_NETWORK) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}net=${net}`;
}
