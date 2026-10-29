/**
 * Planned billing codes at booking (src/lib/appointments/plannedCodes.ts):
 *  - defaults from the appointment type (scheduling settings defaultCpt)
 *  - telehealth modifier: 95 by default, the payer's rule when mapped (GT / both / 93 / FQ)
 *  - add-on validation and suggestions (suggestions only, never auto-added)
 *  - planned codes never override the note's codes and never reach claim building
 *  - charges from the fee schedule only: no fee schedule row -> "No fee set", never an invented amount
 *  - role checks (desk / billing / clinician own appointment, charge override, courtesy discount)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FeeItem } from '../src/lib/billing/feeSchedule';
import {
  EMPTY_PLAN,
  NO_FEE_SET,
  addOnSuggestions,
  autoPlaceOfService,
  billingSectionOpenByDefault,
  canEditPlannedCodes,
  canOverrideCharge,
  canSetDiscount,
  defaultCodeForType,
  notePrefillFromPlan,
  plannedCharge,
  plannedCodeSummary,
  preparePlanForSave,
  scheduledCodeHint,
  telehealthModifierFor,
  validateDiscount,
  validatePlannedLines,
  withTelehealthModifiers,
  type PlannedLine,
} from '../src/lib/appointments/plannedCodes';
import { applyDefaults, codesPayload, draftFromPlan, emptyCodesDraft, shouldSaveCodes } from '../src/features/appointments/billingCodesDraft';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const line = (code: string, isAddOn = false, units = 1, modifiers: string[] = []): PlannedLine => ({
  code, units, modifiers, chargeCents: null, overrideReason: null, isAddOn,
});

function fee(code: string, feeCents: number, flags: Partial<FeeItem> = {}): FeeItem {
  const base = code.slice(0, 5);
  return {
    code, description: `Fee ${code}`, feeCents, billedCpt: base, baseCpt: base,
    telehealth: false, selfPay: false, child: false, itp: false, exactOnly: false,
    variantLabel: 'Standard', insuranceBillable: true, needsReview: false, reviewNote: null,
    active: true, source: 'valant', ...flags,
  };
}

const visit = { telehealth: false, selfPay: false, child: false };

// ─── Defaults from the type ───────────────────────────────────────────────────

test('primary code defaults from the appointment type defaultCpt (title or id, case-insensitive)', () => {
  const services = [
    { id: 'indiv', title: 'Individual Therapy', defaultCpt: '90837' },
    { id: 'intake', title: 'Intake', defaultCpt: '90791 ' },
    { id: 'bad', title: 'Admin', defaultCpt: 'Cancelled' },
  ];
  assert.equal(defaultCodeForType(services, 'individual therapy'), '90837');
  assert.equal(defaultCodeForType(services, 'INTAKE'), '90791');
  assert.equal(defaultCodeForType(services, 'Admin'), null, 'non-CPT default is ignored');
  assert.equal(defaultCodeForType(services, 'Unknown'), null);
  assert.equal(defaultCodeForType(null, 'Intake'), null);

  const d = applyDefaults(emptyCodesDraft(), { primary: '90837', telehealthModifiers: [] });
  assert.equal(d.primary.code, '90837');
  assert.equal(d.addOns.length, 0);
  // Staff took over the primary: a type change does not replace it
  const manual = { ...d, primary: { ...d.primary, code: '90834' }, primaryAuto: false };
  assert.equal(applyDefaults(manual, { primary: '90791', telehealthModifiers: [] }).primary.code, '90834');
});

test('saved plan loads into the draft and is not re-defaulted', () => {
  const d = draftFromPlan({ ...EMPTY_PLAN, lines: [line('90834', false, 1, ['HO']), line('90785', true)] });
  assert.equal(d.primary.code, '90834');
  assert.deepEqual(d.primary.modifiers, ['HO', '', '', '']);
  assert.equal(d.addOns[0].code, '90785');
  assert.equal(d.primaryAuto, false);
  assert.equal(applyDefaults(d, { primary: '90837', telehealthModifiers: ['95'] }).primary.code, '90834');
});

// ─── Telehealth modifier / POS ────────────────────────────────────────────────

test('telehealth adds 95 by default, or the mapped payer rule', () => {
  const video = { isVirtual: true, audioOnly: false };
  const phone = { isVirtual: true, audioOnly: true };
  assert.deepEqual(telehealthModifierFor({ isVirtual: false, audioOnly: false }, null).modifiers, []);
  assert.deepEqual(telehealthModifierFor(video, null).modifiers, ['95']);
  assert.deepEqual(telehealthModifierFor(video, { payerName: 'X', telehealthModifier: 'GT' }).modifiers, ['GT']);
  assert.deepEqual(telehealthModifierFor(video, { payerName: 'X', telehealthModifier: 'both' }).modifiers, ['GT', '95']);
  assert.deepEqual(telehealthModifierFor(video, { payerName: 'X', telehealthModifier: 'none' }).modifiers, []);
  assert.deepEqual(telehealthModifierFor(phone, { payerName: 'Medicare', audioOnlyModifier: '93' }).modifiers, ['93']);
  assert.deepEqual(telehealthModifierFor(phone, { payerName: 'MD Medicaid', audioOnlyModifier: 'FQ' }).modifiers, ['FQ']);
  const blocked = telehealthModifierFor(phone, { payerName: 'Acme', audioOnlyModifier: 'not_allowed' });
  assert.deepEqual(blocked.modifiers, []);
  assert.match(blocked.note ?? '', /not set up to accept audio-only/);
  // Swapping keeps staff modifiers (HO) and replaces 95 with GT
  assert.deepEqual(withTelehealthModifiers(['HO', '95'], ['GT']), ['HO', 'GT']);
  const d = applyDefaults(emptyCodesDraft(), { primary: '90834', telehealthModifiers: ['95'] });
  assert.deepEqual(d.primary.modifiers, ['95', '', '', '']);
});

test('place of service: 11 in person, 10 telehealth at home (default), 02 elsewhere', () => {
  assert.equal(autoPlaceOfService({ isVirtual: false, audioOnly: false }), '11');
  assert.equal(autoPlaceOfService({ isVirtual: true, audioOnly: false }), '10');
  assert.equal(autoPlaceOfService({ isVirtual: true, audioOnly: false, patientLocationType: 'home' }), '10');
  assert.equal(autoPlaceOfService({ isVirtual: true, audioOnly: true, patientLocationType: 'other' }), '02');
});

// ─── Add-on validation and suggestions ────────────────────────────────────────

test('add-on codes need a valid primary', () => {
  const err = (lines: PlannedLine[]) => validatePlannedLines(lines).errors.join(' | ');
  assert.match(err([line('90833', true)]), /need a primary/);
  assert.match(err([line('90834'), line('90833', true)]), /needs an E\/M primary/);
  assert.equal(err([line('99214'), line('90833', true)]), '');
  assert.match(err([line('99214'), line('90833', true), line('90836', true)]), /Only one psychotherapy add-on/);
  assert.match(err([line('90834'), line('90840', true)]), /90840.*needs 90839/);
  assert.equal(err([line('90839'), line('90840', true)]), '');
  assert.match(err([line('90839'), line('90785', true)]), /90785.*crisis/);
  assert.match(err([line('90839'), line('90840', true), line('90785', true)]), /90785.*crisis/);
  assert.equal(err([line('90834'), line('90785', true)]), '');
  assert.equal(err([line('99214'), line('90836', true), line('90785', true)]), '');
  assert.match(err([line('99214'), line('90785', true)]), /90785 needs a psychiatric primary/);
  assert.match(err([line('90833')]), /add-on code and can't be the primary/);
  assert.match(err([line('90791'), line('90833', true)]), /90791 can't be billed with/);
});

test('unit sanity and modifier format', () => {
  const err = (lines: PlannedLine[]) => validatePlannedLines(lines).errors.join(' | ');
  assert.match(err([line('90834', false, 2)]), /once per visit/);
  assert.match(err([line('H0004', false, 0)]), /units must be/);
  assert.equal(err([line('H0004', false, 4)]), '');
  assert.match(err([line('90839'), line('90840', true, 6)]), /more than 4 units/);
  assert.match(err([line('90834', false, 1, ['X'])]), /must be 2 letters/);
  assert.match(err([line('90834', false, 1, ['HO', 'HO'])]), /repeated/);
  assert.match(err([line('90834', false, 1, ['HO', '95', 'U1', 'U2', 'U3'])]), /up to 4 modifiers/);
  assert.match(err([line('9083')]), /not a CPT\/HCPCS/);
  assert.equal(err([line('90834', false, 1, ['HO', '95'])]), '');
});

test('add-on suggestions are suggestions only (never added by defaults)', () => {
  assert.deepEqual(addOnSuggestions('99214').map((s) => s.code), ['90833', '90836', '90838']);
  assert.deepEqual(addOnSuggestions('99214', ['90836']).map((s) => s.code), ['90785']);
  assert.deepEqual(addOnSuggestions('90834').map((s) => s.code), ['90785']);
  assert.deepEqual(addOnSuggestions('90839').map((s) => s.code), ['90840']);
  assert.deepEqual(addOnSuggestions('90834', ['90785']), []);
  const d = applyDefaults(emptyCodesDraft(), { primary: '99214', telehealthModifiers: ['95'] });
  assert.equal(d.addOns.length, 0, 'defaults never add an add-on');
});

// ─── Never override signed / documented codes ────────────────────────────────

test('planned codes prefill only a note with no code and never override documented codes', () => {
  const plan = [line('99214', false, 1, ['95']), line('90836', true), line('90785', true)];
  assert.deepEqual(notePrefillFromPlan(null, plan), { cptCode: '99214', addOnCptCode: '90836', modifiers: ['95'] });
  assert.deepEqual(notePrefillFromPlan({ cptCode: null }, plan)?.cptCode, '99214');
  assert.equal(notePrefillFromPlan({ cptCode: '90837' }, plan), null);
  assert.equal(notePrefillFromPlan({ billingCode: '90832' }, plan), null);
  assert.equal(notePrefillFromPlan(null, []), null);
  // Hint for billing when the signed code differs
  assert.equal(scheduledCodeHint('90837', '90834'), 'Scheduled as 90834');
  assert.equal(scheduledCodeHint('90834', '90834'), null);
  assert.equal(scheduledCodeHint('90837', null), null);
  assert.equal(plannedCodeSummary(plan), '99214-95 + 90836 + 90785');
});

test('claim building never reads planned codes; the planned-code routes never create claims', () => {
  for (const f of [
    'src/lib/billing/claims.ts',
    'src/lib/billing/claimLines.ts',
    'src/lib/billing/claimRules.ts',
    'src/lib/billing/waystarClaimPrep.ts',
    'src/lib/billing/waystarSftpClaims.ts',
    'src/lib/billing/clearinghouseClaims.ts',
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /plannedCode|appointmentPlannedCode|appointment_planned_codes|appointmentBillingPlan/i, `${f} must not read planned codes`);
  }
  for (const f of [
    'src/app/api/appointments/[id]/codes/route.ts',
    'src/app/api/appointments/codes/quote/route.ts',
    'src/lib/appointments/plannedCodesDb.ts',
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /generateClaim|createClaim|prisma\.claim\b/, `${f} must not create claims`);
  }
  const migration = read('prisma/migrations/20261027_appointment_planned_codes.sql');
  assert.doesNotMatch(migration, /ALTER TABLE "Appointment"/, 'no new columns on Appointment');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS appointment_planned_codes/);
});

// ─── No fabricated fees ───────────────────────────────────────────────────────

test('charges come from the fee schedule only; no row -> "No fee set" (never a built-in rate)', () => {
  // 90837 has a built-in constant rate, but with no fee schedule row the plan shows no fee
  const none = plannedCharge([], { code: '90837', units: 1 }, visit);
  assert.equal(none.chargeCents, null);
  assert.equal(none.message, NO_FEE_SET);
  assert.equal(plannedCharge([], { code: '99212', units: 1 }, visit).chargeCents, null);
  const items = [fee('90834', 13500), fee('90834T', 12000, { telehealth: true, variantLabel: 'Telehealth' }), fee('H0004', 2500)];
  assert.equal(plannedCharge(items, { code: '90834', units: 1 }, visit).chargeCents, 13500);
  assert.equal(plannedCharge(items, { code: '90834', units: 1, modifiers: ['95'] }, visit).chargeCents, 12000, 'telehealth modifier picks the telehealth fee');
  assert.equal(plannedCharge(items, { code: 'H0004', units: 4 }, visit).chargeCents, 10000);
  assert.equal(plannedCharge(items, { code: '90837', units: 1 }, visit).chargeCents, null);

  // A front desk save can't put a charge on a code with no fee
  const r = preparePlanForSave(
    { lines: [{ code: '90837', chargeCents: 18000 }] },
    { role: 'FRONT_DESK', isOwnAppointment: false, feeCharges: [null], existing: null }
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.plan.lines[0].chargeCents, null);
});

// ─── Roles ───────────────────────────────────────────────────────────────────

test('role checks: who sets codes, overrides charges and gives discounts', () => {
  for (const role of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']) {
    assert.equal(canEditPlannedCodes(role, { isOwnAppointment: false }), true, role);
  }
  assert.equal(canEditPlannedCodes('THERAPIST', { isOwnAppointment: true }), true);
  assert.equal(canEditPlannedCodes('PSYCHIATRIST', { isOwnAppointment: false }), false);
  assert.equal(canEditPlannedCodes('MEDICAL_ASSISTANT', { isOwnAppointment: true }), false);
  assert.equal(canEditPlannedCodes('HR', { isOwnAppointment: true }), false);
  assert.equal(canOverrideCharge('BILLING'), true);
  assert.equal(canOverrideCharge('FRONT_DESK'), false);
  assert.equal(canOverrideCharge('THERAPIST'), false);
  assert.equal(canSetDiscount('FRONT_DESK'), true);
  assert.equal(canSetDiscount('OFFICE_MANAGER'), true);
  assert.equal(canSetDiscount('BILLING'), true);
  assert.equal(canSetDiscount('THERAPIST'), false);
  assert.equal(billingSectionOpenByDefault('FRONT_DESK'), true);
  assert.equal(billingSectionOpenByDefault('THERAPIST'), false);

  const base = { feeCharges: [13500], existing: null };
  const other = preparePlanForSave({ lines: [{ code: '90834' }] }, { ...base, role: 'THERAPIST', isOwnAppointment: false });
  assert.equal(other.ok === false && other.status, 403);
  const own = preparePlanForSave({ lines: [{ code: '90834' }] }, { ...base, role: 'THERAPIST', isOwnAppointment: true });
  assert.equal(own.ok, true);
  const disc = preparePlanForSave({ lines: [{ code: '90834' }], discountCents: 2000, discountNote: 'Hardship' }, { ...base, role: 'THERAPIST', isOwnAppointment: true });
  assert.equal(disc.ok === false && disc.status, 403);
  const deskDisc = preparePlanForSave({ lines: [{ code: '90834' }], discountCents: 2000, discountNote: 'Hardship' }, { ...base, role: 'FRONT_DESK', isOwnAppointment: false });
  assert.equal(deskDisc.ok, true);
  const noNote = preparePlanForSave({ lines: [{ code: '90834' }], discountCents: 2000 }, { ...base, role: 'BILLING', isOwnAppointment: false });
  assert.equal(noNote.ok === false && noNote.status, 400);
  assert.match(validateDiscount(20000, 'x', 13500) ?? '', /more than the planned charges/);

  // Front desk can't override the fee; billing can, with a reason
  const deskCharge = preparePlanForSave({ lines: [{ code: '90834', chargeCents: 9000 }] }, { ...base, role: 'FRONT_DESK', isOwnAppointment: false });
  assert.equal(deskCharge.ok && deskCharge.plan.lines[0].chargeCents, 13500);
  const noReason = preparePlanForSave({ lines: [{ code: '90834', chargeCents: 9000 }] }, { ...base, role: 'BILLING', isOwnAppointment: false });
  assert.equal(noReason.ok === false && noReason.status, 400);
  const withReason = preparePlanForSave(
    { lines: [{ code: '90834', chargeCents: 9000, overrideReason: 'Sliding scale contract' }] },
    { ...base, role: 'BILLING', isOwnAppointment: false }
  );
  assert.equal(withReason.ok, true);
  if (withReason.ok) {
    assert.equal(withReason.plan.lines[0].chargeCents, 9000);
    assert.ok(withReason.changedFields.includes('chargeOverride'));
    // Audit field names only: no amounts or free text
    assert.ok(withReason.changedFields.every((f) => /^[a-zA-Z]+$/.test(f)));
    // A later front desk save keeps billing's override
    const kept = preparePlanForSave({ lines: [{ code: '90834' }], placeOfService: '11' }, { ...base, role: 'FRONT_DESK', isOwnAppointment: false, existing: withReason.plan });
    assert.equal(kept.ok && kept.plan.lines[0].chargeCents, 9000);
  }

  // Draft payload: discount only for roles that may set it; nothing saved without permission
  const d = { ...applyDefaults(emptyCodesDraft(), { primary: '90834', telehealthModifiers: [] }), discount: '20', discountNote: 'x' };
  assert.equal('discountCents' in codesPayload(d, { canSetDiscount: false }), false);
  assert.equal(codesPayload(d, { canSetDiscount: true }).discountCents, 2000);
  assert.equal(shouldSaveCodes({ ...d, canEdit: false }, 'create'), false);
  assert.equal(shouldSaveCodes({ ...d, canEdit: true }, 'create'), true);
  assert.equal(shouldSaveCodes({ ...d, canEdit: true, dirty: false }, 'edit'), false);
});
