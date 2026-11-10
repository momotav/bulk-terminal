'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Hides site chrome (header, palette, tour…) on bare routes like a popped-out /window. */
export function ChromeGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path?.startsWith('/window') ? null : <>{children}</>;
}
