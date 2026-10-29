/**
 * Behavioral health therapist and prescriber workflow (2026-10-22): Maryland requirements in the
 * Visit Guide, PDMP rules, after-sign claim + next actions, psychotherapy add-on, home queues,
 * clinical task links. Pure functions plus source checks for the wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOLS } from '../src/lib/visits/protocols';
import { requirementById } from '../src/lib/visits/requirements';
import { computeDueItems, classifyMed, type DueFacts, type DueMed } from '../src/lib/visits/due';
import {
  WHEN_LABEL,
  canStartVisit,
  followUpTypeForKind,
  guideActionTarget,
  noteHasCssrsScreen,
  startVisitLabel,
  withLiveNoteSteps,
} from '../src/components/visits/visitGuideHelpers';
import type { GuideStep } from '../src/lib/visits/types';
import { afterSignActions, summarizeClaimResult } from '../src/lib/notes/afterSign';
import { notesQueueTiles } from '../src/lib/notes/queueTiles';
import { openNoteHref, ownClinicalWork, unsignedNoteUrgency, visitNoteHref } from '../src/lib/tasks/visitTaskLinks';
import { ownScheduleRows } from '../src/lib/dashboard/ownSchedule';
import { addOnCodeForMinutes, addOnTimeIssue, psychotherapyMinutesFromHeader, renderHeader } from '../src/lib/ehr/psychMedMgmt';
import { psychotherapyMinutes } from '../src/lib/ai/noteQuality/rules';
import { PLAN_REQUIRED_CPT, reviewDaysNoteText, treatmentPlanGate, DEFAULT_THERAPY_WORKFLOW_SETTINGS } from '../src/lib/ehr/therapy/rules';
import { consentOnFile } from '../src/lib/consents/onFile';

const NOW = new Date('2026-10-22T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function facts(over: Partial<DueFacts> = {}): DueFacts {
  return {
    kind: 'med_management',
    ageYears: 40,
    isVirtual: false,
    intervals: { phq9Days: 30, gad7Days: 30, aimsDays: 182, sdohDays: 365, pdmpDays: 90 },
    latest: { phq9: NOW, gad7: NOW, cssrs: NOW, aims: null, sdoh: NOW, auditC: null, glucoseOrA1c: null, lipids: null, pdmp: null },
    meds: [],
    standingLabs: [],
    labsAwaitingReview: 0,
    treatmentPlan: null,
    consents: { telehealth: true, part2: true, medication: true, minor: true, treatment: true },
    safetyPlanOnFile: true,
    riskLevel: 'low',
    pendingRenewals: 0,
    notPickedUp: [],
    ...over,
  };
}
const med = (name: string, startedAt: Date | null, isNew = false): DueMed => ({ ...classifyMed(name), name, startedAt, isNew });

// ─── Maryland requirements in the guide ──────────────────────────────────────

test('Maryland duty to warn and mandated reporting are cited and confirmed by the practice owner', () => {
  for (const id of ['md_duty_to_warn', 'md_child_abuse_report', 'md_vulnerable_adult_report']) {
    const r = requirementById(id);
    assert.ok(r, id);
    assert.equal(r!.authority, 'Maryland law');
    assert.equal(r!.confirmedOn, '2026-10-21', `${id} confirmed by the practice owner`);
  }
  assert.match(requirementById('md_duty_to_warn')!.citation || '', /Courts and Judicial Proceedings §5-609/);
  assert.match(requirementById('md_child_abuse_report')!.citation || '', /Family Law §5-704/);
  assert.match(requirementById('md_vulnerable_adult_report')!.citation || '', /Family Law §14-302/);
  assert.match(requirementById('telehealth_consent_location')!.rule, /audio-only/i);
});

test('reportable-concerns step: intakes, evaluations and crisis (recommended); therapy (optional); never primary care', () => {
  const level = (kind: keyof typeof PROTOCOLS) => PROTOCOLS[kind].steps.find((s) => s.step.id === 'reportable_concerns')?.step.level ?? null;
  for (const k of ['therapy_intake', 'sud_intake', 'psych_eval_adult', 'psych_eval_child', 'crisis_followup'] as const) assert.equal(level(k), 'recommended', k);
  for (const k of ['therapy_individual', 'therapy_family'] as const) assert.equal(level(k), 'optional', k);
  assert.equal(level('primary_care'), null);
  const step = PROTOCOLS.therapy_intake.steps.find((s) => s.step.id === 'reportable_concerns')!.step;
  assert.deepEqual(step.basis, ['md_duty_to_warn', 'md_child_abuse_report', 'md_vulnerable_adult_report']);
  assert.equal(step.source, 'manual');
});

test('PDMP step records the CRISP query on BH prescriber visits only', () => {
  const pdmpStep = (kind: keyof typeof PROTOCOLS) => PROTOCOLS[kind].steps.find((s) => s.step.id === 'pdmp')?.step;
  for (const k of ['med_management', 'psych_eval_adult', 'psych_reeval'] as const) assert.deepEqual(pdmpStep(k)?.action, { kind: 'pdmp_attest' }, k);
  assert.equal(pdmpStep('primary_care')?.action, undefined, 'primary care step unchanged');
  const t = guideActionTarget({ kind: 'pdmp_attest' }, { clientId: 'c1', today: '2026-10-22' });
  assert.deepEqual(t, { kind: 'pdmp', label: 'Record PDMP (CRISP) query' });
});

// ─── Due rules ──────────────────────────────────────────────────────────────

test('due: PDMP is due when a benzodiazepine / opioid starts after the last query, even inside 90 days', () => {
  const lastQuery = daysAgo(20);
  const started = daysAgo(5);
  const due = computeDueItems(facts({ latest: { ...facts().latest, pdmp: lastQuery }, meds: [med('lorazepam 1 mg', started, true)] }), NOW);
  const item = due.find((d) => d.id === 'pdmp');
  assert.ok(item, 'PDMP due');
  assert.match(item!.reason, /started after the last PDMP query/);
  assert.deepEqual(item!.action, { kind: 'pdmp_attest' });
  // Continuing course queried 20 days ago: nothing due
  const ok = computeDueItems(facts({ latest: { ...facts().latest, pdmp: lastQuery }, meds: [med('lorazepam 1 mg', daysAgo(200), false)] }), NOW);
  assert.equal(ok.find((d) => d.id === 'pdmp'), undefined);
  // Primary care visits get the item without the BH record action
  const pc = computeDueItems(facts({ kind: 'primary_care', meds: [med('oxycodone', daysAgo(200))] }), NOW).find((d) => d.id === 'pdmp');
  assert.ok(pc);
  assert.equal(pc!.action, undefined);
});

test('due: lipids at 12 weeks when the only lipid panel predates the antipsychotic', () => {
  const start = daysAgo(100);
  const due = computeDueItems(
    facts({ meds: [med('quetiapine 100 mg', start)], latest: { ...facts().latest, aims: NOW, glucoseOrA1c: daysAgo(10), lipids: daysAgo(150) } }),
    NOW
  );
  const lip = due.find((d) => d.id === 'metabolic_lipids');
  assert.ok(lip);
  assert.equal(lip!.label, 'Lipid panel (12-week)');
  // Lipids after the start: nothing due for 5 years (adult)
  const none = computeDueItems(facts({ meds: [med('quetiapine 100 mg', start)], latest: { ...facts().latest, aims: NOW, glucoseOrA1c: daysAgo(10), lipids: daysAgo(10) } }), NOW);
  assert.equal(none.find((d) => d.id === 'metabolic_lipids'), undefined);
});

// ─── Visit Guide UI helpers ─────────────────────────────────────────────────

test('follow-up booking: visit type by kind, and the guide suggestion beats the protocol default', () => {
  assert.equal(followUpTypeForKind('med_management'), 'Medication Management');
  assert.equal(followUpTypeForKind('psych_eval_child'), 'Medication Management');
  assert.equal(followUpTypeForKind('therapy_individual'), 'Individual Therapy');
  assert.equal(followUpTypeForKind('prp'), 'PRP Session');
  assert.equal(followUpTypeForKind('group_therapy'), null);
  const t = guideActionTarget({ kind: 'book_follow_up', weeks: 4 }, { clientId: 'c1', today: '2026-10-22', followUpDays: 7, kind: 'med_management' }) as { href: string; label: string };
  const u = new URL(t.href, 'https://x.test');
  assert.equal(u.searchParams.get('after'), '2026-10-29');
  assert.equal(u.searchParams.get('type'), 'Medication Management');
  assert.equal(t.label, 'Book in 1 week');
  assert.equal(WHEN_LABEL.elevated_risk, 'Elevated risk');
});

test('no-show visits open the No-Show note from the schedule', () => {
  assert.equal(canStartVisit('no-show', 'not-started'), true);
  assert.equal(canStartVisit('late-cancel'), true);
  assert.equal(canStartVisit('no-show', 'signed'), false);
  assert.equal(startVisitLabel('no-show', 'in-progress'), 'Continue note');
  assert.equal(startVisitLabel('late-cancel'), 'Document no-show');
});

test('C-SSRS screened inside the note satisfies the guide step (no second entry); incomplete does not', () => {
  const step: GuideStep = { id: 'cssrs', label: 'C-SSRS screen', level: 'required', source: 'auto', phase: 'during', status: 'not_done' };
  assert.equal(noteHasCssrsScreen({ 'Risk Check': 'C-SSRS screen result: NEGATIVE (all items answered No)' }), true);
  assert.equal(noteHasCssrsScreen({ 'Risk Check': 'C-SSRS screen result: POSITIVE' }), true);
  assert.equal(noteHasCssrsScreen({ 'Risk Check': 'C-SSRS screen result: INCOMPLETE (2 of 6 items answered)' }), false);
  const [live] = withLiveNoteSteps([step], { 'Suicidal Ideation': 'C-SSRS screen result: NEGATIVE (all items answered No)' });
  assert.equal(live.status, 'done');
  assert.match(live.detail || '', /documented in this note/);
  const [skipped] = withLiveNoteSteps([{ ...step, status: 'not_applicable' }], { x: 'C-SSRS screen result: POSITIVE' });
  assert.equal(skipped.status, 'not_applicable');
});

// ─── After sign ─────────────────────────────────────────────────────────────

test('after sign: claim summary in plain words', () => {
  assert.equal(summarizeClaimResult({ ok: true, claim: { id: 'k1', status: 'DRAFT' } }).claimId, 'k1');
  assert.match(summarizeClaimResult({ ok: true, claim: { id: 'k1', status: 'READY' }, alreadyExisted: true }).message, /already on file \(ready\)/);
  assert.match(summarizeClaimResult({ ok: false, error: 'No CPT on the signed note. The clinician records…' }).message, /not billable/);
  assert.match(summarizeClaimResult({ ok: false, error: 'Supervisor co-signature pending' }).message, /after your supervisor co-signs/);
  assert.match(summarizeClaimResult({ ok: false, error: 'Prior auth X expired' }).message, /^No claim drafted: Prior auth X expired/);
  assert.match(summarizeClaimResult(null).message, /Billing can create it/);
});

test('after sign: next actions (plan after intake, follow-up unless booked, claim only for billing roles)', () => {
  const base = { clientId: 'c 1', claimId: 'k1', followUpHref: '/dashboard/appointments?new=1&client=c1', followUpLabel: 'Book follow-up in 1 week' };
  const ids = (x: ReturnType<typeof afterSignActions>) => x.map((a) => a.id);
  assert.deepEqual(ids(afterSignActions({ ...base, noteType: 'Therapy Progress' })), ['book_follow_up', 'worklist', 'schedule']);
  assert.deepEqual(ids(afterSignActions({ ...base, noteType: 'Therapy Intake', canOpenClaims: true })), ['treatment_plan', 'book_follow_up', 'open_claim', 'worklist', 'schedule']);
  assert.deepEqual(ids(afterSignActions({ ...base, noteType: 'Psych Med Mgmt', nextBooked: true })), ['worklist', 'schedule']);
  assert.deepEqual(ids(afterSignActions({ ...base, noteType: 'Adult Psych Intake' })), ['book_follow_up', 'worklist', 'schedule'], 'psychiatric intake: no therapy plan prompt');
  assert.equal(afterSignActions({ ...base, noteType: 'Therapy Intake' })[0].href, '/dashboard/ehr/treatment-plans?clientId=c%201');
});

test('sign routes draft the claim from the note (keeping the add-on) and stamp late entry by the practice deadline', () => {
  const workflow = src('src/app/api/ehr/notes/[id]/workflow/route.ts');
  assert.match(workflow, /generateClaimFromNote\(/);
  assert.match(workflow, /summarizeClaimResult\(/);
  const notes = src('src/app/api/notes/[id]/route.ts');
  assert.doesNotMatch(notes, /cptCode: noteCpt/, 'no explicit code: it would drop the add-on line');
  assert.doesNotMatch(notes, /24 \* 60 \* 60 \* 1000/, 'late entry is not "created > 24 h ago"');
  assert.match(notes, /progressNoteTimeliness\.findUnique/);
  const page = src('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(page, /addOnCptCode:/);
  assert.match(page, /psychotherapyMinutes:/);
  assert.match(page, /<AfterSignBanner/);
  assert.match(page, /editor-late-reason/);
});

// ─── Psychotherapy add-on ───────────────────────────────────────────────────

test('psychotherapy add-on: code by minutes, warnings, header round trip readable by note quality', () => {
  assert.equal(addOnCodeForMinutes(15), null);
  assert.equal(addOnCodeForMinutes(16), '90833');
  assert.equal(addOnCodeForMinutes(38), '90836');
  assert.equal(addOnCodeForMinutes(53), '90838');
  assert.equal(addOnTimeIssue({ addOnCode: '', psychotherapyMinutes: null, totalMinutes: 30 }), null);
  assert.match(addOnTimeIssue({ addOnCode: '90833', psychotherapyMinutes: null, totalMinutes: 30 })!, /enter the psychotherapy minutes/);
  assert.match(addOnTimeIssue({ addOnCode: '90833', psychotherapyMinutes: 10, totalMinutes: 30 })!, /at least 16 minutes/);
  assert.match(addOnTimeIssue({ addOnCode: '90833', psychotherapyMinutes: 40, totalMinutes: 60 })!, /\+90836/);
  assert.match(addOnTimeIssue({ addOnCode: '90833', psychotherapyMinutes: 30, totalMinutes: 30 })!, /less than the total visit time/);
  assert.equal(addOnTimeIssue({ addOnCode: '90833', psychotherapyMinutes: 20, totalMinutes: 40 }), null);
  const header = renderHeader({
    patientName: 'A', dateOfBirth: null, mrn: null, dateOfService: '2026-10-22', providerName: 'Dr X', providerRole: null,
    providerCredentials: [], providerNpi: null, location: 'Bowie', visitType: 'telehealth', placeOfService: '10',
    durationMinutes: 40, emCode: '99214', addOnCode: '90833', psychotherapyMinutes: 20, audioOnly: true,
  });
  assert.match(header, /^Psychotherapy time: 20 min \(separate from E\/M time\)$/m);
  assert.match(header, /audio-only/);
  assert.doesNotMatch(header, /modifier 95/);
  assert.equal(psychotherapyMinutesFromHeader(header), '20');
  assert.equal(psychotherapyMinutes(header), 20, 'the note-quality check reads the same line');
});

// ─── Treatment plan labels ──────────────────────────────────────────────────

test('treatment plan: review-date note uses the applied numbers; gate message lists every plan-required code', () => {
  assert.match(reviewDaysNoteText(120, 40, 120), /^Default 120 days from the Practice Settings review interval 120 days/);
  assert.match(reviewDaysNoteText(90, 12, 180), /child plans are reviewed at least every 90 days/);
  assert.match(reviewDaysNoteText(180, 40, null), /no practice review interval set \(180 days\)/);
  const gate = treatmentPlanGate({ noteType: 'Group', cptCode: '90853', plans: [], today: '2026-12-31', settings: { ...DEFAULT_THERAPY_WORKFLOW_SETTINGS } });
  assert.equal(gate.ok, false);
  for (const c of PLAN_REQUIRED_CPT) assert.ok(gate.message.includes(c), c);
});

// ─── Home and tasks ─────────────────────────────────────────────────────────

test('home documentation queue: worklist tabs, co-sign / escalated only when present', () => {
  const tiles = notesQueueTiles({ missing: 2, drafts: 0, ready: 3, returned: 1, cosign: 0, escalated: 0 });
  assert.deepEqual(tiles.map((t) => t.tab), ['missing', 'drafts', 'ready', 'returned']);
  assert.equal(tiles[0].href, '/dashboard/ehr/notes?tab=missing');
  assert.equal(tiles.find((t) => t.tab === 'returned')!.attention, true);
  assert.equal(tiles.find((t) => t.tab === 'drafts')!.attention, false);
  assert.deepEqual(notesQueueTiles({ cosign: 4 }).map((t) => t.tab), ['missing', 'drafts', 'ready', 'returned', 'cosign']);
});

test('clinical tasks: own work, deep links, deadline-based urgency', () => {
  assert.equal(ownClinicalWork('THERAPIST'), true);
  assert.equal(ownClinicalWork('PSYCHIATRIST'), true);
  assert.equal(ownClinicalWork('DIRECTOR'), false);
  assert.equal(openNoteHref('n 1'), '/dashboard/ehr/notes?openNote=n%201');
  const href = new URL(visitNoteHref({ clientId: 'c1', appointmentId: 'a1', startsAt: new Date('2026-10-22T02:30:00Z'), virtual: true }), 'https://x.test');
  assert.equal(href.pathname, '/dashboard/ehr/notes');
  assert.equal(href.searchParams.get('dos'), '2026-10-21', 'practice clock (ET), not UTC');
  assert.equal(href.searchParams.get('guide'), '1');
  assert.equal(href.searchParams.get('telehealth'), '1');
  // 72 h after the end of the service day
  const fresh = unsignedNoteUrgency({ dateOfService: '2026-10-22', deadlineHours: 72, timeZone: 'America/New_York', now: NOW });
  assert.equal(fresh.overdue, false);
  assert.equal(fresh.priority, 'normal');
  const late = unsignedNoteUrgency({ dateOfService: '2026-10-15', deadlineHours: 72, timeZone: 'America/New_York', now: NOW });
  assert.equal(late.overdue, true);
  assert.equal(late.priority, 'urgent');
  assert.ok((late.daysUntil ?? 0) < 0);
  const manage = src('src/lib/tasks/manage.ts');
  assert.match(manage, /actionHref: openNoteHref\(note\.noteId\)/);
  assert.match(manage, /clinicianId: input\.actorUserId/);
  // A visit is missing its note when it has no live (non-dismissed) note
  assert.match(manage, /progressNotes: \{ none: \{ dismissedAt: null \} \}/);
  assert.doesNotMatch(manage, /noteDays\.has/, 'missing-note match is by appointment, not by UTC creation day');
});

test('prescriber home lists only the prescriber’s own visits', () => {
  const rows = [{ id: 1, clinicianId: 'me' }, { id: 2, clinicianId: 'therapist' }, { id: 3, clinicianId: null }];
  assert.deepEqual(ownScheduleRows(rows, 'me').map((r) => r.id), [1, 3]);
  assert.equal(ownScheduleRows(rows, null).length, 3);
});

test('telehealth consent on file (prefills the note tick): signed, current, not revoked', () => {
  const row = (o: Record<string, unknown> = {}) => ({ type: 'Telehealth Consent', formKey: null, status: 'SIGNED', formStatus: null, expiresAt: null, revokedAt: null, ...o });
  assert.equal(consentOnFile([row()], 'telehealth-consent', /telehealth/i, NOW), true);
  assert.equal(consentOnFile([row({ revokedAt: daysAgo(1) })], 'telehealth-consent', /telehealth/i, NOW), false);
  assert.equal(consentOnFile([row({ expiresAt: daysAgo(1) })], 'telehealth-consent', /telehealth/i, NOW), false);
  assert.equal(consentOnFile([row({ status: 'PENDING' })], 'telehealth-consent', /telehealth/i, NOW), false);
  assert.match(src('src/lib/notes/serviceDetail.ts'), /telehealthConsentOnFile/);
});

test('scribe draft keeps the visit date and modality; guide links honor the client', () => {
  const scribe = src('src/app/api/scribe/captures/[id]/note/route.ts');
  assert.match(scribe, /toPracticeWallTime\(appt\.startsAt, tz\)\.date/);
  assert.match(scribe, /appt\?\.isVirtual/);
  assert.match(src('src/app/dashboard/ehr/locus/page.tsx'), /get\('clientId'\)/);
  assert.match(src('src/app/dashboard/ehr/consents/client/[clientId]/page.tsx'), /get\('template'\)/);
  const editor = src('src/components/notes/TherapyNoteEditor.tsx');
  assert.match(editor, /assessments\/cssrs\?clientId=/);
  assert.match(editor, /safety-plan\?clientId=/);
  assert.doesNotMatch(editor, /href="\/dashboard\/ehr\/assessments\/sud"/);
  assert.match(src('src/lib/inbox/loaders.ts'), /supervisor-review\?noteId=/);
  // DrFirst in-basket opens without a patient upload
  assert.match(src('src/components/visits/VisitGuidePanel.tsx'), /screen !== 'message' && screen !== 'report'/);
});
