'use client';

// BuildSkewGuard — self-heals the "old tab after a new deploy" failure mode.
//
// After a redeploy, a tab that's still running the previous build can fail to
// load a now-missing JS chunk (ChunkLoadError) or fetch a mismatched RSC
// payload on client navigation. When that happens we do ONE hard reload, which
// pulls the current build and recovers. Guarded by a sessionStorage timestamp
// so a genuinely-broken build can't put us in a reload loop.

import { useEffect } from 'react';

const STALE_RE = /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

export function BuildSkewGuard() {
  useEffect(() => {
    const KEY = 'bulkstats:skew-reloaded-at';
    const recover = (msg: string | undefined) => {
      if (!msg || !STALE_RE.test(msg)) return;
      try {
        const last = Number(sessionStorage.getItem(KEY) || 0);
        if (Date.now() - last < 20_000) return; // already tried — don't loop
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch { /* sessionStorage blocked — reload once anyway */ }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => recover(e.message || (e.error && e.error.message));
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      recover(typeof r === 'string' ? r : r && (r.message || String(r)));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
