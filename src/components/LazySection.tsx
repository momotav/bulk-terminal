'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Mounts its content (and so starts that section's data requests) only when it
 * comes within about half a screen of the viewport: while you read the first rows,
 * the next one is already loading, and sections far down never load if nobody
 * scrolls there. Once mounted it stays mounted.
 *
 * Until then it holds `minHeight` so the page doesn't jump. A chart search
 * (command palette / ?focus=) mounts every lazy section at once, so the chart it
 * is looking for exists to scroll to.
 */
export function LazySection({ children, minHeight = 360, className }: { children: ReactNode; minHeight?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show) return;
    const now = () => setShow(true);
    if (typeof IntersectionObserver === 'undefined' || new URLSearchParams(window.location.search).has('focus')) { now(); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) now(); }, { rootMargin: '50% 0px 50% 0px' });
    if (ref.current) io.observe(ref.current);
    window.addEventListener('bulkstats:focus-chart', now);
    return () => { io.disconnect(); window.removeEventListener('bulkstats:focus-chart', now); };
  }, [show]);

  return (
    <div ref={ref} className={className} style={show ? undefined : { minHeight }}>
      {show ? children : <div className="h-full animate-pulse rounded-2xl bg-[var(--bg-muted)]" style={{ minHeight }} />}
    </div>
  );
}
