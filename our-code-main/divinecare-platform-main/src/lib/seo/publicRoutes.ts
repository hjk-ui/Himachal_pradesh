export const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/get-started',
  '/support',
  '/privacy',
  '/legal/baa',
] as const;

export const PRIVATE_PREFIXES = [
  '/dashboard',
  '/api',
  '/patient',
  '/p/',
  '/m/',
  '/intake',
  '/telehealth',
  '/invite',
  '/platform',
] as const;

export function siteBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    process.env.AUTH_URL?.replace(/\/$/, '') ||
    'https://altrixs.com'
  );
}

export function isProductionIndexing() {
  return (process.env.ALTRIXS_ENV || '').toLowerCase() === 'production';
}
