// One number format for everything on the wallet page.

import { formatNumber } from '@/lib/api';

export const money = (n: number) => `${n < 0 ? '−' : ''}$${formatNumber(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`;
/** Under half a cent prints as $0.00, which is neither a gain nor a loss. */
const isZero = (n: number) => Math.abs(n) < 0.005;
export const signed = (n: number) => (isZero(n) ? '$0.00' : `${n >= 0 ? '+' : '−'}$${formatNumber(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`);
export const pnlColor = (n: number) => (isZero(n) ? 'var(--role-content)' : n >= 0 ? 'var(--pos)' : 'var(--neg)');
export const coinOf = (symbol: string) => symbol.replace(/-USD$/i, '');
export const shortDate = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// Fixed en-US. The shared ticker formatter follows the browser locale, which
// printed 1 212,20 beside $186,708.
export const formatPx = (n: number) => formatNumber(n, n >= 1 ? 2 : n >= 0.01 ? 4 : 6);
/** Local calendar day, the key the PnL and volume maps share. */
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
