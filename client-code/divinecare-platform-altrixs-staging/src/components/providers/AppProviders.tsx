'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'framer-motion';
import { OutdatedBrowserBanner } from '@/components/security/OutdatedBrowserBanner';

/**
 * Root client providers for the web app.
 * MotionConfig honors the OS "reduce motion" setting for every framer-motion animation.
 * OutdatedBrowserBanner: dismissible notice on every page (staff and patient) for browsers below the Next.js 16 baseline.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <MotionConfig reducedMotion="user">
        <OutdatedBrowserBanner />
        {children}
      </MotionConfig>
    </SessionProvider>
  );
}
