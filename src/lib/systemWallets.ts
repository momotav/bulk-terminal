// Mirror of backend's `systemWallets.ts`. Lists BULK exchange's
// operational accounts (liquidation engine, insurance fund, market-maker
// bots, treasury). The backend already filters these out of every
// leaderboard surface — this frontend copy exists so the wallet detail
// page can render a "Bulk System Account" badge when someone visits
// /whales/<system-address> directly.
//
// Keep this list in sync with backend/src/services/systemWallets.ts.
const SYSTEM_WALLETS = new Set<string>([
  '9J8TUdEWrrcADK913r1Cs7DdqX63VdVU88imfDzT1ypt',
]);

export function isSystemWallet(address: string | null | undefined): boolean {
  if (!address) return false;
  return SYSTEM_WALLETS.has(address);
}

// Heuristic: addresses starting with "BULK" are protocol-owned by
// convention. The oracle account `BULKksNNhqM2teCvh5oRh6GEqYsofp8xEzCqhT1a5g4D`
// is the canonical example — BULK uses vanity prefixes for its
// internal/operational accounts so they're recognizable at a glance.
//
// Separate from `isSystemWallet` because:
//  - `isSystemWallet` is an explicit allowlist for known system accounts
//    that get FILTERED OUT of leaderboards
//  - `isBulkPrefixedAccount` is a passive identification: shows a "BULK"
//    badge but doesn't necessarily mean we want to hide the account
//
// Use this in the explorer UI to label addresses (e.g. show "BULK"
// pill next to the truncated address in a tx list).
export function isBulkPrefixedAccount(address: string | null | undefined): boolean {
  if (!address) return false;
  return address.startsWith('BULK');
}
