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
  BTC: '#00B481',  // green
  ETH: '#2271B5',  // blue
  SOL: '#7570B3',  // purple

  // Known BULK markets — pick visually distinct colors.
  GOLD:     '#FFD700', // gold
  XRP:      '#23292F', // near-black (brand)
  BNB:      '#F3BA2F', // binance yellow
  ZEC:      '#ECB244', // zcash orange-yellow
  SUI:      '#4DA2FF', // sui blue
  DOGE:     '#C2A633', // doge tan
  FARTCOIN: '#A855F7', // purple-pink (playful)
  HYPE:     '#97FBE4', // hyperliquid teal (in case BULK lists it)

  // Aggregate bucket — neutral so it doesn't compete with named series.
  [OTHER_KEY]: '#888888',

  // UI-only keys (used in composed charts alongside coin bars).
  cumulative: '#FFB548',
  total:      '#FFB548',
};

/**
 * Palette for coins we don't know about — deterministic per coin name so the
 * same coin gets the same color across page reloads. Good contrast on dark bg.
 */
const FALLBACK_PALETTE = [
  '#EF4A3C', '#06B6D4', '#84CC16', '#F97316', '#14B8A6',
  '#EC4899', '#8B5CF6', '#22D3EE', '#F59E0B', '#10B981',
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

  return data.map((row) => {
    const out: BucketedPoint = { timestamp: row.timestamp };
    let otherSum = 0;

    for (const [coin, value] of Object.entries(row.coins)) {
      if (typeof value !== 'number' || !isFinite(value)) continue;
      if (enabledSet.has(coin)) {
        // User wants this coin shown as its own series.
        out[coin] = value;
      } else if (showOther && coin !== OTHER_KEY) {
        // Fold into Other (but never double-count an Other key if the data
        // source already has one — that would only happen via the adapter).
        otherSum += value;
      }
    }

    // Carry forward any pre-computed fields like `total` or `Cumulative` so
    // existing composed charts keep working without changes.
    for (const [k, v] of Object.entries(row)) {
      if (k === 'timestamp' || k === 'coins') continue;
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
