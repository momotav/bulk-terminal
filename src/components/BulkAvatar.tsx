'use client';

import { useMemo } from 'react';
import { avatarBackground } from '@/lib/bulkAvatar';
import { cn } from '@/lib/api';

/** A wallet's (or user's) BULK-style avatar: same seed, same picture, everywhere. */
export function BulkAvatar({ seed, size = 36, className, round = false }: { seed: string; size?: number; className?: string; round?: boolean }) {
  const bg = useMemo(() => avatarBackground(seed), [seed]);
  return (
    <span aria-hidden className={cn('inline-block shrink-0', round ? 'rounded-full' : 'rounded-[24%]', className)}
      style={{ width: size, height: size, background: bg }} />
  );
}
