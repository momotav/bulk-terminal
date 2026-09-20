'use client';

import { useEffect, useState } from 'react';

// Small viewport detector for responsive chart tuning (fewer axis ticks,
// tighter gutters on phones). SSR-safe: starts false, resolves on mount.
// Default breakpoint matches Tailwind's `sm` (640px) — below it is "mobile".
export function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [maxWidth]);

  return isMobile;
}
