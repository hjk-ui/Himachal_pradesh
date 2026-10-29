import fs from 'node:fs';
import path from 'node:path';

export const AUTH_DIR = path.join(process.cwd(), 'test-results', '.auth');
export const STORAGE_STATE = path.join(AUTH_DIR, 'layout-np.json');
export const CHART_FILE = path.join(AUTH_DIR, 'layout-chart.json');
export const SUMMARY_FILE = path.join(process.cwd(), 'test-results', 'layout-summary.json');

export type LayoutEnv = { email: string; password: string; baseURL: string; totpSecret: string };

/** Tiny .env parser for the git-ignored .env.e2e.local (strips BOM / CR). Never logs values. */
export function loadLayoutEnv(): LayoutEnv | null {
  const file = path.join(process.cwd(), '.env.e2e.local');
  const vars: Record<string, string> = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    for (const line of raw.split('\n')) {
      const l = line.replace(/\r$/, '').trim();
      if (!l || l.startsWith('#')) continue;
      const eq = l.indexOf('=');
      if (eq < 1) continue;
      const key = l.slice(0, eq).replace(/^export\s+/, '').trim();
      let val = l.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  }
  const pick = (k: string) => process.env[k] || vars[k] || '';
  const email = pick('ALTRIXS_E2E_EMAIL');
  const password = pick('ALTRIXS_E2E_PASSWORD');
  const baseURL = pick('ALTRIXS_E2E_BASE_URL').replace(/\/+$/, '');
  if (!email || !password || !baseURL) return null;
  // Optional: authenticator setup key so the sweep can pass the 2FA step (RFC 6238 code)
  return { email, password, baseURL, totpSecret: pick('ALTRIXS_E2E_TOTP_SECRET') };
}
