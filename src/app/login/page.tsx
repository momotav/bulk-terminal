'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, Wallet } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();

  useEffect(() => {
    if (ready && authenticated) {
      router.push('/profile');
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-bulk-green animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-dark-secondary border border-dark-border rounded-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-bulk-green/10 flex items-center justify-center mx-auto mb-6">
            <Wallet className="w-8 h-8 text-bulk-green" />
          </div>
          
          <h1 className="text-2xl font-bold text-text-primary mb-2">
            Connect Your Wallet
          </h1>
          
          <p className="text-text-secondary mb-8">
            Connect your Solana wallet to access your profile, follow wallets, and track your trading stats.
          </p>
          
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-bulk-green hover:bg-bulk-green/90 transition-colors"
          >
            <Wallet className="w-5 h-5 text-dark-primary" />
            <span className="font-medium text-dark-primary">Connect Wallet</span>
          </button>
          
          <p className="text-xs text-text-tertiary mt-6">
            Supports Phantom, Backpack, and Solflare
          </p>
        </div>
      </div>
    </div>
  );
}
