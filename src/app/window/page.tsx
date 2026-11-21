'use client';

// A workspace window popped out of the page into its own browser window, so it can
// sit on another monitor. Shares state with the site through storage.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Layers } from 'lucide-react';
import { CoinIcon } from '@/components/CoinIcon';
import { ChartView } from '@/components/basket/ChartView';
import { BasketView } from '@/components/basket/BasketView';
import { BookView } from '@/components/basket/BookView';
import { ToolBody, isTool, toolIcon, toolTitle } from '@/components/basket/tools';
import type { Win, WinKind } from '@/lib/basket';
import { dock, useDock } from '@/lib/basket';

function PoppedOut() {
  const q = useSearchParams();
  const rawKind = (q.get('kind') || 'chart') as WinKind;
  const kind = rawKind;
  // A popped-out tool keeps its own settings here (this window only).
  const [tool, setTool] = useState<Partial<Win>>({ coin: q.get('coin') || undefined, coin2: q.get('coin2') || undefined, address: q.get('address') || undefined });
  const [ivTool, setIvTool] = useState(q.get('iv') || '1h');
  const toolWin = { id: q.get('id') || kind, kind, interval: ivTool, x: 0, y: 0, w: 0, h: 0, z: 0, min: false, max: false, ...tool } as Win;
  const [book, setBook] = useState(q.get('book') === '1');
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
    document.title = isTool(kind) ? `${toolTitle(toolWin)} · bulkstats` : kind === 'chart' ? `${coin}-USD · bulkstats` : kind === 'book' ? `${coin} order book · bulkstats` : 'Basket · bulkstats';
  }, [kind, coin]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 h-10 px-3 border-b border-[var(--border-color)] bg-[var(--bg-muted)] text-[13px] font-medium text-[var(--text-primary)] shrink-0">
        {isTool(kind) ? toolIcon(toolWin, 16) : kind === 'basket' ? <Layers className="w-4 h-4 text-[var(--text-secondary)]" /> : <CoinIcon symbol={coin} size={16} />}
        {isTool(kind) ? toolTitle(toolWin) : kind === 'chart' ? `${coin}-USD` : kind === 'book' ? `${coin} order book` : `Basket${legs ? ` · ${legs}` : ''}`}
        <span className="ml-auto text-[11px] font-normal text-[var(--text-tertiary)]">bulkstats</span>
      </div>
      <div className="relative flex-1 min-h-0 overflow-auto">
        {isTool(kind) ? <ToolBody win={toolWin} patch={(p) => setTool((t) => ({ ...t, ...p }))} onInterval={setIvTool} />
          : kind === 'chart' ? <ChartView coin={coin} interval={interval} onInterval={setIv} book={book} onToggleBook={() => setBook((b) => !b)} />
          : kind === 'book' ? <BookView coin={coin} />
          : <BasketView interval={interval} onInterval={setIv} />}
      </div>
    </div>
  );
}

export default function WindowPage() {
  return <Suspense fallback={null}><PoppedOut /></Suspense>;
}
