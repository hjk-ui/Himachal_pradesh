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
test('scanner filters, service panels, preview actions, rescan and mobile layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mutations = await mockApis(page);
  await page.goto('/');
  await expect(page.getByText('8 patients', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /PRP Psychiatric Rehabilitation/ }).click();
  await expect(page.getByText('4 patients', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Details for Marcus Thompson' }).click();
  await page.getByRole('tab', { name: 'PRP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Criteria Met', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('scanner-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add to Care Plan', exact: true }).click();
  await page.getByRole('button', { name: 'Save preview draft' }).click();
  await expect(page.getByRole('heading', { name: 'Preview activity' })).toBeVisible();
  await page.getByRole('tab', { name: 'AOT', exact: true }).click();
  await page.getByRole('button', { name: 'Add Missing Data to Chart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save preview draft' })).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Additional clinical data' })
    .fill('Request legal review and history from care team.');
  await page.getByRole('button', { name: 'Save preview draft' }).click();
  await page.getByRole('button', { name: 'Re-Scan All Patients' }).click();
  await expect(page.getByRole('button', { name: 'Scanning patients' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Re-Scan All Patients' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Search patients or diagnosis' }).fill('no patient');
  await expect(page.getByText('No patients match these filters.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Search patients or diagnosis' }).fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
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
