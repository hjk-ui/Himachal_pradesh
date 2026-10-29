import { test, expect, type Page } from '@playwright/test';

test('appointments retain the requested patient and show failed database saves without phantom records', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/appointments' && route.request().method() === 'POST') {
      expect(route.request().postDataJSON().clientId).toBe('patient-b');
      return route.fulfill({ status: 503, json: { success: false, error: 'Database unavailable for test' } });
    }
    if (path === '/api/clients') {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return route.fulfill({ json: { success: true, clients: [
        { id: 'patient-a', name: 'First Test Patient', status: 'ACTIVE' },
        { id: 'patient-b', name: 'Requested Test Patient', status: 'ACTIVE' },
      ] } });
    }
    return route.fulfill({ json: { success: true, appointments: [], users: [], data: [] } });
  });
  await page.goto('/?view=appointments&client=patient-b&new=1');
  await expect(page.getByText('Schedule New Appointment', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Client Name *')).toHaveValue('patient-b');
  await expect(page.getByText('Dr. Sarah Smith', { exact: true })).toHaveCount(0);
  await page.getByLabel('Start Time *').fill('10:00');
  await page.getByRole('button', { name: 'Schedule Appointment', exact: true }).click();
  await expect(page.getByText('Database unavailable for test')).toBeVisible();
  await expect(page.getByText('Schedule New Appointment', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Start Time *')).toHaveValue('10:00');
});

async function mockApis(page: Page) {
  const mutations: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') mutations.push(path);
    let json: object = {
      success: true,
      data: [],
      clients: [],
      notes: [],
      plans: [],
      alerts: [],
      claims: [],
      stats: { today: 0, unsigned: 0, thisWeek: 0, total: 0 },
    };
    if (path === '/api/billing/overview')
      json = {
        success: true,
        overview: {
          stats: {
            revenueMtdCents: 0,
            revenueMtdChangePct: 0,
            claimsSubmitted: 0,
            claimsSubmittedDelta: 0,
            claimsPending: 0,
            claimsPendingDelta: 0,
            outstandingBalanceCents: 0,
            outstandingDeltaCents: 0,
          },
          payers: [],
          cptUsage: [],
        },
      };
    await route.fulfill({ json });
  });
  return mutations;
}
// Synthetic scan payload (no real patient data) for the Service Eligibility Scanner.
function scanResult(program: string, status: string, met: string[] = [], missing: string[] = []) {
  return { program, status, met, unmet: [], missing, confirm: [], flags: [], gaps: [], evidence: [{ kind: 'diagnosis', text: 'F33.2 — chart dx (primary)', date: null }], summary: `${program} ${status}` };
}
const PROGRAM_KEYS = ['prp', 'spravato', 'tms', 'aot', 'residential', 'iop'];
const statusesOf = (s: Record<string, string>) => Object.fromEntries(PROGRAM_KEYS.map((p) => [p, s[p] ?? 'not_indicated']));
const ALPHA = { prp: 'candidate', spravato: 'potential', tms: 'candidate', aot: 'review' };
const BRAVO = { prp: 'potential' };
const scanRow = (id: string, name: string, mrn: string, statuses: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id, name, mrn, age: 40, primaryDx: 'F33.2', clinician: { id: 'u1', name: 'Test Clinician' }, location: null, payer: 'Maryland Medicaid',
  priority: { score: 5, level: 'low', reasons: [] }, statuses: statusesOf(statuses), gaps: {}, decisions: {}, scannedAt: '2026-10-17T00:00:00.000Z', ...extra,
});
const SCAN_PAYLOAD = {
  success: true,
  generatedAt: '2026-10-17T00:00:00.000Z',
  lastRun: { trigger: 'cron', status: 'success', startedAt: '2026-10-17T06:30:00.000Z', finishedAt: '2026-10-17T06:30:05.000Z', durationMs: 5000 },
  scanBusy: false,
  clientsInScope: 3,
  clientsScanned: 3,
  notScanned: 0,
  sensitiveHidden: 1,
  truncated: false,
  notIndicatedOnly: 1,
  rows: [scanRow('fx-1', 'Test Patient Alpha', 'T-1', ALPHA), scanRow('fx-2', 'Test Patient Bravo', 'T-2', BRAVO, { clinician: null, age: null, primaryDx: 'F25.0' })],
  conversion: Object.fromEntries(PROGRAM_KEYS.map((p) => [p, { accepted: 0, enrolled: 0, declined: 0 }])),
  viewerId: 'u1',
  clinicians: [{ id: 'u1', name: 'Test Clinician' }],
  locations: [],
  config: { tmsMinTrials: 2, prpLocusMin: 17 },
};
const DETAIL_ALPHA = {
  success: true,
  client: {
    id: 'fx-1', name: 'Test Patient Alpha', mrn: 'T-1', age: 40, primaryDx: 'F33.2', clinician: null, location: null, payer: 'Maryland Medicaid',
    priority: { score: 5, level: 'low', reasons: [] },
    results: {
      prp: scanResult('prp', 'candidate', ['Category A-type diagnosis: F33.2']),
      spravato: scanResult('spravato', 'potential', ['MDD diagnosis: F33.2'], ['≥2 adequate antidepressant trials not documented']),
      tms: scanResult('tms', 'candidate', ['Severe MDD coded: F33.2']),
      aot: scanResult('aot', 'review', ['Serious mental illness charted: F33.2']),
      residential: scanResult('residential', 'not_indicated'),
      iop: scanResult('iop', 'not_indicated'),
    },
  },
  decisions: {},
  payerFit: {},
  revenue: {},
  evaluatedAt: '2026-10-17T12:00:00.000Z',
};

test('service eligibility scanner: program cards, filters, criteria detail, refer link and mobile layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mutations = await mockApis(page);
  await page.route('**/api/ehr/scanner/service-eligibility', (route) => route.fulfill({ json: SCAN_PAYLOAD }));
  await page.route('**/api/ehr/scanner/service-eligibility/fx-1', (route) => route.fulfill({ json: DETAIL_ALPHA }));
  await page.goto('/');
  await expect(page.getByText('2 clients shown', { exact: true })).toBeVisible();
  await expect(page.getByText(/Not a clinical determination/i).first()).toBeVisible();
  await page.getByRole('button', { name: /TMS Transcranial/ }).click();
  await expect(page.getByText('1 client shown', { exact: true })).toBeVisible();
  await page.getByText('Test Patient Alpha').click();
  await expect(page.getByText('Why — each criterion', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Refer to TMS/ })).toHaveAttribute('href', /clientId=fx-1/);
  await page.screenshot({ path: testInfo.outputPath('scanner-desktop.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Program' }).selectOption('all');
  await page.getByRole('textbox', { name: 'Search clients' }).fill('no such client');
  await expect(page.getByText('No clients match the current filters.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Search clients' }).fill('');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('notes create all metadata, show structured sections, sign and lock in isolated preview', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mutations = await mockApis(page);
  await page.goto('/?view=notes');
  await page.getByRole('button', { name: 'Demo Preview', exact: true }).click();
  await page.getByRole('button', { name: '+ New Note' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Note Type', exact: true }).locator('option'),
  ).toHaveCount(17);
  await page.getByRole('combobox', { name: 'Note Type', exact: true }).selectOption('BIRP');
  await page.getByRole('combobox', { name: 'CPT / Billing Code' }).selectOption('90834');
  await page.getByRole('checkbox', { name: 'Telehealth Modifier' }).check();
  await page.getByRole('combobox', { name: 'Telehealth place of service' }).selectOption('02');
  await page.getByRole('checkbox', { name: 'Substance Use Disorder' }).check();
  await expect(page.getByText('42 CFR Part 2 — Federal confidentiality protection')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Note body', exact: true })
    .fill(
      'Behavior\nSynthetic behavior\n\nIntervention\nSkills review\n\nResponse\nParticipated\n\nPlan\nFollow up next week',
    );
  await page.getByRole('button', { name: 'Save Note', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Behavior', exact: true })).toBeVisible();
  await expect(page.getByText('CPT / HCPCS 90834')).toBeVisible();
  await expect(page.getByText('Telehealth · Modifier 95 · POS 02')).toBeVisible();
  await expect(page.getByText('42 CFR Part 2 — Federal confidentiality protection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Note', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('note-detail.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Clinical Attestation' }).check();
  await page.getByRole('button', { name: 'Sign Note', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock Note', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('treatment plans apply library goals, preserve care fields through edits and complete a goal', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mutations = await mockApis(page);
  await page.goto('/?view=plans');
  await page.getByRole('button', { name: 'Demo Preview', exact: true }).click();
  await page.getByRole('button', { name: '+ New Treatment Plan' }).click();
  await page.getByRole('button', { name: 'Use Practice Library Template' }).click();
  await page.getByRole('button', { name: 'Substance Use Relapse Prevention', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Plan client' })
    .selectOption({ label: 'Carlos Rivera' });
  await expect(
    page.getByRole('combobox', { name: 'Primary Diagnosis' }).locator('optgroup'),
  ).toHaveCount(10);
  await page
    .getByRole('combobox', { name: 'ASAM Level', exact: true })
    .selectOption('Level 2.1 Intensive Outpatient');
  await page
    .getByRole('textbox', { name: 'Coordination of Care' })
    .fill('PCP follow-up with consent');
  await page
    .getByRole('textbox', { name: 'Barriers to Treatment' })
    .fill('Transportation support needed');
  await page
    .getByRole('button', {
      name: /Create Treatment Plan|Save Treatment Plan|Save Plan/,
      exact: false,
    })
    .click();
  await expect(page.getByText('PCP follow-up with consent', { exact: true })).toBeVisible();
  await expect(page.getByText('Transportation support needed', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plan-detail.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Goal 1 completed' }).check();
  await page.getByRole('button', { name: 'Edit Plan', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Coordination of Care' })).toHaveValue(
    'PCP follow-up with consent',
  );
  await expect(page.getByRole('combobox', { name: 'ASAM Level', exact: true })).toHaveValue(
    'Level 2.1 Intensive Outpatient',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('billing library and ERA review support filtering, discrepancy resolution and posting', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApis(page);
  await page.goto('/?view=billing');
  await page.getByRole('button', { name: 'CPT Codes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search billing library' }).fill('90840');
  await expect(page.getByRole('cell', { name: '90840', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '15 Modifiers' }).click();
  await expect(page.getByRole('cell', { name: '95', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '10 Places of Service' }).click();
  await expect(page.getByRole('cell', { name: '53', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ERA & Payments', exact: true }).click();
  await page.getByRole('combobox', { name: 'ERA status' }).selectOption('Discrepancy');
  await page.getByRole('button', { name: 'View ERA', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('era-detail.png'), fullPage: true });
  await page
    .getByRole('textbox', { name: 'Reconciliation note' })
    .fill('Reviewed deductible allocation against sample EOB.');
  await page.getByRole('button', { name: 'Resolve discrepancy in preview' }).click();
  await page.getByRole('button', { name: 'Auto-post in preview' }).click();
  await expect(
    page.getByText('Posted in demo state. No live ledger entry was created.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('No matching remittances.')).toBeVisible();
  await page.getByRole('button', { name: 'Claims', exact: true }).click();
  await page.getByRole('button', { name: 'ERA & Payments', exact: true }).click();
  await expect(page.getByText('No matching remittances.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
