import type { MetadataRoute } from 'next';
import { buildSitemap } from '@/lib/seo/publicRoutes';

export const dynamic = 'force-dynamic';

/** Public marketing and legal pages only (src/lib/seo/publicRoutes.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(process.env);
}
