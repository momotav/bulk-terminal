'use client';

import { PrivyProvider as PrivyProviderBase } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { ReactNode } from 'react';

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

interface PrivyProviderProps {
  children: ReactNode;
}

export function PrivyProvider({ children }: PrivyProviderProps) {
  return (
    <PrivyProviderBase
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'cmmx4hqnz00oe0dl2ley8mak1'}
      config={{
        appearance: {
          theme: '#1b1a14',
          accentColor: '#ffffff',
          logo: '/bulkstats.png',
          walletChainType: 'solana-only',
        },
        loginMethods: ['email', 'wallet'],
        embeddedWallets: {
          createOnLogin: 'off',
        },
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
      }}
    >
      {children}
    </PrivyProviderBase>
  );
}
