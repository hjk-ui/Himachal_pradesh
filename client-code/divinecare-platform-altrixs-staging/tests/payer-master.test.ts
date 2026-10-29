/**
 * Billing › Payers (payer master) and Billing › Insurance Panels.
 *  - No hard-coded payer list (the old page showed invented payer IDs as real).
 *  - Valant's EDI ID is a hint only: never filled in as the Waystar payer ID.
 *  - Validation (payer ID, US state, ZIP, phone, timely filing, complete address).
 *  - Edit roles: billing + leadership; audits carry changed field names only.
 *  - BILLING's sidebar includes the Report library.
 *  - Panels persist in PayerPanel through /api/billing/panels (not local state / JSON module list).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';
import { buildNavForRole } from '../src/components/layout/navConfig';
import {
  canEditPayerMaster,
  changedFields,
  filterPayers,
  findLinkedMapping,
  formatAddress,
  missingAddress,
  missingPayerId,
  payerMasterData,
  payerMasterInputSchema,
  prefillFromValant,
  type ValantPayerOption,
} from '../src/lib/billing/payerMaster';
import { legacyPanelToInput, panelCounts, panelInputSchema } from '../src/lib/billing/payerPanels';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('payer settings page has no hard-coded payer list or invented payer IDs', () => {
  const page = src('src/app/dashboard/billing/payer-settings/page.tsx');
  assert.doesNotMatch(page, /INITIAL_PAYERS|INITIAL_RULES|MATRIX_PAYERS/);
  for (const invented of ['00840', '00580', '60054', '87726', '62308', 'OMDBH']) assert.ok(!page.includes(invented), invented);
  assert.match(page, /\/api\/billing\/payers/);
  const form = src('src/app/dashboard/billing/payer-settings/PayerForm.tsx');
  for (const invented of ['00840', '00580', 'OMDBH']) assert.ok(!form.includes(invented), invented);
});

const VALANT: ValantPayerOption = {
  id: 'v1',
  name: 'NOVITAS SOLUTIONS PART B',
  ediPayerId: 'SMDC0',
  payerRegistryId: null,
  addresses: [
    { id: 'a1', addressLine: 'PO BOX 3702', city: 'MECHANICSBURG', state: 'PA', zip: '170550000', addressRaw: null, addressStatus: 'ok', phone: '8778894473' },
    { id: 'a2', addressLine: 'PO BOX 9', city: 'ELSEWHERE', state: 'ZZ', zip: '123', addressRaw: null, addressStatus: 'suspect', phone: null },
  ],
};

test('Start from Valant prefills name and address but never the Waystar payer ID', () => {
  const first = prefillFromValant(VALANT);
  assert.equal(first.form.payerId, '');
  assert.equal(first.valantEdiHint, 'SMDC0');
  assert.equal(first.form.name, 'NOVITAS SOLUTIONS PART B');
  assert.equal(first.form.claimsCity, 'MECHANICSBURG');
  assert.equal(first.form.claimsState, 'PA');
  assert.equal(first.form.claimsZip, '170550000');
  assert.equal(first.addressWarning, null);
  // Chosen address; malformed state / ZIP are left blank, not guessed
  const second = prefillFromValant(VALANT, 'a2');
  assert.equal(second.addressId, 'a2');
  assert.equal(second.form.payerId, '');
  assert.equal(second.form.claimsState, '');
  assert.equal(second.form.claimsZip, '');
  assert.ok(second.addressWarning);
  // The client keeps whatever staff typed for payerId; the server never reads ediPayerId into it
  assert.match(src('src/app/dashboard/billing/payer-settings/PayerForm.tsx'), /payerId: f\.payerId/);
  assert.doesNotMatch(src('src/lib/billing/payerMasterDb.ts'), /payerId:\s*[a-z.]*ediPayerId/);
  assert.match(src('src/app/dashboard/billing/payer-settings/PayerForm.tsx'), /Valant EDI ID \(verify against Waystar&apos;s payer list\)/);
});

test('payer validation: payer ID, state, ZIP, phone, timely filing, complete address', () => {
  const ok = payerMasterInputSchema.parse({
    name: 'Medicare Part B', payerId: ' smdc0 ', payerType: 'medicare', claimsAddressLine1: 'PO Box 3702', claimsCity: 'Mechanicsburg',
    claimsState: 'pa', claimsZip: '17055-0000', phone: '1 (877) 889-4473', timelyFilingDays: '365', portalUrl: 'novitas-solutions.com',
  });
  assert.equal(ok.payerId, 'SMDC0');
  assert.equal(ok.claimsState, 'PA');
  assert.equal(ok.claimsZip, '170550000');
  assert.equal(ok.phone, '8778894473');
  assert.equal(ok.timelyFilingDays, 365);
  assert.equal(ok.portalUrl, 'https://novitas-solutions.com');
  assert.equal(ok.clearinghouse, 'Waystar');
  assert.equal(ok.eraEnrollmentStatus, 'unknown');
  const data = payerMasterData(ok);
  assert.equal(data.claimsAddress, formatAddress(data));
  assert.match(data.claimsAddress!, /PO Box 3702, Mechanicsburg, PA 17055-0000/);

  // Blank payer ID / address allowed (shown as Missing); nothing defaulted
  const blank = payerMasterInputSchema.parse({ name: 'CareFirst', payerId: '', timelyFilingDays: '' });
  assert.equal(blank.payerId ?? null, null);
  assert.equal(blank.timelyFilingDays, null);
  assert.ok(missingPayerId(blank));
  assert.ok(missingAddress(blank));

  const bad = (v: Record<string, unknown>) => !payerMasterInputSchema.safeParse({ name: 'X Payer', ...v }).success;
  assert.ok(bad({ payerId: 'A' }));
  assert.ok(bad({ payerId: 'ABC_123' }));
  assert.ok(bad({ payerId: 'ABCDEFGHIJKLMNOP' }));
  assert.ok(!bad({ payerId: 'MD-123' }));
  const addr = { claimsAddressLine1: '1 Main', claimsCity: 'Bowie', claimsZip: '20715' };
  assert.ok(bad({ ...addr, claimsState: 'XX' }));
  assert.ok(!bad({ ...addr, claimsState: 'MD' }));
  assert.ok(bad({ ...addr, claimsState: 'MD', claimsZip: '2071' }));
  assert.ok(bad({ ...addr, claimsState: 'MD', claimsZip: '207151' }));
  assert.ok(!bad({ ...addr, claimsState: 'MD', claimsZip: '20715-1234' }));
  assert.ok(bad({ claimsCity: 'Bowie' }), 'partial address');
  assert.ok(bad({ phone: '555-1234' }));
  assert.ok(bad({ timelyFilingDays: 10 }));
  assert.ok(bad({ timelyFilingDays: 2000 }));
  assert.ok(bad({ name: '' }));
});

test('edit roles: billing + leadership; other roles cannot reach the pages or APIs', () => {
  for (const r of ['BILLING', 'PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR', 'SUPER_ADMIN']) assert.equal(canEditPayerMaster(r), true, r);
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'HR', null, undefined, '']) assert.equal(canEditPayerMaster(r), false, String(r));
  for (const r of ['BILLING', 'PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR']) {
    assert.equal(canAccessPath(r, '/dashboard/billing/payer-settings'), true, r);
    assert.equal(canAccessPath(r, '/dashboard/billing/panels'), true, r);
    for (const m of ['GET', 'POST', 'PATCH']) {
      assert.equal(canAccessApiPath(r, '/api/billing/payers', m), true, `${r} ${m}`);
      assert.equal(canAccessApiPath(r, '/api/billing/panels/x', m), true, `${r} ${m}`);
    }
  }
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'HR']) {
    assert.equal(canAccessApiPath(r, '/api/billing/payers', 'GET'), false, r);
    assert.equal(canAccessApiPath(r, '/api/billing/panels', 'POST'), false, r);
  }
  // Routes check the edit rule before writing, and audit field names only
  for (const f of ['src/app/api/billing/payers/route.ts', 'src/app/api/billing/payers/[id]/route.ts', 'src/app/api/billing/panels/route.ts', 'src/app/api/billing/panels/[id]/route.ts']) {
    const s = src(f);
    assert.match(s, /canEditPayerMaster\(gate\.role\)/, f);
    assert.match(s, /auditPhiAccess/, f);
  }
  assert.deepEqual(changedFields({ name: 'A', phone: null, payerId: 'X' }, { name: 'B', phone: '', payerId: 'X' }), ['name']);
  assert.deepEqual(changedFields(null, { name: 'A', fax: null }), ['name']);
});

test('Waystar rules link by name, alias, then payer ID; filters', () => {
  const maps = [
    { id: 'm1', payerName: 'Medicare Part B', aliases: ['Novitas'], waystarPayerId: 'SMDC0', scope: 'organization' as const, verified: true, active: true },
    { id: 'm2', payerName: 'Carelon MD', aliases: [], waystarPayerId: 'ABC12', scope: 'global' as const, verified: false, active: true },
  ];
  assert.equal(findLinkedMapping({ name: 'MEDICARE PART B' }, maps)?.by, 'name');
  assert.equal(findLinkedMapping({ name: 'novitas' }, maps)?.id, 'm1');
  assert.equal(findLinkedMapping({ name: 'Carelon Behavioral Health', payerId: 'abc12' }, maps)?.by, 'payer_id');
  assert.equal(findLinkedMapping({ name: 'Aetna' }, maps), null);
  const rows = [
    { ...payerMasterData(payerMasterInputSchema.parse({ name: 'Aetna', payerType: 'commercial' })), valant: [] },
    { ...payerMasterData(payerMasterInputSchema.parse({ name: 'Medicare', payerId: 'SMDC0', claimsAddressLine1: '1 A', claimsCity: 'B', claimsState: 'PA', claimsZip: '17055' })), valant: [] },
  ];
  assert.deepEqual(filterPayers(rows, { missingPayerId: true }).map((r) => r.name), ['Aetna']);
  assert.deepEqual(filterPayers(rows, { missingAddress: true }).map((r) => r.name), ['Aetna']);
  assert.deepEqual(filterPayers(rows, { type: 'commercial' }).map((r) => r.name), ['Aetna']);
  assert.deepEqual(filterPayers(rows, { q: 'smdc' }).map((r) => r.name), ['Medicare']);
});

test('BILLING sidebar includes the Report library; Office Manager keeps it', () => {
  for (const role of ['BILLING', 'OFFICE_MANAGER']) {
    const hrefs = buildNavForRole(role).flatMap((s) => s.items.map((i) => i.href));
    assert.ok(hrefs.includes('/dashboard/reports'), role);
  }
  const billing = buildNavForRole('BILLING').flatMap((s) => s.items);
  assert.ok(billing.some((i) => i.href === '/dashboard/reports' && i.label === 'Report library'));
  assert.ok(billing.some((i) => i.href === '/dashboard/billing/payer-settings' && i.label === 'Payers'));
});

test('insurance panels persist through /api/billing/panels (PayerPanel)', () => {
  const page = src('src/app/dashboard/billing/panels/page.tsx');
  assert.doesNotMatch(page, /useModuleList|crypto\.randomUUID/);
  assert.match(page, /\/api\/billing\/panels/);
  assert.match(src('prisma/schema.prisma'), /model PayerPanel \{/);
  assert.match(src('prisma/migrations/20261027_payer_master.sql'), /CREATE TABLE IF NOT EXISTS "PayerPanel"/);
  assert.match(src('src/lib/billing/payerPanelsDb.ts'), /prisma\.payerPanel\.create/);

  // Validation
  assert.ok(panelInputSchema.safeParse({ payerRegistryId: 'reg1', status: 'approved' }).success);
  assert.ok(!panelInputSchema.safeParse({ status: 'approved' }).success, 'payer required');
  assert.ok(!panelInputSchema.safeParse({ payerName: 'Aetna', status: 'active' }).success, 'old status names rejected');
  assert.ok(!panelInputSchema.safeParse({ payerName: 'Aetna', effectiveDate: '10/01/2026' }).success);
  assert.ok(!panelInputSchema.safeParse({ payerName: 'Aetna', contactEmail: 'nope' }).success);
  assert.equal(panelInputSchema.parse({ payerName: 'Aetna', contactPhone: '(301) 555-0100' }).contactPhone, '3015550100');

  // Tiles from saved rows
  const c = panelCounts(
    [
      { status: 'approved', openToNewClients: true, recredentialingDueDate: '2026-11-15' },
      { status: 'approved', openToNewClients: false, recredentialingDueDate: '2028-01-01' },
      { status: 'in_process', openToNewClients: false, recredentialingDueDate: null },
      { status: 'application_submitted', openToNewClients: false, recredentialingDueDate: null },
      { status: 'termed', openToNewClients: true, recredentialingDueDate: '2026-10-01' },
    ],
    new Date('2026-10-27T12:00:00Z'),
  );
  assert.deepEqual(c, { active: 2, pending: 2, open: 1, recredDue: 1 });

  // Old module-list panels import without inventing data
  const legacy = legacyPanelToInput({ panelId: 'p1', payer: 'CareFirst', payerId: '00580', status: 'closed', notes: 'x', openToNewClients: true });
  assert.equal(legacy?.legacyId, 'p1');
  assert.equal(legacy?.input.status, 'approved');
  assert.equal(legacy?.input.openToNewClients, false);
  assert.ok(!('payerRegistryId' in (legacy?.input ?? {})));
  assert.match(String(legacy?.input.notes), /Payer ID entered on the old panel page: 00580/);
  assert.ok(panelInputSchema.safeParse(legacy?.input).success);
  assert.equal(legacyPanelToInput({ payer: 'No id' }), null);
});
