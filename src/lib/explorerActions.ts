// BULK action-code dictionary.
//
// Transactions on BULK contain "actions" — sub-units of work — that
// arrive in events as short string codes. The codes mirror BULK's
// order/operation type field from the trading API (per the dev:
// "for action code to what action is - refer to api place order
// to see L is limit order and Cx is cancel").
//
// Case matters: `L` (limit order) and `l` are different codes.
// Lowercase tends to be internal/protocol-side; uppercase tends to be
// user-initiated. We treat them as distinct keys here.
//
// As more codes appear in the explorer we observe them and confirm
// with the dev rather than guessing. Unknown codes render as raw
// monospace so they're clearly "this code exists but isn't named yet"
// rather than pretending to be labeled.

const ACTION_LABELS: Record<string, { label: string; description?: string }> = {
  // ─── User-initiated trading actions (uppercase per BULK convention) ───
  L:   { label: 'Limit Order',      description: 'Order to buy/sell at a specified price' },
  M:   { label: 'Market Order',     description: 'Order to buy/sell at the best available price' },
  Cx:  { label: 'Cancel',           description: 'Cancel an existing order' },
  // Likely others — to be confirmed/added as we observe them:
  // Mod: { label: 'Modify',            description: 'Modify an existing order' },
  // CxA: { label: 'Cancel All',        description: 'Cancel every order for an account' },
  // Tp:  { label: 'Take Profit',       description: 'Conditional close on profit threshold' },
  // Sl:  { label: 'Stop Loss',         description: 'Conditional close on loss threshold' },

  // ─── Protocol-side actions (lowercase) ───
  px:  { label: 'Price Update',     description: 'Oracle pushes mark price for a market' },
  m:   { label: 'Match',            description: 'Matching engine tick' },
  rng: { label: 'Range',            description: 'Range/pricing computation' },
  // Likely others:
  // liq: { label: 'Liquidation',       description: 'Forced position close by liquidation engine' },
  // adl: { label: 'Auto-Deleverage',   description: 'Position closed via ADL' },
  // fund:{ label: 'Funding',           description: 'Hourly funding payment exchange' },
  // dep: { label: 'Deposit',           description: 'Funds deposited to account' },
  // wd:  { label: 'Withdraw',          description: 'Funds withdrawn from account' },
};

// Returns the human-readable label for an action code, falling back to
// the raw code when unknown (so debugging is easy and the UI is honest).
export function getActionLabel(code: string): string {
  return ACTION_LABELS[code]?.label ?? code;
}

export function getActionDescription(code: string): string | undefined {
  return ACTION_LABELS[code]?.description;
}

// True if we have a human-readable label registered. Used in UI styling
// to differentiate "labeled action" (colored pill) from "unknown action"
// (mono raw text) so users can see at a glance whether we recognize it.
export function isKnownAction(code: string): boolean {
  return code in ACTION_LABELS;
}
