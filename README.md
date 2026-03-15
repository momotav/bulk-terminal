# BULK Terminal - Community Dashboard

A community analytics dashboard for [BULK Exchange](https://bulk.trade) - decentralized perpetual futures on Solana.

## Features

- 🏆 **Leaderboards** - Top traders by PnL, most liquidated, biggest positions, most active
- 📊 **Analytics** - Open interest, funding rates, volume trends, long/short ratio, correlation matrix
- 🐋 **Whale Tracker** - Look up any wallet, track positions and PnL history
- ⭐ **Watchlist** - Save wallets to track (requires account)
- ⚡ **Live Activity** - Recent liquidations and big trades feed
- 🔐 **Auth** - Simple email/password accounts
- 🌓 **Dark/Light Theme** - Toggle between themes

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **State**: Zustand
- **Backend**: Your Railway backend

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env.local`:
```
NEXT_PUBLIC_API_URL=https://bulk-terminal-backend-production.up.railway.app
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Build for Production

```bash
npm run build
```

## Deploy to Vercel

1. Push to GitHub
2. Import to Vercel
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = `https://bulk-terminal-backend-production.up.railway.app`
4. Deploy!

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard with stats and leaderboard preview |
| `/leaderboard` | Full leaderboard with tabs |
| `/analytics` | Charts and market data |
| `/whales` | Whale tracker and watchlist |
| `/whales/[address]` | Individual wallet details |
| `/login` | Login / Register |

## Project Structure

```
src/
├── app/
│   ├── page.tsx           # Dashboard
│   ├── login/page.tsx     # Auth
│   ├── leaderboard/page.tsx
│   ├── analytics/page.tsx
│   └── whales/
│       ├── page.tsx       # Tracker
│       └── [address]/page.tsx
├── components/
│   ├── Header.tsx
│   ├── ExchangeHealth.tsx
│   ├── RecentActivity.tsx
│   └── leaderboard/
│       └── LeaderboardTable.tsx
├── lib/
│   └── api.ts             # Backend API client
└── store/
    └── index.ts           # Zustand store
```

## License

MIT
