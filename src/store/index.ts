import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';
type TimeFrame = '24h' | '7d' | '30d' | 'all';

export interface User {
  id: number;
  wallet_address: string;
  privy_id?: string;
  twitter_id?: string;
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
  telegram_handle?: string;
  display_name?: string;
  avatar_url?: string;
  created_at: string;
  following_count?: number;
  stats?: {
    trade_count: number;
    total_volume: number;
    total_pnl: number;
    win_rate?: number;
  } | null;
}

export interface FollowedWallet {
  wallet_address: string;
  nickname?: string;
  followed_at: string;
  trade_count?: number;
  total_volume?: number;
  total_pnl?: number;
  win_rate?: number;
  last_trade_time?: string;
}

interface AppState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;

  following: FollowedWallet[];
  setFollowing: (following: FollowedWallet[]) => void;
  addFollowing: (wallet: FollowedWallet) => void;
  removeFollowing: (walletAddress: string) => void;

  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;

  timeframe: TimeFrame;
  setTimeframe: (tf: TimeFrame) => void;

  logout: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ 
        theme: state.theme === 'dark' ? 'light' : 'dark' 
      })),

      user: null,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      isAuthenticated: false,
      authToken: null,
      setAuthToken: (authToken) => set({ authToken }),

      following: [],
      setFollowing: (following) => set({ following }),
      addFollowing: (wallet) => set((state) => ({
        following: [...state.following, wallet]
      })),
      removeFollowing: (walletAddress) => set((state) => ({
        following: state.following.filter(w => w.wallet_address !== walletAddress)
      })),

      selectedSymbol: 'BTC-USD',
      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

      timeframe: '24h',
      setTimeframe: (timeframe) => set({ timeframe }),

      logout: () => set({
        user: null,
        isAuthenticated: false,
        authToken: null,
        following: [],
      }),
    }),
    {
      name: 'bulk-stats-storage',
      partialize: (state) => ({ 
        theme: state.theme,
        selectedSymbol: state.selectedSymbol,
      }),
    }
  )
);
