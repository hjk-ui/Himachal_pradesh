/**
 * Search-engine surface: src/app/sitemap.ts and src/app/robots.ts.
 * Only public marketing / legal pages are listed. Staging and every non-production environment
 * (ALTRIXS_ENV !== 'production') disallows all crawling.
 */
import type { MetadataRoute } from 'next';

type Env = Record<string, string | undefined>;

export const PUBLIC_ROUTES: { path: string; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/get-started', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/baa', changeFrequency: 'yearly', priority: 0.3 },
];

/** Staff, patient and API areas: never crawled. */
export const PRIVATE_PATH_PREFIXES = [
  '/dashboard',
  '/api',
  '/patient',
  '/p/',
  '/m/',
  '/intake',
  '/telehealth',
  '/invite',
  '/platform',
];

export function siteBaseUrl(env: Env = process.env): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL || env.AUTH_URL || 'https://altrixs.com').trim();
  return raw.replace(/\/+$/, '');
}

export function isProductionSite(env: Env = process.env): boolean {
  return (env.ALTRIXS_ENV || '').trim().toLowerCase() === 'production';
}

export function buildSitemap(env: Env = process.env, now: Date = new Date()): MetadataRoute.Sitemap {
  const base = siteBaseUrl(env);
  return PUBLIC_ROUTES.map((r) => ({
    url: r.path === '/' ? `${base}/` : `${base}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}

export function buildRobots(env: Env = process.env): MetadataRoute.Robots {
  const base = siteBaseUrl(env);
  if (!isProductionSite(env)) {
    // Staging / dev: keep everything out of search results.
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATH_PREFIXES }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
