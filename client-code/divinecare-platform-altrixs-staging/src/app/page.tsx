import type { Metadata } from 'next';
import { HomePage } from '@/components/marketing/HomePage';
import { HOME_DESCRIPTION, HOME_FAQS, HOME_TITLE } from '@/components/marketing/homeContent';
import { pricingApproved, tierUnitPrice } from '@/lib/billing/plans';

const siteUrl = process.env.AUTH_URL?.replace(/\/$/, '') || 'https://altrixs.com';

const title = HOME_TITLE;
const description = HOME_DESCRIPTION;

export const metadata: Metadata = {
  title: {
    absolute: title,
  },
  description,
  keywords: [
    'behavioral health EHR',
    'mental health EHR',
    'substance use disorder EHR',
    '42 CFR Part 2 EHR',
    'psychiatry EHR with e-prescribing',
    'AI scribe for therapists',
    'integrated behavioral health and primary care EHR',
    'PRP documentation software',
    'behavioral health billing software',
    'telehealth for mental health clinics',
    'measurement-based care software',
    'Altrixs',
  ],
  authors: [{ name: 'Altrixs' }],
  creator: 'Altrixs',
  publisher: 'Altrixs',
  category: 'Healthcare Software',
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Altrixs',
    title,
    description,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80',
        width: 1200,
        height: 630,
        alt: 'Clinician using the Altrixs behavioral health EHR',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Altrixs | Behavioral Health EHR',
    description,
    images: [
      'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80',
    ],
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
  applicationSubCategory: 'Behavioral Health EHR',
  operatingSystem: 'Web',
  url: siteUrl,
  description,
  featureList: [
    'Behavioral health clinical documentation (SOAP, DAP, BIRP, intake, psychiatric evaluation)',
    'AI Scribe with transcript-checked drafts in English and Spanish',
    'E-prescribing with EPCS and PDMP checks',
    'Integrated primary care chart with labs and vitals',
    '42 CFR Part 2 consent and record protection',
    'Scheduling, online booking, telehealth and client portal',
    'Measurement-based care (PHQ-9, GAD-7, PCL-5)',
    'Claims, ERA, eligibility and claim scrubbing',
    'PRP, IOP, PHP, residential and AOT program tools',
    'HR, credentialing and supervision',
  ],
  ...(pricingApproved()
    ? {
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'USD',
          lowPrice: String(tierUnitPrice('starter', 'month')),
          description: 'Per provider per month, by role. Support staff users are free.',
        },
      }
    : {}),
  publisher: {
    '@type': 'Organization',
    name: 'Altrixs',
    url: siteUrl,
    logo: `${siteUrl}/altrixs-logo.png`,
  },
};

const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Altrixs',
  url: siteUrl,
  logo: `${siteUrl}/altrixs-logo.png`,
  description:
    'Altrixs builds a behavioral health EHR with integrated primary care, billing and practice operations.',
  sameAs: [],
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOME_FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

const webSiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Altrixs',
  url: siteUrl,
  potentialAction: {
    '@type': 'SearchAction',
    target: `${siteUrl}/login`,
    'query-input': 'required name=search_term_string',
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
      />
      <HomePage />
    </>
  );
}
