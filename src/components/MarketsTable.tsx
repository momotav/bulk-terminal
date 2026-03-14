'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatNumber, formatCompact, cn } from '@/lib/api';
import type { Ticker } from '@/types';

interface MarketsTableProps {
  tickers: Ticker[];
  onSelect?: (symbol: string) => void;
  selectedSymbol?: string;
}

const symbolIcons: Record<string, { gradient: string; abbr: string }> = {
  'BTC-USD': { gradient: 'from-orange-500 to-yellow-500', abbr: 'BTC' },
  'ETH-USD': { gradient: 'from-indigo-500 to-purple-500', abbr: 'ETH' },
  'SOL-USD': { gradient: 'from-purple-500 to-green-400', abbr: 'SOL' },
};

export function MarketsTable({ tickers, onSelect, selectedSymbol }: MarketsTableProps) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-cyan/20 flex items-center justify-center text-bulk-cyan">
            📊
          </span>
          Markets
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="text-left px-5 py-3 table-header">Market</th>
              <th className="text-right px-5 py-3 table-header">Price</th>
              <th className="text-right px-5 py-3 table-header">24h Change</th>
              <th className="text-right px-5 py-3 table-header">24h Volume</th>
              <th className="text-right px-5 py-3 table-header">Open Interest</th>
              <th className="text-right px-5 py-3 table-header">Funding (8h)</th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((ticker) => {
              const icon = symbolIcons[ticker.symbol] || { gradient: 'from-gray-500 to-gray-600', abbr: ticker.symbol.slice(0, 3) };
              const isPositive = (ticker.priceChangePercent || 0) >= 0;
              const isSelected = selectedSymbol === ticker.symbol;

              return (
                <tr
                  key={ticker.symbol}
                  onClick={() => onSelect?.(ticker.symbol)}
                  className={cn(
                    "table-row cursor-pointer transition-all",
                    isSelected && "bg-bulk-cyan/5 border-l-2 border-l-bulk-cyan"
                  )}
                >
                  {/* Market */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br",
                        icon.gradient
                      )}>
                        {icon.abbr}
                      </div>
                      <div>
                        <p className="font-semibold">{ticker.symbol.split('-')[0]}</p>
                        <p className="text-xs text-gray-500">{ticker.symbol}</p>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-5 py-4 text-right">
                    <span className="font-display text-lg font-semibold">
                      ${formatNumber(ticker.lastPrice || ticker.markPrice, ticker.lastPrice > 1000 ? 2 : 4)}
                    </span>
                  </td>

                  {/* 24h Change */}
                  <td className="px-5 py-4 text-right">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-semibold",
                      isPositive ? "bg-bulk-green/10 text-bulk-green" : "bg-bulk-red/10 text-bulk-red"
                    )}>
                      {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {isPositive ? '+' : ''}{formatNumber(ticker.priceChangePercent, 2)}%
                    </span>
                  </td>

                  {/* Volume */}
                  <td className="px-5 py-4 text-right text-gray-400">
                    ${formatCompact(ticker.quoteVolume || ticker.volume)}
                  </td>

                  {/* Open Interest */}
                  <td className="px-5 py-4 text-right text-gray-400">
                    ${formatCompact(ticker.openInterest)}
                  </td>

                  {/* Funding */}
                  <td className="px-5 py-4 text-right">
                    <span className={cn(
                      "text-sm font-medium",
                      (ticker.fundingRate || 0) >= 0 ? "text-bulk-green" : "text-bulk-red"
                    )}>
                      {((ticker.fundingRate || 0) * 100).toFixed(4)}%
                    </span>
                  </td>
                </tr>
              );
            })}

            {tickers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-bulk-cyan border-t-transparent rounded-full animate-spin" />
                    <span>Loading markets...</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
