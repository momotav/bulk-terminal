# BULK Terminal Dashboard

A real-time trading dashboard for [BULK Exchange](https://bulk.trade) - a decentralized high-performance perpetual futures exchange on Solana.

![BULK Terminal](https://bulk.trade/og-image.png)

## Features

- 📊 **Live Market Data** - Real-time prices, 24h changes, volume, and open interest
- 📈 **TradingView Charts** - Interactive candlestick charts with multiple timeframes
- 📕 **Order Book** - Live depth visualization with bid/ask spread
- ⚡ **Recent Trades** - Real-time trade feed with price direction
- 🔥 **Liquidations Feed** - Live liquidation events with animated updates
- 🏆 **Liquidation Leaderboard** - Top liquidated traders ranking
- 👛 **Account Lookup** - Search any wallet to view positions and orders
- 💹 **Trading Panel** - Place limit/market orders with leverage control
- 🌓 **Dark/Light Theme** - Toggle between cyberpunk dark and clean light modes

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with custom design system
- **Charts**: Lightweight Charts (TradingView)
- **State**: Zustand
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Language**: TypeScript

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/bulk-terminal.git
cd bulk-terminal

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Deploy to Vercel

The easiest way to deploy:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/bulk-terminal)

Or manually:

```bash
npm i -g vercel
vercel
```

## API Endpoints

The dashboard connects to BULK Exchange's Alphanet:

- **REST API**: `https://exchange-api1.northstarlabs.xyz/api/v1`
- **WebSocket**: `wss://exchange-wss1.northstarlabs.xyz`
- **Trading UI**: https://alphanet.bulk.trade
- **Explorer**: https://explorer.bulk.trade

## Project Structure

```
src/
├── app/
│   ├── globals.css      # Tailwind + custom styles
│   ├── layout.tsx       # Root layout with theme provider
│   └── page.tsx         # Main dashboard page
├── components/
│   ├── charts/
│   │   └── PriceChart.tsx
│   ├── trading/
│   │   └── TradingPanel.tsx
│   ├── account/
│   │   └── AccountLookup.tsx
│   ├── Header.tsx
│   ├── MarketsTable.tsx
│   ├── OrderBook.tsx
│   ├── TradesFeed.tsx
│   ├── LiquidationsFeed.tsx
│   ├── Leaderboard.tsx
│   └── StatsCards.tsx
├── hooks/
│   └── useWebSocket.ts  # WebSocket connection hook
├── lib/
│   └── api.ts           # API utilities
├── store/
│   └── index.ts         # Zustand store
└── types/
    └── index.ts         # TypeScript types
```

## Supported Markets

Currently on Alphanet:
- **BTC-USD** - 20x max leverage, $250k margin tier
- **ETH-USD** - 20x max leverage, $250k margin tier  
- **SOL-USD** - 20x max leverage, $250k margin tier

## License

MIT

## Links

- [BULK Exchange](https://bulk.trade)
- [Documentation](https://docs.bulk.trade)
- [API Reference](https://exchange-api.bulk.trade)
- [Twitter](https://twitter.com/bulkexchange)
- [Discord](https://discord.gg/bulk)
