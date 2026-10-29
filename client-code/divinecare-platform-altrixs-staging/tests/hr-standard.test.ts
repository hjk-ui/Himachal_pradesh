/**
 * HR standard (Oct 22): expiration engine, CAQH 120-day cycle, monthly exclusion checks,
 * onboarding / offboarding checklist generation, PTO / sick accrual math with the policy
 * setting, role visibility of compensation and discipline, and AI drafts that never save.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_OFFBOARDING_ITEMS,
  DEFAULT_ONBOARDING_ITEMS,
  addDaysYmd,
  aiDraft,
  buildChecklistTasks,
  canApproveTimeOff,
  caqhNextDue,
  caqhStatus,
  caseloadTaskLabel,
  ceuProgress,
  checklistProgress,
  exclusionDue,
  expiryStatus,
  extractCredentialFields,
  findDates,
  hrFieldAccess,
  hrRelationship,
  ledgerBalance,
  notesOnTime,
  ptoAccrualForPeriod,
  redactEmployeeRecord,
  retrievePolicySections,
  sickAccrual,
  splitPolicyText,
  trainingCompliancePct,
  trainingStatus,
  turnoverPct,
} from '../src/lib/hr/standard';
import { canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';

const read = (p: string) => readFileSync(p, 'utf8');
const TODAY = '2026-10-22';

test('expiration engine: current / due 60 / due 30 / expired / no expiry', () => {
  assert.equal(expiryStatus('2027-06-01', TODAY).status, 'current');
  assert.equal(expiryStatus('2026-12-15', TODAY).status, 'due_60');
  assert.equal(expiryStatus('2026-11-10', TODAY).status, 'due_30');
  assert.equal(expiryStatus(TODAY, TODAY).status, 'due_30');
  const expired = expiryStatus('2026-10-01', TODAY);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.daysLeft, -21);
  assert.equal(expiryStatus(null, TODAY).status, 'no_expiry');
  // Windows come from HR settings
  assert.equal(expiryStatus('2026-12-15', TODAY, { dueSoonDays: 90, urgentDays: 60 }).status, 'due_30');
});

test('CAQH re-attestation every 120 days', () => {
  assert.equal(caqhNextDue('2026-07-01'), addDaysYmd('2026-07-01', 120));
  assert.equal(caqhNextDue('2026-07-01'), '2026-10-29');
  assert.equal(caqhStatus({ caqhId: null }, TODAY).status, 'not_applicable');
  assert.equal(caqhStatus({ caqhId: '12345678', lastAttestedOn: null }, TODAY).status, 'missing');
  const s = caqhStatus({ caqhId: '12345678', lastAttestedOn: '2026-07-01' }, TODAY);
  assert.equal(s.dueOn, '2026-10-29');
  assert.equal(s.status, 'due_30');
  assert.equal(caqhStatus({ caqhId: '1', lastAttestedOn: '2026-06-01' }, TODAY).status, 'expired');
  assert.equal(caqhStatus({ caqhId: '1', lastAttestedOn: '2026-10-01' }, TODAY).status, 'current');
  assert.equal(caqhStatus({ caqhId: '1', lastAttestedOn: '2026-10-01' }, TODAY, { caqhAttestationDays: 30 }).dueOn, '2026-10-31');
});

test('exclusion checks are due monthly (interval from settings)', () => {
  assert.deepEqual(exclusionDue(null, TODAY), { dueOn: TODAY, status: 'never', daysLeft: 0 });
  assert.equal(exclusionDue('2026-09-01', TODAY).status, 'overdue');
  assert.equal(exclusionDue('2026-09-01', TODAY).dueOn, '2026-10-01');
  assert.equal(exclusionDue('2026-09-25', TODAY).status, 'due_soon');
  assert.equal(exclusionDue('2026-10-15', TODAY).status, 'current');
  assert.equal(exclusionDue('2026-10-10', TODAY, 7).status, 'overdue');
  const engine = read('src/lib/hr/expirations.ts');
  assert.match(engine, /settings\.exclusionCheckIntervalDays/);
  // One monthly batch reminder for HR, not one per person per list
  assert.match(engine, /hr:exclusion-batch:/);
});

test('onboarding template generation by role and worker type', () => {
  const therapist = buildChecklistTasks(DEFAULT_ONBOARDING_ITEMS, { userId: 'u1', role: 'THERAPIST', workerType: 'W2', managerUserId: 'm1' }, '2026-11-02');
  const keys = therapist.map((t) => t.key);
  for (const k of ['offer_letter', 'i9_section1', 'i9_section2', 'w4', 'mw507', 'background_check', 'psv', 'caqh', 'training_hipaa', 'training_part2', 'ack_handbook', 'ack_hipaa', 'access_altrixs', 'checkin_30', 'checkin_60', 'checkin_90']) {
    assert.ok(keys.includes(k), k);
  }
  for (const k of ['w9', 'access_drfirst', 'dea_cds']) assert.ok(!keys.includes(k), `therapist should not get ${k}`);
  const byKey = Object.fromEntries(therapist.map((t) => [t.key, t]));
  assert.equal(byKey.offer_letter.dueOn, '2026-10-26');
  assert.equal(byKey.i9_section2.dueOn, '2026-11-05'); // 3 business days
  assert.equal(byKey.checkin_90.dueOn, '2027-01-31');
  assert.equal(byKey.i9_section1.assigneeUserId, 'u1'); // employee task to the new hire
  assert.equal(byKey.orientation.assigneeUserId, 'm1'); // manager task to the manager
  assert.equal(byKey.psv.assigneeUserId, null); // HR queue
  assert.equal(byKey.ack_handbook.requiresAck, true);

  const prescriber = buildChecklistTasks(DEFAULT_ONBOARDING_ITEMS, { userId: 'u2', role: 'PSYCHIATRIST', workerType: 'W2' }, '2026-11-02').map((t) => t.key);
  assert.ok(prescriber.includes('access_drfirst') && prescriber.includes('dea_cds'));
  const contractor = buildChecklistTasks(DEFAULT_ONBOARDING_ITEMS, { userId: 'u3', role: 'THERAPIST', workerType: '1099' }, '2026-11-02').map((t) => t.key);
  assert.ok(contractor.includes('w9') && !contractor.includes('mw507') && !contractor.includes('i9_section1'));
  const frontDesk = buildChecklistTasks(DEFAULT_ONBOARDING_ITEMS, { userId: 'u4', role: 'FRONT_DESK' }, '2026-11-02').map((t) => t.key);
  assert.ok(!frontDesk.includes('psv') && !frontDesk.includes('tb_test') && frontDesk.includes('training_hipaa'));
  assert.deepEqual(checklistProgress([{ status: 'done' }, { status: 'open' }, { status: 'skipped' }]), { done: 1, total: 2, pct: 50 });
});

test('offboarding creates access-revocation and handoff tasks (counts only), audited', () => {
  const tasks = buildChecklistTasks(DEFAULT_OFFBOARDING_ITEMS, { userId: 'u2', role: 'PSYCHIATRIST' }, '2026-11-30');
  const byKey = Object.fromEntries(tasks.map((t) => [t.key, t]));
  assert.equal(byKey.deactivate_user.systemAction, 'deactivate_user');
  assert.equal(byKey.deactivate_user.ownerType, 'admin');
  assert.equal(byKey.deactivate_user.dueOn, '2026-11-30');
  assert.equal(byKey.drfirst_deactivate.systemAction, 'drfirst_deactivate');
  assert.equal(byKey.payer_notify.systemAction, 'payer_notify');
  assert.equal(byKey.caseload_reassign.ownerType, 'clinical_director');
  assert.ok(byKey.cobra_notice && byKey.final_pay && byKey.exit_interview && byKey.equipment_return);
  const admin = buildChecklistTasks(DEFAULT_OFFBOARDING_ITEMS, { userId: 'u5', role: 'BILLING' }, '2026-11-30').map((t) => t.key);
  assert.ok(admin.includes('deactivate_user') && !admin.includes('caseload_reassign') && !admin.includes('drfirst_deactivate'));
  assert.equal(caseloadTaskLabel(12), 'Reassign caseload: 12 assigned clients');
  assert.equal(caseloadTaskLabel(1), 'Reassign caseload: 1 assigned client');

  const lib = read('src/lib/hr/checklists.ts');
  assert.match(lib, /prisma\.client\.count\(/);
  assert.ok(!/prisma\.client\.findMany/.test(lib), 'no client rows / names');
  // The account task closes only when the account is really deactivated (or an admin deactivates it now).
  assert.match(lib, /user\?\.status !== 'DEACTIVATED'/);
  assert.match(lib, /\['ADMIN', 'PRACTICE_DIRECTOR'\]\.includes\(ctx\.role\)/);
  assert.match(lib, /updateStaffUser\(task\.userId, ctx\.userId, ctx\.organizationId, \{ status: 'DEACTIVATED' \}/);
  const route = read('src/app/api/hr/checklists/route.ts');
  assert.match(route, /auditHr\(g\.ctx, req, 'CREATE', 'hrChecklist'/);
  assert.match(read('src/app/api/hr/checklist-tasks/[id]/route.ts'), /systemAction: result\.systemAction/);
});

test('PTO and Maryland HWFA sick accrual math use the policy setting', () => {
  assert.deepEqual(sickAccrual({ hoursWorked: 90 }, { sickAccrualHoursWorked: 30 }), { hours: 3, capped: false, reason: null });
  assert.equal(sickAccrual({ hoursWorked: 100 }, { sickAccrualHoursWorked: 30 }).hours, 3.33);
  assert.equal(sickAccrual({ hoursWorked: 80 }, { sickAccrualHoursWorked: 40 }).hours, 2);
  const unset = sickAccrual({ hoursWorked: 90 }, { sickAccrualHoursWorked: null });
  assert.equal(unset.hours, 0);
  assert.match(unset.reason!, /not set/);
  const annual = sickAccrual({ hoursWorked: 300, accruedThisYear: 38 }, { sickAccrualHoursWorked: 30, sickAnnualAccrualCap: 40 });
  assert.deepEqual([annual.hours, annual.capped], [2, true]);
  const balance = sickAccrual({ hoursWorked: 300, balance: 63 }, { sickAccrualHoursWorked: 30, sickBalanceCap: 64 });
  assert.deepEqual([balance.hours, balance.capped], [1, true]);
  assert.equal(ptoAccrualForPeriod({ hoursPerPeriod: 6.15 }, { fte: 0.5 }).hours, 3.07);
  assert.equal(ptoAccrualForPeriod({ hoursPerPeriod: 8, balanceCap: 120 }, { balance: 118 }).hours, 2);
  assert.equal(ptoAccrualForPeriod(null, {}).hours, 0);
  assert.equal(ledgerBalance([{ bucket: 'sick', hours: 3 }, { bucket: 'sick', hours: -8 }, { bucket: 'pto', hours: 40 }], 'sick'), -5);
  // HWFA default 1 per 30 is a labeled policy setting, not a hidden constant
  assert.match(read('prisma/schema.prisma'), /sickAccrualHoursWorked\s+Float\?\s+@default\(30\)/);
  assert.match(read('src/lib/hr/timeOff.ts'), /settings\.sickAccrualHoursWorked/);
});

test('time off: supervisor or HR approves, never the requester', () => {
  assert.equal(canApproveTimeOff({ userId: 'm1', role: 'THERAPIST' }, { userId: 'u1', managerUserId: 'm1' }), true);
  assert.equal(canApproveTimeOff({ userId: 'x', role: 'THERAPIST' }, { userId: 'u1', managerUserId: 'm1' }), false);
  assert.equal(canApproveTimeOff({ userId: 'h', role: 'HR' }, { userId: 'u1' }), true);
  assert.equal(canApproveTimeOff({ userId: 'h', role: 'HR' }, { userId: 'h' }), false);
  assert.equal(canApproveTimeOff({ userId: 'o', role: 'OFFICE_MANAGER' }, { userId: 'u1' }), false);
});

test('role visibility: compensation and discipline are HR / leadership only', () => {
  const rel = (role: string, viewer = 'v', subject = { userId: 's', managerUserId: 'm' as string | null }) => hrRelationship({ userId: viewer, role }, subject);
  assert.equal(rel('HR'), 'hr');
  assert.equal(rel('PRACTICE_DIRECTOR'), 'leadership');
  assert.equal(rel('HR', 's', { userId: 's', managerUserId: null }), 'hr'); // HR wins over self
  assert.equal(rel('THERAPIST', 's', { userId: 's', managerUserId: null }), 'self');
  assert.equal(rel('THERAPIST', 'm'), 'manager');
  assert.equal(rel('OFFICE_MANAGER'), 'office_manager');
  assert.equal(rel('THERAPIST'), 'peer');
  for (const r of ['hr', 'leadership'] as const) {
    const a = hrFieldAccess(r);
    assert.ok(a.compensation && a.discipline && a.personal && a.editRecord, r);
  }
  for (const r of ['office_manager', 'self', 'manager', 'peer'] as const) {
    const a = hrFieldAccess(r);
    assert.equal(a.compensation, false, r);
    assert.equal(a.discipline, false, r);
  }
  assert.equal(hrFieldAccess('office_manager').personal, false);
  assert.equal(hrFieldAccess('manager').personal, false);
  assert.equal(hrFieldAccess('self').personal, true);
  assert.equal(hrFieldAccess('peer').credentials, false);
  const rec = { name: 'A', payRateCents: 5000, payrollExternalId: 'P1', dateOfBirth: '1990-01-01', separationType: 'voluntary', jobTitle: 'Therapist' };
  const om = redactEmployeeRecord(rec, hrFieldAccess('office_manager'));
  assert.ok(!('payRateCents' in om) && !('payrollExternalId' in om) && !('dateOfBirth' in om) && !('separationType' in om));
  assert.equal((om as Record<string, unknown>).jobTitle, 'Therapist');
  const self = redactEmployeeRecord(rec, hrFieldAccess('self'));
  assert.ok(!('payRateCents' in self) && 'dateOfBirth' in self);
  assert.equal(redactEmployeeRecord(rec, hrFieldAccess('hr')).payRateCents, 5000);

  // Pages and API gates
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/people'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/time-off'), false);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/hr/me'), true);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/hr/org-chart'), true);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/hr/people'), false);
  assert.equal(canAccessApiPath('OFFICE_MANAGER', '/api/hr/discipline', 'GET'), false);
  assert.equal(canAccessApiPath('HR', '/api/hr/discipline', 'GET'), true);
  assert.equal(canAccessApiPath('THERAPIST', '/api/hr/discipline/abc', 'PATCH'), true); // employee acknowledgment
  assert.equal(canAccessApiPath('OFFICE_MANAGER', '/api/hr/dashboard'), false);
  assert.equal(canAccessApiPath('THERAPIST', '/api/hr/people/abc', 'PATCH'), false);
  assert.equal(canAccessApiPath('THERAPIST', '/api/hr/me'), true);
  // Server enforcement: the employee route redacts with hrFieldAccess and refuses peers
  const route = read('src/app/api/hr/people/[userId]/route.ts');
  assert.match(route, /view\.relationship === 'peer'/);
  assert.match(route, /access\.discipline \? listDiscipline/);
  assert.match(read('src/lib/hr/people.ts'), /COMP_FIELDS\.has\(k\) && !access\.compensation/);
  assert.match(read('src/lib/hr/performance.ts'), /Corrective action records are HR \/ leadership only/);
  // No SSN / bank columns in the HR models
  const schema = read('prisma/schema.prisma');
  const hrBlock = schema.slice(schema.indexOf('model StaffHrProfile'), schema.indexOf('model HrOrgSnapshot'));
  assert.ok(!/^\s+(ssn\w*|\w*routing\w*|bank\w*)\s/im.test(hrBlock), 'no SSN / bank fields');
});

test('AI drafts never auto-save; features are flagged off by default', () => {
  const d = aiDraft('writing', { text: 'x' }, 'rules');
  assert.equal(d.saved, false);
  assert.equal(d.status, 'draft');
  assert.equal(d.requiresConfirmation, true);
  for (const p of ['src/lib/hr/ai.ts', 'src/app/api/hr/ai/[feature]/route.ts']) {
    const src = read(p);
    assert.ok(!/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(src), `${p} must not write`);
  }
  const route = read('src/app/api/hr/ai/[feature]/route.ts');
  assert.match(route, /aiFeatureEnabled\(settings, flag\)/);
  assert.match(route, /'AI_ACCESS', 'hrAi'/);
  const schema = read('prisma/schema.prisma');
  for (const f of ['aiDocumentExtract', 'aiWritingDrafts', 'aiReviewAssistant', 'aiPolicyQa', 'aiDigest']) {
    assert.match(schema, new RegExp(`${f}\\s+Boolean\\s+@default\\(false\\)`), f);
  }
  assert.match(schema, /blockSchedulingWhenLicenseExpired Boolean\s+@default\(false\)/);
  assert.match(read('src/lib/hr/expirations.ts'), /if \(!settings\?\.blockSchedulingWhenLicenseExpired\) return \{ blocked: false \}/);
  // Rules extraction (fallback) reads a Maryland license text
  const x = extractCredentialFields('Maryland Board of Social Work Examiners. Licensee: Jane Q Doe. LCSW-C License Number: 12345 Issued 01/15/2025 Expiration Date: 10/31/2027');
  assert.equal(x.licenseType, 'LCSW-C');
  assert.equal(x.licenseNumber, '12345');
  assert.equal(x.expiresAt, '2027-10-31');
  assert.equal(x.state, 'MD');
  assert.deepEqual(findDates('Valid through Oct 31, 2027'), ['2027-10-31']);
});

test('training, CEU, documentation and policy Q&A helpers', () => {
  const req = { id: 'r1', key: 'hipaa', name: 'HIPAA', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 30 };
  assert.equal(trainingStatus(req, { role: 'THERAPIST', lastCompletedOn: '2025-11-10' }, TODAY).status, 'due_30');
  assert.equal(trainingStatus(req, { role: 'THERAPIST', hireDate: '2026-10-15' }, TODAY).status, 'missing');
  assert.equal(trainingStatus(req, { role: 'THERAPIST', hireDate: '2026-08-01' }, TODAY).status, 'expired');
  assert.equal(trainingStatus({ ...req, roles: ['PRP_SPECIALIST'] }, { role: 'THERAPIST' }, TODAY).status, 'not_required');
  assert.equal(trainingCompliancePct(['current', 'expired', 'not_required', 'due_30']), 67);
  const ceu = ceuProgress({ id: 'c1', licenseType: 'LCPC', expiresAt: '2027-01-31', ceuRequired: 0 }, [{ hours: 10, completedOn: '2026-03-01', ceuEligible: true }, { hours: 5, completedOn: '2024-01-01', ceuEligible: true }], { LCPC: { hours: 40, cycleMonths: 24 } });
  assert.deepEqual([ceu.required, ceu.earned, ceu.pct, ceu.source], [40, 10, 25, 'setting']);
  assert.equal(ceuProgress({ id: 'c1', licenseType: 'LCPC', expiresAt: '2027-01-31' }, [], {}).required, null);
  const m = notesOnTime([
    { serviceAt: '2026-10-01T14:00:00Z', signedAt: '2026-10-02T14:00:00Z' },
    { serviceAt: '2026-10-01T14:00:00Z', signedAt: '2026-10-06T14:00:00Z' },
    { serviceAt: '2026-10-01T14:00:00Z', signedAt: null },
  ]);
  assert.deepEqual([m.total, m.signed, m.signedOnTime, m.onTimePct], [3, 2, 1, 33]);
  assert.equal(turnoverPct(4, 40), 10);
  const sections = splitPolicyText('INTRODUCTION\nWelcome.\n\n1. Paid time off\nRequest PTO two weeks ahead in Altrixs.\n\n2. Bereavement leave\nUp to three days.');
  assert.equal(sections.length, 3);
  const hits = retrievePolicySections('how do I request bereavement leave', sections.map((s) => ({ ...s, policyId: 'p', policyTitle: 'Handbook', sectionId: s.id })));
  assert.equal(hits[0].heading, '2. Bereavement leave');
});
