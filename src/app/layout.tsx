import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { PrivyProvider } from '@/components/PrivyProvider';
import { Header } from '@/components/Header';
import { DevnetBanner } from '@/components/DevnetBanner';
import { CommandPalette } from '@/components/CommandPalette';
import { BuildSkewGuard } from '@/components/BuildSkewGuard';
import { FreeChartCursor } from '@/components/FreeChartCursor';
import { WalletWarmup } from '@/components/WalletWarmup';
import { PnlCardTour } from '@/components/tour/PnlCardTour';
import { Workspace } from '@/components/basket/Workspace';
import { ChromeGate } from '@/components/ChromeGate';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Serif display face for page-level headings — mirrors BULK's mainnet
// UI which uses an elegant editorial serif ("theSeasons", licensed) for
// hero text. Fraunces is the closest open alternative. Used ONLY at
// display sizes via the `font-display` / `.page-title` utilities; body
// copy and data stay on the BULK sans.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

const bulkFont = localFont({
  src: [
    {
      path: '../../public/fonts/BULK-Regular.otf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/BULK-Medium.otf',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--font-bulk',
});

export const metadata: Metadata = {
  title: 'BULK Stats - Community Analytics Dashboard',
  description: 'Track trading activity, whale movements, and analytics for BULK Exchange',
  // Tab icon set. Phones need their own: iOS (tab overview, home screen) reads the
  // apple-touch-icon, Android reads the manifest's 192/512 icons; the single 700px
  // PNG before left phones' recent-tabs view without a logo.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('bulkstats-theme') || 'dark';
                  document.documentElement.classList.remove('dark', 'light');
                  document.documentElement.classList.add(theme);
                  document.documentElement.setAttribute('data-theme', theme);
                  var palette = localStorage.getItem('bulkstats-palette') || 'classic';
                  document.documentElement.setAttribute('data-palette', palette);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} ${bulkFont.variable} ${fraunces.variable} font-sans antialiased`}>
        <PrivyProvider>
          <BuildSkewGuard />
          <FreeChartCursor />
          <WalletWarmup />
          <ChromeGate><PnlCardTour /></ChromeGate>
          <Workspace />
          <div className="min-h-screen flex flex-col">
            <ChromeGate>
              <Header />
              <CommandPalette />
              <DevnetBanner />
            </ChromeGate>
            <main className="flex-1">
              {children}
            </main>
          </div>
        </PrivyProvider>
      </body>
    </html>
  );
}
