/**
 * Shared coin configuration.
 *
 * This file is the single source of truth for:
 *   - Which coins are shown BY DEFAULT on every chart (BTC / ETH / SOL)
 *   - The color palette used to render every coin consistently across pages
 *   - The bucketing helper that collapses non-selected coins into an "Other" slice
 *
 * The rest of the app should NEVER hardcode coin lists or colors — always import
 * from here. When BULK adds a new market, the frontend adapts automatically
 * because the full list is fetched from /api/analytics/exchange-info.
 */

// ---- Constants ------------------------------------------------------------

/**
 * Coins that appear as toggle pills by default on every chart.
 * Ordered by significance so the stacking order is stable across charts.
 */
export const DEFAULT_COINS = ['BTC', 'ETH', 'SOL'] as const;

/**
 * Coins to completely hide from the UI — they won't appear in any coin
 * picker, dropdown, chart toggle, treemap, or map. Used for markets we
 * don't want to surface (e.g. XAU, which BULK lists as a perpetual but
 * which we've chosen not to expose on bulkstats for now).
 *
 * The list is filtered out inside `useAvailableCoins` so every downstream
 * consumer (CoinSelector, CoinPicker, orderbook market picker, etc.)
 * automatically sees a universe without these symbols — no per-caller
 * changes needed.
 *
 * Note: this only affects what's DISPLAYED. The backend continues to
 * collect data for these coins; hiding is purely a frontend concern, so
 * if you later change your mind and want XAU visible, just remove it
 * from this list — no data loss, no migration.
 */
export const HIDDEN_COINS: readonly string[] = ['XAU'];

// ---- Asset classes --------------------------------------------------------
//
// BULK listed its first stock perps (NVDA, TSLA, MSTR, …) on 2026-11-01. Its
// /exchangeInfo carries NO asset-class field — a stock record is shaped
// exactly like BTC's — so the crypto/stock split is OURS, curated here. The
// backend's /exchange-info proxy stamps the same classification onto each
// market (`assetClass`) from an identical list, and the frontend trusts that
// when present; this table is the fallback so the split keeps working even if
// the backend is behind.
//
// PAXG (tokenised gold) is deliberately classed as crypto: it's an on-chain
// token, and a one-coin "commodities" group would look thin. Revisit if BULK
// lists more metals.
//
// Stocks on BULK trade 24/7 (continuous hourly candles through the weekend,
// verified on NVDA), so no market-hours special-casing is needed anywhere.

export type AssetClass = 'all' | 'crypto' | 'stock';

export const ASSET_CLASSES: readonly { key: AssetClass; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'crypto', label: 'Crypto' },
  // User-facing label is "TradFi" (user's call, 2026-11-04); the key stays
  // 'stock' because it's persisted in localStorage and stamped by the backend.
  { key: 'stock', label: 'TradFi' },
];

/** Base symbols BULK lists that are equities or equity-like (SPACEX, the US500 index). */
export const STOCK_COINS: readonly string[] = [
  'NVDA', 'TSLA', 'MSTR', 'MU', 'SNDK', 'SKHYNIX', 'CRCL', 'SPACEX', 'US500',
];

/** Human names for the tickers — shown as a hint in pickers and the markets table. */
export const STOCK_NAMES: Record<string, string> = {
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
  MSTR: 'Strategy',
  MU: 'Micron',
  SNDK: 'Sandisk',
  SKHYNIX: 'SK hynix',
  CRCL: 'Circle',
  SPACEX: 'SpaceX',
  US500: 'S&P 500',
};

const STOCK_SET = new Set(STOCK_COINS);

/** Normalise "nvda-usd" / "NVDA-USD" / "NVDA" → "NVDA". */
export const baseCoin = (symbol: string): string => symbol.replace(/-USD$/i, '').toUpperCase();

/** Which group a coin belongs to. Anything not in STOCK_COINS is crypto. */
export function coinClass(coin: string): Exclude<AssetClass, 'all'> {
  return STOCK_SET.has(baseCoin(coin)) ? 'stock' : 'crypto';
}

/** True when `coin` should be visible under the given class filter. */
export function inAssetClass(coin: string, cls: AssetClass): boolean {
  return cls === 'all' || coinClass(coin) === cls;
}

/**
 * Default pills per class. "All" keeps the historical BTC/ETH/SOL trio;
 * "Stocks" uses the three busiest stock perps as of listing week.
 */
export const DEFAULT_COINS_BY_CLASS: Record<AssetClass, readonly string[]> = {
  all: DEFAULT_COINS,
  crypto: DEFAULT_COINS,
  stock: ['SNDK', 'MU', 'NVDA'],
};

export const defaultCoinsFor = (cls: AssetClass): readonly string[] => DEFAULT_COINS_BY_CLASS[cls];

/**
 * Drop every key of a per-coin dict that falls outside the class. This is the
 * ONE chokepoint pages use to make every chart class-aware: filter the raw
 * `coins` dict before bucketing, and the enabled series, the "Other" sum and
 * every cumulative line all follow automatically.
 */
export function filterCoinsByClass<T>(dict: Record<string, T>, cls: AssetClass): Record<string, T> {
  if (cls === 'all') return dict;
  const out: Record<string, T> = {};
  for (const [coin, v] of Object.entries(dict)) {
    if (inAssetClass(coin, cls)) out[coin] = v;
  }
  return out;
}

/** Sum of the finite numeric values in a per-coin dict. */
export function sumCoins(dict: Record<string, unknown>): number {
  let s = 0;
  for (const v of Object.values(dict)) if (typeof v === 'number' && isFinite(v)) s += v;
  return s;
}

/**
 * Special aggregate bucket name. Used both as a series key in chart data and
 * as a toggle pill label. "Other" is shown alongside the default 3 coins and
 * holds the combined value of every coin the user hasn't explicitly enabled.
 */
export const OTHER_KEY = 'Other';

/**
 * Default selection when a chart first loads. BTC/ETH/SOL as named series
 * plus the aggregated Other bucket — matches the 4-pill Hyperliquid default.
 */
export const DEFAULT_ENABLED: readonly string[] = [...DEFAULT_COINS, OTHER_KEY];

/**
 * Color palette. Every coin needs a deterministic color. We keep the original
 * BTC/ETH/SOL colors (they're embedded in user memory from the existing site)
 * and assign distinctive colors to the rest of the known markets.
 *
 * Colors for unknown coins are derived from a hash of the coin name (see
 * `getCoinColor` below) so nothing ever renders as undefined/black.
 */
export const COIN_COLORS: Record<string, string> = {
  // Originals — keep exactly as they were on the legacy 3-coin build.
  BTC: 'var(--coin-3)',
  ETH: 'var(--coin-1)',
  SOL: 'var(--coin-5)',

  // Known BULK markets — pick visually distinct colors.
  GOLD: 'var(--coin-2)',
  XRP: 'var(--coin-4)',
  BNB: 'var(--coin-6)',
  ZEC: 'var(--coin-7)',
  SUI: 'var(--coin-8)',
  DOGE: 'var(--coin-4)',
  FARTCOIN: 'var(--coin-6)',
  HYPE: 'var(--coin-7)',

  // Stock perps (listed 2026-11). The three "Stocks" defaults get the most
  // separated hues so the default stack reads cleanly; the rest are spread
  // across the remaining ramp.
  SNDK: 'var(--coin-8)',
  MU: 'var(--coin-6)',
  NVDA: 'var(--coin-2)',
  TSLA: 'var(--coin-4)',
  MSTR: 'var(--coin-7)',
  SKHYNIX: 'var(--coin-1)',
  CRCL: 'var(--coin-3)',
  SPACEX: 'var(--coin-5)',
  US500: 'var(--coin-3)',

  // Aggregate bucket — neutral so it doesn't compete with named series.
  [OTHER_KEY]: 'var(--coin-other)',

  // UI-only keys (used in composed charts alongside coin bars).
  cumulative: 'var(--accent)',
  total:      'var(--accent)',
};

/**
 * Palette for coins we don't know about — deterministic per coin name so the
 * same coin gets the same color across page reloads. Good contrast on dark bg.
 */
const FALLBACK_PALETTE = [
  'var(--coin-1)', 'var(--coin-2)', 'var(--coin-3)', 'var(--coin-4)',
  'var(--coin-5)', 'var(--coin-6)', 'var(--coin-7)', 'var(--coin-8)',
];

/**
 * Hash a string into a [0, n) bucket — stable and locale-independent.
 * We use a small djb2 variant; overkill for this case but trivial to ship.
 */
function hashString(s: string, buckets: number): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % buckets;
}

/**
 * Get the color for a coin. Known coins use the table above; unknown coins
 * get a deterministic fallback from the palette so they still render nicely.
 */
export function getCoinColor(coin: string): string {
  const explicit = COIN_COLORS[coin];
  if (explicit) return explicit;
  return FALLBACK_PALETTE[hashString(coin, FALLBACK_PALETTE.length)];
}

// ---- Types ----------------------------------------------------------------

/**
 * Raw per-coin data point coming out of the backend analytics endpoints AFTER
 * we migrate them to the dictionary shape. Before migration, legacy endpoints
 * still return `{ BTC, ETH, SOL }` — we have an adapter in this file to
 * convert old-shape rows into the new shape so chart components can be
 * upgraded incrementally.
 */
export interface CoinDataPoint {
  timestamp: string;
  /** Per-coin values, keyed by coin name without the -USD suffix. */
  coins: Record<string, number>;
  /** Any extra fields (e.g. total, Cumulative) still supported. */
  [extra: string]: unknown;
}

/**
 * The view-model shape that chart components render. This is what
 * `bucketWithOther` returns — a flat object with keys BTC/ETH/SOL/Other plus
 * any user-enabled additional coins, ready to be used as Recharts dataKeys.
 */
export interface BucketedPoint {
  timestamp: string;
  [coinOrOther: string]: number | string;
}

// ---- Bucketing helper -----------------------------------------------------

/**
 * Convert raw per-coin data into chart-ready rows where enabled coins are
 * kept as their own keys and everything else is summed into `Other`.
 *
 * UX contract (from the design discussion):
 *   - BTC/ETH/SOL are always-visible default pills (still individual series)
 *   - "Other" is on by default and holds the sum of every non-enabled coin
 *   - When the user enables a non-default coin (e.g. ZEC), that coin becomes
 *     its own series and is SUBTRACTED from Other so totals still reconcile
 *   - When the user DISABLES a default coin (e.g. BTC off), that coin is NOT
 *     folded into Other — it just disappears. This matches Hyperliquid.
 *
 * Arguments:
 *   data         — raw per-coin rows from the API
 *   enabledCoins — which coin keys the user currently has toggled on
 *                  (may include the special OTHER_KEY)
 *
 * Returns: view-model rows. Keys present on each row are exactly
 *   { timestamp, ...(intersection of enabledCoins with coins present in row) }
 * plus `Other` iff OTHER_KEY is enabled, holding the sum of every coin that
 * appears in the raw data but is NOT in enabledCoins.
 */
export function bucketWithOther(
  data: CoinDataPoint[],
  enabledCoins: readonly string[]
): BucketedPoint[] {
  const enabledSet = new Set(enabledCoins);
  const showOther = enabledSet.has(OTHER_KEY);
  // Hidden coins are silently dropped here — their values don't show as their
  // own series, and they're NOT folded into Other either. This keeps
  // totalCumulative / Other-bucket sums consistent with what the user sees.
  const hiddenSet = new Set(HIDDEN_COINS);

  return data.map((row) => {
    const out: BucketedPoint = { timestamp: row.timestamp };
    let otherSum = 0;

    for (const [coin, value] of Object.entries(row.coins)) {
      if (typeof value !== 'number' || !isFinite(value)) continue;
      if (hiddenSet.has(coin)) continue; // dropped entirely
      if (enabledSet.has(coin)) {
        // User wants this coin shown as its own series.
        out[coin] = value;
      } else if (showOther && coin !== OTHER_KEY) {
        // Fold into Other (but never double-count an Other key if the data
        // source already has one — that would only happen via the adapter).
        otherSum += value;
      }
    }

    // Carry forward pre-computed metadata like `total` / `Cumulative` so
    // existing composed charts keep working. CRUCIAL: do NOT copy the raw row's
    // top-level per-coin fields (backend rows carry both a `coins` dict AND
    // legacy top-level BTC/ETH/SOL/Other keys). Those are already handled by the
    // bucketing above; re-copying them re-introduces a DESELECTED coin's value
    // as a stray key, which then gets counted a second time (once as the leftover
    // key, once inside Other) — making the total rise when a coin is unchecked.
    for (const [k, v] of Object.entries(row)) {
      if (k === 'timestamp' || k === 'coins') continue;
      if (k === OTHER_KEY || (row.coins && k in row.coins)) continue; // per-coin: handled by bucketing
      if (typeof v === 'number') out[k] = v;
    }

    if (showOther) out[OTHER_KEY] = otherSum;
    return out;
  });
}

// ---- Legacy-shape adapter -------------------------------------------------

/**
 * Convert legacy chart rows of shape `{ timestamp, BTC, ETH, SOL, ... }` into
 * the new `{ timestamp, coins: { BTC, ETH, SOL } }` shape. This lets us adopt
 * `bucketWithOther` incrementally — charts that still get old-shape data from
 * the backend can wrap responses with this adapter instead of rewriting the
 * backend all at once.
 *
 * Non-coin numeric fields (total, Cumulative, value, etc.) are preserved at
 * the top level so downstream code can still read them.
 */
export function adaptLegacyRow(
  row: Record<string, unknown>,
  knownCoins: readonly string[] = DEFAULT_COINS
): CoinDataPoint {
  const coins: Record<string, number> = {};
  const carry: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(row)) {
    if (k === 'timestamp') continue;
    if (knownCoins.includes(k) && typeof v === 'number') {
      coins[k] = v;
    } else {
      carry[k] = v;
    }
  }

  return {
    timestamp: String(row.timestamp ?? ''),
    coins,
    ...carry,
  };
}
