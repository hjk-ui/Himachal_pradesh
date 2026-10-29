import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isProductionIndexing,
  PRIVATE_PREFIXES,
  PUBLIC_ROUTES,
  siteBaseUrl,
} from '../src/lib/seo/publicRoutes';

describe('sitemap-robots', () => {
  it('public routes include legal BAA and private prefixes are blocked', () => {
    assert.deepEqual([...PUBLIC_ROUTES], [
      '/',
      '/pricing',
      '/get-started',
      '/support',
      '/privacy',
      '/legal/baa',
    ]);
    assert.ok(PRIVATE_PREFIXES.includes('/dashboard'));
    assert.ok(PRIVATE_PREFIXES.includes('/api'));
    assert.ok(PRIVATE_PREFIXES.includes('/patient'));
  });

  it('base URL fallback and production gate', () => {
    assert.match(siteBaseUrl(), /^https?:\/\//);
    const prev = process.env.ALTRIXS_ENV;
    process.env.ALTRIXS_ENV = 'staging';
    assert.equal(isProductionIndexing(), false);
    process.env.ALTRIXS_ENV = 'production';
    assert.equal(isProductionIndexing(), true);
    process.env.ALTRIXS_ENV = prev;
  });
});
