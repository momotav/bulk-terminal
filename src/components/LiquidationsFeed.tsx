'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import { formatNumber, formatCompact, formatAddress, timeAgo, cn } from '@/lib/api';
import type { Liquidation } from '@/types';

interface LiquidationsFeedProps {
  liquidations: Liquidation[];
  maxItems?: number;
}

export function LiquidationsFeed({ liquidations, maxItems = 20 }: LiquidationsFeedProps) {
  const displayLiqs = liquidations.slice(0, maxItems);

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-red/20 flex items-center justify-center">
            <Flame className="w-4 h-4 text-bulk-red" />
          </span>
          Recent Liquidations
        </h2>
        <span className="text-xs text-gray-500">
          {liquidations.length} total
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <AnimatePresence initial={false}>
          {displayLiqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Flame className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No liquidations yet...</p>
              <p className="text-xs mt-1">Watching for rekt traders</p>
            </div>
          ) : (
            displayLiqs.map((liq, index) => (
              <motion.div
                key={liq.id}
                initial={{ opacity: 0, x: -20, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                exit={{ opacity: 0, x: 20, height: 0 }}
                transition={{ duration: 0.3, delay: index * 0.02 }}
                className="border-b border-dark-border/50 last:border-0"
              >
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-dark-tertiary/30 transition-colors">
                  {/* Icon */}
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    liq.side === 'long' 
                      ? "bg-bulk-red/15 text-bulk-red" 
                      : "bg-bulk-green/15 text-bulk-green"
                  )}>
                    {liq.side === 'long' ? (
                      <TrendingDown className="w-5 h-5" />
                    ) : (
                      <TrendingUp className="w-5 h-5" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        liq.side === 'long' 
                          ? "bg-bulk-red/20 text-bulk-red" 
                          : "bg-bulk-green/20 text-bulk-green"
                      )}>
                        {liq.side}
                      </span>
                      <span className="font-semibold text-sm">{liq.symbol}</span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>
                        Size: <span className="text-bulk-cyan font-medium">{formatNumber(liq.size, 4)}</span>
                      </span>
                      <span>
                        @ <span className="text-bulk-cyan font-medium">${formatNumber(liq.price, 2)}</span>
                      </span>
                    </div>

                    {liq.address && (
                      <p className="text-[10px] text-gray-600 mt-1 font-mono">
                        {formatAddress(liq.address)}
                      </p>
                    )}
                  </div>

                  {/* Value & Time */}
                  <div className="text-right shrink-0">
                    <p className={cn(
                      "font-display font-bold text-sm",
                      liq.side === 'long' ? "text-bulk-red" : "text-bulk-green"
                    )}>
                      ${formatCompact(liq.value)}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {timeAgo(liq.timestamp)}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
