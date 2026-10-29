import type { MetadataRoute } from 'next';
import {
  isProductionIndexing,
  PRIVATE_PREFIXES,
  PUBLIC_ROUTES,
  siteBaseUrl,
} from '@/lib/seo/publicRoutes';

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  if (!isProductionIndexing()) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_ROUTES],
      disallow: [...PRIVATE_PREFIXES],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
