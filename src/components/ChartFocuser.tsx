'use client';

// ChartFocuser — smooth-scrolls to a specific chart when the command palette
// (or a deep link) asks for one, and briefly highlights it.
//
// Mounted once in the analytics layout so it covers every analytics page. It
// matches on the chart's VISIBLE HEADING text (h2/h3), so individual charts
// need no anchor IDs. Triggered two ways:
//   • the `bulkstats:focus-chart` event the palette fires after navigating, and
//   • a `?focus=<title>` query param on first load (deep-link / reload).
// Charts render asynchronously, so the match is retried for a few seconds.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function findHeading(title: string): HTMLElement | null {
  const target = norm(title);
  if (!target) return null;
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4'));
  // Prefer an exact normalized match, then a contains match either direction.
  let contains: HTMLElement | null = null;
  for (const h of headings) {
    const t = norm(h.textContent || '');
    if (!t) continue;
    if (t === target) return h;
    if (!contains && (t.includes(target) || target.includes(t))) contains = h;
  }
  return contains;
}

// Walk up to the enclosing chart card so the highlight frames the whole panel,
// not just the title line.
function cardOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  for (let i = 0; i < 6 && node; i++) {
    const cls = node.className || '';
    if (typeof cls === 'string' && /rounded/.test(cls) && /border|bg-/.test(cls)) return node;
    node = node.parentElement;
  }
  return el;
}

function focusChart(title: string, attempt = 0): void {
  const heading = findHeading(title);
  if (!heading) {
    if (attempt < 20) setTimeout(() => focusChart(title, attempt + 1), 200); // ~4s of retries
    return;
  }
  const card = cardOf(heading);
  // Manual offset scroll — the site header is sticky (h-14 = 56px); add breathing room.
  const y = card.getBoundingClientRect().top + window.scrollY - 84;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  card.classList.add('chart-focus-flash');
  setTimeout(() => card.classList.remove('chart-focus-flash'), 1600);
}

export function ChartFocuser() {
  const pathname = usePathname();

  // Deep-link / reload: honor ?focus= on mount and on route change.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus) {
      focusChart(focus);
      // Clean the param so a later plain reload doesn't re-scroll.
      const url = new URL(window.location.href);
      url.searchParams.delete('focus');
      window.history.replaceState({}, '', url.toString());
    }
  }, [pathname]);

  // Same-session navigation from the palette.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const title = (e as CustomEvent<{ title?: string }>).detail?.title;
      if (title) setTimeout(() => focusChart(title), 60); // let the route render
    };
    window.addEventListener('bulkstats:focus-chart', onFocus);
    return () => window.removeEventListener('bulkstats:focus-chart', onFocus);
  }, []);

  return null;
}
