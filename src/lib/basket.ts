'use client';

// Workspace state, shared site-wide: floating windows (charts, the basket, more
// later) and the basket itself. Kept in a tiny external store so windows survive
// page navigation, saved per viewer so a reload brings them back, and synced
// through storage so a popped-out window on another monitor stays in step.

import { useSyncExternalStore } from 'react';
import type { Side } from '@/lib/portfolioMargin';

export interface BasketLeg { coin: string; side: Side; weight: number }
export type WinKind = 'chart' | 'basket';
export interface Win {
  id: string;
  kind: WinKind;
  coin?: string;
  interval: string;
  x: number; y: number; w: number; h: number;
  z: number;
  min: boolean;
  max: boolean;
  /** Open in its own browser window (another monitor), so hidden here. */
  popped?: boolean;
}
export interface DockState {
  windows: Win[];
  /** The basket: exactly the markets with an open chart (closing a chart drops it). */
  legs: BasketLeg[];
  /** Basket size in USD notional, split across legs by weight. */
  size: number;
  leverage: number;
  autoBalance: boolean;
}

export const MAX_LEGS = 6;
export const MAX_WINDOWS = MAX_LEGS + 1; // every chart plus the basket
const KEY = 'bulkstats-workspace';
const INITIAL: DockState = { windows: [], legs: [], size: 10_000, leverage: 5, autoBalance: true };

let state: DockState = INITIAL;
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

function read(): DockState | null {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...INITIAL, ...JSON.parse(raw) } : null; } catch { return null; }
}

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  const saved = read();
  state = saved ? { ...saved, legs: syncLegs(saved.windows, saved.legs, saved.autoBalance) } : INITIAL;
  // Popped-out windows (another browser window, maybe another monitor) share this
  // state through storage: a change in one shows in the others.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const next = read();
    if (next) { state = { ...next, legs: syncLegs(next.windows, next.legs, next.autoBalance) }; notify(); }
  });
}

function set(next: Partial<DockState> | ((s: DockState) => Partial<DockState>)) {
  load();
  state = { ...state, ...(typeof next === 'function' ? next(state) : next) };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  notify();
}

export function useDock(): DockState {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => { load(); return state; },
    () => INITIAL,
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Equal weights, longs and shorts together summing to 100. */
function balanced(legs: BasketLeg[]): BasketLeg[] {
  if (!legs.length) return legs;
  const w = round1(100 / legs.length);
  return legs.map((l, i) => ({ ...l, weight: i === legs.length - 1 ? round1(100 - w * (legs.length - 1)) : w }));
}

const topZ = (ws: Win[]) => ws.reduce((m, w) => Math.max(m, w.z), 0);

/** Where a new window lands: the first free spot in a left-to-right, top-to-bottom
 *  sweep with a gap between windows, so open charts sit side by side (and the
 *  basket link between them shows). Cascades only when the screen is full. */
function placement(ws: Win[], w: number, h: number) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const open = ws.filter((x) => !x.min && !x.max);
  const GAP = 48;
  const free = (x: number, y: number) => open.every((o) => x + w + GAP / 2 <= o.x || o.x + o.w + GAP / 2 <= x || y + h + GAP / 2 <= o.y || o.y + o.h + GAP / 2 <= y);
  for (let y = 76; y + h <= vh - 8; y += 40) {
    for (let x = Math.min(240, vw - w - 8); x + w <= vw - 8; x += 40) if (free(x, y)) return { x, y };
  }
  const k = open.length;
  return { x: Math.max(8, Math.min(vw - w - 8, 240 + k * 32)), y: Math.max(64, Math.min(vh - h - 8, 90 + k * 32)) };
}

/** The basket follows the open charts: legs without a chart go, charts without a leg join (long). */
function syncLegs(ws: Win[], legs: BasketLeg[], auto: boolean): BasketLeg[] {
  const charts = ws.filter((w) => w.kind === 'chart' && w.coin).map((w) => w.coin as string);
  let next = legs.filter((l) => charts.includes(l.coin));
  for (const c of charts) if (!next.some((l) => l.coin === c)) next = [...next, { coin: c, side: 'long', weight: 0 }];
  const changed = next.length !== legs.length || next.some((l, i) => l.coin !== legs[i]?.coin);
  return changed && (auto || next.some((l) => l.weight === 0)) ? balanced(next) : next;
}

function addLeg(legs: BasketLeg[], coin: string, side: Side, auto: boolean): BasketLeg[] {
  if (legs.some((l) => l.coin === coin) || legs.length >= MAX_LEGS) return legs;
  const next = [...legs, { coin, side, weight: 0 }];
  return auto || legs.length === 0 ? balanced(next) : next;
}

const patchWin = (id: string, p: Partial<Win>) => set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, ...p } : w)) }));

export const dock = {
  /** Open a coin's chart window (it also joins the basket). Already open: bring it forward. */
  openChart(coin: string, side: Side = 'long') {
    const c = coin.replace(/-USD$/i, '').toUpperCase();
    set((s) => {
      const have = s.windows.find((w) => w.kind === 'chart' && w.coin === c);
      if (have) return { windows: s.windows.map((w) => (w.id === have.id ? { ...w, min: false, z: topZ(s.windows) + 1 } : w)) };
      if (s.windows.filter((w) => w.kind === 'chart').length >= MAX_LEGS) return {};
      const w = 560; const h = 360;
      const ws: Win[] = [...s.windows, { id: `chart-${c}`, kind: 'chart', coin: c, interval: '1h', ...placement(s.windows, w, h), w, h, z: topZ(s.windows) + 1, min: false, max: false }];
      return { legs: addLeg(s.legs, c, side, s.autoBalance), windows: ws };
    });
  },
  openBasket() {
    set((s) => {
      const have = s.windows.find((w) => w.kind === 'basket');
      if (have) return { windows: s.windows.map((w) => (w.id === have.id ? { ...w, min: false, z: topZ(s.windows) + 1 } : w)) };
      const w = 380; const h = Math.min(640, (typeof window !== 'undefined' ? window.innerHeight : 800) - 90);
      return { windows: [...s.windows, { id: 'basket', kind: 'basket', interval: '1h', ...placement(s.windows, w, h), w, h, z: topZ(s.windows) + 1, min: false, max: false }] };
    });
  },
  close: (id: string) => set((s) => {
    const windows = s.windows.filter((w) => w.id !== id);
    return { windows, legs: syncLegs(windows, s.legs, s.autoBalance) };
  }),
  closeAll: () => set({ windows: [], legs: [] }),
  /** Moved into its own browser window: hide it here, keep it in the basket. */
  popOut: (id: string) => patchWin(id, { popped: true }),
  /** Its browser window closed: it comes back here, minimised. */
  unpop: (id: string) => patchWin(id, { popped: false, min: true }),
  focus: (id: string) => set((s) => {
    const top = topZ(s.windows);
    const w = s.windows.find((x) => x.id === id);
    return w && w.z === top ? {} : { windows: s.windows.map((x) => (x.id === id ? { ...x, z: top + 1 } : x)) };
  }),
  minimize: (id: string, min = true) => set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, min, z: min ? w.z : topZ(s.windows) + 1 } : w)) })),
  toggleMax: (id: string) => set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, max: !w.max, z: topZ(s.windows) + 1 } : w)) })),
  move: (id: string, x: number, y: number) => patchWin(id, { x, y }),
  resize: (id: string, w: number, h: number) => patchWin(id, { w, h }),
  setWinInterval: (id: string, interval: string) => patchWin(id, { interval }),

  // Basket
  /** Adding a market to the basket opens its chart: the two always match. */
  addLeg: (coin: string, side: Side) => dock.openChart(coin, side),
  removeLeg: (coin: string) => set((s) => {
    const windows = s.windows.filter((w) => !(w.kind === 'chart' && w.coin === coin));
    return { windows, legs: syncLegs(windows, s.legs, s.autoBalance) };
  }),
  clearLegs: () => set((s) => ({ windows: s.windows.filter((w) => w.kind !== 'chart'), legs: [] })),
  setSize: (size: number) => set({ size }),
  setLeverage: (leverage: number) => set({ leverage }),
  setAutoBalance: (autoBalance: boolean) => set((s) => ({ autoBalance, legs: autoBalance ? balanced(s.legs) : s.legs })),
  setSide: (coin: string, side: Side) => set((s) => ({ legs: s.legs.map((l) => (l.coin === coin ? { ...l, side } : l)) })),
  setWeight: (coin: string, weight: number) => set((s) => ({ autoBalance: false, legs: s.legs.map((l) => (l.coin === coin ? { ...l, weight: Math.max(0, Math.min(100, weight)) } : l)) })),
  /** Load a whole basket, as from a shared link: its charts and the basket window. */
  loadBasket(legs: BasketLeg[]) {
    set({ legs: [], autoBalance: false, windows: [] });
    for (const l of legs.slice(0, MAX_LEGS)) dock.openChart(l.coin, l.side);
    set((s) => ({ legs: legs.slice(0, MAX_LEGS).filter((l) => s.windows.some((w) => w.coin === l.coin)), autoBalance: false }));
    dock.openBasket();
  },
};

/** Open a chart window from anywhere on the site. */
export function openChart(coin: string) { dock.openChart(coin); }

// ── BULK's share format ──────────────────────────────────────────────────────
// app.bulk.trade/s/SNDK:25+SOL:25-BTC:25+MU:25 : longs joined by "+", then "-"
// and the shorts joined by "+". Weights are percents of the whole basket.

const fmtW = (w: number) => String(round1(w));

export function basketSpec(legs: BasketLeg[]): string {
  const part = (side: Side) => legs.filter((l) => l.side === side && l.weight > 0).map((l) => `${l.coin}:${fmtW(l.weight)}`).join('+');
  const longs = part('long'); const shorts = part('short');
  return shorts ? `${longs}-${shorts}` : longs;
}

export function parseBasketSpec(spec: string): BasketLeg[] {
  const s = decodeURIComponent(spec).replace(/ /g, '+').trim();
  const cut = s.indexOf('-');
  const read = (txt: string, side: Side): BasketLeg[] => txt.split('+').filter(Boolean).flatMap((p) => {
    const [coin, w] = p.split(':');
    const weight = Number(w);
    return coin && /^[A-Z0-9]{1,16}$/i.test(coin) && Number.isFinite(weight) && weight > 0 ? [{ coin: coin.toUpperCase(), side, weight }] : [];
  });
  return cut < 0 ? read(s, 'long') : [...read(s.slice(0, cut), 'long'), ...read(s.slice(cut + 1), 'short')];
}

export const bulkBasketUrl = (legs: BasketLeg[], autoBalance: boolean) =>
  `https://app.bulk.trade/s/${basketSpec(legs)}?autoBalance=${autoBalance ? 'on' : 'off'}`;
