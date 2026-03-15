import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BULK Stats | Community Analytics Dashboard',
  description: 'Track top traders, liquidations, whale positions, and market analytics on BULK Exchange',
  keywords: ['BULK', 'Exchange', 'Leaderboard', 'Analytics', 'Solana', 'DeFi', 'Liquidations'],
  icons: {
    icon: '/STATS.png',
    shortcut: '/STATS.png',
    apple: '/STATS.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-dark-primary">
        {children}
      </body>
    </html>
  );
}
