import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'clinical-expansion.spec.ts',
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    baseURL: 'http://127.0.0.1:3407',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/clinical-preview-server.cjs',
    url: 'http://127.0.0.1:3407',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
