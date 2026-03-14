'use client';

import { useMemo } from 'react';
import { formatNumber, cn } from '@/lib/api';

interface OrderBookLevel {
  px: number;
  sz: number;
  n: number;
}

interface OrderBookProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice?: number;
  symbol: string;
}

export function OrderBook({ bids, asks, lastPrice, symbol }: OrderBookProps) {
  const { maxTotal, processedBids, processedAsks } = useMemo(() => {
    let bidTotal = 0;
    let askTotal = 0;
    
    const pBids = bids.slice(0, 12).map(level => {
      bidTotal += level.sz;
      return { ...level, total: bidTotal };
    });
    
    const pAsks = asks.slice(0, 12).map(level => {
      askTotal += level.sz;
      return { ...level, total: askTotal };
    });
    
    const max = Math.max(bidTotal, askTotal);
    
    return {
      maxTotal: max,
      processedBids: pBids,
      processedAsks: pAsks.reverse(),
    };
  }, [bids, asks]);

  const spread = asks[0] && bids[0] 
    ? ((asks[0].px - bids[0].px) / asks[0].px * 100).toFixed(3)
    : '—';

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-magenta/20 flex items-center justify-center text-bulk-magenta">
            📊
          </span>
          Order Book
        </h2>
        <span className="text-xs text-gray-500">{symbol}</span>
      </div>

      {/* Headers */}
      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-dark-border">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Asks (sells) - reversed so lowest ask is at bottom */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col justify-end">
          {processedAsks.map((level, i) => (
            <div key={`ask-${i}`} className="relative grid grid-cols-3 gap-2 px-4 py-1 text-sm hover:bg-dark-tertiary/30">
              {/* Depth bar */}
              <div 
                className="absolute right-0 top-0 bottom-0 bg-bulk-red/10"
                style={{ width: `${(level.total / maxTotal) * 100}%` }}
              />
              <span className="relative text-bulk-red font-mono">${formatNumber(level.px, 2)}</span>
              <span className="relative text-right text-gray-400 font-mono">{formatNumber(level.sz, 4)}</span>
              <span className="relative text-right text-gray-500 font-mono">{formatNumber(level.total, 4)}</span>
            </div>
          ))}
        </div>

        {/* Spread / Last Price */}
        <div className="px-4 py-3 bg-dark-tertiary/50 border-y border-dark-border">
          <div className="flex items-center justify-between">
            <span className="text-lg font-display font-bold text-bulk-cyan">
              ${formatNumber(lastPrice, 2)}
            </span>
            <span className="text-xs text-gray-500">
              Spread: <span className="text-bulk-yellow">{spread}%</span>
            </span>
          </div>
        </div>

        {/* Bids (buys) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {processedBids.map((level, i) => (
            <div key={`bid-${i}`} className="relative grid grid-cols-3 gap-2 px-4 py-1 text-sm hover:bg-dark-tertiary/30">
              {/* Depth bar */}
              <div 
                className="absolute right-0 top-0 bottom-0 bg-bulk-green/10"
                style={{ width: `${(level.total / maxTotal) * 100}%` }}
              />
              <span className="relative text-bulk-green font-mono">${formatNumber(level.px, 2)}</span>
              <span className="relative text-right text-gray-400 font-mono">{formatNumber(level.sz, 4)}</span>
              <span className="relative text-right text-gray-500 font-mono">{formatNumber(level.total, 4)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
