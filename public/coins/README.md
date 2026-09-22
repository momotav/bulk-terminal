# Coin logos

Drop coin logo files here to match BULK exactly. `CoinIcon` looks for them
first, so anything you add overrides the CDN / monogram fallback.

## Naming

`<SYMBOL>.svg` (preferred) or `<SYMBOL>.png` — UPPERCASE base asset, e.g.:

    public/coins/BTC.svg
    public/coins/HYPE.png
    public/coins/FARTCOIN.svg

Square images work best (they're rendered in a circle).

## What's already handled automatically

These 8 are pulled from a public CDN with no file needed (though a local file
still overrides them): **BTC, ETH, SOL, BNB, DOGE, AAVE, XRP, ZEC**.

## What you'll want to add (the CDN doesn't have these)

**ENA, FARTCOIN, HYPE, JTO, JUP, LIT, MEGA, MON, NEAR, PUMP, SUI, TAO, XAU, XPL**

Grab each from BULK (or the token's site) and save as `<SYMBOL>.svg`/`.png`.
Any coin without a file shows a colored letter monogram, so nothing ever breaks.
