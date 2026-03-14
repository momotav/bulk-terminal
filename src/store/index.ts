import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme, Ticker, Liquidation, LeaderboardEntry, FullAccount } from '@/types';

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Market Data
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  tickers: Record<string, Ticker>;
  updateTicker: (ticker: Ticker) => void;

  // Liquidations
  liquidations: Liquidation[];
  addLiquidation: (liq: Liquidation) => void;
  clearLiquidations: () => void;

  // Leaderboard
  leaderboard: LeaderboardEntry[];
  updateLeaderboard: (entries: LeaderboardEntry[]) => void;

  // Account lookup
  searchedAccount: string | null;
  accountData: FullAccount | null;
  setSearchedAccount: (address: string | null) => void;
  setAccountData: (data: FullAccount | null) => void;

  // Trading panel
  tradingPanelOpen: boolean;
  setTradingPanelOpen: (open: boolean) => void;
  orderSide: 'buy' | 'sell';
  setOrderSide: (side: 'buy' | 'sell') => void;
  orderType: 'limit' | 'market';
  setOrderType: (type: 'limit' | 'market') => void;

  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ 
        theme: state.theme === 'dark' ? 'light' : 'dark' 
      })),

      // Market Data
      selectedSymbol: 'BTC-USD',
      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
      tickers: {},
      updateTicker: (ticker) => set((state) => ({
        tickers: { ...state.tickers, [ticker.symbol]: ticker }
      })),

      // Liquidations
      liquidations: [],
      addLiquidation: (liq) => set((state) => ({
        liquidations: [liq, ...state.liquidations].slice(0, 100)
      })),
      clearLiquidations: () => set({ liquidations: [] }),

      // Leaderboard
      leaderboard: [],
      updateLeaderboard: (entries) => set({ leaderboard: entries }),

      // Account lookup
      searchedAccount: null,
      accountData: null,
      setSearchedAccount: (address) => set({ searchedAccount: address }),
      setAccountData: (data) => set({ accountData: data }),

      // Trading panel
      tradingPanelOpen: false,
      setTradingPanelOpen: (open) => set({ tradingPanelOpen: open }),
      orderSide: 'buy',
      setOrderSide: (side) => set({ orderSide: side }),
      orderType: 'limit',
      setOrderType: (type) => set({ orderType: type }),

      // Connection
      connected: false,
      setConnected: (connected) => set({ connected }),
    }),
    {
      name: 'bulk-terminal-storage',
      partialize: (state) => ({ 
        theme: state.theme,
        selectedSymbol: state.selectedSymbol,
      }),
    }
  )
);

// Selectors for performance
export const useTheme = () => useStore((state) => state.theme);
export const useSelectedSymbol = () => useStore((state) => state.selectedSymbol);
export const useLiquidations = () => useStore((state) => state.liquidations);
export const useLeaderboard = () => useStore((state) => state.leaderboard);
export const useConnection = () => useStore((state) => state.connected);
