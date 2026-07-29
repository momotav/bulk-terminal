// BULK action-code dictionary.
//
// Transactions on BULK contain "actions" — sub-units of work — that arrive in
// events as short string codes. This map is the authoritative mapping straight
// from BULK's API docs.
//
// Two things the earlier version got wrong, now corrected:
//   • The wire tags are LOWERCASE — `l`, `m`, `cx`, `cxa` — not `L`/`M`/`Cx`.
//   • `m` is a MARKET ORDER, not "Match".
// `tif` values (GTC / IOC / ALO) are a sub-field of `l`, not standalone codes,
// so they are deliberately absent here. Unknown codes fall back to the raw tag
// (see getActionLabel) so anything new shows honestly rather than mislabeled.

const ACTION_LABELS: Record<string, { label: string; description?: string }> = {
  // ─── Orders & order management ───
  l:    { label: 'Limit Order',       description: 'Resting limit order (GTC / IOC / ALO)' },
  m:    { label: 'Market Order',      description: 'Executes immediately at best available price' },
  mod:  { label: 'Modify',            description: 'Change the size of a resting order' },
  cx:   { label: 'Cancel',            description: 'Cancel a specific order by ID' },
  cxa:  { label: 'Cancel All',        description: 'Cancel all orders (by symbol or all symbols)' },

  // ─── Conditional / advanced orders ───
  st:   { label: 'Stop',              description: 'Conditional stop order' },
  tp:   { label: 'Take Profit',       description: 'Conditional take-profit order' },
  rng:  { label: 'Range / OCO',       description: 'Range collar (one-cancels-the-other)' },
  trig: { label: 'Trigger Basket',    description: 'Runs nested actions when a threshold is crossed' },
  trl:  { label: 'Trailing Stop',     description: 'Trailing conditional that follows favorable price' },
  of:   { label: 'On-Fill',           description: 'One-shot consequents on first fill of a parent action' },

  // ─── Builder codes ───
  abc:  { label: 'Approve Builder Code', description: 'Approve a builder-code fee recipient' },
  rbc:  { label: 'Revoke Builder Code',  description: 'Revoke a builder-code fee recipient' },

  // ─── Account / settings ───
  faucet:              { label: 'Faucet',            description: 'Request testnet funds' },
  agentWalletCreation: { label: 'Agent Wallet',      description: 'Register or remove an agent wallet' },
  updateUserSettings:  { label: 'Update Settings',   description: 'Update per-symbol leverage' },
  createSubAccount:    { label: 'Create Sub-Account' },
  removeSubAccount:    { label: 'Remove Sub-Account' },
  renameSubAccount:    { label: 'Rename Sub-Account' },
  transfer:            { label: 'Transfer',          description: 'Move margin between accounts' },

  // ─── Multisig ───
  createMultisig: { label: 'Create Multisig' },
  msp:  { label: 'Multisig Propose' },
  msa:  { label: 'Multisig Approve' },
  msr:  { label: 'Multisig Reject' },
  msc:  { label: 'Multisig Cancel' },
  mse:  { label: 'Multisig Execute' },
  msu:  { label: 'Multisig Update Policy' },

  // ─── Admin / oracle ───
  px:   { label: 'Oracle Price',      description: 'Admin/oracle mark-price update' },
  o:    { label: 'Pyth Oracle Batch', description: 'Batch Pyth oracle price updates (admin)' },
  whitelistFaucet: { label: 'Whitelist Faucet', description: 'Admin faucet whitelist' },
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
