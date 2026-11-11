'use client';

import { useEffect, useState } from 'react';
import { wallet, type HierarchyResponse, type HierarchySummary } from '@/lib/api';

// A master wallet and its sub-accounts, resolved the same way whichever member
// you start from: a sub-account looks up its master and takes the master's view,
// so every page in the family sees the same list, names and summaries.

export interface FamilyAccount {
  pubkey: string;
  name: string;
  isMaster: boolean;
  summary?: HierarchySummary;
}

export interface AccountFamily {
  master: string;
  accounts: FamilyAccount[];
  /** Some accounts came back without a summary (BULK hiccup), so totals are low. */
  partial: boolean;
}

export interface FamilyTotals {
  balance: number;
  value: number;
  realized: number;
  unrealized: number;
  pnl: number;
  notional: number;
  positions: number;
}

const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<HierarchyResponse | null> }>();

function hierarchy(address: string): Promise<HierarchyResponse | null> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await wallet.getHierarchy(address); } catch { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); }
    }
    cache.delete(address);
    return null;
  })();
  cache.set(address, { at: Date.now(), p });
  return p;
}

export const accountValue = (s?: HierarchySummary) => (s ? s.totalBalance + s.unrealizedPnl : 0);

export function familyTotals(accounts: FamilyAccount[]): FamilyTotals {
  const t: FamilyTotals = { balance: 0, value: 0, realized: 0, unrealized: 0, pnl: 0, notional: 0, positions: 0 };
  for (const a of accounts) {
    const s = a.summary;
    if (!s) continue;
    t.balance += s.totalBalance;
    t.value += accountValue(s);
    t.realized += s.realizedPnl;
    t.unrealized += s.unrealizedPnl;
    t.notional += Math.abs(s.notional);
    t.positions += s.positionsCount;
  }
  t.pnl = t.realized + t.unrealized;
  return t;
}

export function useAccountFamily(address: string) {
  const [state, setState] = useState<{ loading: boolean; kind: HierarchyResponse['kind'] | null; family: AccountFamily | null }>({ loading: true, kind: null, family: null });

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setState({ loading: true, kind: null, family: null });
    (async () => {
      const own = await hierarchy(address);
      if (cancelled) return;
      if (!own) { setState({ loading: false, kind: null, family: null }); return; }
      const top = own.kind === 'SubAccount' && own.parent ? await hierarchy(own.parent) : own;
      if (cancelled) return;
      if (!top || top.kind !== 'MasterEOA' || top.subAccounts.length === 0) {
        setState({ loading: false, kind: own.kind, family: null });
        return;
      }
      const accounts: FamilyAccount[] = [
        { pubkey: top.address, name: 'Master', isMaster: true, summary: top.summaries[top.address] },
        ...top.subAccounts.map((s, i) => ({
          pubkey: s.pubkey,
          name: s.name?.trim() || `Sub-account ${i + 1}`,
          isMaster: false,
          summary: top.summaries[s.pubkey],
        })),
      ];
      setState({ loading: false, kind: own.kind, family: { master: top.address, accounts, partial: accounts.some((a) => !a.summary) } });
    })();
    return () => { cancelled = true; };
  }, [address]);

  return state;
}
