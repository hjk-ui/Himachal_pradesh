/**
 * Clinical least-privilege / data-scope hardening (Oct 20): medication, note, AOT, PRP, residential,
 * TMS / Spravato, crisis, Part 2 / VIP lock, previsit brief, referrals. Pure helpers are unit
 * tested; route wiring is checked against the source (same style as tests/role-matrix.test.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canAccessClientChartNotes,
  canEditClientDiagnoses,
  canSeeClientCheckIns,
  canViewClientMedications,
  canWriteClientMedications,
} from '../src/lib/clients/orgScope';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { canUsePrpWorkflow, prpWorkflowWriteBlock } from '../src/lib/prp/workflowAccess';
import { filterLockedRows, maskLockedRows, PROTECTED_RECORD_LABEL } from '../src/lib/privacy/lockedRows';
import { maskLockedAlerts } from '../src/lib/alerts/lockedMask';
import { evaluationDiagnosisBlock, isDiagnosticEvaluationTemplate } from '../src/lib/clinical/evaluationAccess';
import { canUsePsychotherapyNote } from '../src/lib/notes/psychotherapyAccess';
import { canWritePrimaryCareMedications } from '../src/features/medical/roles';
import { referralsNeedCaseloadScope, referralVisibleToCaseloadActor } from '../src/lib/referrals/manage';
import { canSeeAotClinical, redactAotParticipant, AOT_RESTRICTED_LABEL } from '../src/app/api/aot/_scope';
import { residentRowsInOrg } from '../src/app/api/residential/_scope';
import { buildPreVisitFacts, type PreVisitInputs } from '../src/lib/ai/previsit/facts';
import type { AlertDto } from '../src/lib/alerts/manage';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

// ─── 1. Clinical medications ──────────────────────────────────────────────────────────────────
test('1. /api/clinical/medications: GET needs canViewClientMedications, POST / intake need canWriteClientMedications', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST', 'HR']) {
    assert.equal(canViewClientMedications(r), false, `${r} must not read medications`);
    assert.equal(canWriteClientMedications(r), false, `${r} must not write medications`);
  }
  for (const r of ['PSYCHIATRIST', 'NP', 'THERAPIST', 'PHYSICIAN', 'MEDICAL_ASSISTANT', 'ADMIN']) {
    assert.equal(canViewClientMedications(r), true, r);
    assert.equal(canWriteClientMedications(r), true, r);
  }
  assert.equal(canViewClientMedications('CRISIS_RESPONDER'), true);
  assert.equal(canWriteClientMedications('CRISIS_RESPONDER'), false);

  const route = read('src/app/api/clinical/medications/route.ts');
  assert.match(route, /if \(!canViewClientMedications\(gate\.role\)\)/);
  assert.match(route, /if \(!canWriteClientMedications\(gate\.role\)\)/);
  assert.match(read('src/app/api/clinical/medications/intake/route.ts'), /if \(!canWriteClientMedications\(gate\.role\)\)/);
  // The chart's Medications tab uses the same rules, so permitted roles still load it
  const page = read('src/app/dashboard/clients/[id]/page.tsx');
  assert.match(page, /function canViewMedications\(role\?: StaffRole \| null\) \{\s*return canViewClientMedications\(role\);/);
  assert.match(page, /function canWriteMedications\(role\?: StaffRole \| null\) \{\s*return canWriteClientMedications\(role\);/);
});

// ─── 2. Risk watch note banner ────────────────────────────────────────────────────────────────
test('2. risk-watch kind=note requires canAccessClientChartNotes (verbatim note quotes)', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'PEER_SUPPORT', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(canAccessClientChartNotes(r), false, r);
  }
  const src = read('src/app/api/ai/risk-watch/route.ts');
  const noteBranch = src.slice(src.indexOf('} else {'));
  assert.match(noteBranch, /if \(!canAccessClientChartNotes\(gate\.role\)\)[\s\S]*status: 403/);
  assert.ok(noteBranch.indexOf('canAccessClientChartNotes') < noteBranch.indexOf('prisma.progressNote.findFirst'));
});

// ─── 3. PRP workflow ──────────────────────────────────────────────────────────────────────────
test('3. PRP workflow: PRP page / form roles only, prescriber fields for prescribers, caseload scope', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'PEER_SUPPORT', 'HR', 'PHYSICIAN']) {
    assert.equal(canUsePrpWorkflow(r), false, r);
  }
  for (const r of ['PRP_SPECIALIST', 'CASE_MANAGER', 'PSYCHIATRIST', 'ADMIN', 'THERAPIST']) {
    assert.equal(canUsePrpWorkflow(r), true, r);
  }
  assert.equal(prpWorkflowWriteBlock('PRP_SPECIALIST', { assessmentData: { a: 1 } }), null);
  assert.equal(prpWorkflowWriteBlock('THERAPIST', { assessmentData: { a: 1 } }), 'assessment_not_permitted');
  assert.equal(prpWorkflowWriteBlock('PRP_SPECIALIST', { prescriberSignature: 'Dr X' }), 'prescriber_fields_not_permitted');
  assert.equal(prpWorkflowWriteBlock('CASE_MANAGER', { prescriberNpi: '1234567890' }), 'prescriber_fields_not_permitted');
  assert.equal(prpWorkflowWriteBlock('PSYCHIATRIST', { prescriberNpi: '1234567890', prescriberSignature: 'Dr X' }), null);
  assert.equal(prpWorkflowWriteBlock('PRP_SPECIALIST', { prescriberNpi: '  ' }), null);

  const route = read('src/app/api/prp/workflow/route.ts');
  assert.match(route, /clientAccessWhere\(/);
  assert.equal((route.match(/if \(!canUsePrpWorkflow\(gate\.role\)\)/g) || []).length, 2, 'GET and POST gated');
  assert.match(route, /prpWorkflowWriteBlock\(gate\.role, parsed\.data\)/);
});

// ─── 4. AOT clinical content ──────────────────────────────────────────────────────────────────
test('4. AOT: clinical content for EHR clinical roles only; others get redacted participants on their caseload', () => {
  for (const r of ['CASE_MANAGER', 'PRP_SPECIALIST', 'PEER_SUPPORT', 'CRISIS_RESPONDER']) assert.equal(canSeeAotClinical(r), false, r);
  for (const r of ['PSYCHIATRIST', 'NP', 'THERAPIST', 'CLINICIAN', 'PRACTICE_DIRECTOR']) assert.equal(canSeeAotClinical(r), true, r);

  const p = {
    id: 'p1', name: 'R. One', status: 'active', county: 'Baltimore', diagnosis: 'F20.9 Schizophrenia',
    eligibilityData: { smi: true, hospitalizations: 3, petitionChecklist: { filed: { done: true } }, sourceKind: 'family' },
    psychiatristAffidavit: { mse: 'disorganized' }, escalationEvents: [{ event: 'refused injection' }], deadlines: [{ label: 'x' }],
  };
  const cm = redactAotParticipant(p, 'CASE_MANAGER') as Record<string, unknown>;
  assert.equal(cm.diagnosis, AOT_RESTRICTED_LABEL);
  assert.equal(cm.psychiatristAffidavit, null);
  assert.deepEqual(cm.escalationEvents, []);
  assert.deepEqual(cm.eligibilityData, { petitionChecklist: { filed: { done: true } }, sourceKind: 'family' });
  assert.deepEqual(cm.deadlines, [{ label: 'x' }]);
  assert.equal(redactAotParticipant(p, 'PSYCHIATRIST'), p);

  assert.match(read('src/app/api/aot/participants/[id]/route.ts'), /participantOnCaseload\(gate, participant\)/);
  assert.match(read('src/app/api/aot/participants/[id]/route.ts'), /redactAotParticipant\(participant, gate\.role\)/);
  assert.match(read('src/app/api/aot/participants/[id]/route.ts'), /AOT_CLINICAL_FIELDS, 'signAffidavit'/);
  assert.match(read('src/app/api/aot/participants/route.ts'), /redactAotParticipant\(p, gate\.role\)/);
  const board = read('src/app/api/aot/caseboard/route.ts');
  assert.match(board, /filterRowsToCaseload\(/);
  assert.match(board, /diagnosis: clinical \? p\.diagnosis : AOT_RESTRICTED_LABEL/);
  const doc = read('src/app/api/aot/documents/[id]/route.ts');
  assert.match(doc, /!canSeeAotClinical\(gate\.role\) && sign\.mySlots\.length === 0/);
  assert.match(doc, /Editing form content: EHR clinical roles only\s*\n?\s*if \(!canSeeAotClinical\(gate\.role\)\)/);
  assert.match(read('src/app/api/aot/eval-basis/route.ts'), /if \(!canSeeAotClinical\(gate\.role\)\)/);
  assert.match(read('src/app/api/aot/court-report/route.ts'), /!canSeeAotClinical\(gate\.role\)/);
});

// ─── 5. Part 2 / VIP lock on notes and clinical lists ─────────────────────────────────────────
test('5. Part 2 / VIP: locked clients dropped from lists, masked in the co-sign queue, 403 on one-client reads', () => {
  const rows = [{ id: 'a', clientId: 'c1' }, { id: 'b', clientId: 'locked' }, { id: 'c', clientId: null }];
  assert.deepEqual(filterLockedRows(rows, new Set(['locked']), (r) => r.clientId).map((r) => r.id), ['a', 'c']);
  const masked = maskLockedRows(rows, new Set(['locked']), (r) => r.clientId, (r) => ({ ...r, id: 'masked' }));
  assert.deepEqual(masked.map((r) => r.id), ['a', 'masked', 'c']);
  // Lookup failure (null) masks every client-linked row
  assert.deepEqual(maskLockedRows(rows, null, (r) => r.clientId, (r) => ({ ...r, id: 'm' })).map((r) => r.id), ['m', 'm', 'c']);

  const notes = read('src/lib/clients/notes.ts');
  assert.match(notes, /threadAssigneeOr/, 'existing import kept');
  assert.match(notes, /const locked = await notePhiBlock\(input, note\.clientId\);/);
  assert.match(notes, /const locked = await notePhiBlock\(input, input\.clientId\);/);
  assert.match(notes, /withoutLockedClients\(\s*\{ organizationId: input\.organizationId/);
  assert.match(read('src/lib/clinical/access.ts'), /if \(opts\.clientId\) \{\s*const blocked = await clientPhiBlock\(gate, opts\.clientId, path\)/);
  const ehrNotes = read('src/app/api/ehr/notes/route.ts');
  assert.match(ehrNotes, /action: 'LIST',\s*resourceType: 'progressNote'/);
  for (const f of [
    'src/app/api/clinical/assessments/route.ts',
    'src/app/api/clinical/evaluations/route.ts',
    'src/app/api/clinical/locus/route.ts',
    'src/app/api/compliance/mandatory-reporting/route.ts',
    'src/app/api/ehr/treatment-plans/route.ts',
  ]) {
    assert.match(read(f), /withoutLockedClients\(gate, /, f);
  }
  assert.match(read('src/app/api/clinical/measures/route.ts'), /requireClinicalContext\(ASSESSMENTS_PATH, \{ clientId \}\)/);
  const review = read('src/app/api/ehr/supervisor-review/route.ts');
  assert.match(review, /maskLockedRows\(queue, locked/);
  assert.match(review, /body: '',/);
  assert.match(review, /clientName: PROTECTED_RECORD_LABEL/);
});

// ─── 6. Previsit brief for primary care ───────────────────────────────────────────────────────
function previsitInputs(): PreVisitInputs {
  const at = new Date('2026-10-10T15:00:00Z');
  return {
    client: { riskLevel: 'LOW', names: ['Jordan Rivers'] },
    appointments: [],
    medications: [],
    problems: [],
    riskAlerts: [],
    crisisEpisodes: [],
    assessments: [
      { id: 'a1', instrumentId: 'phq9', instrumentName: 'PHQ-9', totalScore: 14, severity: 'moderate', safetyFlagged: false, createdAt: at },
      { id: 'a2', instrumentId: 'gad7', instrumentName: 'GAD-7', totalScore: 9, severity: 'mild', safetyFlagged: false, createdAt: at },
    ],
    measurements: [],
    treatmentPlan: { id: 'tp', status: 'ACTIVE', reviewDueAt: null, goals: [{ text: 'Reduce panic attacks' }] },
    sessionFrequency: null,
    draftNoteCount: 0,
    pendingConsentCount: 0,
    sdohReferrals: [],
    standingLabs: [],
    labResultsAwaitingReview: 0,
    recentNotes: [{ id: 'n1', noteType: 'progress', body: 'Plan: continue CBT for panic', dateOfService: at, createdAt: at, part2: false }],
  } as unknown as PreVisitInputs;
}

test('6. previsit facts: no BH note plan, plan goals or PHQ-9 / GAD-7 without chart-note access', () => {
  const now = new Date('2026-10-20T15:00:00Z');
  const bh = buildPreVisitFacts(previsitInputs(), { now, timeZone: 'America/New_York', audience: 'prescriber', bhChartNotes: true });
  assert.ok(bh.lastNotePlan, 'psychiatrist keeps the last note plan');
  assert.ok(bh.scores.some((s) => s.instrument === 'PHQ-9'));
  assert.ok((bh.treatmentPlan?.goals.length ?? 0) > 0);

  assert.equal(canAccessClientChartNotes('PHYSICIAN'), false);
  const pc = buildPreVisitFacts(previsitInputs(), { now, timeZone: 'America/New_York', audience: 'prescriber', bhChartNotes: canAccessClientChartNotes('PHYSICIAN') });
  assert.equal(pc.lastNotePlan, null);
  assert.ok(!pc.scores.some((s) => s.instrument === 'PHQ-9' || s.instrument === 'GAD-7'));
  assert.deepEqual(pc.treatmentPlan?.goals, []);

  const service = read('src/lib/ai/previsit/service.ts');
  assert.match(service, /const bhChartNotes = canAccessClientChartNotes\(viewer\.role\);/);
  assert.match(service, /audience: bhChartNotes \? audience : `\$\{audience\}:no-bh-notes`/, 'cache key separates primary care briefs');
  assert.match(read('src/lib/ai/previsit/prismaSource.ts'), /bhChartNotes\s*\?\s*prisma\.progressNote\.findMany/);
});

// ─── 7. Residential unlinked residents ────────────────────────────────────────────────────────
test('7. residential: unlinked residents (no clientId) are dropped everywhere', () => {
  const rows = [{ id: 'r1', clientId: 'c1' }, { id: 'r2', clientId: null }, { id: 'r3', clientId: 'other-org' }];
  assert.deepEqual(residentRowsInOrg(rows, new Set(['c1']), (r) => r.clientId).map((r) => r.id), ['r1']);
  const scope = read('src/app/api/residential/_scope.ts');
  assert.match(scope, /if \(!resident\.clientId\) return null;/);
  assert.match(scope, /organizationId column|organizationId \(future migration/);
  for (const f of ['shift-notes', 'residents', 'bed-board', 'shifts']) {
    assert.match(read(`src/app/api/residential/${f}/route.ts`), /residentRowsInOrg\(/, f);
  }
  assert.match(read('src/app/api/residential/residents/route.ts'), /Link the resident to a client chart/);
});

// ─── 8. Check-ins ─────────────────────────────────────────────────────────────────────────────
test('8. GET /api/clients/[id]/check-ins requires canSeeClientCheckIns', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'HR', 'PHYSICIAN']) assert.equal(canSeeClientCheckIns(r), false, r);
  assert.equal(canSeeClientCheckIns('PEER_SUPPORT'), true);
  assert.match(read('src/app/api/clients/[id]/check-ins/route.ts'), /if \(!canSeeClientCheckIns\(gate\.role\)\)/);
  assert.match(read('src/lib/clients/checkIns.ts'), /if \(!canSeeClientCheckIns\(input\.actorRole\)\)/);
});

// ─── 9. TMS / Spravato ────────────────────────────────────────────────────────────────────────
test('9. TMS / Spravato list and by-id queries are caseload scoped (clientAccessWhere)', () => {
  for (const f of [
    'src/app/api/tms/courses/route.ts',
    'src/app/api/tms/courses/[id]/route.ts',
    'src/app/api/tms/phq9/route.ts',
    'src/app/api/tms/sessions/route.ts',
    'src/app/api/tms/sessions/[id]/route.ts',
    'src/app/api/spravato/enrollments/route.ts',
    'src/app/api/spravato/enrollments/[id]/route.ts',
    'src/app/api/spravato/sessions/route.ts',
    'src/app/api/spravato/sessions/[id]/route.ts',
  ]) {
    const src = read(f);
    assert.match(src, /client: clientAccessWhere\(\{ organizationId: gate\.organizationId, actorUserId: gate\.userId, actorRole: gate\.role \}\)/, f);
    assert.doesNotMatch(src, /where: \{ (id(: \w+(\.\w+)?)?, )?organizationId: gate\.organizationId \}/, `${f}: unscoped org-only lookup left`);
  }
});

// ─── 10. Evaluations diagnoses ────────────────────────────────────────────────────────────────
test('10. evaluations: only canEditClientDiagnoses roles record diagnoses / finalize diagnostic templates', () => {
  const dx = { sections: [{ type: 'textarea' }, { type: 'diagnosis' }] };
  const nonDx = { sections: [{ type: 'textarea' }] };
  assert.equal(isDiagnosticEvaluationTemplate(dx), true);
  assert.equal(isDiagnosticEvaluationTemplate(nonDx), false);
  assert.equal(canEditClientDiagnoses('PRP_SPECIALIST'), false);
  assert.equal(evaluationDiagnosisBlock('PRP_SPECIALIST', dx, { diagnoses: [{ code: 'F32.1' }], status: 'DRAFT' }), 'diagnoses_not_permitted');
  assert.equal(evaluationDiagnosisBlock('PRP_SPECIALIST', dx, { diagnoses: [], status: 'FINALIZED' }), 'diagnostic_finalize_not_permitted');
  assert.equal(evaluationDiagnosisBlock('PRP_SPECIALIST', dx, { diagnoses: [], status: 'DRAFT' }), null);
  assert.equal(evaluationDiagnosisBlock('PRP_SPECIALIST', nonDx, { diagnoses: [], status: 'FINALIZED' }), null);
  assert.equal(evaluationDiagnosisBlock('THERAPIST', dx, { diagnoses: [{ code: 'F32.1' }], status: 'FINALIZED' }), null);
  assert.match(read('src/app/api/clinical/evaluations/route.ts'), /evaluationDiagnosisBlock\(gate\.role, template,/);
});

// ─── 11. Primary care medication list ─────────────────────────────────────────────────────────
test('11. POST /api/medical/patients/[id]/medications: medical providers + MA only', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'CASE_MANAGER', 'THERAPIST', 'CLINICIAN', 'BILLING', 'PEER_SUPPORT', '']) {
    assert.equal(canWritePrimaryCareMedications(r), false, r || '(none)');
  }
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PSYCHIATRIST', 'NP', 'ADMIN']) {
    assert.equal(canWritePrimaryCareMedications(r), true, r);
  }
  assert.match(read('src/app/api/medical/patients/[id]/medications/route.ts'), /if \(!canWritePrimaryCareMedications\(scope\.gate\.role\)\)/);
});

// ─── 12. Crisis episode by id ─────────────────────────────────────────────────────────────────
test('12. crisis episode GET / PATCH by id apply the program caseload filter', () => {
  const src = read('src/app/api/crisis/episodes/[id]/route.ts');
  assert.match(src, /programCaseloadClientIds\(/);
  assert.equal((src.match(/found && \(await onCaseload\(gate, found\.clientId\)\) \? found : null/g) || []).length, 2);
  assert.match(src, /if \(!\(await onCaseload\(gate, body\.clientId\)\)\)/);
});

// ─── 13. Psychotherapy notes author-only ──────────────────────────────────────────────────────
test('13. psychotherapy notes: the stored author only, even after the note clinician changes', () => {
  assert.equal(canUsePsychotherapyNote({ callerId: 'u1', noteClinicianId: 'u1', storedAuthorId: null }), true, 'new row');
  assert.equal(canUsePsychotherapyNote({ callerId: 'u1', noteClinicianId: 'u1', storedAuthorId: 'u1' }), true);
  assert.equal(canUsePsychotherapyNote({ callerId: 'u2', noteClinicianId: 'u2', storedAuthorId: 'u1' }), false, 'new clinician cannot read the old author notes');
  assert.equal(canUsePsychotherapyNote({ callerId: 'u1', noteClinicianId: 'u2', storedAuthorId: 'u1' }), false);
  assert.equal(canUsePsychotherapyNote({ callerId: 'u1', noteClinicianId: null, storedAuthorId: null }), false);
  const src = read('src/app/api/notes/[id]/psychotherapy-notes/route.ts');
  assert.equal((src.match(/canUsePsychotherapyNote\(\{ callerId: access\.gate\.userId/g) || []).length, 2);
  assert.match(src, /authorId: access\.gate\.userId, text/);
  assert.doesNotMatch(src, /progressNotePsychotherapyNote\.findUnique\([^;]*\.catch\(/, 'lookup errors fail closed');
});

// ─── 14. Verified admin base role ─────────────────────────────────────────────────────────────
test('14. note routes read the admin base role from the DB, never the JWT', () => {
  for (const f of ['src/lib/notes/routeAccess.ts', 'src/app/api/notes/[id]/route.ts', 'src/app/api/notes/[id]/addenda/route.ts', 'src/app/api/notes/policy/route.ts']) {
    const src = read(f);
    assert.doesNotMatch(src, /session\?\.user\?\.baseRole|baseRoleOf\(/, f);
    assert.match(src, /verifiedAdminBaseRole|verifiedNoteBaseRole/, f);
  }
});

// ─── 15. Aria ─────────────────────────────────────────────────────────────────────────────────
test('15. Aria: clinical role gate and a caseload-verified clientId in the audit log', () => {
  assert.equal(canAccessClientChartNotes('FRONT_DESK') || canAccessPath('FRONT_DESK', '/dashboard/ai-insights'), false);
  assert.equal(canAccessClientChartNotes('BILLING') || canAccessPath('BILLING', '/dashboard/ai-insights'), false);
  assert.equal(canAccessClientChartNotes('THERAPIST') || canAccessPath('THERAPIST', '/dashboard/ai-insights'), true);
  const src = read('src/app/api/agents/aria/route.ts');
  assert.match(src, /if \(!canUseAria\(gate\.role\)\)/);
  assert.match(src, /clientAccessWhere\(/);
  assert.doesNotMatch(src, /patientId: body\.clientId/);
});

// ─── 16. Risk alert feeds ─────────────────────────────────────────────────────────────────────
test('16. risk alerts: locked clients keep severity / type, description blanked, alias name', () => {
  const alert = {
    id: 'al1', clientId: 'vip', clientName: 'Real Name', clinicianId: null, organizationId: 'o', type: 'crisis_keywords',
    source: 'check_in', sourceId: null, severity: 'high', description: 'said X', reviewNote: 'called', mood: 2, stress: 9,
    createdAt: '', reviewed: false, reviewedAt: null, reviewedById: null,
  } as unknown as AlertDto;
  const open = { ...alert, id: 'al2', clientId: 'ok' };
  const [m, o] = maskLockedAlerts([alert, open], new Map([['vip', { alias: 'Client V' }]]));
  assert.equal(m.clientName, 'Client V');
  assert.equal(m.description, '');
  assert.equal(m.reviewNote, null);
  assert.equal(m.severity, 'high');
  assert.equal(m.type, 'crisis_keywords');
  assert.equal(m.protected, true);
  assert.equal(o.description, 'said X');
  assert.equal(maskLockedAlerts([open], null)[0].clientName, PROTECTED_RECORD_LABEL, 'lookup failure masks all');

  assert.match(read('src/app/api/risk-alerts/route.ts'), /maskAlertsForViewer\(gate, rawAlerts\)/);
  const legacy = read('src/app/api/alerts/route.ts');
  assert.match(legacy, /canAccessPath\(gate\.role, '\/dashboard\/alerts', gate\.capabilities\)/);
  assert.match(legacy, /maskAlertsForViewer\(gate, rawAlerts\)/);
  assert.match(legacy, /auditPhiAccess\(/);
});

// ─── 17. Primary care patient list ────────────────────────────────────────────────────────────
test('17. GET /api/medical/patients: problem list gated, Part 2 clients dropped, contact PII masked', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST', 'CASE_MANAGER']) {
    assert.equal(canAccessPath(r, '/dashboard/medical/problem-list'), false, r);
  }
  const src = read('src/app/api/medical/patients/route.ts');
  assert.match(src, /const canSeeProblems = canAccessPath\(gate\.role, '\/dashboard\/medical\/problem-list'/);
  assert.match(src, /canSeeProblems \? client\?\.medicalProblems \|\| \[\] : \[\]/);
  assert.match(src, /withoutLockedClients\(gate, /);
  assert.match(src, /maskClientPii\(\{ phone: p\.phone/);
  assert.match(src, /phone: pii\.phone,\s*email: pii\.email/);
});

// ─── 18. Community referrals ──────────────────────────────────────────────────────────────────
test('18. community referrals: Peer Support / Case Manager see their own or caseload referrals only', () => {
  assert.equal(referralsNeedCaseloadScope('PEER_SUPPORT'), true);
  assert.equal(referralsNeedCaseloadScope('CASE_MANAGER'), true);
  assert.equal(referralsNeedCaseloadScope('FRONT_DESK'), false);
  const scope = { createdIds: new Set(['mine']), caseloadNames: new Set(['jordan rivers']) };
  assert.equal(referralVisibleToCaseloadActor({ id: 'mine', patientName: 'Somebody Else' }, scope), true);
  assert.equal(referralVisibleToCaseloadActor({ id: 'x', patientName: '  Jordan   RIVERS ' }, scope), true);
  assert.equal(referralVisibleToCaseloadActor({ id: 'y', patientName: 'Jordan Riverside' }, scope), false, 'exact names only');
  const route = read('src/app/api/referrals/route.ts');
  assert.match(route, /listReferrals\(gate\.organizationId, \{ userId: gate\.userId, role: gate\.role \}\)/);
  assert.match(route, /action: 'LIST',\s*resourceType: COMMUNITY_REFERRAL_RESOURCE/);
  assert.match(route, /action: 'CREATE',\s*resourceType: COMMUNITY_REFERRAL_RESOURCE,\s*resourceId: result\.referral\.id/);
  assert.match(read('src/app/api/referrals/[id]/route.ts'), /referralVisibleTo\(gate\.organizationId, id/);
});
