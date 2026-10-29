import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NOTE_SECTIONS, NOTE_TYPES } from '../src/lib/ehr/noteTemplates';
import { AUTO_STEP_IDS, PROTOCOLS, VISIT_KINDS } from '../src/lib/visits/protocols';
import { REQUIREMENTS, requirementById } from '../src/lib/visits/requirements';
import { billingCodeFromNotes, defaultKindForRole, pickFallbackAppointment, resolveVisitKind } from '../src/lib/visits/resolveKind';
import { classifyMed, computeDueItems, type DueFacts, type DueMed } from '../src/lib/visits/due';
import { assembleGuide, audienceForRole, noteTypeFor, type GuideAssemblyInput } from '../src/lib/visits/guide';
import { canMarkVisitStep, canViewVisitGuide } from '../src/lib/visits/access';
import { canAccessApiPath } from '../src/lib/auth/roleAccess';
import type { VisitKind } from '../src/lib/visits/types';

const NOW = new Date('2026-10-20T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// ─── resolveVisitKind ────────────────────────────────────────────────────────

test('resolveKind: Valant codes in appointment notes', () => {
  const k = (notes: string, extra: Record<string, unknown> = {}) => resolveVisitKind({ notes, appointmentType: 'Telehealth', ...extra });
  assert.equal(k('Valant code: 90837T').kind, 'therapy_individual');
  assert.equal(k('Valant code: 90837T').resolvedFrom, 'Valant code 90837');
  assert.equal(k('Valant code: 90791').kind, 'therapy_intake');
  assert.equal(k('Valant code: 90792', { clientAgeYears: 40 }).kind, 'psych_eval_adult');
  assert.equal(k('Valant code: 90792', { clientAgeYears: 12 }).kind, 'psych_eval_child');
  assert.equal(k('Valant code: 99214', { clinicianRole: 'PSYCHIATRIST' }).kind, 'med_management');
  assert.equal(k('Valant code: 99214', { clinicianRole: 'PHYSICIAN' }).kind, 'primary_care');
  assert.equal(k('Valant code: 99213', { clinicianRole: 'MEDICAL_NP' }).kind, 'primary_care');
  assert.equal(k('Valant code: 99204', { clinicianRole: 'NP', clientAgeYears: 9 }).kind, 'psych_eval_child');
  assert.equal(k('Valant code: 90847').kind, 'therapy_family');
  assert.equal(k('Valant code: 90853').kind, 'group_therapy');
  assert.equal(k('Valant code: 90853', { groupIsSud: true }).kind, 'sud_group');
  assert.equal(k('Valant code: H2017').kind, 'prp');
  assert.equal(k('Valant code: S9480').kind, 'iop');
  assert.equal(k('Valant code: H0004').kind, 'sud_individual');
  assert.equal(k('Valant code: H0005').kind, 'sud_group');
  assert.equal(k('Valant code: 90868').kind, 'tms');
  assert.equal(k('Valant code: G2083').kind, 'spravato');
  assert.equal(k('Valant code: 99442').kind, 'telephone');
  assert.equal(k('Valant code: 98967').kind, 'telephone');
  assert.equal(billingCodeFromNotes('Imported. Valant code: 90834-95'), '90834');
});

test('resolveKind: appointment type text, labels, roles, explicit kind', () => {
  const r = (appointmentType: string, extra: Record<string, unknown> = {}) => resolveVisitKind({ appointmentType, ...extra }).kind;
  assert.equal(r('Initial Assessment'), 'therapy_intake');
  assert.equal(r('Psychiatric Evaluation', { clientAgeYears: 30 }), 'psych_eval_adult');
  assert.equal(r('Psychiatric Evaluation', { clientAgeYears: 15 }), 'psych_eval_child');
  assert.equal(r('Medication Review', { clinicianRole: 'NP' }), 'med_management');
  assert.equal(r('Medication Management', { clinicianRole: 'PHYSICIAN' }), 'primary_care');
  assert.equal(r('Medication Management', { clinicianRole: 'PSYCHIATRIST', labelMeaning: 'reeval' }), 'psych_reeval');
  assert.equal(r('Medication Management', { clinicianRole: 'THERAPIST', labelMeaning: 'reeval' }), 'med_management');
  assert.equal(r('Crisis Follow-up'), 'crisis_followup');
  assert.equal(r('PRP Session'), 'prp');
  assert.equal(r('Group Therapy'), 'group_therapy');
  assert.equal(r('Individual Therapy'), 'therapy_individual');
  assert.equal(r('Telehealth Check-in', { clinicianRole: 'THERAPIST' }), 'telephone');
  assert.equal(r('Telehealth Check-in', { clinicianRole: 'PSYCHIATRIST' }), 'med_management');
  // Ambiguous type falls through to the label / role
  assert.equal(r('Telehealth', { clinicianRole: 'PSYCHIATRIST' }), 'med_management');
  assert.equal(r('Telehealth', { labelMeaning: 'new', clinicianRole: 'THERAPIST' }), 'therapy_intake');
  assert.equal(r('Telehealth', { clinicianRole: 'THERAPIST' }), 'other');
  assert.equal(resolveVisitKind({ appointmentType: 'Telehealth', isGroup: true, groupIsSud: true }).kind, 'sud_group');
  assert.equal(resolveVisitKind({ appointmentType: 'Individual Therapy', explicitKind: 'discharge' }).kind, 'discharge');
  assert.equal(resolveVisitKind({ appointmentType: 'Individual Therapy', explicitKind: 'bogus' }).kind, 'therapy_individual');
  assert.match(resolveVisitKind({ appointmentType: 'Medication Management' }).resolvedFrom, /appointment type "Medication Management"/);
});

// ─── Protocol / requirement integrity ─────────────────────────────────────────

test('every VisitKind has a protocol with a real note type, real sections, known basis and auto ids', () => {
  const kinds: VisitKind[] = [
    'therapy_intake', 'psych_eval_adult', 'psych_eval_child', 'psych_reeval', 'med_management', 'therapy_individual', 'therapy_family',
    'group_therapy', 'sud_individual', 'sud_group', 'sud_intake', 'prp', 'iop', 'php', 'crisis_followup', 'telephone', 'primary_care', 'tms',
    'spravato', 'treatment_plan_review', 'discharge', 'no_show', 'other',
  ];
  assert.deepEqual([...VISIT_KINDS].sort(), [...kinds].sort());
  const ids = new Set(REQUIREMENTS.map((r) => r.id));
  assert.equal(ids.size, REQUIREMENTS.length, 'requirement ids unique');
  for (const kind of kinds) {
    const p = PROTOCOLS[kind];
    assert.ok(p, `protocol for ${kind}`);
    assert.equal(p.kind, kind);
    assert.ok((NOTE_TYPES as readonly string[]).includes(p.noteType), `${kind}: note type ${p.noteType}`);
    const sections = NOTE_SECTIONS[p.noteType as (typeof NOTE_TYPES)[number]];
    const stepIds = new Set<string>();
    for (const { step } of p.steps) {
      assert.ok(!stepIds.has(step.id), `${kind}: duplicate step ${step.id}`);
      stepIds.add(step.id);
      if (step.source === 'note') assert.ok(sections.includes(step.noteSection!), `${kind}/${step.id}: section "${step.noteSection}" not in ${p.noteType}`);
      if (step.source === 'auto') assert.ok((AUTO_STEP_IDS as readonly string[]).includes(step.id), `${kind}/${step.id}: auto step without a chart check`);
      for (const b of step.basis ?? []) assert.ok(ids.has(b), `${kind}/${step.id}: unknown basis ${b}`);
      assert.ok(step.label.length <= 60, `${kind}/${step.id}: label too long`);
    }
    const phases = p.steps.map((s) => ['prepare', 'during', 'wrap_up'].indexOf(s.phase));
    assert.deepEqual(phases, [...phases].sort((a, b) => a - b), `${kind}: steps ordered prepare → during → wrap_up`);
  }
  for (const kind of ['sud_individual', 'sud_group', 'sud_intake'] as const) assert.equal(PROTOCOLS[kind].part2, true);
});

test('requirements: compliance-sensitive items carry the practice owner confirmation (2026-10-21)', () => {
  for (const id of ['md_pdmp', 'md_epcs', 'dea_telehealth', 'minor_consent_md', 'prp_comar', 'treatment_plan_review', 'spravato_rems']) {
    assert.equal(requirementById(id)?.confirmedBy, 'Practice owner', id);
    assert.equal(requirementById(id)?.confirmedOn, '2026-10-21', id);
    assert.notEqual(requirementById(id)?.confirm, true, `${id}: no longer shows "Confirm with compliance"`);
  }
  for (const id of ['tjc_suicide_screen', 'tjc_med_rec', 'tjc_mbc', 'hedis_ssd', 'hedis_apm', 'hedis_add', 'hedis_amm', 'hedis_fuh', 'part2_consent', 'cms_em_2021', 'cms_psychotherapy_time', 'telehealth_consent_location', 'asam', 'tms_course', 'sdoh_screen', 'discharge_aftercare', 'informed_consent_psychotropic', 'apa_aims', 'ada_apa_metabolic']) {
    assert.ok(requirementById(id), id);
  }
});

test('med management: PDMP required only with controlled meds; med rec and C-SSRS required', () => {
  const steps = PROTOCOLS.med_management.steps.map((s) => s.step);
  const pdmp = steps.find((s) => s.id === 'pdmp')!;
  assert.equal(pdmp.when, 'controlled_meds');
  assert.deepEqual(pdmp.basis, ['md_pdmp']);
  assert.equal(steps.find((s) => s.id === 'med_rec')!.level, 'required');
  assert.deepEqual(steps.find((s) => s.id === 'cssrs')!.basis, ['tjc_suicide_screen']);
  assert.equal(steps.find((s) => s.id === 'med_consent')!.when, 'new_med');
});

// ─── computeDueItems ──────────────────────────────────────────────────────────

const med = (name: string, extra: Partial<DueMed> = {}): DueMed => ({ ...classifyMed(name), name, startedAt: daysAgo(200), isNew: false, ...extra });

function facts(over: Partial<DueFacts> = {}): DueFacts {
  return {
    kind: 'med_management',
    ageYears: 40,
    isVirtual: false,
    timeZone: 'America/New_York',
    intervals: { phq9Days: 30, gad7Days: 30, aimsDays: 182, sdohDays: 365, pdmpDays: 90 },
    latest: { phq9: daysAgo(5), gad7: daysAgo(5), cssrs: NOW, aims: null, sdoh: daysAgo(30), auditC: null, glucoseOrA1c: daysAgo(30), lipids: daysAgo(30), pdmp: null },
    meds: [],
    standingLabs: [],
    labsAwaitingReview: 0,
    treatmentPlan: { status: 'ACTIVE', reviewDueAt: daysAgo(-60) },
    consents: { telehealth: true, part2: true, medication: true, minor: true, treatment: true },
    safetyPlanOnFile: true,
    riskLevel: 'low',
    pendingRenewals: 0,
    notPickedUp: [],
    ...over,
  };
}
const byId = (items: ReturnType<typeof computeDueItems>, id: string) => items.find((i) => i.id === id);

test('due: PDMP every 90 days on a benzodiazepine', () => {
  const none = computeDueItems(facts({ meds: [med('lorazepam 1 mg')] }), NOW);
  assert.equal(byId(none, 'pdmp')?.severity, 'due');
  assert.match(byId(none, 'pdmp')!.reason, /no PDMP query on file/);
  const old = computeDueItems(facts({ meds: [med('Xanax 0.5 mg')], latest: { ...facts().latest, pdmp: daysAgo(120) } }), NOW);
  assert.equal(byId(old, 'pdmp')?.severity, 'overdue');
  assert.match(byId(old, 'pdmp')!.reason, /120 days ago/);
  assert.deepEqual(byId(old, 'pdmp')!.basis, ['md_pdmp']);
  const recent = computeDueItems(facts({ meds: [med('clonazepam')], latest: { ...facts().latest, pdmp: daysAgo(30) } }), NOW);
  assert.equal(byId(recent, 'pdmp'), undefined);
  // Stimulant only: recommended info, not a requirement
  const stim = computeDueItems(facts({ meds: [med('Adderall XR 20 mg')] }), NOW);
  assert.equal(byId(stim, 'pdmp')?.severity, 'info');
  // No controlled meds: nothing
  assert.equal(byId(computeDueItems(facts({ meds: [med('sertraline')] }), NOW), 'pdmp'), undefined);
});

test('due: AIMS every 6 months on an antipsychotic', () => {
  const none = computeDueItems(facts({ meds: [med('quetiapine 100 mg')] }), NOW);
  assert.match(byId(none, 'aims')!.reason, /on quetiapine 100 mg; no AIMS on file/);
  const old = computeDueItems(facts({ meds: [med('Abilify')], latest: { ...facts().latest, aims: daysAgo(200) } }), NOW);
  assert.equal(byId(old, 'aims')?.severity, 'overdue');
  assert.match(byId(old, 'aims')!.reason, /200 days ago/);
  assert.equal(byId(computeDueItems(facts({ meds: [med('Abilify')], latest: { ...facts().latest, aims: daysAgo(100) } }), NOW), 'aims'), undefined);
  // Chart flag counts even when the name does not match
  assert.ok(byId(computeDueItems(facts({ meds: [{ ...med('Study drug X'), antipsychotic: true }] }), NOW), 'aims'));
  // Metabolic labs when none on file
  const noLabs = computeDueItems(facts({ meds: [med('olanzapine')], latest: { ...facts().latest, aims: daysAgo(10), glucoseOrA1c: null, lipids: null } }), NOW);
  assert.match(byId(noLabs, 'metabolic_glucose')!.reason, /no glucose or A1c result on file/);
  assert.ok(byId(noLabs, 'metabolic_lipids'));
  // Therapy visits do not carry prescriber monitoring items
  assert.equal(byId(computeDueItems(facts({ kind: 'therapy_individual', meds: [med('quetiapine')] }), NOW), 'aims'), undefined);
});

test('due: measure intervals and C-SSRS each BH visit', () => {
  const items = computeDueItems(facts({ kind: 'therapy_individual', latest: { ...facts().latest, phq9: daysAgo(41), gad7: null, cssrs: daysAgo(7) } }), NOW);
  assert.match(byId(items, 'phq9')!.reason, /last PHQ-9 41 days ago .*\(interval 30 days\)/);
  assert.equal(byId(items, 'phq9')!.severity, 'due');
  assert.match(byId(items, 'gad7')!.reason, /none on file/);
  assert.ok(byId(items, 'cssrs'));
  const fresh = computeDueItems(facts({ kind: 'therapy_individual' }), NOW);
  assert.equal(byId(fresh, 'phq9'), undefined);
  assert.equal(byId(fresh, 'cssrs'), undefined, 'C-SSRS recorded today');
  assert.equal(byId(computeDueItems(facts({ kind: 'telephone', latest: { ...facts().latest, cssrs: null } }), NOW), 'cssrs'), undefined);
});

test('due: telehealth consent, Part 2 consent, safety plan, treatment plan', () => {
  const tele = computeDueItems(facts({ isVirtual: true, consents: { ...facts().consents, telehealth: false } }), NOW);
  assert.match(byId(tele, 'telehealth_consent')!.reason, /no signed telehealth consent on file/);
  assert.equal(byId(computeDueItems(facts({ isVirtual: false, consents: { ...facts().consents, telehealth: false } }), NOW), 'telehealth_consent'), undefined);

  const sud = computeDueItems(facts({ kind: 'sud_individual', consents: { ...facts().consents, part2: false } }), NOW);
  assert.deepEqual(byId(sud, 'part2_consent')!.basis, ['part2_consent']);
  assert.equal(byId(computeDueItems(facts({ kind: 'therapy_individual', consents: { ...facts().consents, part2: false } }), NOW), 'part2_consent'), undefined);

  const risk = computeDueItems(facts({ riskLevel: 'high', safetyPlanOnFile: false }), NOW);
  assert.equal(byId(risk, 'safety_plan')!.severity, 'overdue');

  const plan = computeDueItems(facts({ kind: 'therapy_individual', treatmentPlan: { status: 'ACTIVE', reviewDueAt: daysAgo(10) } }), NOW);
  assert.match(byId(plan, 'treatment_plan')!.reason, /plan review was due/);
  assert.match(byId(computeDueItems(facts({ kind: 'therapy_individual', treatmentPlan: null }), NOW), 'treatment_plan')!.reason, /no active treatment plan on file/);
});

test('due: renewals, not picked up, standing labs, minors', () => {
  const items = computeDueItems(
    facts({
      pendingRenewals: 2,
      notPickedUp: [{ drug: 'sertraline 50 mg', date: daysAgo(3) }],
      standingLabs: [{ tests: ['Lithium level'], nextDueAt: daysAgo(5), active: true, endDate: null }],
      meds: [med('lithium carbonate 300 mg')],
    }),
    NOW
  );
  assert.match(byId(items, 'renewals')!.reason, /2 pharmacy refill request/);
  assert.ok(items.some((i) => /sertraline 50 mg not dispensed/.test(i.reason)));
  assert.ok(items.some((i) => i.label === 'Standing labs' && i.severity === 'overdue'));
  assert.equal(byId(items, 'lithium_level'), undefined, 'standing lithium order on file');
  const child = computeDueItems(facts({ ageYears: 9, consents: { ...facts().consents, minor: false }, meds: [med('methylphenidate', { startedAt: daysAgo(10), isNew: true })] }), NOW);
  assert.equal(byId(child, 'minor_consent')!.severity, 'due');
  assert.ok(child.some((i) => i.basis?.includes('hedis_add')));
  // Ordered overdue → due → info
  const rank = { overdue: 0, due: 1, info: 2 };
  const ranks = child.map((i) => rank[i.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

// ─── assembleGuide ────────────────────────────────────────────────────────────

function guideInput(over: Partial<GuideAssemblyInput> = {}): GuideAssemblyInput {
  return {
    kind: 'med_management',
    resolvedFrom: 'test',
    appointmentId: 'a1',
    clientId: 'c1',
    viewerAudience: 'prescriber',
    conditions: { controlled_meds: false, antipsychotic: false, minor: false, telehealth: false, new_med: false, elevated_risk: false },
    ageYears: 40,
    brief: { lastVisit: null, lastPlan: null, openFollowUps: [], scores: [], risk: { level: 'low', openAlerts: 0, safetyPlanOnFile: false }, meds: [], changesSinceLastVisit: [], careTeam: [] },
    due: [],
    autoChecks: {},
    marks: [],
    followUp: { medChange: false, elevatedRisk: false, nextBooked: null },
    ...over,
  };
}

test('guide: steps filtered by condition; auto and manual status; summary', () => {
  const g = assembleGuide(guideInput({ autoChecks: { cssrs: { done: true, detail: 'C-SSRS recorded today' } }, marks: [{ stepId: 'med_rec', status: 'done', reason: null }] }));
  assert.equal(g.steps.some((s) => s.id === 'pdmp'), false, 'no controlled meds → no PDMP step');
  assert.equal(g.steps.some((s) => s.id === 'telehealth_location'), false);
  assert.equal(g.steps.find((s) => s.id === 'cssrs')!.status, 'done');
  assert.equal(g.steps.find((s) => s.id === 'med_rec')!.status, 'done');
  assert.equal(g.steps.find((s) => s.id === 'side_effects')!.status, 'not_done');
  assert.equal(g.summary.required, g.steps.filter((s) => s.level === 'required').length);
  assert.equal(g.summary.requiredDone, 2);
  assert.ok(g.requirements.some((r) => r.id === 'tjc_med_rec'));
  assert.equal(g.followUp.suggestedDays, 28);

  const ctrl = assembleGuide(guideInput({ conditions: { ...guideInput().conditions, controlled_meds: true, telehealth: true }, followUp: { medChange: true, elevatedRisk: false, nextBooked: null } }));
  assert.ok(ctrl.steps.some((s) => s.id === 'pdmp'));
  assert.ok(ctrl.steps.some((s) => s.id === 'telehealth_location'));
  assert.ok(ctrl.requirements.some((r) => r.id === 'md_pdmp'));
  assert.equal(ctrl.followUp.suggestedDays, 14);

  // Therapist viewing a med visit: prescriber-only steps hidden
  const t = assembleGuide(guideInput({ viewerAudience: 'therapist', conditions: { ...guideInput().conditions, controlled_meds: true } }));
  assert.equal(t.steps.some((s) => s.id === 'pdmp'), false);
  // Deferred with a reason
  const d = assembleGuide(guideInput({ marks: [{ stepId: 'cssrs', status: 'deferred', reason: 'client left early' }] }));
  assert.equal(d.steps.find((s) => s.id === 'cssrs')!.status, 'deferred');
  assert.equal(d.steps.find((s) => s.id === 'cssrs')!.detail, 'client left early');
});

test('guide: child re-evaluation opens the child template; missing sections become manual ticks', () => {
  assert.equal(noteTypeFor('psych_reeval', 12), 'Child Psych Intake');
  assert.equal(noteTypeFor('psych_reeval', 30), 'Adult Psych Re-Eval');
  const g = assembleGuide(guideInput({ kind: 'psych_reeval', ageYears: 12 }));
  assert.equal(g.noteType, 'Child Psych Intake');
  const sections = NOTE_SECTIONS['Child Psych Intake'];
  for (const s of g.steps) if (s.source === 'note') assert.ok(sections.includes(s.noteSection!), s.id);
  assert.equal(g.steps.find((s) => s.id === 'measure_review')!.source, 'manual');
});

// ─── Access ───────────────────────────────────────────────────────────────────

test('access: who can open the guide / mark steps; /api/visits is client PHI', () => {
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'PHYSICIAN', 'MEDICAL_ASSISTANT', 'ADMIN']) assert.equal(canViewVisitGuide(r), true, r);
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'HR', 'PEER_SUPPORT']) assert.equal(canViewVisitGuide(r), false, r);
  assert.equal(canMarkVisitStep('PHYSICIAN', 'primary_care'), true);
  assert.equal(canMarkVisitStep('PHYSICIAN', 'med_management'), false);
  assert.equal(canMarkVisitStep('THERAPIST', 'therapy_individual'), true);
  assert.equal(canMarkVisitStep('OFFICE_MANAGER', 'therapy_individual'), false);
  assert.equal(canAccessApiPath('HR', '/api/visits/guide'), false);
  assert.equal(canAccessApiPath('THERAPIST', '/api/visits/guide'), true);
  assert.equal(canAccessApiPath('PSYCHIATRIST', '/api/visits/checklist', 'POST'), true);
  assert.equal(audienceForRole('NP'), 'prescriber');
  assert.equal(audienceForRole('ADMIN'), null);
});

test('routes: guide and checklist audit and gate; migration is idempotent', () => {
  const root = path.join(__dirname, '..');
  const guide = fs.readFileSync(path.join(root, 'src/app/api/visits/guide/route.ts'), 'utf8');
  const checklist = fs.readFileSync(path.join(root, 'src/app/api/visits/checklist/route.ts'), 'utf8');
  for (const src of [guide, checklist]) {
    assert.match(src, /requireOrgContext/);
    assert.match(src, /auditPhiAccess/);
  }
  assert.match(checklist, /resolveChartAccess/);
  assert.match(checklist, /reason is required/);
  const loader = fs.readFileSync(path.join(root, 'src/lib/visits/loader.ts'), 'utf8');
  assert.match(loader, /part2: false/);
  assert.match(loader, /resolveAccess/);
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20261021_visit_checklist.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS visit_checklist_items/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "visit_checklist_items_appointment_id_step_id_key"/);
  assert.doesNotMatch(sql, /CREATE TABLE visit_checklist_items/);
});

// ─── No appointment given (Scribe) ───────────────────────────────────────────

test('no appointment: today\'s own / current / next / most recent appointment stands in', () => {
  const at = (h: number, status: string, clinicianId = 'me', id = `${h}`) => ({ id, startsAt: new Date(`2026-10-20T${String(h).padStart(2, '0')}:00:00Z`), status, clinicianId });
  // next upcoming wins over an earlier completed one
  assert.equal(pickFallbackAppointment([at(13, 'COMPLETED'), at(17, 'SCHEDULED')], NOW, 'me')!.which, 'next');
  // checked-in / in-session first
  const cur = pickFallbackAppointment([at(14, 'IN_SESSION'), at(17, 'SCHEDULED')], NOW, 'me')!;
  assert.equal(cur.which, 'current');
  assert.equal(cur.appt.id, '14');
  // nothing upcoming → most recent earlier today
  const recent = pickFallbackAppointment([at(9, 'COMPLETED'), at(13, 'COMPLETED')], NOW, 'me')!;
  assert.equal(recent.which, 'most recent');
  assert.equal(recent.appt.id, '13');
  // the viewer's own appointment is preferred over another clinician's
  assert.equal(pickFallbackAppointment([at(16, 'SCHEDULED', 'other', 'theirs'), at(18, 'SCHEDULED', 'me', 'mine')], NOW, 'me')!.appt.id, 'mine');
  // missed / cancelled appointments never stand in
  assert.equal(pickFallbackAppointment([at(16, 'NO_SHOW'), at(17, 'CANCELLED'), at(18, 'LATE_CANCEL')], NOW, 'me'), null);
  assert.equal(pickFallbackAppointment([], NOW, 'me'), null);
});

test('no appointment: default kind by clinician role, with an explanation', () => {
  assert.equal(defaultKindForRole('PSYCHIATRIST')!.kind, 'med_management');
  assert.equal(defaultKindForRole('NP')!.kind, 'med_management');
  assert.equal(defaultKindForRole('THERAPIST')!.kind, 'therapy_individual');
  assert.equal(defaultKindForRole('CLINICIAN')!.kind, 'therapy_individual');
  assert.equal(defaultKindForRole('PHYSICIAN')!.kind, 'primary_care');
  assert.equal(defaultKindForRole('MEDICAL_NP')!.kind, 'primary_care');
  assert.match(defaultKindForRole('THERAPIST')!.resolvedFrom, /default for clinician role \(therapist\)/);
  assert.equal(defaultKindForRole('FRONT_DESK'), null);
  const loader = fs.readFileSync(path.join(__dirname, '..', 'src/lib/visits/loader.ts'), 'utf8');
  assert.match(loader, /pickFallbackAppointment/);
  assert.match(loader, /practiceTodayBounds/);
  assert.match(loader, /no appointment today/);
});

test('Visit Guide links: safety plan, treatment plans and labs honor ?clientId=', () => {
  const root = path.join(__dirname, '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const safety = read('src/app/dashboard/ehr/safety-plan/page.tsx');
  assert.match(safety, /get\('clientId'\)/);
  assert.match(safety, /clients\.find\(\(c\) => c\.id === requested\)/);
  const tp = read('src/app/dashboard/ehr/treatment-plans/page.tsx');
  assert.match(tp, /get\('clientId'\)/);
  assert.match(tp, /clientFilter && p\.clientId !== clientFilter/);
  const labs = read('src/app/dashboard/ehr/labs/page.tsx');
  assert.match(labs, /get\('clientId'\)/);
  assert.match(read('src/components/labs/LabWorklist.tsx'), /useLabOrders\(\{ program, clientId \}\)/);
});
