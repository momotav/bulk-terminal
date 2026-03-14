'use client';

import { useState, useCallback } from 'react';
import { Search, Wallet, TrendingUp, TrendingDown, AlertCircle, X, Copy, Check } from 'lucide-react';
import { api, formatNumber, formatCompact, formatAddress, cn } from '@/lib/api';
import type { FullAccount, Position } from '@/types';

export function AccountLookup() {
  const [address, setAddress] = useState('');
  const [account, setAccount] = useState<FullAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!address.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getFullAccount(address.trim());
      if (data) {
        setAccount(data);
      } else {
        setError('Account not found or has no activity');
        setAccount(null);
      }
    } catch (err) {
      setError('Failed to fetch account data');
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearSearch = () => {
    setAddress('');
    setAccount(null);
    setError(null);
  };

  const totalPnL = account 
    ? (account.margin.realizedPnl || 0) + (account.margin.unrealizedPnl || 0)
    : 0;

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-green/20 flex items-center justify-center text-bulk-green">
            <Wallet className="w-4 h-4" />
          </span>
          Account Lookup
        </h2>
      </div>

      {/* Search Input */}
      <div className="p-4 border-b border-dark-border">
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter Solana wallet address..."
              className="input pl-10 pr-10 text-sm"
            />
            {address && (
              <button 
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !address.trim()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {error && (
          <div className="flex items-center gap-3 p-4 bg-bulk-red/10 border border-bulk-red/30 rounded-lg text-bulk-red">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!account && !error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Wallet className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-sm">Enter a wallet address to view account details</p>
            <p className="text-xs mt-1">Positions, margins, and open orders</p>
          </div>
        )}

        {account && (
          <div className="space-y-4">
            {/* Address Header */}
            <div className="flex items-center justify-between p-3 bg-dark-tertiary rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bulk-cyan to-bulk-magenta flex items-center justify-center text-white text-xs font-bold">
                  {address.slice(0, 2)}
                </div>
                <span className="font-mono text-sm">{formatAddress(address)}</span>
              </div>
              <button onClick={copyAddress} className="p-2 hover:bg-dark-border rounded-lg transition-colors">
                {copied ? <Check className="w-4 h-4 text-bulk-green" /> : <Copy className="w-4 h-4 text-gray-400" />}
              </button>
            </div>

            {/* Margin Overview */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-dark-tertiary rounded-lg">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Total Balance</p>
                <p className="font-display text-lg font-bold text-bulk-cyan">
                  ${formatNumber(account.margin.totalBalance, 2)}
                </p>
              </div>
              <div className="p-3 bg-dark-tertiary rounded-lg">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Available</p>
                <p className="font-display text-lg font-bold">
                  ${formatNumber(account.margin.availableBalance, 2)}
                </p>
              </div>
              <div className="p-3 bg-dark-tertiary rounded-lg">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Margin Used</p>
                <p className="font-display text-lg font-bold text-bulk-yellow">
                  ${formatNumber(account.margin.marginUsed, 2)}
                </p>
              </div>
              <div className="p-3 bg-dark-tertiary rounded-lg">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Total PnL</p>
                <p className={cn(
                  "font-display text-lg font-bold",
                  totalPnL >= 0 ? "text-bulk-green" : "text-bulk-red"
                )}>
                  {totalPnL >= 0 ? '+' : ''}{formatNumber(totalPnL, 2)}
                </p>
              </div>
            </div>

            {/* Positions */}
            {account.positions.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">
                  Open Positions ({account.positions.length})
                </h3>
                <div className="space-y-2">
                  {account.positions.map((pos, i) => (
                    <PositionCard key={i} position={pos} />
                  ))}
                </div>
              </div>
            )}

            {/* Open Orders */}
            {account.openOrders.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">
                  Open Orders ({account.openOrders.length})
                </h3>
                <div className="space-y-2">
                  {account.openOrders.map((order, i) => (
                    <div key={i} className="p-3 bg-dark-tertiary rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                            order.isBuy ? "bg-bulk-green/20 text-bulk-green" : "bg-bulk-red/20 text-bulk-red"
                          )}>
                            {order.isBuy ? 'Buy' : 'Sell'}
                          </span>
                          <span className="font-semibold text-sm">{order.symbol}</span>
                        </div>
                        <span className="text-xs text-gray-500 uppercase">{order.tif}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">
                          {formatNumber(order.size, 4)} @ ${formatNumber(order.price, 2)}
                        </span>
                        <span className="text-gray-500">
                          Filled: {formatNumber(order.filledSize, 4)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {account.positions.length === 0 && account.openOrders.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">No active positions or orders</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const isLong = position.size > 0;
  const pnlPercent = position.notional ? (position.unrealizedPnl / position.notional) * 100 : 0;

  return (
    <div className="p-3 bg-dark-tertiary rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            isLong ? "bg-bulk-green/15 text-bulk-green" : "bg-bulk-red/15 text-bulk-red"
          )}>
            {isLong ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          </span>
          <div>
            <p className="font-semibold text-sm">{position.symbol}</p>
            <p className="text-[10px] text-gray-500">
              {isLong ? 'Long' : 'Short'} {position.leverage}x
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className={cn(
            "font-display font-bold",
            position.unrealizedPnl >= 0 ? "text-bulk-green" : "text-bulk-red"
          )}>
            {position.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(position.unrealizedPnl, 2)}
          </p>
          <p className={cn(
            "text-xs",
            pnlPercent >= 0 ? "text-bulk-green" : "text-bulk-red"
          )}>
            {pnlPercent >= 0 ? '+' : ''}{formatNumber(pnlPercent, 2)}%
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-gray-500">Size</p>
          <p className="font-mono">{formatNumber(Math.abs(position.size), 4)}</p>
        </div>
        <div>
          <p className="text-gray-500">Entry</p>
          <p className="font-mono">${formatNumber(position.price, 2)}</p>
        </div>
        <div>
          <p className="text-gray-500">Liq. Price</p>
          <p className="font-mono text-bulk-red">${formatNumber(position.liquidationPrice, 2)}</p>
        </div>
      </div>
    </div>
  );
}
