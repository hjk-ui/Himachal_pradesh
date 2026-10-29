/**
 * Owner decisions approved 2026-10-21:
 *  1. Nightly eligibility (off by default): selection rules, gate, batching, wiring.
 *  2. CPT 99212 with no fee: never priced as $0 silently.
 *  3. MA standing orders: draft list, Medical Director approval, approved-only use.
 *  4. Maryland compliance items confirmed by the owner; PDMP citation; treatment plan review rule.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  NIGHTLY_BATCH_SIZE,
  NIGHTLY_MAX_INQUIRIES,
  NIGHTLY_OFF_NOTE,
  canManageNightlyEligibility,
  chunkInquiries,
  nightlyGate,
  selectNightlyInquiries,
  type NightlyAppointment,
} from '../src/lib/eligibility/nightly';
import type { FoEligibilityFact } from '../src/lib/frontOffice/rules';
import { CPT_CODES, FEE_NOT_SET, chargeAmountCents, cptByCode, cptFeeMissing, cptRateCents, missingFeeMessage } from '../src/lib/constants/cpt';
import { mergeCptOptions, pickFee, priceClaimLines } from '../src/lib/billing/feeSchedule';
import { normalizeClaimLines } from '../src/lib/billing/claimLines';
import { PMM_EM_OPTIONS } from '../src/lib/ehr/psychMedMgmt';
import { PROTOCOLS } from '../src/lib/visits/protocols';
import {
  DRAFT_POC_STANDING_ORDERS,
  STANDING_ORDER_ATTESTATION,
  approveStandingOrder,
  canApproveStandingOrders,
  canRetireStandingOrders,
  mergeStandingOrderEdits,
  parsePocStandingOrders,
  retireStandingOrder,
  usableStandingOrders,
  withDraftStandingOrders,
} from '../src/lib/medical/primaryCareWorkflow';
import { OWNER_CONFIRMED_IDS, REQUIREMENTS, requirementById } from '../src/lib/visits/requirements';
import { ADULT_REVIEW_MAX_DAYS, CHILD_REVIEW_MAX_DAYS, defaultReviewDays, maxReviewDays } from '../src/lib/ehr/therapy/rules';
import { validatePlanReviewDate } from '../src/lib/workflows/dates';
import { clinicalSchema } from '../src/lib/practice/settings';

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ─── 1. Nightly eligibility ──────────────────────────────────────────────────

const NOW = new Date('2026-11-09T02:00:00Z'); // 21:00 ET Nov 8; tomorrow = Nov 9 practice day
const VISIT = new Date('2026-11-09T15:00:00Z');
const daysBefore = (n: number) => new Date(VISIT.getTime() - n * 86_400_000);
const appt = (over: Partial<NightlyAppointment> = {}): NightlyAppointment => ({
  id: 'a1', clientId: 'c1', startsAt: VISIT, status: 'SCHEDULED', payer: 'CareFirst BlueCross BlueShield', medicaid: false, ...over,
});
const check = (over: Partial<FoEligibilityFact> = {}): FoEligibilityFact => ({
  status: 'ELIGIBLE', checkedAt: daysBefore(5), payerName: 'CareFirst BlueCross BlueShield', awaitingResponse: false, priorAuthRequired: false, channel: 'waystar', ...over,
});
const select = (appointments: NightlyAppointment[], checks: Record<string, FoEligibilityFact[]> = {}, max?: number) =>
  selectNightlyInquiries({ appointments, checks: new Map(Object.entries(checks)), visitDate: () => '2026-11-09', now: NOW, max });

test('nightly: setting is OFF by default, labelled for Waystar production, editable by leadership + billing only', () => {
  assert.equal(NIGHTLY_OFF_NOTE, 'Off — enable after Waystar production is live');
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']) assert.equal(canManageNightlyEligibility(r), true, r);
  for (const r of ['FRONT_DESK', 'THERAPIST', 'OFFICE_MANAGER', 'PSYCHIATRIST', 'MEDICAL_ASSISTANT', null]) assert.equal(canManageNightlyEligibility(r), false, String(r));
  const schema = src('prisma/schema.prisma');
  assert.match(schema, /eligibilityNightlyEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /eligibilityNightlyAllowTest\s+Boolean\s+@default\(false\)/);
  const mig = src('prisma/migrations/20261022_owner_decisions_eligibility_nightly.sql');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS "eligibilityNightlyEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS "eligibilityNightlyAllowTest" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(src('src/features/ehr/NightlyEligibilityCard.tsx'), /NIGHTLY_OFF_NOTE/);
});

test('nightly gate: off, Waystar inactive, or test indicator without "Allow on test clearinghouse" never run', () => {
  const on = { enabled: true, allowTest: false };
  assert.deepEqual(nightlyGate({ settings: { enabled: false, allowTest: true }, waystarActive: true, usageIndicator: 'P' }).run, false);
  assert.equal((nightlyGate({ settings: on, waystarActive: false, usageIndicator: 'P' }) as { reason: string }).reason, 'waystar_not_active');
  assert.equal((nightlyGate({ settings: on, waystarActive: true, usageIndicator: 'T' }) as { reason: string }).reason, 'test_clearinghouse');
  assert.equal(nightlyGate({ settings: { enabled: true, allowTest: true }, waystarActive: true, usageIndicator: 'T' }).run, true);
  assert.equal(nightlyGate({ settings: on, waystarActive: true, usageIndicator: 'P' }).run, true);
});

test('nightly selection: stale, never-verified, payer-changed and failed checks are sent; current / awaiting / inactive are not', () => {
  const r = select(
    [
      appt({ id: 'stale', clientId: 'c-stale' }),
      appt({ id: 'none', clientId: 'c-none' }),
      appt({ id: 'current', clientId: 'c-current' }),
      appt({ id: 'awaiting', clientId: 'c-awaiting' }),
      appt({ id: 'inactive', clientId: 'c-inactive' }),
      appt({ id: 'mismatch', clientId: 'c-mismatch' }),
      appt({ id: 'failed', clientId: 'c-failed' }),
    ],
    {
      'c-stale': [check({ checkedAt: daysBefore(31) })],
      'c-current': [check({ checkedAt: daysBefore(30) })],
      'c-awaiting': [check({ status: 'PENDING', checkedAt: daysBefore(2), awaitingResponse: true })],
      'c-inactive': [check({ status: 'INELIGIBLE', checkedAt: daysBefore(3) })],
      'c-mismatch': [check({ payerName: 'Aetna', checkedAt: daysBefore(3) })],
      'c-failed': [check({ status: 'ERROR', checkedAt: daysBefore(3) })],
    }
  );
  assert.deepEqual(r.inquiries.map((q) => q.appointmentId).sort(), ['failed', 'mismatch', 'none', 'stale']);
  assert.deepEqual(r.reasons, { never_verified: 1, stale: 1, payer_changed: 1, last_check_failed: 1 });
  assert.equal(r.skipped.current, 1);
  assert.equal(r.skipped.awaiting_response, 1);
  assert.equal(r.skipped.inactive_on_file, 1);
  assert.equal(r.inquiries[0].dos, '2026-11-09');
});

test('nightly selection: Maryland Medicaid needs a check in the visit month (front-office rule reused)', () => {
  const medicaid = appt({ payer: 'Maryland Medicaid', medicaid: true });
  const lastMonth = check({ payerName: 'Maryland Medicaid', checkedAt: new Date('2026-10-28T15:00:00Z') });
  assert.equal(select([medicaid], { c1: [lastMonth] }).inquiries.length, 1, 'October check does not cover a November visit');
  const thisMonth = check({ payerName: 'Maryland Medicaid', checkedAt: new Date('2026-11-02T15:00:00Z') });
  assert.equal(select([medicaid], { c1: [thisMonth] }).inquiries.length, 0);
  // Commercial payer: the same October check is within 30 days
  assert.equal(select([appt()], { c1: [check({ checkedAt: new Date('2026-10-28T15:00:00Z') })] }).inquiries.length, 0);
});

test('nightly selection: never self-pay (or no payer), never cancelled visits', () => {
  const r = select([
    appt({ id: 's1', payer: 'Self Pay' }),
    appt({ id: 's2', payer: null, clientId: 'c2' }),
    appt({ id: 's3', payer: 'self-pay', medicaid: true, clientId: 'c3' }),
    appt({ id: 'x', status: 'CANCELLED', clientId: 'c4' }),
    appt({ id: 'n', status: 'NO_SHOW', clientId: 'c5' }),
  ]);
  assert.equal(r.inquiries.length, 0);
  assert.equal(r.skipped.self_pay, 3);
  assert.equal(r.skipped.not_going_ahead, 2);
});

test('nightly selection: one inquiry per client + payer per night; a 270 already out tonight is not repeated', () => {
  const r = select([appt({ id: 'a' }), appt({ id: 'b', startsAt: new Date(VISIT.getTime() + 3_600_000) }), appt({ id: 'c', payer: 'Aetna' })]);
  assert.equal(r.inquiries.length, 2, 'two payers for the same client');
  assert.equal(r.skipped.duplicate_client_payer, 1);
  const sentTonight = select([appt()], { c1: [check({ status: 'ERROR', checkedAt: new Date(NOW.getTime() - 3_600_000) })] });
  assert.equal(sentTonight.inquiries.length, 0);
  assert.equal(sentTonight.skipped.sent_tonight, 1);
});

test('nightly selection: per-night ceiling and 99-per-file batches (existing Waystar limit)', () => {
  const many = Array.from({ length: 250 }, (_, i) => appt({ id: `a${i}`, clientId: `c${i}` }));
  const r = select(many, {}, 200);
  assert.equal(r.inquiries.length, 200);
  assert.equal(r.skipped.over_nightly_limit, 50);
  assert.equal(NIGHTLY_BATCH_SIZE, 99);
  assert.ok(NIGHTLY_MAX_INQUIRIES >= NIGHTLY_BATCH_SIZE);
  assert.deepEqual(chunkInquiries(r.inquiries).map((c) => c.length), [99, 99, 2]);
});

test('nightly job wiring: dry run default, advisory lock, existing 270 path, commented cron line, audited', () => {
  const script = src('scripts/eligibility-nightly.ts');
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /withJobLock\(JOB_LOCK_KEYS\.eligibilityNightly/);
  assert.match(script, /DEFAULT_ORG/);
  assert.match(src('src/lib/jobs/advisoryLock.ts'), /eligibilityNightly: 'job:eligibility-nightly'/);
  const run = src('src/lib/eligibility/nightlyRun.ts');
  assert.match(run, /requestWaystarEligibility\(/);
  assert.match(run, /if \(!input\.apply/);
  assert.match(run, /eligibility_nightly_run/);
  const cron = src('deploy/crontab.staging');
  assert.match(cron, /enable at Waystar production go-live/i);
  assert.match(cron, /^# 0 2 \* \* \* altrixs .*scripts\/eligibility-nightly\.ts --apply/m);
  assert.doesNotMatch(cron, /^0 2 \* \* \* .*eligibility-nightly/m, 'cron line stays commented out');
});

// ─── 2. CPT 99212 (no fee) ───────────────────────────────────────────────────

test('99212 is in the catalog with the E/M level 2 description and NO fee', () => {
  const row = cptByCode('99212');
  assert.ok(row);
  assert.equal(row!.rate, null);
  assert.equal(row!.category, 'MedMgmt');
  assert.match(row!.desc, /established patient/i);
  assert.match(row!.desc, /straightforward MDM/i);
  assert.match(row!.desc, /10\+ min total time/);
  assert.equal(cptFeeMissing('99212'), true);
  assert.equal(cptFeeMissing('99213'), false);
  assert.equal(cptFeeMissing('ZZZZZ'), false, 'unknown codes are not "no fee"');
  assert.equal(cptRateCents('99212'), null);
  assert.equal(missingFeeMessage('99212-95'), 'Set a fee for 99212 in the fee schedule');
  assert.equal(FEE_NOT_SET, 'Fee not set');
});

test('99212 fee lookup warns and claim building refuses a blank charge instead of $0', () => {
  const q = pickFee([], { cpt: '99212' });
  assert.equal(q.feeMissing, true);
  assert.ok(q.warnings.includes('Set a fee for 99212 in the fee schedule'));
  const priced = priceClaimLines([], [{ cptCode: '99212', units: 1 } as never], { telehealth: false, selfPay: false, child: false });
  assert.equal(priced.ok, true);
  if (priced.ok) {
    assert.equal(priced.lines[0].charge, undefined, 'charge left blank, not $0');
    assert.ok(priced.summary.warnings.some((w) => w.includes('Set a fee for 99212 in the fee schedule')));
  }
  const n = normalizeClaimLines([{ cptCode: '99212', units: 1 } as never], 1);
  assert.equal(n.ok, false);
  assert.match(n.error || '', /Set a fee for 99212 in the fee schedule/);
  const entered = normalizeClaimLines([{ cptCode: '99212', units: 1, charge: 95 } as never], 1);
  assert.equal(entered.ok, true, 'a charge entered on the line is used');
  assert.equal(entered.lines[0].chargeCents, 9500);
  // Once the practice fee schedule has 99212, its fee is used
  const fee = pickFee([{ code: '99212', description: 'Est Pt', feeCents: 13500, billedCpt: '99212', baseCpt: '99212', telehealth: false, selfPay: false, child: false, itp: false, exactOnly: false, variantLabel: 'Standard', insuranceBillable: true, needsReview: false, reviewNote: null, active: true, source: 'valant' } as never], { cpt: '99212' });
  assert.equal(fee.feeCents, 13500);
  assert.ok(!fee.feeMissing);
  assert.equal(chargeAmountCents('99213'), 8900, 'other codes unchanged');
  assert.match(src('src/lib/billing/claimScrubber.ts'), /missingFeeMessage\(claim\.cptCode\)/);
});

test('99212 appears in the med-management E/M option lists next to 99213–99215; pick lists show "Fee not set"', () => {
  const em = PMM_EM_OPTIONS.map((o) => o.code);
  for (const c of ['99212', '99213', '99214', '99215']) assert.ok(em.includes(c), c);
  assert.ok(PROTOCOLS.med_management.cpt.includes('99212'));
  const merged = mergeCptOptions(CPT_CODES, []);
  assert.equal(merged.find((m) => m.code === '99212')!.rate, null);
  assert.match(src('src/features/billing/BillingCodeLibrary.tsx'), /FEE_NOT_SET/);
  assert.match(src('src/app/dashboard/billing/fee-schedule/page.tsx'), /FEE_NOT_SET/);
  assert.match(src('src/app/api/billing/fee-schedule/route.ts'), /export async function POST/);
});

// ─── 3. MA standing orders ───────────────────────────────────────────────────

const MD = { role: 'PHYSICIAN', isMedicalDirector: true, roleEligible: true };
const now = new Date('2026-10-22T14:00:00Z');

test('standing orders: six-test draft list, CPTs match the catalog (Lab, no fee), none usable until approved', () => {
  const expected: Record<string, string> = { '82962': 'glucose', '81002': 'dip stick', '87880': 'strep', '81025': 'pregnancy', '87811': 'SARS-CoV-2', '87804': 'influenza' };
  assert.equal(DRAFT_POC_STANDING_ORDERS.length, 6);
  for (const o of DRAFT_POC_STANDING_ORDERS) {
    assert.equal(o.status, 'draft');
    const row = cptByCode(o.cpt!);
    assert.ok(row, `${o.cpt} in the CPT catalog`);
    assert.equal(row!.category, 'Lab');
    assert.equal(row!.rate, null, `${o.cpt} has no fee`);
    assert.match(row!.desc, new RegExp(expected[o.cpt!], 'i'));
  }
  assert.match(cptByCode('81002')!.desc, /non-automated, without microscopy/);
  const list = withDraftStandingOrders([]);
  assert.equal(list.length, 6);
  assert.deepEqual(usableStandingOrders(list), []);
  // Stored rows are kept; missing draft tests are appended once
  const stored = parsePocStandingOrders([{ key: 'rapid-strep', name: 'Rapid strep (group A)', criteria: 'sore throat', resultType: 'pos_neg', cpt: '87880' }]);
  assert.equal(withDraftStandingOrders(stored).length, 6);
});

test('standing orders: only a verified Medical Director approves, with the exact attestation and criteria', () => {
  assert.equal(canApproveStandingOrders(MD), true);
  assert.equal(canApproveStandingOrders({ role: 'PRACTICE_DIRECTOR', isMedicalDirector: false, roleEligible: false }), false, 'leadership without the flag');
  assert.equal(canApproveStandingOrders({ role: 'MEDICAL_ASSISTANT', isMedicalDirector: true, roleEligible: false }), false);
  assert.equal(canApproveStandingOrders({ role: 'PHYSICIAN', isMedicalDirector: false, roleEligible: true }), false);
  assert.equal(canRetireStandingOrders({ role: 'PRACTICE_DIRECTOR', isMedicalDirector: false, roleEligible: false }), true);
  assert.equal(canRetireStandingOrders({ role: 'MEDICAL_ASSISTANT', isMedicalDirector: false, roleEligible: false }), false);

  const list = withDraftStandingOrders([]);
  const base = { key: 'glucose-fingerstick', approverId: 'u-md', approverName: 'Dr. A', now };
  assert.equal(approveStandingOrder(list, { ...base, attestation: 'yes', criteria: 'Diabetes, each visit' }).ok, false);
  assert.equal(approveStandingOrder(list, { ...base, attestation: STANDING_ORDER_ATTESTATION }).ok, false, 'criteria required');
  const ok = approveStandingOrder(list, { ...base, attestation: STANDING_ORDER_ATTESTATION, criteria: 'Diabetes on the problem list, each visit' });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(STANDING_ORDER_ATTESTATION, 'I authorize medical assistants to perform this test under this standing order');
  assert.deepEqual(ok.order.approval, { approverId: 'u-md', approverName: 'Dr. A', approvedAt: now.toISOString(), attestation: STANDING_ORDER_ATTESTATION });
  assert.deepEqual(usableStandingOrders(ok.list).map((o) => o.key), ['glucose-fingerstick']);
  // Round trip through the stored JSON keeps the approval
  assert.equal(usableStandingOrders(parsePocStandingOrders(JSON.parse(JSON.stringify(ok.list)))).length, 1);
  // A forged "approved" row without a valid approval reads as draft
  assert.equal(parsePocStandingOrders([{ key: 'x1', name: 'X', resultType: 'text', status: 'approved', approval: { approverId: 'u', approvedAt: 'now', attestation: 'ok' } }])[0].status, 'draft');

  const retired = retireStandingOrder(ok.list, { key: 'glucose-fingerstick', byId: 'u-pd', byName: 'Director', now });
  assert.equal(retired.ok, true);
  if (retired.ok) {
    assert.deepEqual(usableStandingOrders(retired.list), []);
    assert.equal(approveStandingOrder(retired.list, { ...base, attestation: STANDING_ORDER_ATTESTATION, criteria: 'x x x' }).ok, false);
  }
});

test('standing orders: PUT cannot approve; editing an approved order sends it back to draft; approved rows are not deleted', () => {
  const approved = approveStandingOrder(withDraftStandingOrders([]), { key: 'rapid-strep', approverId: 'u-md', approverName: 'Dr. A', attestation: STANDING_ORDER_ATTESTATION, criteria: 'Sore throat with fever', now });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const stored = approved.list;
  // Forged approval in the request is ignored for a draft
  const forged = stored.map((o) => (o.key === 'covid-antigen' ? { ...o, status: 'approved' as const, approval: { approverId: 'x', approverName: 'x', approvedAt: now.toISOString(), attestation: STANDING_ORDER_ATTESTATION } } : o));
  const m1 = mergeStandingOrderEdits(stored, forged);
  assert.equal(m1.list.find((o) => o.key === 'covid-antigen')!.status, 'draft');
  assert.equal(m1.list.find((o) => o.key === 'rapid-strep')!.status, 'approved', 'unchanged approved order kept');
  const edited = stored.map((o) => (o.key === 'rapid-strep' ? { ...o, criteria: 'Any sore throat' } : o));
  const m2 = mergeStandingOrderEdits(stored, edited);
  assert.equal(m2.list.find((o) => o.key === 'rapid-strep')!.status, 'draft');
  assert.deepEqual(m2.reverted, ['rapid-strep']);
  const dropped = mergeStandingOrderEdits(stored, stored.filter((o) => o.key !== 'rapid-strep'));
  assert.ok(dropped.list.some((o) => o.key === 'rapid-strep' && o.status === 'approved'));
});

test('standing orders: server wiring (rooming offers / accepts approved only; approve route audited; MD flag from the database)', () => {
  const rooming = src('src/app/api/medical/rooming/[appointmentId]/route.ts');
  assert.match(rooming, /standingOrders: usableStandingOrders\(settings\.pocStandingOrders\)/);
  assert.match(rooming, /new Map\(usableStandingOrders\(settings\.pocStandingOrders\)/);
  const route = src('src/app/api/medical/primary-care-settings/standing-orders/route.ts');
  assert.match(route, /auditPhiAccess/);
  assert.match(route, /actOnStandingOrder/);
  const db = src('src/lib/medical/primaryCareWorkflowDb.ts');
  assert.match(db, /isMedicalDirector: true/);
  assert.match(db, /canApproveStandingOrders\(actor\)/);
  assert.match(src('src/app/api/medical/primary-care-settings/route.ts'), /mergeStandingOrderEdits\(/);
});

// ─── 4. Maryland compliance confirmations ───────────────────────────────────

test('owner-confirmed requirements show "Confirmed by practice 2026-10-21", not "Confirm with compliance"', () => {
  const ids = ['md_pdmp', 'md_epcs', 'dea_telehealth', 'minor_consent_md', 'prp_comar', 'treatment_plan_review', 'spravato_rems', 'telehealth_consent_location', 'discharge_aftercare', 'sdoh_screen', 'tms_course', 'md_duty_to_warn', 'md_child_abuse_report', 'md_vulnerable_adult_report'];
  assert.deepEqual([...OWNER_CONFIRMED_IDS].sort(), [...ids].sort());
  for (const id of ids) {
    const r = requirementById(id)!;
    assert.equal(r.confirmedBy, 'Practice owner', id);
    assert.equal(r.confirmedOn, '2026-10-21', id);
    assert.notEqual(r.confirm, true, id);
  }
  // Items the owner did not confirm keep the badge
  for (const id of ['uspstf_screening', 'acip_immunization', 'collaborative_care']) assert.equal(requirementById(id)!.confirm, true, id);
  assert.ok(REQUIREMENTS.every((r) => !(r.confirm && r.confirmedOn)), 'never both');
  const ui = src('src/components/visits/VisitGuidePanel.tsx');
  assert.match(ui, /Confirmed by practice \{r\.confirmedOn\}/);
  assert.match(requirementById('telehealth_consent_location')!.rule, /audio-only/i);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test('PDMP citation is Health-General §21-2A-04.1 everywhere', () => {
  const hits = walk(join(ROOT, 'src')).filter((f) => /21-2A-04\.2/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
  assert.match(src('src/app/api/prescribing/pdmp-check/route.ts'), /statutoryAuthority: 'Maryland Health-General § 21-2A-04\.1'/);
  assert.match(requirementById('md_pdmp')!.citation || '', /§21-2A-04\.1/);
});

test('treatment plan review: one rule (adults <= 180 from Practice Settings, under 18 <= 90) on every path', () => {
  assert.equal(ADULT_REVIEW_MAX_DAYS, 180);
  assert.equal(CHILD_REVIEW_MAX_DAYS, 90);
  assert.equal(defaultReviewDays(40, 180), 180);
  assert.equal(defaultReviewDays(12, 180), 90);
  assert.equal(defaultReviewDays(40, 120), 120);
  assert.equal(defaultReviewDays(12, 60), 60);
  assert.equal(defaultReviewDays(40, 365), 180, 'over the cap: falls back to 180');
  assert.equal(maxReviewDays(17, 180), 90);
  assert.equal(maxReviewDays(null, 150), 150);
  // Settings validation caps the adult interval at 180
  assert.equal(clinicalSchema.safeParse({ treatmentPlanReviewDays: 180 }).success, true);
  assert.equal(clinicalSchema.safeParse({ treatmentPlanReviewDays: 181 }).success, false);
  assert.equal(clinicalSchema.safeParse({ treatmentPlanReviewDays: 365 }).success, false);
  // The date validator takes the rule's limit
  const t = new Date('2026-01-01T17:00:00Z');
  assert.equal(validatePlanReviewDate('2026-06-30', t, 180).ok, true);
  assert.equal(validatePlanReviewDate('2026-07-01', t, 180).ok, false);
  assert.equal(validatePlanReviewDate('2026-04-01', t, 90).ok, true);
  assert.equal(validatePlanReviewDate('2026-04-02', t, 90).ok, false);
  // Legacy path and template path both use the per-client rule
  const legacy = src('src/lib/ehr/treatmentPlans.ts');
  assert.match(legacy, /clientReviewDays\(/);
  assert.doesNotMatch(legacy, /addCalendarDays\(clinicDate\(\), 90\)/);
  const store = src('src/lib/ehr/therapy/planStore.ts');
  assert.match(store, /clientReviewDays\(/);
  assert.doesNotMatch(store, /MAX_REVIEW_DAYS/);
});

test('compliance confirmation doc lists every confirmed item and the open numeric items', () => {
  const p = 'docs/compliance-confirmations-2026-10-21.md';
  assert.ok(existsSync(join(ROOT, p)));
  const doc = src(p);
  for (const id of OWNER_CONFIRMED_IDS) assert.match(doc, new RegExp(id), id);
  assert.match(doc, /initial treatment plan/i);
  assert.match(doc, /discharge summary/i);
});
