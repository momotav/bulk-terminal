'use client';

// A macOS-style floating window: drag by the title bar, resize from the corner,
// traffic lights to close / minimise / zoom, and a pop-out button that reopens it
// as a real browser window, which can then go to another monitor.
//
// Dragging writes left/top straight to the element and commits to the store once,
// on release: no React render per pointer move.

import { useEffect, useRef, type ReactNode } from 'react';
import { ExternalLink, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { cn } from '@/lib/api';
import { dock, type Win } from '@/lib/basket';

const MIN_W = 300;
const MIN_H = 200;
const TOP = 60; // keep windows below the site header

function clampBox(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  // At least 120px of the title bar stays on screen, so a window can't be lost.
  return { x: Math.min(vw - 120, Math.max(120 - w, x)), y: Math.min(vh - 40, Math.max(TOP, y)), w, h };
}

export function FloatingWindow({ win, layer, title, icon, onPopOut, children, mobile, extra }: {
  win: Win; layer: number; title: ReactNode; icon?: ReactNode; onPopOut?: () => void; children: ReactNode; mobile: boolean;
  /** Extra title-bar controls, before the standard ones. */
  extra?: ReactNode;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const fx = useWindowMotion(el, win);

  // Keep a window reachable when the browser window shrinks.
  useEffect(() => {
    if (mobile || win.max) return;
    const fix = () => {
      const b = clampBox(win.x, win.y, win.w, win.h);
      if (b.x !== win.x || b.y !== win.y) dock.move(win.id, b.x, b.y);
    };
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
  }, [win.id, win.x, win.y, win.w, win.h, win.max, mobile]);

  const drag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (mobile || win.max || e.button !== 0) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dock.focus(win.id);
    const node = el.current!;
    const sx = e.clientX; const sy = e.clientY;
    const start = { x: win.x, y: win.y, w: win.w, h: win.h };
    let last = start;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      last = mode === 'move'
        ? clampBox(start.x + dx, start.y + dy, start.w, start.h)
        : { ...start, w: Math.max(MIN_W, Math.min(window.innerWidth - start.x - 4, start.w + dx)), h: Math.max(MIN_H, Math.min(window.innerHeight - start.y - 4, start.h + dy)) };
      node.style.left = `${last.x}px`; node.style.top = `${last.y}px`;
      node.style.width = `${last.w}px`; node.style.height = `${last.h}px`;
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.style.userSelect = '';
      if (mode === 'move') dock.move(win.id, last.x, last.y); else dock.resize(win.id, last.w, last.h);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const box = mobile
    ? { left: 0, top: 56, width: '100vw', height: 'calc(100dvh - 56px)' }
    : win.max
      ? { left: 8, top: TOP, width: 'calc(100vw - 16px)', height: `calc(100vh - ${TOP + 8}px)` }
      : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <div ref={el} role="dialog" aria-label={typeof title === 'string' ? title : undefined} data-win-kind={win.kind} data-win-id={win.id}
      onPointerDownCapture={() => dock.focus(win.id)}
      className={cn('fixed flex flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-base)] shadow-[0_18px_50px_rgba(0,0,0,0.38)]', mobile ? 'rounded-none' : 'rounded-xl')}
      style={{ ...box, zIndex: layer, display: win.min || win.popped ? 'none' : undefined }}>
      {/* Title bar: title on the left, controls grouped on the right. */}
      <div onPointerDown={(e) => drag(e, 'move')} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) fx.toggleMax(); }}
        className={cn('flex items-center gap-2 h-9 pl-3 pr-1.5 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-muted)] select-none', !mobile && !win.max && 'cursor-grab active:cursor-grabbing')}>
        <span className="flex items-center gap-1.5 min-w-0 text-[13px] font-medium text-[var(--text-primary)] truncate">{icon}{title}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {extra}
          {onPopOut && !mobile && <Ctl label="Open in its own window (move it to another screen)" onClick={onPopOut}><ExternalLink className="w-3.5 h-3.5" /></Ctl>}
          <Ctl label="Minimise" onClick={fx.minimize}><Minus className="w-3.5 h-3.5" /></Ctl>
          {!mobile && <Ctl label={win.max ? 'Restore' : 'Fill the screen'} onClick={fx.toggleMax}>{win.max ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</Ctl>}
          <Ctl label="Close" danger onClick={fx.close}><X className="w-3.5 h-3.5" /></Ctl>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 overflow-auto">{children}</div>
      {!mobile && !win.max && (
        <div onPointerDown={(e) => drag(e, 'size')} aria-hidden
          className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize"
          style={{ background: 'linear-gradient(135deg, transparent 50%, var(--border-color) 50%, var(--border-color) 60%, transparent 60%, transparent 72%, var(--border-color) 72%, var(--border-color) 82%, transparent 82%)' }} />
      )}
    </div>
  );
}

// ── Motion ──────────────────────────────────────────────────────────────────
// Opening grows the window in; closing shrinks it away; minimising sends it down
// into the "+" corner and restoring brings it back out; zoom glides between sizes.
// Transform and opacity only (cheap), and nothing at all with reduced motion.

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const calm = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Offset from the window's centre to the "+" button, as a transform toward the dock. */
function toDock(node: HTMLElement): string {
  const r = node.getBoundingClientRect();
  const plus = document.querySelector('button[aria-label="Open a tool"]')?.getBoundingClientRect();
  const tx = (plus ? plus.left + plus.width / 2 : window.innerWidth - 40) - (r.left + r.width / 2);
  const ty = (plus ? plus.top + plus.height / 2 : window.innerHeight - 40) - (r.top + r.height / 2);
  return `translate(${tx}px, ${ty}px) scale(0.12)`;
}

function useWindowMotion(el: React.RefObject<HTMLDivElement | null>, win: Win) {
  const busy = useRef(false);
  const wasMin = useRef(win.min);

  // Open: grow in from just under full size.
  useEffect(() => {
    const n = el.current;
    if (!n || calm() || win.min || win.popped) return;
    n.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore from the dock: come back out of the "+" corner.
  useEffect(() => {
    const n = el.current;
    if (wasMin.current && !win.min && n && !calm()) {
      n.animate([{ opacity: 0, transform: toDock(n) }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE });
    }
    wasMin.current = win.min;
  }, [win.min]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = (frames: Keyframe[], ms: number, done: () => void) => {
    const n = el.current;
    if (!n || calm()) { done(); return; }
    if (busy.current) return;
    busy.current = true;
    const a = n.animate(frames, { duration: ms, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    a.finished.catch(() => {}).then(() => { busy.current = false; done(); a.cancel(); });
  };

  return {
    close: () => out([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.92)' }], 170, () => dock.close(win.id)),
    minimize: () => {
      const n = el.current;
      out([{ opacity: 1, transform: 'none' }, { opacity: 0.2, transform: n ? toDock(n) : 'scale(0.1)' }], 300, () => dock.minimize(win.id));
    },
    toggleMax: () => {
      const n = el.current;
      if (n && !calm()) {
        n.style.transition = 'left .24s cubic-bezier(.2,.8,.2,1), top .24s cubic-bezier(.2,.8,.2,1), width .24s cubic-bezier(.2,.8,.2,1), height .24s cubic-bezier(.2,.8,.2,1)';
        setTimeout(() => { n.style.transition = ''; }, 280);
      }
      dock.toggleMax(win.id);
    },
  };
}

function Ctl({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn('w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-tertiary)] transition-colors',
        danger ? 'hover:bg-[color-mix(in_srgb,var(--neg)_18%,transparent)] hover:text-[var(--neg)]' : 'hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]')}>
      {children}
    </button>
  );
}
