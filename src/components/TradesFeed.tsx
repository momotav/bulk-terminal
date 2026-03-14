'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { formatNumber, cn } from '@/lib/api';

interface Trade {
  id: string;
  px: number;
  sz: number;
  time: number;
  side: boolean;
}

interface TradesFeedProps {
  trades: Trade[];
  symbol: string;
}

export function TradesFeed({ trades, symbol }: TradesFeedProps) {
  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-cyan/20 flex items-center justify-center text-bulk-cyan">
            ⚡
          </span>
          Recent Trades
        </h2>
        <span className="text-xs text-gray-500">{symbol}</span>
      </div>

      {/* Header */}
      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-dark-border">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trades list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <AnimatePresence initial={false}>
          {trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <span className="text-3xl mb-2">⚡</span>
              <p className="text-sm">Waiting for trades...</p>
            </div>
          ) : (
            trades.slice(0, 50).map((trade, index) => (
              <motion.div
                key={trade.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "grid grid-cols-3 gap-2 px-4 py-1.5 text-sm font-mono border-b border-dark-border/30 hover:bg-dark-tertiary/30",
                  index === 0 && (trade.side ? "flash-green" : "flash-red")
                )}
              >
                <span className={trade.side ? "text-bulk-green" : "text-bulk-red"}>
                  ${formatNumber(trade.px, trade.px > 1000 ? 2 : 4)}
                </span>
                <span className="text-right text-gray-400">
                  {formatNumber(trade.sz, 4)}
                </span>
                <span className="text-right text-gray-500 text-xs">
                  {formatTime(trade.time)}
                </span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
