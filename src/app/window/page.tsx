'use client';

// A workspace window popped out of the page into its own browser window, so it can
// sit on another monitor. Shares state with the site through storage.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Layers } from 'lucide-react';
import { CoinIcon } from '@/components/CoinIcon';
import { ChartView } from '@/components/basket/ChartView';
import { BasketView } from '@/components/basket/BasketView';
import { dock, useDock } from '@/lib/basket';

function PoppedOut() {
  const q = useSearchParams();
  const kind = q.get('kind') === 'basket' ? 'basket' : 'chart';
  const coin = (q.get('coin') || 'BTC').toUpperCase();
  const [interval, setIv] = useState(q.get('iv') || '1h');
  const legs = useDock().legs.length;

  // Closing this window hands it back to the page it came from.
  const id = q.get('id');
  useEffect(() => {
    if (!id) return;
    const back = () => dock.unpop(id);
    window.addEventListener('pagehide', back);
    return () => window.removeEventListener('pagehide', back);
  }, [id]);

  useEffect(() => {
    document.title = kind === 'chart' ? `${coin}-USD · bulkstats` : 'Basket · bulkstats';
  }, [kind, coin]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 h-10 px-3 border-b border-[var(--border-color)] bg-[var(--bg-muted)] text-[13px] font-medium text-[var(--text-primary)] shrink-0">
        {kind === 'chart' ? <CoinIcon symbol={coin} size={16} /> : <Layers className="w-4 h-4 text-[var(--text-secondary)]" />}
        {kind === 'chart' ? `${coin}-USD` : `Basket${legs ? ` · ${legs}` : ''}`}
        <span className="ml-auto text-[11px] font-normal text-[var(--text-tertiary)]">bulkstats</span>
      </div>
      <div className="relative flex-1 min-h-0 overflow-auto">
        {kind === 'chart' ? <ChartView coin={coin} interval={interval} onInterval={setIv} /> : <BasketView interval={interval} onInterval={setIv} />}
      </div>
    </div>
  );
}

export default function WindowPage() {
  return <Suspense fallback={null}><PoppedOut /></Suspense>;
}
