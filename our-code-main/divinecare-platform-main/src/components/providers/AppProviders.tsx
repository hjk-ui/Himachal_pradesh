'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { IdleSessionGuard } from '@/components/auth/IdleSessionGuard';

/**
 * Root client providers for the web app.
 * IdleSessionGuard is inert unless a staff NextAuth session exists.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      {children}
      <IdleSessionGuard />
    </SessionProvider>
  );
}
