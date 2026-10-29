/**
 * sitemap.xml lists public marketing / legal pages only; robots.txt keeps staging (and every
 * non-production environment) out of search and blocks private areas in production.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_PATH_PREFIXES, PUBLIC_ROUTES, buildRobots, buildSitemap, siteBaseUrl } from '../src/lib/seo/publicRoutes';

const ROOT = path.join(__dirname, '..');
const PROD = { ALTRIXS_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://altrixs.com/' };
const STAGING = { ALTRIXS_ENV: 'staging', AUTH_URL: 'https://staging.altrixs.com' };

test('sitemap lists public routes only, on the configured base URL', () => {
  const urls = buildSitemap(PROD).map((e) => e.url);
  assert.deepEqual(urls, [
    'https://altrixs.com/',
    'https://altrixs.com/pricing',
    'https://altrixs.com/get-started',
    'https://altrixs.com/support',
    'https://altrixs.com/privacy',
    'https://altrixs.com/legal/baa',
  ]);
  for (const u of urls) {
    const p = new URL(u).pathname;
    for (const prefix of [...PRIVATE_PATH_PREFIXES, '/book', '/login', '/onboarding', '/clinician', '/fhir', '/schedule', '/m', '/p']) {
      assert.ok(!(p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)), `${u} is private (${prefix})`);
    }
  }
  // Every listed route is a real page.
  for (const r of PUBLIC_ROUTES) {
    const file = r.path === '/' ? 'src/app/page.tsx' : `src/app${r.path}/page.tsx`;
    assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  }
  assert.equal(siteBaseUrl({ AUTH_URL: 'https://staging.altrixs.com/' }), 'https://staging.altrixs.com');
  assert.equal(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: 'https://a.example', AUTH_URL: 'https://b.example' }), 'https://a.example');
  assert.equal(siteBaseUrl({}), 'https://altrixs.com');
});

test('robots: staging and other non-production environments disallow everything', () => {
  for (const env of [STAGING, {}, { ALTRIXS_ENV: 'development' }]) {
    const r = buildRobots(env);
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    assert.deepEqual(rules, [{ userAgent: '*', disallow: '/' }]);
    assert.equal(r.sitemap, undefined);
  }
});

test('robots: production allows public pages, blocks private areas and links the sitemap', () => {
  const r = buildRobots(PROD);
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  assert.equal(rules.length, 1);
  assert.equal(rules[0].allow, '/');
  assert.deepEqual(rules[0].disallow, ['/dashboard', '/api', '/patient', '/p/', '/m/', '/intake', '/telehealth', '/invite', '/platform']);
  assert.equal(r.sitemap, 'https://altrixs.com/sitemap.xml');
  for (const route of PUBLIC_ROUTES) {
    for (const d of rules[0].disallow as string[]) assert.ok(!route.path.startsWith(d), `${route.path} blocked by ${d}`);
  }
});

test('Next.js metadata routes use the helpers', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'src/app/sitemap.ts'), 'utf8'), /buildSitemap\(process\.env\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/app/robots.ts'), 'utf8'), /buildRobots\(process\.env\)/);
});
