import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  isValidClia,
  isValidEin,
  isValidNpi,
  isValidTaxonomy,
  maskTaxId,
  normalizeEin,
} from '../src/lib/practice/validators';
import {
  billingSchema,
  changedFields,
  clinicalSchema,
  complianceSchema,
  locationInputSchema,
  profileSchema,
  baaInputSchema,
} from '../src/lib/practice/settings';
import { computePracticeChecklist, emptySettingsView, type ChecklistContext } from '../src/lib/practice/checklist';
import { canEditPracticeSettings, canViewPracticeSettings } from '../src/lib/practice/access';
import { isPlaceholderAddress, isPlaceholderNpi, placeholderLocationFields } from '../src/lib/practice/placeholders';
import { unsignedNoteCutoff } from '../src/lib/inbox/core';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── Validators ──────────────────────────────────────────────────────────────

test('NPI uses the CMS Luhn check over 80840 + NPI', () => {
  assert.equal(isValidNpi('1234567893'), true); // CMS published example
  assert.equal(isValidNpi('1801621297'), true); // MD Behavioral Health adult clinic (NPPES)
  assert.equal(isValidNpi('1234567890'), false);
  assert.equal(isValidNpi('123456789'), false);
  assert.equal(isValidNpi('12345678930'), false);
  assert.equal(isValidNpi(''), false);
  assert.equal(isValidNpi(null), false);
});

test('EIN format and IRS prefix', () => {
  assert.equal(isValidEin('92-3843658'), true);
  assert.equal(isValidEin('923843658'), true);
  assert.equal(isValidEin('07-1234567'), false); // prefix never issued
  assert.equal(isValidEin('00-0000000'), false);
  assert.equal(isValidEin('92-384365'), false);
  assert.equal(isValidEin('9a-3843658'), false);
  assert.equal(normalizeEin('92-3843658'), '923843658');
});

test('tax ID is only ever shown masked', () => {
  assert.equal(maskTaxId('923843658'), 'XX-XXX3658');
  assert.equal(maskTaxId('92-3843658'), 'XX-XXX3658');
  assert.equal(maskTaxId(null), '');
});

test('taxonomy and CLIA formats', () => {
  assert.equal(isValidTaxonomy('261QM0801X'), true);
  assert.equal(isValidTaxonomy('2084P0800X'), true);
  assert.equal(isValidTaxonomy('251s00000x'), true);
  assert.equal(isValidTaxonomy('261QM0801'), false);
  assert.equal(isValidTaxonomy('261QM08011'), false);
  assert.equal(isValidClia('21D1234567'), true);
  assert.equal(isValidClia('21X1234567'), false);
});

// ─── Section schemas ─────────────────────────────────────────────────────────

test('profile schema validates identifiers and keeps an unsent tax ID', () => {
  const ok = profileSchema.parse({ legalName: ' MD Behavioral Health LLC ', organizationNpi: '1801621297', taxonomyCodes: ['261qm0801x'] });
  assert.equal(ok.legalName, 'MD Behavioral Health LLC');
  assert.equal(ok.taxId, undefined, 'tax ID not sent = keep stored value');
  assert.deepEqual(ok.taxonomyCodes, ['261QM0801X']);
  assert.equal(ok.dbaName, null, 'empty text becomes null, never a placeholder');
  assert.equal(profileSchema.parse({ taxId: '92-3843658' }).taxId, '923843658');
  assert.equal(profileSchema.parse({ taxId: '' }).taxId, null);
  assert.throws(() => profileSchema.parse({ organizationNpi: '1234567890' }), /check digit/);
  assert.throws(() => profileSchema.parse({ taxId: '07-1234567' }), /EIN/);
  assert.throws(() => profileSchema.parse({ taxonomyCodes: ['ABC'] }), /Taxonomy/);
  assert.throws(() => profileSchema.parse({ cliaNumber: '12345' }), /CLIA/);
  assert.throws(() => profileSchema.parse({ website: 'mdbh.com' }), /http/);
});

test('billing schema: fees off by default, pay-to required when different, telehealth POS 02/10', () => {
  const d = billingSchema.parse({});
  assert.equal(d.noShowFeeEnabled, false);
  assert.equal(d.lateCancelFeeEnabled, false);
  assert.equal(d.lateFeesEnabled, false);
  assert.equal(d.noShowFeeCents, null);
  assert.equal(d.posOffice, '11');
  assert.equal(d.posTelehealthHome, '10');
  assert.equal(d.posTelehealthOther, '02');
  assert.equal(d.telehealthModifierDefault, '95');
  assert.throws(() => billingSchema.parse({ payToSameAsBilling: false }), /Pay-to address/);
  assert.equal(
    billingSchema.parse({ payToSameAsBilling: false, payToAddressLine1: 'PO Box 1', payToCity: 'Bowie', payToState: 'md', payToZip: '20716-3104' }).payToZip,
    '207163104'
  );
  assert.throws(() => billingSchema.parse({ payToSameAsBilling: false, payToAddressLine1: 'PO Box 1', payToCity: 'Bowie', payToState: 'MD', payToZip: '20716' }), /ZIP\+4/);
  assert.throws(() => billingSchema.parse({ noShowFeeEnabled: true }), /no-show fee/);
  assert.equal(billingSchema.parse({ noShowFeeEnabled: true, noShowFeeCents: 5000 }).noShowFeeCents, 5000);
  assert.throws(() => billingSchema.parse({ posTelehealthHome: '11' }), /02 or 10/);
});

test('clinical and compliance defaults', () => {
  const c = clinicalSchema.parse({});
  assert.equal(c.noteSignDeadlineHours, 72, 'practice policy default: sign within 72 hours');
  assert.equal(c.treatmentPlanReviewDays, 180);
  assert.deepEqual(c.cosignRequiredRoles, ['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT']);
  assert.equal(c.aiNoteConsentRequired, true);
  assert.throws(() => clinicalSchema.parse({ noteSignDeadlineHours: 72, lateNoteEscalationHours: 48 }), /Escalation/);
  const k = complianceSchema.parse({});
  assert.equal(k.recordRetentionYearsAdult, 5);
  assert.equal(k.recordRetentionMinorAge, 21);
  assert.equal(k.part2Program, null, 'Part 2 starts unanswered');
  assert.throws(() => complianceSchema.parse({ recordRetentionYearsAdult: 3 }));
});

test('BAA status requires a signed date when signed', () => {
  assert.throws(() => baaInputSchema.parse({ vendorKey: 'aws', vendorName: 'AWS', status: 'signed' }), /signed/);
  assert.equal(baaInputSchema.parse({ vendorKey: 'aws', vendorName: 'AWS', status: 'signed', signedOn: '2026-01-15' }).status, 'signed');
});

// ─── Placeholders ────────────────────────────────────────────────────────────

test('seeded placeholder NPIs and addresses are recognized and rejected', () => {
  for (const npi of ['1457893211', '1457893212', '1457893213', '1457893214']) {
    assert.equal(isPlaceholderNpi(npi), true);
    assert.equal(isValidNpi(npi), false, `${npi} also fails the check digit, so claims reject it`);
  }
  assert.equal(isPlaceholderNpi('1801621297'), false);
  assert.equal(isPlaceholderAddress('15500 Annapolis Rd', '20715'), true);
  assert.equal(isPlaceholderAddress('4000 Mitchellville Rd', '20716'), false);
  assert.deepEqual(placeholderLocationFields({ npi: '1457893212', addressLine1: '13870 Georgia Ave', postalCode: '20906' }), ['npi', 'addressLine1']);
  assert.throws(() => locationInputSchema.parse({ name: 'Bowie', npi: '1457893211' }));
});

test('no code path carries the fabricated location NPIs', () => {
  const ctx = read('src/context/LocationContext.tsx');
  assert.ok(!/14578932\d\d/.test(ctx), 'LocationContext must not contain seeded NPIs');
  const route = read('src/app/api/locations/route.ts');
  assert.match(route, /requireOrgContext\(\)/, 'GET /api/locations requires a clinic session');
  assert.ok(!/location_npi|address_line1/.test(route), 'switcher rows never return NPI or street address');
  assert.ok(!/pathname\.startsWith\('\/api\/locations'\)/.test(read('src/proxy.ts')), '/api/locations is not a public API');
});

test('placeholder cleanup migration clears exactly the seeded values, idempotently', () => {
  const sql = read('prisma/migrations/20261018_clear_placeholder_location_npis.sql');
  assert.match(sql, /WHERE location_npi IN \('1457893211', '1457893212', '1457893213', '1457893214'\)/);
  assert.match(sql, /to_regclass\('public\.practice_locations'\) IS NULL/);
  assert.match(sql, /\('15500 Annapolis Rd', '20715'\)/);
  assert.ok(!/DELETE\s+FROM/i.test(sql));
  assert.ok(!/\bpractices\b\s+SET/i.test(sql), 'does not touch other tables');
});

// ─── Checklist ───────────────────────────────────────────────────────────────

function context(overrides: Partial<ChecklistContext> = {}): ChecklistContext {
  return {
    settings: emptySettingsView(),
    locations: [],
    billingProviders: { active: 0, defaultNpi: null, problems: ['No billing provider configured'] },
    payers: { active: 0, verified: 0 },
    scheduling: { enabledServices: 0, reminderChannels: [], telehealthPlatform: null },
    baas: [],
    staff: { active: 0, leadership: 0, clinicians: 0, cliniciansMissingNpi: 0 },
    integrations: [],
    ...overrides,
  };
}

function complete(): ChecklistContext {
  const settings = {
    ...emptySettingsView(),
    legalName: 'MD Behavioral Health LLC',
    practiceType: 'omhc',
    organizationNpi: '1801621297',
    hasTaxId: true,
    taxIdMasked: 'XX-XXX3658',
    taxonomyCodes: ['261QM0801X'],
    medicaidProviderNumber: '123456789',
    mainPhone: '3012498100',
    mainEmail: 'info@example.org',
    omhcLicenseNumber: 'OMHC-1',
    omhcLicenseExpiresOn: '2027-06-30',
    accreditationBody: 'CARF',
    billingContactName: 'Billing',
    billingContactEmail: 'billing@example.org',
    statementRemitAddressLine1: '4000 Mitchellville Rd',
    statementRemitCity: 'Bowie',
    statementRemitState: 'MD',
    statementRemitZip: '20716',
    privacyOfficerName: 'P',
    privacyOfficerEmail: 'p@example.org',
    securityOfficerName: 'S',
    securityOfficerEmail: 's@example.org',
    breachContactName: 'B',
    breachContactEmail: 'b@example.org',
    part2Program: false,
    reviewedSections: ['billing', 'clinical', 'compliance', 'scheduling'],
  };
  const hours = { mon: { enabled: true, start: '09:00', end: '17:00' } };
  return context({
    settings,
    locations: [
      { id: 'l1', name: 'Bowie', code: 'BW', addressLine1: '4000 Mitchellville Rd', addressLine2: null, city: 'Bowie', state: 'MD', postalCode: '20716', phone: '3012498100', fax: null, npi: null, posCode: '11', timezone: 'America/New_York', active: true, isPrimary: true, businessHours: hours, unverifiedFields: [] },
    ],
    billingProviders: { active: 1, defaultNpi: '1801621297', problems: [], defaultTaxIdMatches: true },
    payers: { active: 3, verified: 3 },
    scheduling: { enabledServices: 4, reminderChannels: ['email'], telehealthPlatform: 'CHIME' },
    baas: ['aws', 'waystar', 'drfirst', 'stripe'].map((k) => ({ vendorKey: k, vendorName: k, service: null, status: 'signed' as const, signedOn: '2026-01-01', expiresOn: null, notes: null, requiredForGoLive: k !== 'stripe' })),
    staff: { active: 10, leadership: 1, clinicians: 6, cliniciansMissingNpi: 0 },
    integrations: (['waystar', 'drfirst', 'stripe', 'sms', 'email', 'chime', 'healthlake'] as const).map((key) => ({ key, label: key, state: 'configured' as const, detail: '' })),
  });
}

test('an empty practice is neither ready to bill nor ready to go live', () => {
  const c = computePracticeChecklist(context());
  assert.equal(c.readyToBill, false);
  assert.equal(c.readyToGoLive, false);
  const bill = c.billBlockers.map((i) => i.id);
  for (const id of ['legal-name', 'org-npi', 'tax-id', 'taxonomy', 'billing-provider', 'payer-any', 'clinician-npi', 'int-waystar']) {
    assert.ok(bill.includes(id), `${id} blocks billing`);
  }
  assert.ok(c.goLiveBlockers.some((i) => i.id === 'privacy-officer'));
  assert.ok(c.goLiveBlockers.some((i) => i.id === 'baa-aws'));
  assert.ok(!c.goLiveBlockers.some((i) => i.id === 'baa-stripe'), 'Stripe BAA is recommended only');
  assert.equal(c.sections.length, 9);
  assert.ok(c.sections.every((s) => s.percent >= 0 && s.percent <= 100));
});

test('a complete practice is ready to bill and go live with every section at 100%', () => {
  const c = computePracticeChecklist(complete());
  assert.deepEqual(c.billBlockers.map((i) => i.id), []);
  assert.deepEqual(c.goLiveBlockers.map((i) => i.id), []);
  assert.equal(c.readyToBill, true);
  assert.equal(c.readyToGoLive, true);
  assert.equal(c.percent, 100);
  assert.ok(c.sections.every((s) => s.percent === 100));
});

test('checklist items flip individually', () => {
  const base = complete();
  const badNpi = computePracticeChecklist({ ...base, settings: { ...base.settings, organizationNpi: '1234567890' } });
  assert.equal(badNpi.readyToBill, false);
  assert.equal(badNpi.billBlockers[0].id, 'org-npi');

  const placeholder = computePracticeChecklist({ ...base, locations: [{ ...base.locations[0], npi: '1457893211', unverifiedFields: ['npi'] }] });
  assert.ok(placeholder.billBlockers.some((i) => i.id === 'location-npi'));

  const unverifiedPayer = computePracticeChecklist({ ...base, payers: { active: 3, verified: 2 } });
  assert.equal(unverifiedPayer.readyToBill, true, 'verification is recommended, not blocking');
  assert.ok(unverifiedPayer.sections.find((s) => s.key === 'payers')!.percent < 100);

  const payTo = computePracticeChecklist({ ...base, settings: { ...base.settings, payToSameAsBilling: false } });
  assert.ok(payTo.billBlockers.some((i) => i.id === 'pay-to'));

  const part2 = computePracticeChecklist({ ...base, settings: { ...base.settings, part2Program: null } });
  assert.equal(part2.readyToBill, true);
  assert.equal(part2.readyToGoLive, false);

  const prp = computePracticeChecklist({ ...base, settings: { ...base.settings, specialties: ['Psychiatric rehabilitation (PRP)'] } });
  assert.ok(prp.goLiveBlockers.some((i) => i.id === 'prp-license'));
});

// ─── Role gate & audit ───────────────────────────────────────────────────────

test('only practice leadership edits practice settings', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) {
    assert.equal(canEditPracticeSettings(r), true, r);
    assert.equal(canViewPracticeSettings(r), true, r);
  }
  for (const r of ['BILLING', 'OFFICE_MANAGER', 'THERAPIST', 'PSYCHIATRIST', 'FRONT_DESK', 'HR', 'SUPER_ADMIN', '', null]) {
    assert.equal(canEditPracticeSettings(r), false, String(r));
  }
  assert.equal(canViewPracticeSettings('BILLING'), false);
  assert.equal(canViewPracticeSettings('THERAPIST'), false);
});

test('changedFields reports names only and ignores unchanged / unsent fields', () => {
  const before = { legalName: 'A', taxId: '923843658', omhcLicenseExpiresOn: new Date('2027-01-01T00:00:00Z'), specialties: ['x'] };
  assert.deepEqual(
    changedFields(before, { legalName: 'A', taxId: undefined, omhcLicenseExpiresOn: new Date('2027-01-01T00:00:00Z'), specialties: ['x', 'y'], dbaName: null }),
    ['specialties']
  );
  assert.deepEqual(changedFields({}, { legalName: 'B', mainPhone: '3015550100' }), ['legalName', 'mainPhone']);
});

test('every practice-settings write is gated to leadership and audited without values', () => {
  const gate = read('src/app/api/practice-settings/_lib/gate.ts');
  assert.match(gate, /outcome: 'DENIED'/, 'denied writes are audited');
  assert.match(gate, /requireOrgContext/);
  for (const rel of ['route.ts', 'locations/route.ts', 'baas/route.ts', 'onboarding/route.ts']) {
    const src = read(`src/app/api/practice-settings/${rel}`);
    assert.match(src, /practiceGate\('write'/, `${rel} PUT uses the write gate`);
  }
  const store = read('src/lib/practice/store.ts');
  const audits = store.match(/writeAuditLog\(/g) ?? [];
  assert.ok(audits.length >= 4, 'section, onboarding, location and BAA writes are audited');
  assert.match(store, /changedFields: auditSafe\(allChanged\)/);
  assert.match(store, /value withheld/);
  assert.ok(!/metadata: \{[^}]*taxId:/.test(store), 'tax ID value never in audit metadata');
  assert.ok(!/taxId[^\n]*NextResponse/.test(read('src/app/api/practice-settings/route.ts')));
});

test('settings view never exposes the full tax ID', async () => {
  const store = read('src/lib/practice/store.ts');
  assert.match(store, /const \{ taxId, organizationId: _org/);
  assert.match(store, /taxIdMasked: maskTaxId\(taxId\)/);
});

test('inbox unsigned-note cutoff follows the practice signing deadline', () => {
  const now = new Date('2026-10-17T16:00:00.000Z');
  assert.equal(unsignedNoteCutoff(now).toISOString(), '2026-10-16T16:00:00.000Z');
  assert.equal(unsignedNoteCutoff(now, 48).toISOString(), '2026-10-15T16:00:00.000Z');
  assert.equal(unsignedNoteCutoff(now, Number.NaN).toISOString(), '2026-10-16T16:00:00.000Z');
});

test('practice settings migration is idempotent and seeds no identifiers', () => {
  const sql = read('prisma/migrations/20261018_practice_settings.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "PracticeSettings"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "PracticeBaa"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "npi"/);
  assert.ok(!/INSERT\s+INTO/i.test(sql), 'no data written');
});
