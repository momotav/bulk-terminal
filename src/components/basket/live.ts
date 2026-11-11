'use client';

import { useEffect, useState } from 'react';
import { analytics, marketStreamUrl, type OrderbookSnapshot } from '@/lib/api';

// Live data for workspace windows, shared per market: however many windows show
// BTC (its chart, its book, a popped-out copy in this tab), there is one price
// stream and one order-book poll, opened by the first reader and closed by the last.

export interface Tick { price: number; ts: number }

type Feed<T> = { last: T | null; subs: Set<(v: T) => void>; stop: () => void };
const prices = new Map<string, Feed<Tick>>();
const books = new Map<string, Feed<OrderbookSnapshot>>();

function share<T>(map: Map<string, Feed<T>>, key: string, start: (emit: (v: T) => void) => () => void, fn: (v: T) => void): () => void {
  let f = map.get(key);
  if (!f) {
    const feed: Feed<T> = { last: null, subs: new Set(), stop: () => {} };
    feed.stop = start((v) => { feed.last = v; feed.subs.forEach((s) => s(v)); });
    map.set(key, feed);
    f = feed;
  }
  f.subs.add(fn);
  if (f.last) fn(f.last);
  return () => {
    const cur = map.get(key);
    if (!cur) return;
    cur.subs.delete(fn);
    if (cur.subs.size === 0) { cur.stop(); map.delete(key); }
  };
}

/** Every trade print for a market (BULK's live stream through our backend). */
export function subscribePrice(coin: string, fn: (t: Tick) => void): () => void {
  return share(prices, coin, (emit) => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(marketStreamUrl(`${coin}-USD`));
      es.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data) as { price: number; ts?: number };
          const p = Number(m.price);
          if (p > 0) emit({ price: p, ts: Number(m.ts) || Date.now() });
        } catch { /* keep-alive or junk: ignore */ }
      };
    } catch { /* no stream: the chart still refreshes every minute */ }
    return () => es?.close();
  }, fn);
}

/** The latest price, re-rendering at most every `everyMs`. */
export function useLivePrice(coin: string, everyMs = 250): Tick | null {
  const [tick, setTick] = useState<Tick | null>(null);
  useEffect(() => {
    setTick(null);
    let pending: Tick | null = null;
    let timer: number | null = null;
    const off = subscribePrice(coin, (t) => {
      pending = t;
      if (timer === null) timer = window.setTimeout(() => { timer = null; setTick(pending); }, everyMs);
    });
    return () => { off(); if (timer !== null) window.clearTimeout(timer); };
  }, [coin, everyMs]);
  return tick;
}

/** A market's order book, refreshed every second while anything shows it. */
export function useOrderbook(coin: string): OrderbookSnapshot | null {
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  useEffect(() => {
    setBook(null);
    return share(books, coin, (emit) => {
      let busy = false;
      let alive = true;
      const load = () => {
        if (busy || document.hidden) return;
        busy = true;
        analytics.getOrderbook(coin, 20).then((b) => { if (alive && b) emit(b); }).catch(() => {}).finally(() => { busy = false; });
      };
      load();
      const id = window.setInterval(load, 1000);
      return () => { alive = false; window.clearInterval(id); };
    }, setBook);
  }, [coin]);
  return book;
}

export const intervalSeconds = (iv: string) => ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as Record<string, number>)[iv] ?? 3600;
