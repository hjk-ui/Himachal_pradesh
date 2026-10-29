/**
 * Billing least-privilege (src/lib/billing/billingAccess.ts and the billing routes):
 * BILLING_CORE (Admin, Director, Practice Director, Billing) does revenue-cycle work; Office
 * Manager is read-only on claims / A/R / ERAs and posts patient payments; Front Desk posts patient
 * copays only; clinicians draft claims from their own notes; primary care providers see and create
 * charges for their own encounters. Pure helpers are unit-tested; route wiring is checked on source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  canCreateClaimFromNote,
  canPostPatientPayment,
  canReadBillingQueue,
  canReadMedicalBillingSummary,
  canUpdateMedicalChargeStatus,
  canUseMedicalBillingPicker,
  chargeDosYmd,
  claimFromNoteDecision,
  encounterKey,
  encounterKeysFromVisits,
  frontDeskPaymentFilter,
  isBillingCore,
  isFrontDeskVisiblePayment,
  medicalChargeCreateScope,
  medicalChargeReadScope,
  onOwnEncounter,
  paymentMethodsFor,
  paymentPostDecision,
} from '../src/lib/billing/billingAccess';
import { canAccessClaims, canMutateClaims } from '../src/lib/billing/claims';
import { generateAppealLetter } from '../src/lib/aiAssists';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const CORE = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'] as const;
const NON_CORE = ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'CASE_MANAGER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER', 'HR'] as const;

test('billing core reads the queues; Office Manager no longer does (2026-10-22 patient-side only)', () => {
  for (const r of CORE) {
    assert.equal(isBillingCore(r), true, r);
    assert.equal(canReadBillingQueue(r), true, r);
    assert.equal(canAccessClaims(r), true, r);
    assert.equal(canMutateClaims(r), true, r);
  }
  for (const r of NON_CORE) {
    assert.equal(isBillingCore(r), false, r);
    assert.equal(canMutateClaims(r), false, r);
  }
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'CRISIS_RESPONDER'] as const) {
    assert.equal(canReadBillingQueue(r), false, r);
  }
  assert.equal(isBillingCore(null), false);
});

// ─── 2. Claims from a signed note ────────────────────────────────────────────

test('claim from note: billing core may use any note, markReady and CPT', () => {
  const d = claimFromNoteDecision({ role: 'BILLING', actorUserId: 'u-bill', noteClinicianId: 'u-other', existingClaimCpt: '90834', requestedCpt: '90837', markReady: true });
  assert.deepEqual(d, { ok: true, markReady: true, cptCode: '90837', markReadyDropped: false });
});

test('claim from note: clinicians only from their own note', () => {
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN'] as const) {
    const other = claimFromNoteDecision({ role, actorUserId: 'u1', noteClinicianId: 'u2', existingClaimCpt: null });
    assert.equal(other.ok, false, role);
    assert.equal(('reason' in other ? other.reason : null), 'not_own_note');
    assert.equal(('reason' in other ? other.status : null), 403);
    const noClinician = claimFromNoteDecision({ role, actorUserId: 'u1', noteClinicianId: null, existingClaimCpt: null });
    assert.equal(noClinician.ok, false, `${role}: a note with no clinician is not "own"`);
    assert.equal(canCreateClaimFromNote(role, { clinicianId: 'u1' }, 'u1'), true);
    assert.equal(canCreateClaimFromNote(role, { clinicianId: 'u2' }, 'u1'), false);
  }
});

test('claim from note: clinicians never mark READY; no CPT change on an existing claim', () => {
  const fresh = claimFromNoteDecision({ role: 'THERAPIST', actorUserId: 'u1', noteClinicianId: 'u1', existingClaimCpt: null, requestedCpt: '90837', markReady: true });
  assert.deepEqual(fresh, { ok: true, markReady: false, cptCode: '90837', markReadyDropped: true });

  const changed = claimFromNoteDecision({ role: 'THERAPIST', actorUserId: 'u1', noteClinicianId: 'u1', existingClaimCpt: '90834', requestedCpt: '90837' });
  assert.equal(changed.ok, false);
  assert.equal(('reason' in changed ? changed.reason : null), 'cpt_change_requires_billing');

  // Same base code (modifier only, e.g. telehealth -GT): not a change; the claim keeps its code
  const same = claimFromNoteDecision({ role: 'NP', actorUserId: 'u1', noteClinicianId: 'u1', existingClaimCpt: '90837', requestedCpt: '90837-GT', markReady: true });
  assert.deepEqual(same, { ok: true, markReady: false, cptCode: undefined, markReadyDropped: true });
});

test('claim routes apply the own-note rule and audit DENIED', () => {
  for (const f of ['src/app/api/billing/claims/from-note/route.ts', 'src/app/api/billing/claims/route.ts']) {
    const r = src(f);
    assert.match(r, /claimFromNoteDecision\(\{/, f);
    assert.match(r, /noteClinicianId: note\.clinicianId/, f);
    assert.match(r, /outcome: 'DENIED'[\s\S]{0,120}reason: decision\.reason/, f);
    assert.doesNotMatch(r, /markReady: body\.markReady === true,\s*\}\);/, `${f}: markReady comes from the decision`);
  }
});

// ─── 1. Locked notes: metadata only ──────────────────────────────────────────

test('locked-notes returns metadata without the note body', () => {
  const r = src('src/app/api/billing/locked-notes/route.ts');
  assert.match(r, /const \{ body, \.\.\.meta \} = note;/);
  assert.match(r, /\.map\(lockedNoteMetadata\)/);
});

// ─── 3, 4, 5, 14. Claim editing / submission / resubmit / ERA / retrieval ────

test('claim detail: GET billing core + Office Manager read-only; PUT billing core (audited)', () => {
  const r = src('src/app/api/billing/claims/[id]/route.ts');
  const get = r.slice(r.indexOf('export async function GET'), r.indexOf('export async function PUT'));
  const put = r.slice(r.indexOf('export async function PUT'), r.indexOf('const patchSchema'));
  assert.match(get, /canAccessClaims\(gate\.role\) \|\| canReadBillingQueue\(gate\.role\)/);
  assert.match(put, /if \(!canMutateClaims\(gate\.role\)/);
  assert.match(put, /outcome: 'DENIED'/);
  assert.ok(put.indexOf('canMutateClaims') < put.indexOf('updateClaimSchema.safeParse'), 'role check before the body is parsed');
});

test('submit / re-scrub / resubmit / ERA sync / inbound retrieval are billing core only', () => {
  assert.match(src('src/app/api/billing/claim-scrub/submit/route.ts'), /if \(!canMutateClaims\(gate\.role\)\)/);
  const scrub = src('src/app/api/billing/claim-scrub/route.ts');
  const scrubPost = scrub.slice(scrub.indexOf('export async function POST'));
  assert.match(scrubPost, /if \(!canMutateClaims\(gate\.role\)\)/);
  assert.match(src('src/app/api/billing/ar/action/route.ts'), /body\.action === 'resubmit' && !canMutateClaims\(gate\.role\)/);
  assert.match(src('src/app/api/billing/ar/sync-era/route.ts'), /if \(!canMutateClaims\(gate\.role\)\)/);
  const inbound = src('src/app/api/waystar/inbound/route.ts');
  const inboundPost = inbound.slice(inbound.indexOf('export async function POST'));
  assert.match(inboundPost, /if \(!canAccessClaims\(g\.role\)\)/);
  for (const f of ['src/lib/billing/clearinghouseClaims.ts', 'src/lib/billing/waystarSftpSubmit.ts']) {
    const s = src(f);
    const fn = s.slice(s.indexOf(f.endsWith('clearinghouseClaims.ts') ? 'function scope(' : 'function assertBillingRole('));
    assert.doesNotMatch(fn.slice(0, 400), /OFFICE_MANAGER'\)/, `${f}: no Office Manager exception`);
  }
});

test('write-offs and payer batches are billing core only', () => {
  // canMutateLedger is billing core only (no Office Manager / Front Desk)
  for (const f of [
    'src/app/api/billing/payments/adjustment/route.ts',
    'src/app/api/billing/payments/bulk-batch/route.ts',
    'src/app/api/billing/statements/payment-plan/route.ts',
  ]) {
    assert.match(src(f), /if \(!canMutateLedger\(gate\.role\)\)/, f);
  }
});

// ─── 6. Residential & crisis billing queue ───────────────────────────────────

test('residential-crisis / specialized: GET billing core + OM, writes billing core', () => {
  const rc = src('src/app/api/billing/residential-crisis/route.ts');
  const rcGet = rc.slice(rc.indexOf('export async function GET'), rc.indexOf('export async function PATCH'));
  assert.match(rcGet, /!canReadBillingQueue\(gate\.role\)/);
  assert.match(rcGet, /canBill: isBillingCore\(gate\.role\)/);
  assert.equal((rc.match(/!isBillingCore\(gate\.role\)/g) || []).length, 2, 'PATCH and POST');
  const sp = src('src/app/api/billing/specialized/route.ts');
  assert.match(sp.slice(sp.indexOf('export async function GET'), sp.indexOf('const postSchema')), /!canReadBillingQueue\(gate\.role\)/);
  assert.match(sp.slice(sp.indexOf('export async function POST')), /!isBillingCore\(gate\.role\)/);
});

// ─── 7, 8. Primary care charges ──────────────────────────────────────────────

test('medical charges: read / create / status scopes by role', () => {
  for (const r of CORE) {
    assert.equal(medicalChargeReadScope(r), 'org', r);
    assert.equal(medicalChargeCreateScope(r), 'any', r);
    assert.equal(canUpdateMedicalChargeStatus(r), true, r);
  }
  assert.equal(medicalChargeReadScope('OFFICE_MANAGER'), null);
  assert.equal(medicalChargeCreateScope('OFFICE_MANAGER'), null);
  assert.equal(canUpdateMedicalChargeStatus('OFFICE_MANAGER'), false);
  for (const r of ['PHYSICIAN', 'MEDICAL_NP'] as const) {
    assert.equal(medicalChargeReadScope(r), 'own_encounters', r);
    assert.equal(medicalChargeCreateScope(r), 'own_encounter', r);
    assert.equal(canUpdateMedicalChargeStatus(r), false, r);
  }
  for (const r of ['FRONT_DESK', 'CASE_MANAGER', 'MEDICAL_ASSISTANT', 'THERAPIST'] as const) {
    assert.equal(medicalChargeReadScope(r), null, r);
    assert.equal(medicalChargeCreateScope(r), null, r);
  }
});

test('medical billing summary is practice-wide (billing core); picker adds PHY / MNP', () => {
  for (const r of CORE) {
    assert.equal(canReadMedicalBillingSummary(r), true, r);
    assert.equal(canUseMedicalBillingPicker(r), true, r);
  }
  for (const r of ['PHYSICIAN', 'MEDICAL_NP'] as const) {
    assert.equal(canReadMedicalBillingSummary(r), false, r);
    assert.equal(canUseMedicalBillingPicker(r), true, r);
  }
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'MEDICAL_ASSISTANT', 'CASE_MANAGER'] as const) {
    assert.equal(canReadMedicalBillingSummary(r), false, r);
    assert.equal(canUseMedicalBillingPicker(r), false, r);
  }
  assert.match(src('src/app/api/medical/billing/summary/route.ts'), /!canReadMedicalBillingSummary\(gate\.role\)/);
  assert.match(src('src/app/api/medical/billing/patients/route.ts'), /!canUseMedicalBillingPicker\(gate\.role\)/);
  // Providers get a 403 from the summary: the panel hides instead of showing an error
  assert.match(src('src/features/billing/overview/MedicalBillingSummaryPanel.tsx'), /if \(forbidden\) return null;/);
});

test('own encounter: visit practice date matches the charge date of service', () => {
  // 9:30 PM Eastern on Oct 14 is Oct 15 in UTC; the encounter is Oct 14 at the practice
  const keys = encounterKeysFromVisits([{ clientId: 'c1', visitDate: new Date('2026-10-15T01:30:00Z') }], 'America/New_York');
  assert.equal(keys.has(encounterKey('c1', '2026-10-14')), true);
  assert.equal(keys.has(encounterKey('c1', '2026-10-15')), false);
  assert.equal(chargeDosYmd(new Date('2026-10-14T00:00:00Z')), '2026-10-14');
  assert.equal(onOwnEncounter({ clientId: 'c1', dos: new Date('2026-10-14T00:00:00Z') }, keys), true);
  assert.equal(onOwnEncounter({ clientId: 'c2', dos: new Date('2026-10-14T00:00:00Z') }, keys), false);
  assert.equal(onOwnEncounter({ clientId: 'c1', dos: new Date('2026-10-13T00:00:00Z') }, keys), false);
});

test('medical charges route: scope gates on GET / POST / PATCH and own-encounter check', () => {
  const r = src('src/app/api/medical/billing/charges/route.ts');
  const get = r.slice(r.indexOf('export async function GET'), r.indexOf('const newChargeSchema'));
  const post = r.slice(r.indexOf('export async function POST'), r.indexOf('const updateChargeSchema'));
  const patch = r.slice(r.indexOf('export async function PATCH'));
  assert.match(get, /medicalChargeReadScope\(gate\.role\)/);
  assert.match(get, /onOwnEncounter\(c, ownKeys\)/);
  assert.match(post, /medicalChargeCreateScope\(gate\.role\)/);
  assert.match(post, /reason: 'not_own_encounter'/);
  assert.match(patch, /canUpdateMedicalChargeStatus\(gate\.role\)/);
  assert.match(r, /outcome: 'DENIED', metadata: \{ reason \}/);
});

// ─── 9. Primary care payer settings ──────────────────────────────────────────

test('medical payer settings POST: billing core, zod-validated, audited', () => {
  const r = src('src/app/api/medical/billing/payers/route.ts');
  const post = r.slice(r.indexOf('export async function POST'));
  assert.match(post, /if \(!isBillingCore\(gate\.role\)\)/);
  assert.match(post, /postSchema\.safeParse\(/);
  assert.match(post, /action: 'medical\.payer_settings_updated'/);
  assert.match(post, /outcome: 'DENIED'/);
  assert.doesNotMatch(r, /as any/);
});

// ─── 10. Payments: Front Desk and Office Manager ─────────────────────────────

test('payment posting by role and method', () => {
  for (const r of CORE) {
    assert.equal(canPostPatientPayment(r, 'INSURANCE', 'claim1'), true, r);
    assert.equal(canPostPatientPayment(r, 'CASH', null), true, r);
  }
  // Office Manager: patient methods with no claim link, no insurance
  for (const m of ['CARD', 'CASH', 'CHECK', 'ACH']) assert.equal(canPostPatientPayment('OFFICE_MANAGER', m, null), true, m);
  assert.equal(canPostPatientPayment('OFFICE_MANAGER', 'CHECK', 'claim1'), false);
  assert.equal(canPostPatientPayment('OFFICE_MANAGER', 'INSURANCE', 'claim1'), false);
  // Front Desk: copay / cash at the desk, never claim-linked or insurance
  for (const m of ['CARD', 'CASH', 'CHECK', 'ACH']) assert.equal(canPostPatientPayment('FRONT_DESK', m, null), true, m);
  assert.equal(canPostPatientPayment('FRONT_DESK', 'CARD', 'claim1'), false);
  assert.equal(canPostPatientPayment('FRONT_DESK', 'INSURANCE', null), false);
  assert.equal(canPostPatientPayment('FRONT_DESK', 'STUB', null), false);
  const d = paymentPostDecision('FRONT_DESK', { method: 'CARD', claimId: 'c' });
  assert.equal(('reason' in d ? d.reason : null), 'claim_linked_payment');
  for (const r of ['THERAPIST', 'MEDICAL_ASSISTANT', 'HR'] as const) assert.equal(canPostPatientPayment(r, 'CASH', null), false, r);

  assert.deepEqual(paymentMethodsFor('FRONT_DESK'), ['CARD', 'ACH', 'CASH', 'CHECK']);
  assert.ok(paymentMethodsFor('BILLING').includes('INSURANCE'));
  assert.deepEqual(paymentMethodsFor('THERAPIST'), []);
});

test('Front Desk payment list: patient payments only', () => {
  const rows = [
    { id: 'a', method: 'CARD', claimId: null },
    { id: 'b', method: 'INSURANCE', claimId: 'c1' },
    { id: 'c', method: 'CASH', claimId: 'c1' },
    { id: 'd', method: 'STUB', claimId: null },
    { id: 'e', method: 'ACH', claimId: null },
  ];
  assert.deepEqual(frontDeskPaymentFilter('FRONT_DESK', rows).map((r) => r.id), ['a', 'e']);
  assert.equal(frontDeskPaymentFilter('BILLING', rows).length, rows.length);
  assert.equal(frontDeskPaymentFilter('OFFICE_MANAGER', rows).length, rows.length);
  assert.equal(isFrontDeskVisiblePayment({ method: 'INSURANCE', claimId: null }), false);
});

test('payments route enforces the posting rule and audits it; the page offers role methods', () => {
  const r = src('src/app/api/billing/payments/route.ts');
  assert.match(r, /frontDeskPaymentFilter\(gate\.role, all\.payments\)/);
  assert.match(r, /paymentPostDecision\(gate\.role, \{ method: body\.method, claimId: body\.claimId \}\)/);
  assert.match(r, /reason: decision\.reason/);
  assert.match(r, /source: 'front_desk_copay'/);
  const page = src('src/app/dashboard/billing/payments/page.tsx');
  assert.match(page, /const paymentMethods = paymentMethodsFor\(user\?\.role\);/);
  assert.match(page, /\{methods\.map\(\(item\) =>/);
  assert.doesNotMatch(page, /\['CARD', 'ACH', 'CASH', 'CHECK', 'INSURANCE'\] as const\)\.map/);
});

// ─── 11. Appeals ─────────────────────────────────────────────────────────────

test('appeals/draft is retired (410) and the template invents no identifiers', async () => {
  const r = src('src/app/api/billing/appeals/draft/route.ts');
  assert.match(r, /status: 410/);
  assert.match(r, /\/api\/billing\/denials\/appeal/);
  assert.doesNotMatch(r, /generateAppealLetter|38500|H0018|Patient Candidate/);
  const lib = src('src/lib/aiAssists.ts');
  assert.doesNotMatch(lib, /1982736450|52-9847102/);
  const letter = await generateAppealLetter({
    clientName: 'Test Patient', payer: 'Test Payer', dos: '2026-10-01', cptCode: '90837',
    reasonCode: 'CO-16', reasonText: 'Missing information', amountCents: 20000,
  });
  assert.match(letter.letter, /\[Billing NPI\]/);
  assert.match(letter.letter, /\[Tax ID\]/);
  assert.doesNotMatch(letter.drafter, /Bedrock|Claude|Sonnet/);
  assert.doesNotMatch(letter.letter, /documentation confirms acute symptomatology/);
  const withOrg = await generateAppealLetter({
    clientName: 'Test Patient', payer: 'Test Payer', dos: '2026-10-01', cptCode: '90837',
    reasonCode: 'CO-16', reasonText: 'Missing information', amountCents: 20000,
    organizationName: 'Example Practice LLC', billingNpi: '1234567893', taxId: '12-3456789',
  });
  assert.match(withOrg.letter, /Example Practice LLC/);
  assert.match(withOrg.letter, /NPI: 1234567893 \| Tax ID: 12-3456789/);
});

// ─── 12, 13. Waystar ─────────────────────────────────────────────────────────

test('waystar status is billing core; remits/summary and inbound/retrieve are retired', () => {
  const status = src('src/app/api/waystar/status/route.ts');
  assert.match(status, /requireOrgContext\(\)/);
  assert.match(status, /if \(!canAccessClaims\(gate\.role\)\)/);
  for (const f of ['src/app/api/waystar/remits/summary/route.ts', 'src/app/api/waystar/inbound/retrieve/route.ts']) {
    const r = src(f);
    assert.match(r, /status: 410/, f);
    assert.match(r, /requireOrgContext\(\)/, f);
    assert.match(r, /canAccessClaims\(gate\.role\)/, f);
    assert.doesNotMatch(r, /getS3FileContent|retrieveInboundFiles|searchParams/, f);
  }
});
