'use client';

// ----------------------------------------------------------------------------
// Appearance menu — one header button that opens a popover with both the
// light/dark theme and the 3 color palettes. Replaces the separate ThemeToggle
// + PaletteSwitcher so the header stays compact.
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Palette, Sun, Moon, Check } from 'lucide-react';

type Theme = 'dark' | 'light';
type PaletteId = 'classic' | 'grove' | 'orchid';

const PALETTES: { id: PaletteId; label: string; pos: string; neg: string }[] = [
  { id: 'classic', label: 'Classic', pos: '#21C07A', neg: '#E5484D' },
  { id: 'grove', label: 'Grove', pos: '#21C07A', neg: '#F97316' },
  { id: 'orchid', label: 'Orchid', pos: '#60A5FA', neg: '#A78BFA' },
];

export function AppearanceMenu({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [palette, setPalette] = useState<PaletteId>('classic');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setTheme((localStorage.getItem('bulkstats-theme') as Theme) || 'dark');
    setPalette((localStorage.getItem('bulkstats-palette') as PaletteId) || 'classic');
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-9 h-9 rounded-md transition-colors hover:bg-[var(--bg-secondary-20)] text-[var(--text-secondary)]"
        aria-label="Appearance settings"
        aria-expanded={open}
        title="Appearance"
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] shadow-xl p-3 z-50">
          {/* Theme */}
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium mb-1.5">Theme</div>
          <div className="flex gap-1.5 mb-3">
            {([['dark', Moon, 'Dark'], ['light', Sun, 'Light']] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => chooseTheme(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  theme === id
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-[var(--bg-secondary-20)]'
                    : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
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
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                  palette === p.id ? 'bg-[var(--bg-secondary-20)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary-20)]'
                }`}
              >
                <span className="flex w-8 h-4 rounded overflow-hidden border border-[var(--border-color)] shrink-0">
                  <span className="w-1/2 h-full" style={{ background: p.pos }} />
                  <span className="w-1/2 h-full" style={{ background: p.neg }} />
                </span>
                <span className="flex-1 text-left">{p.label}</span>
                {palette === p.id && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
