import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CHART_FILE, STORAGE_STATE, SUMMARY_FILE, loadLayoutEnv } from './layout/env';

/**
 * Horizontal-overflow sweep across NP-visible routes x 4 viewports.
 * Records every combo to test-results/layout-summary.json (selectors only, never page text).
 * Run: npm run test:e2e:layout
 */

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

const ROUTES = [
  '/dashboard',
  '/dashboard/clients',
  '/dashboard/appointments',
  '/dashboard/telehealth',
  '/dashboard/scribe',
  '/dashboard/inbox',
  '/dashboard/messages',
  '/dashboard/alerts',
  '/dashboard/tasks',
  '/dashboard/ehr',
  '/dashboard/ehr/notes',
  '/dashboard/ehr/treatment-plans',
  '/dashboard/ehr/assessments',
  '/dashboard/ehr/diagnoses',
  '/dashboard/ehr/prescriptions',
  '/dashboard/ehr/consents',
  '/dashboard/clients/waitlist',
  '/dashboard/medical',
];

/** Main chart tabs (keys from src/components/chart/chartTabs.ts), opened via ?tab= on the first client. */
const CHART_TABS = ['summary', 'notes', 'appointments', 'treatment-plan', 'assessments', 'diagnoses', 'medications', 'documents', 'billing'];

type Status = 'pass' | 'fail' | 'skipped';
type Row = { route: string; viewport: string; status: Status; pageOverflowPx: number; offenders: string[] };

const results: Row[] = [];
const env = loadLayoutEnv();
const hasAuth = fs.existsSync(STORAGE_STATE);

test.use({ storageState: hasAuth ? STORAGE_STATE : undefined });
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  test.skip(process.env.ALTRIXS_LAYOUT_SWEEP !== '1', 'Run via playwright.layout.config.ts (npm run test:e2e:layout)');
  test.skip(!env, '.env.e2e.local missing ALTRIXS_E2E_EMAIL / ALTRIXS_E2E_PASSWORD / ALTRIXS_E2E_BASE_URL');
  test.skip(!hasAuth, 'No signed-in storage state (sign-in failed or MFA required) — see global setup output');
});

test.afterAll(() => {
  if (!results.length) return;
  fs.mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(results, null, 2) + '\n');
  const fails = results.filter((r) => r.status === 'fail').length;
  const skips = results.filter((r) => r.status === 'skipped').length;
  console.log(`[layout] ${results.length} combos: ${fails} fail, ${skips} skipped -> ${path.relative(process.cwd(), SUMMARY_FILE)}`);
});

const DENIED = /not permitted|access denied|forbidden|not authorized|you do not have (access|permission)|you don.t have (access|permission)/i;

async function isDenied(page: Page, status: number | undefined): Promise<boolean> {
  if (status === 401 || status === 403) return true;
  // Only inspect headings/alerts for a denial pattern; nothing is recorded.
  return page
    .locator('h1, h2, [role="alert"]')
    .evaluateAll((els, src) => {
      const re = new RegExp(src, 'i');
      return els.some((e) => re.test((e as HTMLElement).innerText || ''));
    }, DENIED.source)
    .catch(() => false);
}

async function measure(page: Page): Promise<{ pageOverflowPx: number; offenders: string[] }> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const se = document.scrollingElement || document.documentElement;
    const pageOverflowPx = Math.max(0, se.scrollWidth - vw);
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const offenders: string[] = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of Array.from(all)) {
      if (offenders.length >= 5) break;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
      if (clipped(el)) continue;
      // Report the outermost offender only: skip if the parent already overflows unclipped.
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > vw + 1 && !clipped(p)) continue;
      offenders.push(describe(el));
    }
    return { pageOverflowPx: pageOverflowPx > 1 ? pageOverflowPx : 0, offenders };
  });
}

async function sweep(page: Page, label: string, target: string) {
  const expectedPath = target.split('?')[0];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const res = await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const actual = new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
    const redirected = actual !== expectedPath.replace(/\/+$/, '');
    if (redirected || (await isDenied(page, res?.status()))) {
      results.push({ route: label, viewport: vp.name, status: 'skipped', pageOverflowPx: 0, offenders: [] });
      continue;
    }
    const m = await measure(page);
    const status: Status = m.pageOverflowPx > 0 || m.offenders.length ? 'fail' : 'pass';
    // Recorded only: serial mode skips every later test after a failed one, so the pass/fail
    // assertion runs once at the end (layout summary) after all routes are measured
    results.push({ route: label, viewport: vp.name, status, ...m });
  }
}

for (const route of ROUTES) {
  test(`layout ${route}`, async ({ page }) => {
    await sweep(page, route, route);
  });
}

for (const tab of CHART_TABS) {
  test(`layout client chart tab=${tab}`, async ({ page }) => {
    const chart = fs.existsSync(CHART_FILE) ? (JSON.parse(fs.readFileSync(CHART_FILE, 'utf8')) as { path?: string }) : null;
    test.skip(!chart?.path, 'No client chart discovered from /dashboard/clients');
    const target = tab === 'summary' ? chart!.path! : `${chart!.path}?tab=${tab}`;
    // Label without the client id so the summary carries no identifiers.
    await sweep(page, `/dashboard/clients/[id]?tab=${tab}`, target);
  });
}

// Last in serial order: fails when any route x viewport overflowed (details in layout-summary.json)
test('layout summary: no page overflows at any viewport', () => {
  const failed = results.filter((r) => r.status === 'fail').map((r) => `${r.route} @ ${r.viewport}`);
  expect(failed, 'routes x viewports with horizontal overflow').toEqual([]);
});
