# Coin logos

BULK's own coin icons, one SVG per listed market, fetched from
`https://app.bulk.trade/assets/coins/<SYMBOL>.svg` on 2026-11-10. `CoinIcon`
(src/components/CoinIcon.tsx) maps each symbol in its `LOCAL` table, and the
PnL share card loads `/coins/<SYMBOL>.svg` for its canvas.

When BULK lists a new market, fetch its icon from the same path (the app is
behind a Vercel bot check, so load it in a browser), save it here as
`<SYMBOL>.svg` and add it to `LOCAL`. Until then the coin falls back to a public
CDN icon or a coloured monogram.

The SVGs bring their own shape (crypto round, stocks rounded-square), so
they're drawn unclipped. `XAU.png` is older and stays for the hidden XAU market.
