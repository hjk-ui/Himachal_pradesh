import { expect, test } from '@playwright/test';

const email = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'admin@altrixs.local';
const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'Altrixs@123';

test('admin login reaches /dashboard with HTTP 200', async ({ page }) => {
  const setupRes = page.waitForResponse((res) => res.url().includes('/api/auth/setup'));
  await page.goto('/login');
  await setupRes;
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

  const bootAlert = page.getByRole('alert');
  if (await bootAlert.isVisible()) {
    throw new Error(
      `Login page not ready (database/auth). ${await bootAlert.innerText()}`
    );
  }

  await page.getByLabel('Work email').fill(email);
  await page.locator('input[name="staff-password"]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await Promise.race([
    page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 30_000 }),
    page.getByRole('alert').waitFor({ timeout: 30_000 }).then(async () => {
      throw new Error(await page.getByRole('alert').innerText());
    }),
  ]);

  await expect(page).toHaveURL(/\/dashboard/);
  const res = await page.request.get('/dashboard');
  expect(res.status()).toBe(200);
});
