import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { chromium } from '@playwright/test';
import { AUTH_DIR, CHART_FILE, STORAGE_STATE, loadLayoutEnv } from './env';

/** Replace ALTRIXS_E2E_TOTP_SECRET in the git-ignored .env.e2e.local (never printed). */
function saveTotpSecret(secret: string) {
  const file = path.join(process.cwd(), '.env.e2e.local');
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l && !l.startsWith('ALTRIXS_E2E_TOTP_SECRET='))
    : [];
  fs.writeFileSync(file, [...lines, `ALTRIXS_E2E_TOTP_SECRET=${secret}`].join('\n') + '\n');
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 setup key, as authenticator apps compute it. */
function totpNow(base32Secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/[\s=-]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** Signs in once through the staff login page and saves storage state for the layout spec. */
export default async function globalSetup() {
  const env = loadLayoutEnv();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (const f of [STORAGE_STATE, CHART_FILE]) if (fs.existsSync(f)) fs.rmSync(f);
  if (!env) {
    console.log('[layout] .env.e2e.local missing ALTRIXS_E2E_EMAIL/PASSWORD/BASE_URL — layout spec will be skipped.');
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: env.baseURL });
  try {
    await page.goto('/login');
    await page.getByLabel('Work email').fill(env.email);
    await page.locator('input[name="staff-password"]').fill(env.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const mfa = page.getByText(/6-digit code from your authenticator|Set up two-factor|authenticator app/i).first();
    const outcome = await Promise.race([
      page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 30_000 }).then(() => 'ok' as const),
      mfa.waitFor({ timeout: 30_000 }).then(() => 'mfa' as const),
      // The login page always renders an empty live region (role=alert): wait for one with text
      page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30_000 }).then(() => 'error' as const),
    ]).catch(() => 'timeout' as const);

    let finalOutcome: string = outcome;
    if (outcome === 'mfa') {
      const codeField = page.getByLabel('6-digit code');
      // First-time 2FA setup (e.g. right after an admin "Reset 2FA"): read the setup key shown on the
      // page, keep it ONLY in the git-ignored .env.e2e.local so later runs can make codes, and finish setup.
      const keyLabel = page.getByText("Can't scan? Enter this key");
      if (await keyLabel.isVisible().catch(() => false)) {
        const shown = (await keyLabel.locator('xpath=following-sibling::p[1]').innerText()).replace(/\s/g, '');
        if (!/^[A-Z2-7]{16,64}$/i.test(shown)) throw new Error('[layout] 2FA setup key not found on the setup page.');
        saveTotpSecret(shown);
        env.totpSecret = shown;
        await codeField.fill(totpNow(shown));
        await page.getByRole('button', { name: 'Verify' }).click();
        // Recovery codes step: never read or stored by the sweep; tick the box and continue
        await page.getByText('I saved these recovery codes somewhere safe.').click({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Continue' }).click();
        finalOutcome = await page
          .waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 30_000 })
          .then(() => 'ok')
          .catch(() => 'enroll_failed');
        if (finalOutcome !== 'ok') throw new Error(`[layout] 2FA setup did not reach /dashboard (outcome: ${finalOutcome}).`);
        console.log('[layout] 2FA set up for the e2e account; setup key saved to .env.e2e.local (git-ignored).');
      }
      const onCodeStep = finalOutcome !== 'ok' && (await codeField.isVisible().catch(() => false));
      if (finalOutcome === 'ok') {
        // enrolled just now
      } else {
      if (!env.totpSecret || !onCodeStep) {
        console.log(
          onCodeStep
            ? '[layout] 2FA code step: add ALTRIXS_E2E_TOTP_SECRET (the authenticator setup key) to .env.e2e.local — layout spec will be skipped.'
            : '[layout] 2FA setup step: finish 2FA setup for the e2e account by hand first (save the setup key as ALTRIXS_E2E_TOTP_SECRET) — layout spec will be skipped.'
        );
        return;
      }
      await codeField.fill(totpNow(env.totpSecret));
      await page.getByRole('button', { name: 'Verify' }).click();
      finalOutcome = await Promise.race([
        page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 30_000 }).then(() => 'ok'),
        page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30_000 }).then(() => 'mfa_rejected'),
      ]).catch(() => 'timeout');
      }
    }
    if (finalOutcome !== 'ok') {
      // Do not echo page text (may include account details); just report the outcome.
      throw new Error(`[layout] sign-in did not reach /dashboard (outcome: ${finalOutcome}).`);
    }
    await page.context().storageState({ path: STORAGE_STATE });

    // Discover the first client chart from the clients list (id only, no names).
    await page.goto('/dashboard/clients');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const link = page.locator('a[href^="/dashboard/clients/"]');
    const hrefs = await link.evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
    const href = hrefs.find((h) => /^\/dashboard\/clients\/[^/?#]+$/.test(h.split('?')[0]) && !/\/(waitlist|intake)$/.test(h.split('?')[0]));
    if (href) fs.writeFileSync(CHART_FILE, JSON.stringify({ path: href.split('?')[0] }));
    else console.log('[layout] no client chart link found on /dashboard/clients — chart routes will be skipped.');
  } finally {
    await browser.close();
  }
}
