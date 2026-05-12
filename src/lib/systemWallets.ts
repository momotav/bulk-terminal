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
