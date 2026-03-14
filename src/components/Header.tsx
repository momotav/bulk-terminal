'use client';

import { Sun, Moon, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '@/store';
import { cn } from '@/lib/api';

export function Header() {
  const { theme, toggleTheme, connected } = useStore();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-dark-border">
      {/* Logo */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-bulk-cyan to-bulk-magenta flex items-center justify-center font-display font-black text-xl animate-pulse-glow">
          B
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold gradient-text">
            BULK
          </h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-[3px]">
            Terminal Dashboard
          </p>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Connection Status */}
        <div className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg border",
          connected 
            ? "border-bulk-green/30 bg-bulk-green/10" 
            : "border-bulk-red/30 bg-bulk-red/10"
        )}>
          {connected ? (
            <>
              <Wifi className="w-4 h-4 text-bulk-green" />
              <span className="text-sm text-bulk-green">Live</span>
              <span className="w-2 h-2 rounded-full bg-bulk-green animate-pulse" />
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-bulk-red" />
              <span className="text-sm text-bulk-red">Connecting...</span>
            </>
          )}
        </div>

        {/* Network Badge */}
        <div className="px-3 py-1.5 rounded-full bg-gradient-to-r from-bulk-orange to-bulk-yellow text-dark-primary text-xs font-bold uppercase tracking-wider">
          Alphanet
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-lg bg-dark-tertiary hover:bg-dark-border transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-bulk-yellow" />
          ) : (
            <Moon className="w-5 h-5 text-bulk-cyan" />
          )}
        </button>
      </div>
    </header>
  );
}
