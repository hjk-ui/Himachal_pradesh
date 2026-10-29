import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE, loadLayoutEnv } from './tests/e2e/layout/env';

/**
 * Responsive layout sweep (horizontal overflow) for an NP account against a deployed env.
 * Credentials: git-ignored .env.e2e.local (ALTRIXS_E2E_EMAIL / _PASSWORD / _BASE_URL).
 * Output: test-results/layout-summary.json
 */
const env = loadLayoutEnv();
process.env.ALTRIXS_LAYOUT_SWEEP = '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /layout\.spec\.ts$/,
  globalSetup: './tests/e2e/layout/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 240_000,
  use: {
    baseURL: env?.baseURL || 'http://localhost:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }],
});
