import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BULK Terminal | Community Analytics Dashboard',
  description: 'Track top traders, liquidations, whale positions, and market analytics on BULK Exchange',
  keywords: ['BULK', 'Exchange', 'Leaderboard', 'Analytics', 'Solana', 'DeFi', 'Liquidations'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">
        {/* Background effects */}
        <div className="fixed inset-0 grid-bg pointer-events-none z-0" />
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-bulk-cyan rounded-full blur-[120px] opacity-20 animate-float" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-bulk-magenta rounded-full blur-[120px] opacity-20 animate-float" style={{ animationDelay: '-3s' }} />
        </div>

        {/* Main content */}
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
