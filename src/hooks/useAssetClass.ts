'use client';

// Site-wide market-class filter (All / Crypto / Stocks).
//
// BULK listed stock perps in 2026-11 and exposes no asset-class field, so the
// split is ours (see STOCK_COINS in lib/coins). The chosen class lives in the
// persisted store so every page agrees; this hook is the ergonomic wrapper
// pages and components use to (a) read it, (b) get the class's default pills,
// and (c) filter a per-coin dict down to the class before bucketing.

import { useCallback, useMemo } from 'react';
import { useStore } from '@/store';
import {
  type AssetClass,
  ASSET_CLASSES,
  defaultCoinsFor,
  filterCoinsByClass,
  inAssetClass,
} from '@/lib/coins';

export interface UseAssetClassResult {
  assetClass: AssetClass;
  setAssetClass: (cls: AssetClass) => void;
  /** Default pills for the current class (BTC/ETH/SOL or SNDK/MU/NVDA). */
  defaults: readonly string[];
  /** "All" / "Crypto" / "Stocks". */
  label: string;
  /** True when the filter is narrowing (anything but "all"). */
  narrowed: boolean;
  /** Is this coin visible under the current class? */
  isIn: (coin: string) => boolean;
  /** Drop out-of-class keys from a per-coin dict. Identity when "all". */
  filterDict: <T>(dict: Record<string, T>) => Record<string, T>;
}

export function useAssetClass(): UseAssetClassResult {
  const assetClass = useStore((s) => s.assetClass);
  const setAssetClass = useStore((s) => s.setAssetClass);

  const isIn = useCallback((coin: string) => inAssetClass(coin, assetClass), [assetClass]);
  const filterDict = useCallback(
    <T,>(dict: Record<string, T>) => filterCoinsByClass(dict, assetClass),
    [assetClass],
  );

  return useMemo(
    () => ({
      assetClass,
      setAssetClass,
      defaults: defaultCoinsFor(assetClass),
      label: ASSET_CLASSES.find((c) => c.key === assetClass)?.label ?? 'All',
      narrowed: assetClass !== 'all',
      isIn,
      filterDict,
    }),
    [assetClass, setAssetClass, isIn, filterDict],
  );
}
