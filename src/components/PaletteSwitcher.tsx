'use client';

// ----------------------------------------------------------------------------
// Site-wide color palette switcher. Sets data-palette on <html>, persisted to
// localStorage. Everything that reads --pos/--neg/--accent/--coin-* re-tints
// automatically. Mirrors the ThemeToggle (dark/light) pattern.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';

type Palette = 'original' | 'classic' | 'grove' | 'orchid';

const PALETTES: { id: Palette; label: string; pos: string; neg: string }[] = [
  { id: 'original', label: 'Original · amber', pos: '#FFD9A8', neg: '#D98A2E' },
  { id: 'classic', label: 'Classic · green / red', pos: '#21C07A', neg: '#E5484D' },
  { id: 'grove', label: 'Grove · green / orange', pos: '#21C07A', neg: '#F97316' },
  { id: 'orchid', label: 'Orchid · blue / purple', pos: '#60A5FA', neg: '#A78BFA' },
];

export function applyPalette(p: Palette) {
  document.documentElement.setAttribute('data-palette', p);
}

export function PaletteSwitcher({ className = '' }: { className?: string }) {
  const [palette, setPalette] = useState<Palette>('classic');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = (localStorage.getItem('bulkstats-palette') as Palette) || 'classic';
    setPalette(saved);
    applyPalette(saved);
  }, []);

  const choose = (p: Palette) => {
    setPalette(p);
    localStorage.setItem('bulkstats-palette', p);
    applyPalette(p);
  };

  if (!mounted) return <div className={`h-9 ${className}`} />;

  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="group" aria-label="Color palette">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          onClick={() => choose(p.id)}
          title={p.label}
          aria-label={p.label}
          aria-pressed={palette === p.id}
          className={`relative w-8 h-6 rounded-md overflow-hidden border transition-all ${
            palette === p.id
              ? 'border-[var(--text-primary)] scale-105'
              : 'border-[var(--border-color)] opacity-70 hover:opacity-100'
          }`}
        >
          <span className="absolute inset-0 flex">
            <span className="w-1/2 h-full" style={{ background: p.pos }} />
            <span className="w-1/2 h-full" style={{ background: p.neg }} />
          </span>
        </button>
      ))}
    </div>
  );
}
