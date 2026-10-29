import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import {
  antidepressantGeneric,
  asamLevelNumber,
  extractIcdCodes,
  parseAsamFromNote,
  prpDiagnosis,
} from '../src/lib/clinical/serviceEligibility/codes';
import { tmsTrialRule } from '../src/lib/clinical/serviceEligibility/criteria';
import {
  antidepressantTrials,
  evaluateAot,
  evaluatePrp,
  evaluateResidential,
  evaluateSpravato,
  evaluateTms,
  isCurrent,
  type ChartDx,
  type ChartMed,
  type ClientChart,
} from '../src/lib/clinical/serviceEligibility/rules';
import { chartDiagnoses, runServiceEligibilityScan, type EligibilityDb } from '../src/lib/clinical/serviceEligibility/load';
import { radarRedirectTarget, SUD_RADAR_HREF } from '../src/lib/clinical/serviceEligibility/routes';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { CLINIC_ROLES } from '../src/types/roles';

// Synthetic ids and values only; no real patient data.

const NOW = new Date('2026-10-17T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const dx = (code: string, source: ChartDx['source'] = 'primary', label: string | null = null): ChartDx => ({ code, label, source, date: null });
const med = (name: string, startDaysAgo: number, endDaysAgo: number | null, extra: Partial<ChartMed> = {}): ChartMed => ({
  name,
  genericName: null,
  brandName: null,
  startDate: daysAgo(startDaysAgo),
  endDate: endDaysAgo === null ? null : daysAgo(endDaysAgo),
  active: endDaysAgo === null,
  status: endDaysAgo === null ? 'active' : 'discontinued',
  stopReason: null,
  ...extra,
});

function chart(over: Partial<ClientChart> = {}): ClientChart {
  return {
    id: 'c1',
    dateOfBirth: new Date('1985-03-01T00:00:00Z'),
    insurancePayer: 'Maryland Medicaid',
    insuranceType: 'Medicaid',
    diagnoses: [],
    problemCount: 1,
    meds: [],
    allergies: [],
    phq9: null,
    cssrs: null,
    locus: null,
    sudIntake: null,
    sudSignals: [],
    crisisEpisodes: [],
    prpEnrollment: null,
    prpReferral: null,
    spravatoEnrollment: null,
    tmsCourse: null,
    aotParticipant: null,
    residentialResident: null,
    ...over,
  };
}

// ─── Codes ───────────────────────────────────────────────────────────────────

test('ICD extraction, antidepressant names and ASAM note parsing read only charted text', () => {
  assert.deepEqual(extractIcdCodes('F33.2, f20.0; Z95.0 and F32A'), ['F33.2', 'F20.0', 'Z95.0', 'F32.A']);
  assert.deepEqual(extractIcdCodes(null), []);
  assert.equal(antidepressantGeneric('Lexapro 10 mg'), 'escitalopram');
  assert.equal(antidepressantGeneric(null, 'Sertraline HCl'), 'sertraline');
  assert.equal(antidepressantGeneric('Contrave (naltrexone/bupropion)'), null);
  assert.equal(antidepressantGeneric('Lisinopril'), null);
  const body = [
    'ASAM Dimensions',
    'Dimension 1 — Acute intoxication / withdrawal potential: 1 (mild)',
    'Dimension 2 — Biomedical conditions & complications: 0 (no risk)',
    'Dimension 3 — Emotional, behavioral or cognitive conditions: 2 (moderate)',
    'Dimension 4 — Readiness to change: 3 (significant)',
    'Dimension 5 — Relapse / continued use potential: 3 (significant)',
    'Dimension 6 — Recovery / living environment: 3 (significant)',
    'Recommended level of care: ASAM 3.5 High-intensity residential',
  ].join('\n');
  const a = parseAsamFromNote(body);
  assert.deepEqual(a.ratings, { 1: 1, 2: 0, 3: 2, 4: 3, 5: 3, 6: 3 });
  assert.equal(asamLevelNumber(a.levelOfCare), 3.5);
  assert.equal(asamLevelNumber('ASAM 1 Outpatient'), 1);
  assert.equal(prpDiagnosis('F20.0')?.onClinicList, true);
  assert.equal(prpDiagnosis('F41.1')?.category, 'B');
  assert.equal(prpDiagnosis('F21')?.onClinicList, false);
  assert.equal(prpDiagnosis('F90.0'), null);
});

test('chart diagnoses merge primary, secondary and active problem-list codes without duplicates', () => {
  const list = chartDiagnoses(
    { primaryDiagnosis: 'Major depressive disorder, recurrent, severe', primaryDiagnosisCode: 'F33.2', secondaryDiagnoses: 'F10.20, F33.2' },
    [
      { icd10Code: 'I67.1', name: 'Cerebral aneurysm', status: 'Active', onsetDate: null, createdAt: daysAgo(10) },
      { icd10Code: 'G40.909', name: 'Epilepsy', status: 'Resolved', onsetDate: null, createdAt: daysAgo(10) },
    ]
  );
  assert.deepEqual(list.map((d) => d.code), ['F33.2', 'F10.20', 'I67.1']);
  assert.equal(list[0].label, 'Major depressive disorder, recurrent, severe');
});

// ─── PRP ─────────────────────────────────────────────────────────────────────

test('PRP: SMI + LOCUS at threshold + Medicaid → candidate; no impairment evidence → diagnosis only; no list dx → not indicated', () => {
  const base = { diagnoses: [dx('F20.0')], locus: { composite: 18, level: 'Level 3', date: daysAgo(30) } };
  const cand = evaluatePrp(chart(base), NOW);
  assert.equal(cand.status, 'candidate');
  assert.ok(cand.met.some((m) => m.includes('F20.0')));
  assert.ok(cand.evidence.some((e) => e.kind === 'locus' && e.text.includes('18')));

  const noLocus = evaluatePrp(chart({ diagnoses: [dx('F20.0')] }), NOW);
  assert.equal(noLocus.status, 'screen', 'SMI diagnosis without impairment documentation is diagnosis-only');
  assert.ok(noLocus.missing.some((m) => /LOCUS/.test(m)));

  const low = evaluatePrp(chart({ ...base, locus: { composite: 12, level: 'Level 1', date: daysAgo(30) } }), NOW);
  assert.equal(low.status, 'potential');
  assert.ok(low.unmet.some((m) => /below the clinic threshold/.test(m)));

  assert.equal(evaluatePrp(chart({ ...base, diagnoses: [dx('F41.9')] }), NOW).status, 'not_indicated', 'F41.9 never qualifies alone');
  assert.equal(evaluatePrp(chart({ diagnoses: [dx('F41.1')] }), NOW).status, 'not_indicated', 'GAD without impairment does not qualify');
  assert.equal(evaluatePrp(chart({ ...base, diagnoses: [dx('F41.1')] }), NOW).status, 'candidate', 'Category B + documented impairment');

  assert.equal(evaluatePrp(chart({ diagnoses: [dx('F90.0')] }), NOW).status, 'not_indicated');
  assert.equal(evaluatePrp(chart(), NOW).status, 'not_indicated');
});

test('PRP: enrolled exclusion, ended enrollment, conflicting residential and non-Medicaid payer', () => {
  const base = { diagnoses: [dx('F25.0')], locus: { composite: 20, level: 'Level 4', date: daysAgo(10) } };
  assert.equal(evaluatePrp(chart({ ...base, prpEnrollment: { status: 'active', date: daysAgo(5) } }), NOW).status, 'enrolled');
  assert.equal(evaluatePrp(chart({ ...base, prpEnrollment: { status: 'discharged', date: daysAgo(400) } }), NOW).status, 'candidate');
  const res = evaluatePrp(chart({ ...base, residentialResident: { program: '3.5', date: daysAgo(3) } }), NOW);
  assert.equal(res.status, 'potential');
  assert.ok(res.flags.some((f) => /Conflicting service/.test(f)));
  const comm = evaluatePrp(chart({ ...base, insurancePayer: 'Aetna', insuranceType: 'Commercial' }), NOW);
  assert.ok(comm.confirm.some((c) => /not recorded as Maryland Medicaid/.test(c)));
});

// ─── Spravato ────────────────────────────────────────────────────────────────

test('Spravato: two adequate antidepressant trials → candidate; one trial → potential (missing); SI pathway', () => {
  const meds = [med('Sertraline', 200, 120), med('Lexapro', 100, null)];
  const trd = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds }), NOW);
  assert.equal(trd.status, 'candidate');
  assert.ok(trd.met.some((m) => /Treatment-resistant: 2/.test(m)));
  assert.equal(trd.evidence.filter((e) => e.kind === 'medication').length, 2);
  assert.ok(trd.confirm.some((c) => /REMS/.test(c)));

  const one = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds: [med('Sertraline', 200, 120), med('Bupropion', 20, null)] }), NOW);
  assert.equal(one.status, 'potential');
  assert.ok(one.missing.some((m) => /1 with ≥6 weeks on record, 1 short, unknown-duration or not counted/.test(m)));

  const si = evaluateSpravato(chart({ diagnoses: [dx('F32.2')], cssrs: { severity: 'HIGH Suicide Risk', safetyFlagged: true, date: daysAgo(3) } }), NOW);
  assert.equal(si.status, 'candidate');
  assert.ok(si.flags.some((f) => /988/.test(f)));
  const oldSi = evaluateSpravato(chart({ diagnoses: [dx('F32.2')], cssrs: { severity: 'HIGH Suicide Risk', safetyFlagged: true, date: daysAgo(90) } }), NOW);
  assert.equal(oldSi.status, 'screen', 'no medication history and no acute SI: diagnosis only');
});

test('Spravato: contraindications, minors, no problem list, no MDD and enrolled', () => {
  const meds = [med('Sertraline', 200, 120), med('Escitalopram', 100, null)];
  const contra = evaluateSpravato(chart({ diagnoses: [dx('F33.2'), dx('I67.1', 'problem-list')], meds }), NOW);
  assert.equal(contra.status, 'not_indicated');
  assert.ok(contra.flags.some((f) => /Cerebral aneurysm/.test(f)));
  const allergy = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds, allergies: [{ allergen: 'Ketamine', status: 'Active' }] }), NOW);
  assert.equal(allergy.status, 'not_indicated');
  assert.equal(evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds, dateOfBirth: new Date('2012-01-01') }), NOW).status, 'not_indicated');
  const noProblems = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds, problemCount: 0 }), NOW);
  assert.equal(noProblems.status, 'potential');
  assert.ok(noProblems.missing.some((m) => /No problem list/.test(m)));
  const noDob = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds, dateOfBirth: null }), NOW);
  assert.ok(noDob.missing.some((m) => /Date of birth/.test(m)));
  assert.equal(evaluateSpravato(chart({ diagnoses: [dx('F41.1')] }), NOW).status, 'not_indicated');
  assert.equal(evaluateSpravato(chart({ diagnoses: [dx('F33.42')] }), NOW).status, 'not_indicated', 'remission is not active MDD');
  assert.equal(evaluateSpravato(chart({ diagnoses: [dx('F33.2')], spravatoEnrollment: { status: 'induction', date: daysAgo(4) } }), NOW).status, 'enrolled');
});

test('antidepressant trials: one per drug, longest duration, entered-in-error skipped', () => {
  const trials = antidepressantTrials(
    [med('Zoloft', 30, 20), med('Sertraline', 300, 200), med('Prozac', 100, 10, { status: 'entered in error' })],
    NOW
  );
  assert.equal(trials.length, 1);
  assert.equal(trials[0].generic, 'sertraline');
  assert.equal(trials[0].days, 100);
  assert.equal(trials[0].adequateDuration, true);
});

// ─── TMS ─────────────────────────────────────────────────────────────────────

test('TMS: Medicare (Novitas) one trial → candidate; unknown payer needs two; payer rule raises the count', () => {
  const meds = [med('Fluoxetine', 200, 100)];
  const c = evaluateTms(chart({ diagnoses: [dx('F33.2')], meds, insurancePayer: 'Medicare', insuranceType: 'Medicare' }), NOW);
  assert.equal(c.status, 'candidate');
  assert.ok(c.confirm.some((x) => /L34998/.test(x)));
  assert.equal(tmsTrialRule('UnitedHealthcare').minTrials, 4);
  assert.equal(tmsTrialRule('Unknown Plan').minTrials, 2, 'payers without a rule: two trials (commercial standard)');
  assert.equal(tmsTrialRule('Medicare').minTrials, 1);
  const medicaidOne = evaluateTms(chart({ diagnoses: [dx('F33.2')], meds }), NOW);
  assert.equal(medicaidOne.status, 'potential', 'one trial is not enough without a payer rule');
  assert.ok(medicaidOne.missing.some((m) => /1 of 2/.test(m)));
  const uhc = evaluateTms(chart({ diagnoses: [dx('F33.2')], meds, insurancePayer: 'UnitedHealthcare', insuranceType: 'Commercial' }), NOW);
  assert.equal(uhc.status, 'potential');
  assert.ok(uhc.missing.some((m) => /1 of 4/.test(m)));
  const intol = evaluateTms(chart({ diagnoses: [dx('F33.2')], insurancePayer: 'Medicare', insuranceType: 'Medicare', meds: [med('Venlafaxine', 20, 10, { stopReason: 'Intolerance — nausea' })] }), NOW);
  assert.equal(intol.status, 'candidate');
});

test('TMS: severity from PHQ-9, moderate codes, contraindications and enrollment', () => {
  const meds = [med('Fluoxetine', 200, 100), med('Sertraline', 90, null)];
  const phq = evaluateTms(chart({ diagnoses: [dx('F32.9')], meds, phq9: { score: 22, date: daysAgo(10) } }), NOW);
  assert.equal(phq.status, 'candidate');
  assert.ok(phq.met.some((m) => /PHQ-9 22/.test(m)));
  const unspecified = evaluateTms(chart({ diagnoses: [dx('F32.9')], meds }), NOW);
  assert.equal(unspecified.status, 'potential');
  assert.ok(unspecified.missing.some((m) => /severity not established/.test(m)));
  const moderate = evaluateTms(chart({ diagnoses: [dx('F33.1')], meds }), NOW);
  assert.equal(moderate.status, 'potential');
  assert.ok(moderate.unmet.some((m) => /requires severe MDD/.test(m)));
  const implant = evaluateTms(chart({ diagnoses: [dx('F33.2'), dx('Z95.0', 'problem-list')], meds }), NOW);
  assert.equal(implant.status, 'not_indicated');
  const seizure = evaluateTms(chart({ diagnoses: [dx('F33.2'), dx('G40.909', 'problem-list')], meds }), NOW);
  assert.equal(seizure.status, 'potential');
  assert.ok(seizure.flags.some((f) => /Relative contraindication: Epilepsy/.test(f)));
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F33.2')], tmsCourse: { status: 'active', date: daysAgo(3) } }), NOW).status, 'enrolled');
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F33.2')], meds, tmsCourse: { status: 'completed', date: daysAgo(300) } }), NOW).status, 'candidate');
  assert.equal(isCurrent('archived'), false);
  assert.equal(isCurrent('active'), true);
});

// ─── AOT ─────────────────────────────────────────────────────────────────────

test('AOT: SMI → review with chart context only; no SMI → not indicated; participant → enrolled', () => {
  const r = evaluateAot(chart({ diagnoses: [dx('F20.0')], crisisEpisodes: [{ date: daysAgo(100) }, { date: daysAgo(400) }, { date: daysAgo(2000) }] }), NOW);
  assert.equal(r.status, 'review');
  assert.equal(r.evidence.filter((e) => e.kind === 'crisis').length, 2, 'two crisis episodes inside 36 months');
  assert.ok(r.met.some((m) => /2 acute psychiatric events/.test(m)));
  assert.ok(r.confirm.some((c) => /never file a petition/.test(c)));
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F41.1')] }), NOW).status, 'not_indicated');
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F31.2')], aotParticipant: { status: 'petition' } }), NOW).status, 'enrolled');
});

// ─── Residential ─────────────────────────────────────────────────────────────

const intake = (levelOfCare: string | null, ratings: Record<number, number> = { 1: 1, 2: 0, 3: 2, 4: 3, 5: 3, 6: 3 }) => ({
  asam: { ratings, levelOfCare },
  date: daysAgo(20),
  noteId: 'n1',
});

test('Residential: SUD dx + intake recommending 3.5 → candidate; missing intake → potential; lower level → not indicated', () => {
  const c = evaluateResidential(chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 3.5 High-intensity residential') }), NOW);
  assert.equal(c.status, 'candidate');
  assert.ok(c.evidence.some((e) => e.kind === 'note' && /D1 1/.test(e.text)));
  const none = evaluateResidential(chart({ diagnoses: [dx('F11.20')] }), NOW);
  assert.equal(none.status, 'potential');
  assert.ok(none.missing.some((m) => /Substance Abuse Intake/.test(m)));
  assert.equal(evaluateResidential(chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 1 Outpatient') }), NOW).status, 'not_indicated');
  const wm = evaluateResidential(chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 3.5 High-intensity residential', { 1: 3, 2: 0, 3: 2, 4: 3, 5: 3, 6: 3 }) }), NOW);
  assert.equal(wm.status, 'potential');
  assert.ok(wm.flags.some((f) => /withdrawal management/.test(f)));
});

test('Residential: nicotine / remission excluded, radar-only signal, enrolled resident', () => {
  assert.equal(evaluateResidential(chart({ diagnoses: [dx('F17.210')] }), NOW).status, 'not_indicated');
  assert.equal(evaluateResidential(chart({ diagnoses: [dx('F10.21')] }), NOW).status, 'not_indicated');
  const radar = evaluateResidential(chart({ sudSignals: [{ condition: 'Alcohol use language', routedAction: 'residential-referral', date: daysAgo(2) }] }), NOW);
  assert.equal(radar.status, 'potential');
  assert.ok(radar.evidence.some((e) => e.href === SUD_RADAR_HREF));
  assert.equal(evaluateResidential(chart({ diagnoses: [dx('F10.20')], residentialResident: { program: '3.1', date: daysAgo(9) } }), NOW).status, 'enrolled');
});

// ─── Scan: scoping, Part 2, set-based loading ────────────────────────────────

function mockDb(clients: any[], calls: Record<string, any[]>) {
  const rec = (name: string, rows: (where: any) => any[]) => ({
    findMany: async (args: any) => {
      (calls[name] ??= []).push(args);
      return rows(args.where);
    },
  });
  const ids = (w: any): string[] => w.clientId?.in ?? [];
  return {
    client: {
      findMany: async (args: any) => {
        (calls.client ??= []).push(args);
        const start = args.cursor ? clients.findIndex((c) => c.id === args.cursor.id) + 1 : 0;
        return clients.slice(start, start + args.take);
      },
    },
    medicalProblem: rec('medicalProblem', (w) => (ids(w).includes('a') ? [{ clientId: 'a', icd10Code: 'I10', name: 'Hypertension', status: 'Active', onsetDate: null, createdAt: daysAgo(50) }] : [])),
    clientMedication: rec('clientMedication', (w) =>
      ids(w).includes('a') ? [{ clientId: 'a', medicationName: 'Sertraline', drugName: null, genericName: null, brandName: null, startDate: daysAgo(300), endDate: null, stopDate: daysAgo(200), active: false, status: 'discontinued', stopReason: null }] : []
    ),
    medicalAllergy: rec('medicalAllergy', () => []),
    clinicalAssessmentRecord: rec('clinicalAssessmentRecord', () => []),
    locusAssessmentRecord: rec('locusAssessmentRecord', () => []),
    progressNote: rec('progressNote', () => []),
    sudRadarSignal: rec('sudRadarSignal', () => []),
    crisisEpisode: rec('crisisEpisode', () => []),
    prpEnrollment: rec('prpEnrollment', (w) => (ids(w).includes('b') ? [{ clientId: 'b', status: 'active', startDate: daysAgo(10), createdAt: daysAgo(10) }] : [])),
    prpReferral: rec('prpReferral', () => []),
    spravatoEnrollment: rec('spravatoEnrollment', () => []),
    tmsCourse: rec('tmsCourse', () => []),
    aotParticipant: rec('aotParticipant', () => []),
    residentialResident: rec('residentialResident', () => []),
  } as unknown as EligibilityDb;
}

const clientRow = (id: string, code: string | null) => ({
  id, name: `Synthetic ${id.toUpperCase()}`, mrn: null, dateOfBirth: new Date('1980-01-01'), insurancePayer: 'Medicare', insuranceType: 'Medicare',
  primaryDiagnosis: null, primaryDiagnosisCode: code, secondaryDiagnoses: null, assignedTo: { id: 'u1', name: 'Clin' }, location: null,
});

test('scan: caseload scope passed through, active only, protected clients dropped before clinical reads, batched IN queries', async () => {
  const calls: Record<string, any[]> = {};
  const db = mockDb([clientRow('a', 'F33.2'), clientRow('b', 'F20.0'), clientRow('locked', 'F33.2'), clientRow('d', 'J45.909')], calls);
  const scope = { AND: [{ organizationId: 'org' }, { assignedToId: 'therapist-1' }] };
  const res = await runServiceEligibilityScan({
    db, organizationId: 'org', clientWhere: scope, now: NOW, batchSize: 2,
    lockedIds: async (ids) => new Set(ids.filter((i) => i === 'locked')),
  });
  assert.deepEqual(calls.client[0].where, { AND: [scope, { status: 'ACTIVE' }] });
  assert.equal(calls.client.length, 3, 'two full batches + final empty read');
  assert.equal(calls.clientMedication.length, 2, 'one medication query per batch, not per client');
  assert.ok(calls.clientMedication.every((a) => !a.where.clientId.in.includes('locked')), 'protected client rows never read');
  assert.ok(calls.prpEnrollment.every((a) => a.where.organizationId === 'org'));
  assert.equal(res.sensitiveHidden, 1);
  assert.equal(res.clientsScanned, 3);
  assert.equal(res.notIndicatedOnly, 1, 'asthma-only client returns nothing');
  assert.deepEqual(res.clients.map((c) => c.id), ['a', 'b']);
  assert.equal(res.clients.find((c) => c.id === 'b')!.results.prp.status, 'enrolled');
  assert.equal(res.counts.prp.enrolled, 1);
  assert.equal(res.clients.find((c) => c.id === 'a')!.results.tms.status, 'candidate');
});

/** Prisma fake for the snapshot path: scan (via mockDb), lock transaction, snapshot store, runs, decisions, fees. */
function snapshotPrisma(clients: any[], calls: Record<string, any[]>, opts: { locked?: boolean } = {}) {
  const base: any = mockDb(clients, calls);
  const store = new Map<string, any>();
  const scanClientFindMany = base.client.findMany;
  base.client = {
    findMany: async (args: any) => {
      if (args.take !== undefined) return scanClientFindMany(args);
      (calls.clientRead ??= []).push(args);
      return clients.map((c) => ({ id: c.id, name: c.name, mrn: c.mrn, assignedTo: c.assignedTo, location: c.location }));
    },
  };
  base.serviceEligibilitySnapshot = {
    findFirst: async () => (store.size ? [...store.values()][0] : null),
    findMany: async () => [...store.values()],
    deleteMany: async (a: any) => {
      for (const k of [...store.keys()]) {
        const r = store.get(k);
        if (a.where.clientId?.in ? a.where.clientId.in.includes(r.clientId) : a.where.NOT ? r.runId !== a.where.NOT.runId : true) store.delete(k);
      }
      return { count: 0 };
    },
    createMany: async (a: any) => {
      for (const d of a.data) store.set(d.clientId, d);
      return { count: a.data.length };
    },
  };
  base.serviceEligibilityScanRun = {
    create: async () => ({ id: 'run-1' }),
    update: async (a: any) => ((calls.runUpdate ??= []).push(a), {}),
    findFirst: async () => null,
  };
  base.serviceEligibilityDecision = { findMany: async () => [] };
  base.feeScheduleItem = { findMany: async () => [] };
  base.$transaction = async (arg: any) => (typeof arg === 'function' ? arg({ $queryRaw: async () => [{ locked: opts.locked ?? true }] }) : Promise.all(arg));
  base.$executeRaw = async () => 0;
  return { db: base, store };
}

test('GET service-eligibility: role gate, caseload scope, first visit scans into the snapshot, counts-only audit', async (t) => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  t.after(() => {
    loader._load = originalLoad;
  });
  const calls: Record<string, any[]> = {};
  const audits: any[] = [];
  let role = 'BILLING';
  const { db, store } = snapshotPrisma([clientRow('a', 'F33.2'), clientRow('z', 'J45.909')], calls);
  loader._load = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => ({ ok: true, userId: 'therapist-1', organizationId: 'org', role }) };
    if (id === '@/lib/audit/requestMeta') return { auditPhiAccess: async (a: any) => { audits.push(a); } };
    if (id === '@/lib/privacy/sensitiveAccess') return { lockedSensitiveClientIds: async () => new Set<string>() };
    if (id === '@/lib/time/practiceTimeServer') return { getPracticeTimeZone: async () => 'America/New_York' };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  const route = require('../src/app/api/ehr/scanner/service-eligibility/route');
  const denied = await route.GET(new Request('http://localhost/api/ehr/scanner/service-eligibility'));
  assert.equal(denied.status, 403);
  role = 'THERAPIST';
  const res = await route.GET(new Request('http://localhost/api/ehr/scanner/service-eligibility'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(store.size, 2, 'every scanned client gets a snapshot row (not-indicated ones too)');
  assert.deepEqual(body.rows.map((r: any) => r.id), ['a'], 'only clients with an indicated program are listed');
  assert.equal(body.notIndicatedOnly, 1);
  assert.equal(body.rows[0].statuses.tms, 'candidate', 'Medicare payer: one adequate trial meets L34998');
  assert.ok(!('results' in body.rows[0]), 'list rows carry statuses only; evidence loads per client');
  assert.ok(JSON.stringify(calls.client[0].where).includes('"assignedToId":"therapist-1"'), 'caseload role scans only assigned clients');
  assert.ok(JSON.stringify(calls.clientRead[0].where).includes('"assignedToId":"therapist-1"'), 'and reads only assigned clients');
  const list = audits.find((a) => a.action === 'LIST');
  assert.ok(list && audits.some((a) => a.action === 'CREATE' && a.resourceType === 'serviceEligibilityScan'));
  assert.ok(!JSON.stringify(audits).includes('Synthetic'), 'audit carries counts only');
  // Second visit reads the snapshot without scanning
  const before = calls.client.length;
  const again = await route.GET(new Request('http://localhost/api/ehr/scanner/service-eligibility'));
  assert.equal(again.status, 200);
  assert.equal(calls.client.length, before, 'no re-scan on a normal visit');
});

// ─── Routes, nav and links ───────────────────────────────────────────────────

test('scanner and radar pages: same access rule, old radar deep links redirect, links point at the radar page', () => {
  for (const role of CLINIC_ROLES) {
    assert.equal(canAccessPath(role, SUD_RADAR_HREF), canAccessPath(role, '/dashboard/ehr/scanner'), role);
  }
  assert.equal(radarRedirectTarget({ tab: 'sud-radar' }), SUD_RADAR_HREF);
  assert.equal(radarRedirectTarget({ view: 'radar' }), SUD_RADAR_HREF);
  assert.equal(radarRedirectTarget({ radar: '1' }), SUD_RADAR_HREF);
  assert.equal(radarRedirectTarget({ service: 'AOT' }), null);
  assert.equal(radarRedirectTarget({}), null);

  const root = path.join(__dirname, '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const nav = read('src/components/layout/navConfig.ts');
  assert.match(nav, /href: '\/dashboard\/ehr\/scanner',\s*label: 'Service Eligibility Scanner'/);
  assert.match(nav, /href: '\/dashboard\/ehr\/scanner\/sud-radar',\s*label: 'SUD Referral Radar'/);
  assert.match(nav, /label: 'SUD Screeners'/);
  for (const f of ['src/lib/inbox/loaders.ts', 'src/lib/dashboard/homeTiles.ts', 'src/app/dashboard/ehr/assessments/sud/page.tsx']) {
    assert.ok(read(f).includes('/dashboard/ehr/scanner/sud-radar'), `${f} links the radar page`);
  }
  assert.ok(read('src/app/dashboard/ehr/scanner/sud-radar/page.tsx').includes('<SudReferralRadar />'));
  const scanner = read('src/app/dashboard/ehr/scanner/page.tsx');
  assert.ok(scanner.includes('ServiceEligibilityScanner') && !scanner.includes('PATIENTS'));
});
