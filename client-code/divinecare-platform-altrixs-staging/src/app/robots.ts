import type { MetadataRoute } from 'next';
import { buildRobots } from '@/lib/seo/publicRoutes';

export const dynamic = 'force-dynamic';

/** Production allows public pages and blocks private areas; every other environment blocks all. */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(process.env);
}
