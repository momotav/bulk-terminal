'use client';

import { useEffect, useState } from 'react';
import { wallet, type ActivityEvent, type ClosedPosition, type WalletData, type WalletFunding } from '@/lib/api';
import { buildPnlCurve, type PnlCurve, type WalletFillLite } from '@/lib/walletMetrics';
import type { AccountFamily } from '@/lib/accountFamily';

// The whole wallet page for a master and its sub-accounts at once. Each account
// is loaded exactly as a single wallet would be, then combined:
//  - money (balances, realized, unrealized, fees, funding) adds up;
//  - positions, closed trades, fills, funding payments and transfers are pooled,
//    each tagged with the account it came from so per-position maths stays inside
//    its own account (see bookKey);
//  - the PnL curve is the sum of every account's own curve, so the family chart
//    ends exactly on the summed live figure.

export interface FamilyMember {
  pubkey: string;
  data: WalletData;
  closed: ClosedPosition[];
  fills: WalletFillLite[];
  funding: WalletFunding | null;
  curve: PnlCurve;
}

export interface FamilyView {
  data: WalletData;
  closed: ClosedPosition[];
  fills: WalletFillLite[];
  funding: WalletFunding | null;
  curve: PnlCurve;
  members: FamilyMember[];
}

type Pos = NonNullable<WalletData['live']>['positions'][number];
export type FamilyPosition = Pos & { account?: string };

const retry = async <T,>(load: () => Promise<T>, cancelled: () => boolean, tries = 5): Promise<T | null> => {
  for (let attempt = 0; attempt < tries && !cancelled(); attempt++) {
    try { return await load(); } catch { await new Promise((r) => setTimeout(r, Math.min(3000, 700 * (attempt + 1)))); }
  }
  return null;
};

async function loadMember(pubkey: string, cancelled: () => boolean): Promise<FamilyMember | null> {
  const data = await retry(() => wallet.getWallet(pubkey), cancelled);
  if (!data || cancelled()) return null;
  const [closedRes, fillsRes, funding] = await Promise.all([
    retry(() => wallet.getClosedPositions(pubkey, { limit: 10000 }), cancelled),
    retry(() => wallet.getFills(pubkey, { limit: 40000, lite: true }), cancelled),
    retry(() => wallet.getFunding(pubkey), cancelled),
  ]);
  const m = data.live?.margin;
  const curve = buildPnlCurve({
    snapshots: data.snapshots ?? [], history: data.history ?? [],
    realizedNow: m?.realizedPnl ?? null, unrealizedNow: m?.unrealizedPnl ?? null, now: Date.now(),
  });
  return {
    pubkey,
    data,
    closed: (closedRes?.positions ?? []).map((c) => ({ ...c, account: pubkey })),
    fills: ((fillsRes?.fills ?? []) as WalletFillLite[]).map((f) => ({ ...f, account: pubkey })),
    funding,
    curve,
  };
}

/** Sum of several step curves on the union of their times. Before an account's
 *  first point it holds its starting value (zero when it starts from zero). */
export function sumCurves(curves: PnlCurve[]): PnlCurve {
  const live = curves.filter((c) => c.points.length > 0);
  if (live.length === 0) return { points: [], realizedOnlyUntil: null, startsFromZero: true };
  if (live.length === 1) return live[0];
  const times = Array.from(new Set(live.flatMap((c) => c.points.map((p) => p.t)))).sort((a, b) => a - b);
  const idx = live.map(() => -1);
  const points = times.map((t) => {
    let v = 0;
    live.forEach((c, i) => {
      while (idx[i] + 1 < c.points.length && c.points[idx[i] + 1].t <= t) idx[i]++;
      v += idx[i] >= 0 ? c.points[idx[i]].v : c.startsFromZero ? 0 : c.points[0].v;
    });
    return { t, v };
  });
  const gaps = live.map((c) => c.realizedOnlyUntil).filter((x): x is number => x !== null);
  return { points, realizedOnlyUntil: gaps.length ? Math.max(...gaps) : null, startsFromZero: live.every((c) => c.startsFromZero) };
}

function mergeFunding(list: (WalletFunding | null)[]): WalletFunding | null {
  const got = list.filter((f): f is WalletFunding => !!f);
  if (got.length === 0) return null;
  const bySymbol: Record<string, number> = {};
  for (const f of got) for (const [k, v] of Object.entries(f.bySymbol)) bySymbol[k] = (bySymbol[k] ?? 0) + v;
  return {
    // Incomplete if any account was missing: count stays above recent, which the
    // page already reads as "the payment list is cut".
    count: got.reduce((s, f) => s + f.count, 0) + (got.length < list.length ? 1 : 0),
    paid: got.reduce((s, f) => s + f.paid, 0),
    received: got.reduce((s, f) => s + f.received, 0),
    net: got.reduce((s, f) => s + f.net, 0),
    bySymbol,
    recent: got.flatMap((f) => f.recent).sort((a, b) => b.timestamp - a.timestamp),
  };
}

export function mergeFamily(members: FamilyMember[], masterPubkey: string): FamilyView {
  const master = members.find((m) => m.pubkey === masterPubkey) ?? members[0];
  const lives = members.map((m) => m.data.live).filter((l): l is NonNullable<WalletData['live']> => !!l);
  const sum = (k: keyof NonNullable<WalletData['live']>['margin']) => lives.reduce((s, l) => s + (Number(l.margin?.[k]) || 0), 0);
  const positions: FamilyPosition[] = members.flatMap((m) => (m.data.live?.positions ?? []).map((p) => ({ ...p, account: m.pubkey })));
  const masterTier = master.data.live?.feeTiers?.find((t) => t.symbol === 'global') ?? master.data.live?.feeTiers?.[0];
  const data: WalletData = {
    ...master.data,
    live: lives.length ? {
      ...master.data.live!,
      margin: {
        ...master.data.live!.margin,
        totalBalance: sum('totalBalance'),
        availableBalance: sum('availableBalance'),
        marginUsed: sum('marginUsed'),
        realizedPnl: sum('realizedPnl'),
        unrealizedPnl: sum('unrealizedPnl'),
        fees: sum('fees'),
        funding: sum('funding'),
      },
      positions,
      openOrders: members.flatMap((m) => m.data.live?.openOrders ?? []),
      // BULK's fee tier is shared by the master and its subs: every account reports the
      // same family-wide rolling volume, so it is taken once, never summed.
      feeTiers: masterTier ? [masterTier] : master.data.live!.feeTiers,
    } : master.data.live,
    markPrices: Object.assign({}, ...members.map((m) => m.data.markPrices ?? {})),
    tracked: master.data.tracked ? {
      ...master.data.tracked,
      total_pnl: members.reduce((s, m) => s + Number(m.data.tracked?.total_pnl ?? 0), 0),
      total_volume: members.reduce((s, m) => s + Number(m.data.tracked?.total_volume ?? 0), 0),
      total_trades: members.reduce((s, m) => s + Number(m.data.tracked?.total_trades ?? 0), 0),
      total_liquidations: members.reduce((s, m) => s + Number(m.data.tracked?.total_liquidations ?? 0), 0),
    } : master.data.tracked,
  };
  return {
    data,
    closed: members.flatMap((m) => m.closed).sort((a, b) => (Number(b.closedAt) || 0) - (Number(a.closedAt) || 0)),
    fills: members.flatMap((m) => m.fills).sort((a, b) => b.timestamp - a.timestamp),
    funding: mergeFunding(members.map((m) => m.funding)),
    curve: sumCurves(members.map((m) => m.curve)),
    members,
  };
}

/** Transfers for every account in the family, newest first. Moves between two
 *  family accounts are kept in the list but flagged so totals can skip them. */
export async function loadFamilyActivity(pubkeys: string[]): Promise<ActivityEvent[]> {
  const seen = new Set<string>();
  const out: ActivityEvent[] = [];
  for (const pk of pubkeys) {
    const r = await retry(() => wallet.getActivity(pk, 200), () => false, 4);
    for (const e of r?.data ?? []) {
      const key = `${e.activityType}|${e.timestamp}|${e.from}|${e.to}|${e.amount}`;
      if (seen.has(key)) continue; // a move between two family accounts appears in both
      seen.add(key);
      out.push(e);
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

/** Loads every account in the family (two at a time) once `enabled` turns on. */
export function useFamilyData(family: AccountFamily | null, enabled: boolean) {
  const [state, setState] = useState<{ view: FamilyView | null; loaded: number; total: number }>({ view: null, loaded: 0, total: 0 });
  const key = family ? family.accounts.map((a) => a.pubkey).join(',') : '';

  useEffect(() => {
    if (!family || !enabled) return;
    let cancelled = false;
    const queue = family.accounts.map((a) => a.pubkey);
    const total = queue.length;
    const done: FamilyMember[] = [];
    setState({ view: null, loaded: 0, total });
    const worker = async () => {
      while (queue.length && !cancelled) {
        const pk = queue.shift()!;
        const m = await loadMember(pk, () => cancelled);
        if (cancelled) return;
        if (m) done.push(m);
        setState((s) => ({ ...s, loaded: s.loaded + 1 }));
      }
    };
    Promise.all([worker(), worker()]).then(() => {
      if (cancelled || done.length === 0) return;
      const order = new Map(family.accounts.map((a, i) => [a.pubkey, i]));
      done.sort((a, b) => (order.get(a.pubkey) ?? 0) - (order.get(b.pubkey) ?? 0));
      setState({ view: mergeFamily(done, family.master), loaded: total, total });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
