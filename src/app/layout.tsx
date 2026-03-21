import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { PrivyProvider } from '@/components/PrivyProvider';
import { Header } from '@/components/Header';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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
      { url: '/bulkstats.png', type: 'image/png' },
    ],
    apple: '/bulkstats.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${bulkFont.variable} font-sans bg-dark-primary text-text-primary antialiased`}>
        <PrivyProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
              {children}
            </main>
            <footer className="border-t border-dark-border py-6">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-sm text-text-tertiary">
                <p>BULK Stats - Community Analytics Dashboard</p>
                <p className="mt-1">
                  Built for{' '}
                  <a 
                    href="https://bulk.trade" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-bulk-green hover:underline"
                  >
                    BULK Exchange
                  </a>
                </p>
              </div>
            </footer>
          </div>
        </PrivyProvider>
      </body>
    </html>
  );
}
