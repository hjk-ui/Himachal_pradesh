import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Altrixs@123';
const stamp = Date.now().toString().slice(-6);
const patientName = `QA Loop Kid ${stamp}`;
const patientEmail = `qa.loop.kid.${stamp}@example.com`;

test.describe.configure({ mode: 'serial' });
test.setTimeout(420_000);

async function login(page: Page, email: string) {
  await page.goto('/login');
  if (page.url().includes('/dashboard')) {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
  }
  const setupRes = page.waitForResponse((res) => res.url().includes('/api/auth/setup'));
  await page.goto('/login');
  await setupRes;
  const bootAlert = page.getByRole('alert');
  if (await bootAlert.isVisible()) {
    throw new Error(`Login not ready: ${await bootAlert.innerText()}`);
  }
  await page.getByLabel('Work email').fill(email);
  await page.locator('input[name="staff-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 45_000 });
}

async function api(page: Page, method: 'get' | 'post' | 'patch', path: string, body?: unknown) {
  const res = await page.request[method](path, body === undefined ? undefined : { data: body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} ${res.status()}: ${JSON.stringify(data)}`);
  }
  return data;
}

test('Order 0 clinic loop — 8 QA steps', async ({ page, browser }) => {
  const results: string[] = [];
  let clientId = '';
  let noteId = '';
  let token = '';

  await test.step('1 waitlist → match → intake', async () => {
    await login(page, 'office@role-demo.local');
    const wl = await api(page, 'get', '/api/waitlist');
    const nia = (wl.clinicians as { id: string; name: string }[]).find((c) =>
      /nia\s+patel/i.test(c.name)
    );
    expect(nia, 'Therapist Nia Patel must appear in waitlist match list').toBeTruthy();

    const created = await api(page, 'post', '/api/waitlist', {
      name: patientName,
      email: patientEmail,
      phone: '(301) 555-0199',
      specialty: 'CBT',
      urgency: 'routine',
    });
    expect(created.entry?.status).toBe('waiting');

    const matched = await api(page, 'post', `/api/waitlist/${created.entry.id}/match`, {
      clinicianId: nia!.id,
    });
    expect(matched.entry?.status).toBe('matched');

    const intake = await api(page, 'post', `/api/waitlist/${created.entry.id}/intake`);
    token = intake.invite?.token;
    expect(token).toBeTruthy();

    await page.goto('/dashboard/clients/intake');
    await expect(page.getByText(patientName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Awaiting Client').first()).toBeVisible();
    results.push('1 PASS');
  });

  await test.step('2 public intake → client roster', async () => {
    const guest = await browser.newContext();
    const g = await guest.newPage();
    const complete = await g.request.post(`/api/intake/public/${token}/complete`, {
      data: {
        demographics: {
          firstName: 'QA',
          lastName: `Loop Kid ${stamp}`,
          dateOfBirth: '2012-03-15',
          addressLine1: '12 Test St',
          city: 'Baltimore',
          state: 'MD',
          postalCode: '21201',
          phone: '(301) 555-0199',
          email: patientEmail,
        },
        insurance: {
          primaryPayer: 'Medicaid (Maryland)',
          memberId: `QA${stamp}`,
        },
        consents: { hipaa: true, treatment: true, telehealth: true, financial: true },
        signature: { fullName: patientName, signedAt: new Date().toISOString() },
      },
    });
    const body = await complete.json();
    expect(complete.ok(), `intake complete: ${JSON.stringify(body)}`).toBeTruthy();
    await guest.close();

    await page.goto('/dashboard/clients/intake');
    await expect(page.getByText(patientName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Completed').first()).toBeVisible();

    const clients = await api(page, 'get', '/api/clients');
    const row = (clients.clients || clients).find?.((c: { name: string }) =>
      c.name.includes(`Loop Kid ${stamp}`)
    ) || (Array.isArray(clients) ? clients.find((c: { name: string }) => c.name.includes(`Loop Kid ${stamp}`)) : null);
    const list = Array.isArray(clients.clients) ? clients.clients : Array.isArray(clients) ? clients : [];
    const found = list.find((c: { name: string; id: string }) =>
      String(c.name).includes(`Loop Kid ${stamp}`)
    );
    expect(found, `client missing from roster: ${JSON.stringify(clients).slice(0, 400)}`).toBeTruthy();
    clientId = found.id;
    results.push('2 PASS');
  });

  await test.step('3 two appointments virtual + in-person', async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const a = await api(page, 'post', '/api/appointments', {
      clientId,
      type: 'Individual Therapy',
      date,
      startTime: '10:00',
      endTime: '10:50',
      isVirtual: true,
      videoProvider: 'zoom',
    });
    const b = await api(page, 'post', '/api/appointments', {
      clientId,
      type: 'Individual Therapy',
      date,
      startTime: '14:00',
      endTime: '14:50',
      isVirtual: false,
    });
    expect(a.appointment?.isVirtual || a.isVirtual).toBeTruthy();
    expect(b.appointment?.isVirtual || b.isVirtual).toBeFalsy();
    const virtualId = a.appointment?.id || a.id;
    await api(page, 'patch', `/api/appointments/${virtualId}`, { status: 'checked-in' });
    results.push('3 PASS');
    results.push('4a check-in PASS');
  });

  await test.step('4 note Draft → Sign → Lock', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await login(page, 'therapist@role-demo.local');

    const note = await api(page, 'post', `/api/clients/${clientId}/notes`, {
      body: 'QA loop: client attended, mood reviewed, plan to continue CBT.',
    });
    noteId = note.note?.id;
    expect(noteId).toBeTruthy();
    expect(note.note?.workflowStatus || 'Draft').toMatch(/Draft/i);

    const signed = await api(page, 'patch', `/api/ehr/notes/${noteId}/workflow`, { status: 'Signed' });
    expect(signed.status).toBe('Signed');
    const locked = await api(page, 'patch', `/api/ehr/notes/${noteId}/workflow`, { status: 'Locked' });
    expect(locked.status).toBe('Locked');
    results.push('4 PASS');
  });

  await test.step('5 mood 2/10 → alert → review', async () => {
    await api(page, 'post', `/api/clients/${clientId}/check-ins`, {
      mood: 2,
      stress: 6,
      note: 'Low energy today',
    });
    const alerts = await api(page, 'get', '/api/risk-alerts?unreviewed=true');
    const hit = (alerts.alerts as { id: string; clientName: string; type: string }[]).find(
      (a) => a.clientName.includes(`Loop Kid ${stamp}`) && /mood/i.test(a.type)
    );
    expect(hit, `no low-mood alert: ${JSON.stringify(alerts).slice(0, 500)}`).toBeTruthy();
    const reviewed = await api(page, 'patch', `/api/risk-alerts/${hit!.id}/review`, {
      note: 'Called family and safety-planned.',
    });
    expect(reviewed.alert?.reviewed).toBeTruthy();
    results.push('5 PASS');
  });

  await test.step('6 eligibility + draft claim', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await login(page, 'billing@role-demo.local');

    const elig = await api(page, 'post', '/api/eligibility/check', {
      clientId,
      payerName: 'Medicaid (MD)',
      memberId: `QA${stamp}`,
    });
    expect(elig.check?.id || elig.id).toBeTruthy();

    const claim = await api(page, 'post', '/api/billing/claims/from-note', { noteId });
    const status = claim.claim?.status || claim.status;
    expect(String(status).toUpperCase()).toBe('DRAFT');
    results.push('6 PASS');
  });

  await test.step('7 multi-role switch', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await login(page, 'multirole@altrixs.local');

    await expect(page.getByText('Your dashboards')).toBeVisible({ timeout: 20_000 });
    await page.getByText('Your dashboards').click();
    await page.getByRole('button', { name: 'Front Desk' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByText(/front.?desk|waitlist|schedule/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: 'Progress Notes' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Claims' })).toHaveCount(0);

    await page.getByText('Your dashboards').click();
    await page.getByRole('button', { name: 'Billing Specialist' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Claims' }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto('/dashboard/ehr/notes');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByText('Your dashboards').click();
    await page.getByRole('button', { name: 'HR Manager' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto('/dashboard/clients/waitlist');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/dashboard/billing/claims');
    await expect(page).toHaveURL(/\/dashboard$/);
    results.push('7 PASS');
  });

  await test.step('8 NP Rx stub; therapist blocked', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await login(page, 'therapist@role-demo.local');
    await page.goto('/dashboard/ehr/prescriptions');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await login(page, 'np@role-demo.local');
    await page.goto('/dashboard/ehr/prescriptions');
    await expect(page.getByRole('heading', { name: 'E-Prescribing' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: '+ New Prescription' }).click();
    await page.locator('select').first().selectOption({ index: 1 });
    await page.getByText('Medication *').locator('..').locator('select').selectOption({
      label: 'Sertraline (Zoloft)',
    });
    await page.locator('select').filter({ hasText: 'Select pharmacy' }).selectOption({
      label: 'CVS Pharmacy - Baltimore',
    });
    await page.getByRole('button', { name: 'Send to Pharmacy' }).click();
    await expect(page.getByText('Sertraline (Zoloft)').first()).toBeVisible();
    results.push('8 PASS');
  });

  console.log(results.join('\n'));
});
