'use client';

import { useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';
const DWELL_MS = 180;
const AGAIN_AFTER_MS = 2 * 60_000;

/**
 * Starts loading a wallet's fill history when someone rests on a link to it, so the
 * backend has it cached by the time they've clicked. Fills are the slow part of a
 * wallet page: a busy wallet's history is two or more sequential BULK pages.
 *
 * Mounted once for the whole site; any link to /whales/<address> qualifies. Only after
 * a short dwell, so sweeping the mouse down a leaderboard doesn't fire a request per
 * row, and once per wallet every couple of minutes.
 */
export function WalletWarmup() {
  useEffect(() => {
    const warmed = new Map<string, number>();
    let timer: number | null = null;
    let pending: string | null = null;

    const onOver = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href^="/whales/"]') as HTMLAnchorElement | null;
      const address = link?.getAttribute('href')?.split('/')[2]?.split(/[?#]/)[0];
      if (!address || address === pending) return;
      if (timer) window.clearTimeout(timer);
      pending = address;
      timer = window.setTimeout(() => {
        timer = null;
        const last = warmed.get(address) ?? 0;
        if (Date.now() - last < AGAIN_AFTER_MS) return;
        warmed.set(address, Date.now());
        // Fire and forget: the response isn't used here, only the backend cache it fills.
        fetch(`${API_URL}/api/wallet/${address}/fills?limit=40000&lite=1`).catch(() => {});
      }, DWELL_MS);
    };
    const onOut = (e: MouseEvent) => {
      const from = (e.target as Element | null)?.closest?.('a[href^="/whales/"]');
      const to = (e.relatedTarget as Element | null)?.closest?.('a[href^="/whales/"]');
      if (from && from !== to && timer) { window.clearTimeout(timer); timer = null; pending = null; }
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mouseout', onOut, { passive: true });
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
