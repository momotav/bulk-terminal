import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/lib/api';

type Theme = 'dark' | 'light';
type TimeFrame = '24h' | '7d' | '30d' | 'all';

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Auth
  user: User | null;
  setUser: (user: User | null) => void;

  // Selected market for analytics
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;

  // Timeframe filter
  timeframe: TimeFrame;
  setTimeframe: (tf: TimeFrame) => void;

  // Watchlist (local cache)
  watchlist: string[];
  addToWatchlist: (address: string) => void;
  removeFromWatchlist: (address: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ 
        theme: state.theme === 'dark' ? 'light' : 'dark' 
      })),

      // Auth
      user: null,
      setUser: (user) => set({ user }),

      // Selected market
      selectedSymbol: 'BTC-USD',
      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

      // Timeframe
      timeframe: '24h',
      setTimeframe: (timeframe) => set({ timeframe }),

      // Watchlist
      watchlist: [],
      addToWatchlist: (address) => set((state) => ({
        watchlist: state.watchlist.includes(address) 
          ? state.watchlist 
          : [...state.watchlist, address]
      })),
      removeFromWatchlist: (address) => set((state) => ({
        watchlist: state.watchlist.filter(a => a !== address)
      })),
    }),
    {
      name: 'bulk-terminal-storage',
      partialize: (state) => ({ 
        theme: state.theme,
        selectedSymbol: state.selectedSymbol,
        watchlist: state.watchlist,
      }),
    }
  )
);
