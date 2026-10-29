import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { AppProviders } from '@/components/providers/AppProviders';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-clinic-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL || 'https://altrixs.com'),
  title: {
    default: 'Altrixs | Behavioral Health EHR',
    template: '%s · Altrixs',
  },
  description:
    'Altrixs is a behavioral health EHR with integrated primary care, billing, telehealth and practice operations.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Altrixs',
  },
};

/** Phones + tablets: correct scale, notch-safe, no accidental zoom quirks */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#5C2D91',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Content-Security-Policy nonce (src/proxy.ts, src/lib/security/csp.ts): reading the request makes
  // every page render per request, so Next.js stamps that request's nonce on its scripts. A page
  // prerendered at build time would carry no nonce and its scripts would be blocked.
  await headers();
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
