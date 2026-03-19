'use client';

import { PrivyProvider as PrivyProviderBase } from '@privy-io/react-auth';
import { ReactNode } from 'react';

interface PrivyProviderProps {
  children: ReactNode;
}

export function PrivyProvider({ children }: PrivyProviderProps) {
  return (
    <PrivyProviderBase
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'cmmx4hqnz00oe0dl2ley8mak1'}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#B8FF04',
          logo: '/bulkstats.png',
          showWalletLoginFirst: true,
        },
        loginMethods: ['wallet'],
        embeddedWallets: {
          createOnLogin: 'off',
        },
      }}
    >
      {children}
    </PrivyProviderBase>
  );
}
