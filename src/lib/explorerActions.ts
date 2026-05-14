// BULK action-code dictionary.
//
// Transactions on BULK contain "actions" — sub-units of work — that
// arrive in events as short string codes (`px`, `m`, `rng`, etc.).
// These codes are opaque to anyone who hasn't read the BULK source.
// We map them to human-readable labels so the explorer UI isn't a
// wall of jargon.
//
// This dictionary is built from observed traffic + docs examples. The
// real source of truth lives in BULK's client code; we should periodically
// reconcile. Unknown codes fall through with the raw value displayed.
//
// Pull request from a future me / the dev: when new codes appear,
// append them here rather than letting them render as cryptic two-letter
// strings.

const ACTION_LABELS: Record<string, { label: string; description?: string }> = {
  // Oracle / price feed
  px: { label: 'Price Update', description: 'Oracle pushes mark price for a market' },

  // Matching engine (from docs example)
  m: { label: 'Match', description: 'Order matching tick' },
  rng: { label: 'Range', description: 'Range/pricing computation' },

  // Common patterns we expect but haven't confirmed yet:
  // dep, wd, liq, ord, can — to be filled in when seen.
};

// Returns the human-readable label for an action code, falling back to
// the raw code in monospace when unknown (so debugging is easy).
export function getActionLabel(code: string): string {
  return ACTION_LABELS[code]?.label ?? code;
}

export function getActionDescription(code: string): string | undefined {
  return ACTION_LABELS[code]?.description;
}

// True if we have a human-readable label registered. Useful for UI
// styling (e.g. show as a colored pill if known, dim mono text if not).
export function isKnownAction(code: string): boolean {
  return code in ACTION_LABELS;
}
