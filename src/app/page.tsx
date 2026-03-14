'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { StatsCards } from '@/components/StatsCards';
import { MarketsTable } from '@/components/MarketsTable';
import { PriceChart } from '@/components/charts/PriceChart';
import { OrderBook } from '@/components/OrderBook';
import { TradesFeed } from '@/components/TradesFeed';
import { LiquidationsFeed } from '@/components/LiquidationsFeed';
import { Leaderboard } from '@/components/Leaderboard';
import { AccountLookup } from '@/components/account/AccountLookup';
import { TradingPanel } from '@/components/trading/TradingPanel';
import { useMarketData } from '@/hooks/useWebSocket';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import type { Ticker, Liquidation } from '@/types';

// Tab navigation for mobile/responsive
type TabType = 'markets' | 'trade' | 'liquidations' | 'account';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabType>('markets');
  const [initialTickers, setInitialTickers] = useState<Ticker[]>([]);
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  
  const { selectedSymbol, setSelectedSymbol, setConnected } = useStore();
  const { connected, tickers: wsTickers, trades, orderbook } = useMarketData();

  // Merge initial and websocket tickers
  const tickers = wsTickers.length > 0 ? wsTickers : initialTickers;
  const currentTicker = tickers.find(t => t.symbol === selectedSymbol);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const tickerData = await api.getAllTickers();
        setInitialTickers(tickerData);
      } catch (error) {
        console.error('Failed to load initial data:', error);
      }
    };
    loadInitialData();
  }, []);

  // Update connection status in store
  useEffect(() => {
    setConnected(connected);
  }, [connected, setConnected]);

  // Simulate liquidations for demo (in real app, these come from WebSocket)
  useEffect(() => {
    if (!connected) return;

    const interval = setInterval(() => {
      const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const ticker = tickers.find(t => t.symbol === symbol);
      const price = ticker?.lastPrice || 50000;
      const side = Math.random() > 0.5 ? 'long' : 'short';
      const size = Math.random() * 2 + 0.1;
      
      const liq: Liquidation = {
        id: `${Date.now()}-${Math.random()}`,
        symbol,
        side,
        size,
        price: price * (1 + (Math.random() - 0.5) * 0.01),
        value: size * price,
        address: generateRandomAddress(),
        timestamp: Date.now(),
      };
      
      setLiquidations(prev => [liq, ...prev].slice(0, 100));
    }, 5000 + Math.random() * 10000);

    return () => clearInterval(interval);
  }, [connected, tickers]);

  const handleSelectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, [setSelectedSymbol]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      {/* Mobile Tab Navigation */}
      <div className="lg:hidden flex border-b border-dark-border bg-dark-secondary/50 backdrop-blur-sm sticky top-0 z-20">
        {[
          { id: 'markets', label: 'Markets', icon: '📊' },
          { id: 'trade', label: 'Trade', icon: '⚡' },
          { id: 'liquidations', label: 'Liqs', icon: '🔥' },
          { id: 'account', label: 'Account', icon: '👛' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex-1 py-3 text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'text-bulk-cyan border-b-2 border-bulk-cyan bg-bulk-cyan/5'
                : 'text-gray-500 hover:text-white'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 lg:p-6">
        {/* Stats Cards - Always visible */}
        <div className="mb-6">
          <StatsCards tickers={tickers} />
        </div>

        {/* Desktop Layout */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-6">
          {/* Left Column - Markets & Chart */}
          <div className="col-span-8 space-y-6">
            <MarketsTable 
              tickers={tickers} 
              onSelect={handleSelectSymbol}
              selectedSymbol={selectedSymbol}
            />
            
            <div className="h-[500px]">
              <PriceChart />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="h-[400px]">
                <OrderBook 
                  bids={orderbook.bids}
                  asks={orderbook.asks}
                  lastPrice={currentTicker?.lastPrice}
                  symbol={selectedSymbol}
                />
              </div>
              <div className="h-[400px]">
                <TradesFeed trades={trades} symbol={selectedSymbol} />
              </div>
            </div>
          </div>

          {/* Right Column - Trading, Liquidations, Account */}
          <div className="col-span-4 space-y-6">
            <div className="h-[580px]">
              <TradingPanel ticker={currentTicker} />
            </div>
            
            <div className="h-[350px]">
              <LiquidationsFeed liquidations={liquidations} />
            </div>
            
            <div className="h-[400px]">
              <Leaderboard />
            </div>
            
            <div className="h-[450px]">
              <AccountLookup />
            </div>
          </div>
        </div>

        {/* Mobile Layout - Tab Content */}
        <div className="lg:hidden">
          {activeTab === 'markets' && (
            <div className="space-y-4">
              <MarketsTable 
                tickers={tickers} 
                onSelect={handleSelectSymbol}
                selectedSymbol={selectedSymbol}
              />
              <div className="h-[400px]">
                <PriceChart />
              </div>
              <div className="h-[350px]">
                <OrderBook 
                  bids={orderbook.bids}
                  asks={orderbook.asks}
                  lastPrice={currentTicker?.lastPrice}
                  symbol={selectedSymbol}
                />
              </div>
            </div>
          )}

          {activeTab === 'trade' && (
            <div className="space-y-4">
              <div className="h-[600px]">
                <TradingPanel ticker={currentTicker} />
              </div>
              <div className="h-[300px]">
                <TradesFeed trades={trades} symbol={selectedSymbol} />
              </div>
            </div>
          )}

          {activeTab === 'liquidations' && (
            <div className="space-y-4">
              <div className="h-[400px]">
                <LiquidationsFeed liquidations={liquidations} />
              </div>
              <div className="h-[500px]">
                <Leaderboard />
              </div>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="h-[600px]">
              <AccountLookup />
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-dark-border py-4 px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-4">
            <span>Powered by <span className="gradient-text font-semibold">BULK Exchange</span></span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">Alphanet</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://alphanet.bulk.trade" target="_blank" rel="noopener noreferrer" className="hover:text-bulk-cyan transition-colors">
              Trade
            </a>
            <a href="https://explorer.bulk.trade" target="_blank" rel="noopener noreferrer" className="hover:text-bulk-cyan transition-colors">
              Explorer
            </a>
            <a href="https://exchange-api.bulk.trade" target="_blank" rel="noopener noreferrer" className="hover:text-bulk-cyan transition-colors">
              API Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Helper to generate random Solana-like addresses
function generateRandomAddress(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
