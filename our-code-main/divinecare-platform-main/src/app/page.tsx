import type { Metadata } from 'next';
import { HomePage } from '@/components/marketing/HomePage';
import {
  DEFAULT_DESCRIPTION,
  HOME_DESCRIPTION,
  HOME_KEYWORDS,
  HOME_TITLE,
} from '@/lib/marketing/homeContent';
import { siteBaseUrl } from '@/lib/seo/publicRoutes';

const siteUrl = siteBaseUrl();

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  keywords: [...HOME_KEYWORDS],
  authors: [{ name: 'Altrixs' }],
  creator: 'Altrixs',
  publisher: 'Altrixs',
  category: 'Healthcare Software',
  alternates: { canonical: siteUrl },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Altrixs',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Altrixs | Behavioral Health EHR',
    description: DEFAULT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Altrixs',
  applicationCategory: 'HealthApplication',
  operatingSystem: 'Web',
  description: HOME_DESCRIPTION,
  url: siteUrl,
  offers:
    process.env.NEXT_PUBLIC_PRICING_APPROVED === 'true'
      ? {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          description: 'Free trial available',
        }
      : undefined,
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <HomePage />
    </>
  );
}
