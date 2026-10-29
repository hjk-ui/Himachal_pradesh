import type { MetadataRoute } from 'next';
import { isProductionIndexing, PUBLIC_ROUTES, siteBaseUrl } from '@/lib/seo/publicRoutes';

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isProductionIndexing()) return [];
  const base = siteBaseUrl();
  const now = new Date();
  return PUBLIC_ROUTES.map((path) => ({
    url: path === '/' ? base : `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }));
}
