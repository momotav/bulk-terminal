'use client';

import { useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Info, Zap } from 'lucide-react';
import { formatNumber, cn } from '@/lib/api';
import { useStore } from '@/store';
import type { Ticker } from '@/types';

interface TradingPanelProps {
  ticker?: Ticker;
}

const leverageOptions = [1, 2, 5, 10, 20];

export function TradingPanel({ ticker }: TradingPanelProps) {
  const { selectedSymbol, orderSide, setOrderSide, orderType, setOrderType } = useStore();
  
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const markPrice = ticker?.markPrice || ticker?.lastPrice || 0;
  const sizeNum = parseFloat(size) || 0;
  const priceNum = orderType === 'market' ? markPrice : (parseFloat(price) || markPrice);
  
  const notional = sizeNum * priceNum;
  const margin = notional / leverage;
  const fee = notional * 0.0005; // 0.05% taker fee estimate

  const handleSubmit = useCallback(() => {
    if (!sizeNum || (orderType === 'limit' && !priceNum)) return;
    setShowConfirm(true);
  }, [sizeNum, priceNum, orderType]);

  const confirmOrder = useCallback(() => {
    // In a real implementation, this would sign and submit to the API
    console.log('Order submitted:', {
      symbol: selectedSymbol,
      side: orderSide,
      type: orderType,
      price: priceNum,
      size: sizeNum,
      leverage,
      reduceOnly,
    });
    
    // Reset form
    setShowConfirm(false);
    setSize('');
    if (orderType === 'limit') setPrice('');
  }, [selectedSymbol, orderSide, orderType, priceNum, sizeNum, leverage, reduceOnly]);

  const setPercentSize = (percent: number) => {
    // This would calculate based on available balance
    // For demo, just set a placeholder
    const baseSize = 0.1 * percent;
    setSize(baseSize.toFixed(4));
  };

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-yellow/20 flex items-center justify-center text-bulk-yellow">
            <Zap className="w-4 h-4" />
          </span>
          Trade {selectedSymbol}
        </h2>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar">
        {/* Buy/Sell Toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-dark-tertiary rounded-lg">
          <button
            onClick={() => setOrderSide('buy')}
            className={cn(
              "py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2",
              orderSide === 'buy'
                ? "bg-bulk-green text-dark-primary"
                : "text-gray-400 hover:text-bulk-green"
            )}
          >
            <TrendingUp className="w-4 h-4" />
            Long
          </button>
          <button
            onClick={() => setOrderSide('sell')}
            className={cn(
              "py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2",
              orderSide === 'sell'
                ? "bg-bulk-red text-white"
                : "text-gray-400 hover:text-bulk-red"
            )}
          >
            <TrendingDown className="w-4 h-4" />
            Short
          </button>
        </div>

        {/* Order Type */}
        <div className="flex gap-2">
          <button
            onClick={() => setOrderType('limit')}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
              orderType === 'limit'
                ? "bg-bulk-cyan/20 text-bulk-cyan border border-bulk-cyan/50"
                : "bg-dark-tertiary text-gray-400 hover:text-white"
            )}
          >
            Limit
          </button>
          <button
            onClick={() => setOrderType('market')}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
              orderType === 'market'
                ? "bg-bulk-cyan/20 text-bulk-cyan border border-bulk-cyan/50"
                : "bg-dark-tertiary text-gray-400 hover:text-white"
            )}
          >
            Market
          </button>
        </div>

        {/* Price Input (for limit orders) */}
        {orderType === 'limit' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 block">
              Price (USD)
            </label>
            <div className="relative">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={formatNumber(markPrice, 2)}
                className="input text-right pr-16 font-mono"
                step="0.01"
              />
              <button
                onClick={() => setPrice(markPrice.toFixed(2))}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] bg-dark-border rounded text-gray-400 hover:text-white"
              >
                Mark
              </button>
            </div>
          </div>
        )}

        {/* Size Input */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 block">
            Size ({selectedSymbol.split('-')[0]})
          </label>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="0.0000"
            className="input text-right font-mono"
            step="0.0001"
          />
          <div className="flex gap-1 mt-2">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => setPercentSize(pct / 100)}
                className="flex-1 py-1 text-xs bg-dark-tertiary rounded hover:bg-dark-border transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-[10px] uppercase tracking-wider text-gray-500">
              Leverage
            </label>
            <span className="text-sm font-bold text-bulk-cyan">{leverage}x</span>
          </div>
          <div className="flex gap-1">
            {leverageOptions.map(lev => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
                  leverage === lev
                    ? "bg-bulk-cyan text-dark-primary"
                    : "bg-dark-tertiary text-gray-400 hover:text-white"
                )}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>

        {/* Reduce Only */}
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            reduceOnly 
              ? "bg-bulk-cyan border-bulk-cyan" 
              : "border-dark-border group-hover:border-gray-500"
          )}>
            {reduceOnly && (
              <svg className="w-3 h-3 text-dark-primary" fill="currentColor" viewBox="0 0 12 12">
                <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
              </svg>
            )}
          </div>
          <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
            Reduce Only
          </span>
        </label>

        {/* Order Summary */}
        {sizeNum > 0 && (
          <div className="p-3 bg-dark-tertiary rounded-lg space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Notional Value</span>
              <span className="font-mono">${formatNumber(notional, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Required Margin</span>
              <span className="font-mono text-bulk-yellow">${formatNumber(margin, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Est. Fee</span>
              <span className="font-mono text-gray-400">${formatNumber(fee, 4)}</span>
            </div>
          </div>
        )}

        {/* Warning for high leverage */}
        {leverage >= 10 && (
          <div className="flex items-start gap-2 p-3 bg-bulk-orange/10 border border-bulk-orange/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-bulk-orange shrink-0 mt-0.5" />
            <p className="text-xs text-bulk-orange">
              High leverage increases liquidation risk. Trade responsibly.
            </p>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!sizeNum || (orderType === 'limit' && !priceNum)}
          className={cn(
            "w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed",
            orderSide === 'buy'
              ? "bg-bulk-green text-dark-primary hover:bg-bulk-green/90"
              : "bg-bulk-red text-white hover:bg-bulk-red/90"
          )}
        >
          {orderSide === 'buy' ? 'Long' : 'Short'} {selectedSymbol.split('-')[0]}
        </button>

        {/* Info */}
        <div className="flex items-center gap-2 text-[10px] text-gray-500 justify-center">
          <Info className="w-3 h-3" />
          <span>Connect wallet to place real orders</span>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-sm w-full p-6 space-y-4">
            <h3 className="font-display text-xl font-bold text-center">
              Confirm Order
            </h3>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className={cn(
                  "font-semibold",
                  orderSide === 'buy' ? "text-bulk-green" : "text-bulk-red"
                )}>
                  {orderType.toUpperCase()} {orderSide.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Symbol</span>
                <span className="font-semibold">{selectedSymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Size</span>
                <span className="font-mono">{formatNumber(sizeNum, 4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Price</span>
                <span className="font-mono">${formatNumber(priceNum, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Leverage</span>
                <span className="font-mono text-bulk-cyan">{leverage}x</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="py-3 rounded-lg bg-dark-tertiary hover:bg-dark-border transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={confirmOrder}
                className={cn(
                  "py-3 rounded-lg font-semibold transition-colors",
                  orderSide === 'buy'
                    ? "bg-bulk-green text-dark-primary hover:bg-bulk-green/90"
                    : "bg-bulk-red text-white hover:bg-bulk-red/90"
                )}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
