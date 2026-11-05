'use client';

import { useEffect } from 'react';

const HOSTS = '.recharts-wrapper, .tv-lightweight-charts';
const ATTR = 'data-free-cursor';
const TIP_GAP = 14;

/** The plot area inside a chart, in the chart's own pixels. */
function plotOf(host: HTMLElement): { left: number; top: number; width: number; height: number } | null {
  if (host.classList.contains('recharts-wrapper')) {
    // Charts with nothing to read on hover (bare sparklines) get no line.
    if (!host.querySelector('.recharts-tooltip-wrapper')) return null;
    const clip = host.querySelector('clipPath[id$="-clip"] rect');
    if (!clip) return null;
    const n = (name: string) => Number(clip.getAttribute(name)) || 0;
    return { left: n('x'), top: n('y'), width: n('width'), height: n('height') };
  }
  // lightweight-charts lays out a table; the widest cell of the top row is the pane.
  const cells = Array.from(host.querySelectorAll<HTMLElement>('tr:first-child > td'));
  const pane = cells.sort((a, b) => b.clientWidth - a.clientWidth)[0];
  if (!pane) return null;
  const outer = host.getBoundingClientRect();
  const r = pane.getBoundingClientRect();
  return { left: r.left - outer.left, top: r.top - outer.top, width: r.width, height: r.height };
}

/**
 * The hover line on every chart follows the mouse instead of jumping from point to
 * point, and recharts tooltips ride along with it. The libraries still pick what the
 * tooltip reads, so values stay those of the nearest data point.
 *
 * Mounted once for the whole site. Listening on the document means no chart has to
 * opt in and new charts get it for free. It only writes CSS variables, so a mouse
 * move costs no React render; globals.css draws the line from them.
 */
export function FreeChartCursor() {
  useEffect(() => {
    let host: HTMLElement | null = null;
    let frame = 0;
    let pending: { x: number; y: number; target: EventTarget | null } | null = null;

    // A tooltip is empty until recharts fills it, so the first measure is too small.
    const tipSize = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(paint); });
    let watched: HTMLElement | null = null;

    const release = () => {
      host?.removeAttribute(ATTR);
      host = null;
      tipSize.disconnect();
      watched = null;
    };

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const { x, y, target } = pending;
      const next = target instanceof Element ? target.closest<HTMLElement>(HOSTS) : null;
      if (next !== host) release();
      if (!next) return;

      const box = next.getBoundingClientRect();
      const plot = plotOf(next);
      const mx = x - box.left;
      const my = y - box.top;
      if (!plot || mx < plot.left || mx > plot.left + plot.width || my < plot.top || my > plot.top + plot.height) {
        release();
        return;
      }

      next.style.setProperty('--cursor-x', `${mx}px`);
      next.style.setProperty('--cursor-top', `${plot.top}px`);
      next.style.setProperty('--cursor-height', `${plot.height}px`);

      const tip = next.querySelector<HTMLElement>('.recharts-tooltip-wrapper');
      if (tip !== watched) {
        tipSize.disconnect();
        if (tip) tipSize.observe(tip);
        watched = tip;
      }
      if (tip) {
        // Beside the mouse, flipping sides and clamping so it stays inside the chart.
        const right = mx + TIP_GAP;
        const tx = right + tip.offsetWidth <= box.width ? right : Math.max(0, mx - TIP_GAP - tip.offsetWidth);
        const ty = Math.max(0, Math.min(my + TIP_GAP, box.height - tip.offsetHeight));
        next.style.setProperty('--tip-x', `${tx}px`);
        next.style.setProperty('--tip-y', `${ty}px`);
      }
      next.setAttribute(ATTR, '');
      host = next;
    };

    const onMove = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY, target: e.target };
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
      if (frame) cancelAnimationFrame(frame);
      release();
    };
  }, []);

  return null;
}
