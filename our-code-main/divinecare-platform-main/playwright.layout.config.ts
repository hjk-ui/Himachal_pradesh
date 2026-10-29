import { defineConfig, devices } from '@playwright/test';

/**
 * Layout / responsive checks (Oct 25). Minimal on purpose: it documents the viewports every
 * layout spec must pass at, and runs any `tests/e2e/layout-*.spec.ts` once per viewport.
 * No layout specs exist yet, so `npm run test:e2e:layout` passes with no tests.
 *
 * Viewports (width x height):
 *   390  x 844   phone
 *   768  x 1024  tablet
 *   1280 x 800   laptop
 *   1920 x 1080  desktop
 *
 * Needs a running app (default http://localhost:3000, override with PLAYWRIGHT_BASE_URL);
 * it does not start one.
 */
export const LAYOUT_VIEWPORTS = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'layout-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: LAYOUT_VIEWPORTS.map((v) => ({
    name: v.name,
    use: {
      ...devices['Desktop Chrome'],
      channel: process.env.PW_CHANNEL || undefined,
      viewport: { width: v.width, height: v.height },
    },
  })),
});
