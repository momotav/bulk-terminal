import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'BULK Terminal | Live Exchange Dashboard',
  description: 'Real-time trading dashboard for BULK Exchange - View markets, liquidations, and trade perpetual futures on Solana',
  keywords: ['BULK', 'Exchange', 'Trading', 'Perpetuals', 'Solana', 'DeFi', 'Liquidations'],
  authors: [{ name: 'BULK Exchange' }],
  openGraph: {
    title: 'BULK Terminal',
    description: 'Real-time trading dashboard for BULK Exchange',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-screen overflow-x-hidden">
        <ThemeProvider>
          {/* Background effects */}
          <div className="fixed inset-0 grid-bg pointer-events-none z-0" />
          <div className="fixed inset-0 pointer-events-none z-0">
            {/* Floating orbs */}
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-bulk-cyan rounded-full blur-[100px] opacity-20 animate-float" />
            <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-bulk-magenta rounded-full blur-[100px] opacity-20 animate-float" style={{ animationDelay: '-3s' }} />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-bulk-green rounded-full blur-[100px] opacity-10 animate-float" style={{ animationDelay: '-6s' }} />
          </div>

          {/* Main content */}
          <div className="relative z-10">
            {children}
          </div>

          {/* Scanlines overlay */}
          <div className="scanlines pointer-events-none" />
        </ThemeProvider>
      </body>
    </html>
  );
}
