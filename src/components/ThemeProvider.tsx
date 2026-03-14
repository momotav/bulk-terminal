'use client';

import { useEffect } from 'react';
import { useStore } from '@/store';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.remove('light');
    } else {
      root.classList.add('light');
    }
  }, [theme]);

  return <>{children}</>;
}
