'use client';

// ----------------------------------------------------------------------------
// Appearance menu — one header button that opens a popover with both the
// light/dark theme and the 3 color palettes. Replaces the separate ThemeToggle
// + PaletteSwitcher so the header stays compact.
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Sun, Moon, Check } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';

type Theme = 'dark' | 'light';
type PaletteId = 'original' | 'classic' | 'grove' | 'orchid';

const PALETTES: { id: PaletteId; label: string; pos: string; neg: string }[] = [
  { id: 'original', label: 'BULKSTATS Standard Color', pos: '#FFD9A8', neg: '#D98A2E' },
  { id: 'classic', label: 'BULK Standard Color', pos: '#21C07A', neg: '#E5484D' },
  { id: 'grove', label: 'Colour Vision Deficiency-Friendly A', pos: '#21C07A', neg: '#F97316' },
  { id: 'orchid', label: 'Colour Vision Deficiency-Friendly B', pos: '#60A5FA', neg: '#A78BFA' },
];

export function AppearanceMenu({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<Theme>('dark');
  const [palette, setPalette] = useState<PaletteId>('classic');
  // Popover is portaled to <body> so no ancestor's overflow/stacking context can
  // clip it (the old in-flow popover got cut off on mobile). We position it with
  // fixed coords measured from the trigger button.
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setTheme((localStorage.getItem('bulkstats-theme') as Theme) || 'dark');
    setPalette((localStorage.getItem('bulkstats-palette') as PaletteId) || 'classic');
  }, []);

  // Measure the trigger and anchor the fixed popover under its right edge,
  // clamped into the viewport. Recomputed on open, resize, and scroll.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      setCoords({ top: b.bottom + 8, right: Math.max(12, window.innerWidth - b.right) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('bulkstats-theme', t);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(t);
    root.setAttribute('data-theme', t);
  };

  const choosePalette = (p: PaletteId) => {
    setPalette(p);
    localStorage.setItem('bulkstats-palette', p);
    document.documentElement.setAttribute('data-palette', p);
  };

  if (!mounted) return <div className={`w-9 h-9 ${className}`} />;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-9 h-9 rounded-md transition-colors hover:bg-[var(--bg-secondary-20)] text-[var(--text-secondary)]"
        aria-label="Appearance settings"
        aria-expanded={open}
        title="Appearance"
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && mounted && createPortal(
        isMobile ? (
          // Mobile: a full-screen backdrop + bottom sheet. Centering the panel
          // in its own fixed overlay means NOTHING in the page can clip it —
          // the anchored dropdown kept getting cut by an ancestor's overflow.
          <div
            className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50"
            onClick={() => setOpen(false)}
          >
            <div
              ref={popRef}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-t-2xl border-t border-[var(--border-color)] bg-[var(--bg-muted)] shadow-2xl p-4 pb-8 animate-sheet-up"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-color)]" />
              <PanelBody theme={theme} palette={palette} chooseTheme={chooseTheme} choosePalette={choosePalette} />
            </div>
          </div>
        ) : (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: coords.top, right: coords.right }}
          className="origin-top-right w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] shadow-xl p-3 z-[100]">
          <PanelBody theme={theme} palette={palette} chooseTheme={chooseTheme} choosePalette={choosePalette} />
        </div>
        ),
        document.body
      )}
    </div>
  );
}

// Shared theme + palette controls, rendered inside both the desktop dropdown
// and the mobile bottom sheet.
function PanelBody({
  theme,
  palette,
  chooseTheme,
  choosePalette,
}: {
  theme: Theme;
  palette: PaletteId;
  chooseTheme: (t: Theme) => void;
  choosePalette: (p: PaletteId) => void;
}) {
  return (
    <>
      {/* Theme */}
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium mb-1.5">Theme</div>
      <div className="flex gap-1.5 mb-3">
        {([['dark', Moon, 'Dark'], ['light', Sun, 'Light']] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => chooseTheme(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              theme === id
                ? 'border-[var(--accent)] text-[var(--text-primary)] bg-[var(--bg-secondary-20)]'
                : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Palette */}
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium mb-1.5">Palette</div>
      <div className="space-y-1">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => choosePalette(p.id)}
            className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${
              palette === p.id ? 'bg-[var(--bg-secondary-20)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary-20)]'
            }`}
          >
            <span className="flex w-8 h-4 rounded overflow-hidden border border-[var(--border-color)] shrink-0">
              <span className="w-1/2 h-full" style={{ background: p.pos }} />
              <span className="w-1/2 h-full" style={{ background: p.neg }} />
            </span>
            <span className="flex-1 text-left">{p.label}</span>
            {palette === p.id && <Check className="w-4 h-4 text-[var(--accent)]" />}
          </button>
        ))}
      </div>
    </>
  );
}
