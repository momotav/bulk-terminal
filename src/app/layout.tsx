import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { PrivyProvider } from '@/components/PrivyProvider';
import { Header } from '@/components/Header';
import { DevnetBanner } from '@/components/DevnetBanner';

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
  icons: {
    icon: [
      { url: '/STATS.png', type: 'image/png' },
    ],
    apple: '/STATS.png',
  },
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
          <div className="min-h-screen flex flex-col">
            <Header />
            <DevnetBanner />
            <main className="flex-1">
              {children}
            </main>
          </div>
        </PrivyProvider>
      </body>
    </html>
  );
}
