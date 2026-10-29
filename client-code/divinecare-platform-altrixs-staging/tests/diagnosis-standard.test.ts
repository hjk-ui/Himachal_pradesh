/**
 * Diagnosis workflow standard (src/lib/diagnoses): code validation against the FY2027 ICD-10-CM
 * set, ranking with exactly one primary, resolve-not-delete with history, review events, note
 * reminders, claim pointer selection, scrubber findings, Part 2 masking, audit coverage of the new
 * routes, and backfill parsing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import {
  applyOrder,
  canChangeStatus,
  currentInOrder,
  deriveLegacyFields,
  diagnosesForViewer,
  diagnosisNoteWarnings,
  isPart2SudCode,
  moveDiagnosis,
  normalizeRanks,
  parseLegacyDiagnoses,
  parseLegacyEntry,
  reviewState,
  type DiagnosisRow,
} from '../src/lib/diagnoses/model';
import { checkChartDiagnosisCode, claimDiagnosisFindings, isBehavioralHealthService, specificityAlternatives } from '../src/lib/diagnoses/rules';
import { DSM5TR_COMMON, dsmNameFor } from '../src/lib/diagnoses/dsm5tr';
import { planDiagnosisBackfill } from '../src/lib/diagnoses/backfill';
import { claimDiagnosesFromNote } from '../src/lib/billing/noteDiagnoses';
import { checkIcd10Code } from '../src/lib/icd10/validate';
import { canSeeBhDiagnoses } from '../src/lib/clients/chartSectionAccess';
import { canEditClientDiagnoses } from '../src/lib/clients/orgScope';
import { intakeDiagnosisReviewAction } from '../src/lib/notes/afterSign';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const row = (over: Partial<DiagnosisRow>): DiagnosisRow => ({
  id: 'x',
  code: 'F33.1',
  description: 'Major depressive disorder, recurrent, moderate',
  dsmName: null,
  rank: 1,
  isPrimary: false,
  status: 'ACTIVE',
  onsetDate: null,
  resolvedDate: null,
  statusReason: null,
  diagnosingProviderName: null,
  source: 'CLINICIAN',
  ...over,
});

// ─── Validation ─────────────────────────────────────────────────────────────

test('validation: valid, header, unspecified, unknown, manifestation-first and sex edits', () => {
  assert.deepEqual(checkChartDiagnosisCode('f331').issues, []);
  assert.equal(checkChartDiagnosisCode('F33.1').check.code, 'F33.1');

  const header = checkChartDiagnosisCode('F31.1');
  assert.equal(header.issues[0].id, 'code.header');
  assert.equal(header.issues[0].severity, 'warn');
  assert.ok(header.issues[0].alternatives!.some((a) => a.code === 'F31.11'), 'header lists its billable children');

  const unspecified = checkChartDiagnosisCode('F32.9');
  assert.equal(unspecified.issues[0].id, 'code.unspecified');
  assert.ok(unspecified.issues[0].alternatives!.some((a) => a.code === 'F32.1'));
  assert.ok(specificityAlternatives('F43.10').some((a) => a.code === 'F43.12'), 'PTSD unspecified → acute / chronic');

  const unknown = checkChartDiagnosisCode('Z99.999');
  assert.equal(unknown.issues[0].severity, 'block');
  assert.equal(checkChartDiagnosisCode('depression').issues[0].severity, 'block');

  assert.ok(checkChartDiagnosisCode('F02.80', { asPrimary: true }).issues.some((i) => i.id === 'seq.manifestation'));
  assert.ok(!checkChartDiagnosisCode('F02.80', { asPrimary: false }).issues.some((i) => i.id === 'seq.manifestation'));
  assert.ok(checkChartDiagnosisCode('F53.0', { sex: 'M' }).issues.some((i) => i.id === 'sex'));
  assert.ok(!checkChartDiagnosisCode('F53.0', { sex: 'F' }).issues.some((i) => i.id === 'sex'));
});

test('DSM-5-TR names: every code is a billable FY2027 ICD-10-CM code; no ICD-9 numbers on the reference page', () => {
  for (const e of DSM5TR_COMMON) {
    const c = checkIcd10Code(e.code, { requireBillable: true });
    assert.equal(c.status, 'ok', `${e.code}: ${c.message}`);
  }
  assert.equal(dsmNameFor('F31.81'), 'Bipolar II disorder');
  assert.equal(dsmNameFor('F34.0'), 'Cyclothymic disorder', 'cyclothymia is F34.0, not F31.81');
  const page = read('src/app/dashboard/ehr/diagnoses/page.tsx');
  assert.doesNotMatch(page, /dsm: '\d{3}\.\d+'/, 'DSM-IV / ICD-9 numbers removed');
  assert.match(page, /DSM5TR_COMMON/);
});

test('coding page no longer invents an ICD-10 code when the chart has none', () => {
  const src = read('src/app/dashboard/coding/page.tsx');
  assert.doesNotMatch(src, /primaryDiagnosisCode \|\| 'F/);
});

// ─── Ranking: exactly one primary ───────────────────────────────────────────

test('ranking: exactly one primary among current rows; non-current rows are never primary', () => {
  const rows = [
    row({ id: 'a', rank: 2 }),
    row({ id: 'b', rank: 1, code: 'F41.1' }),
    row({ id: 'c', rank: 1, code: 'F43.10', status: 'RESOLVED', isPrimary: true }),
    row({ id: 'd', rank: 3, code: 'F90.0', status: 'PROVISIONAL' }),
  ];
  const n = normalizeRanks(rows);
  assert.equal(n.filter((r) => r.isPrimary).length, 1);
  assert.equal(n.find((r) => r.isPrimary)!.id, 'b');
  assert.equal(n.find((r) => r.id === 'c')!.rank, 0);
  assert.equal(n.find((r) => r.id === 'c')!.isPrimary, false);

  const promoted = moveDiagnosis(rows, 'd', 'primary');
  assert.deepEqual(currentInOrder(promoted).map((r) => r.id), ['d', 'b', 'a']);
  assert.equal(promoted.filter((r) => r.isPrimary).length, 1);
  assert.deepEqual(currentInOrder(moveDiagnosis(rows, 'b', 'down')).map((r) => r.id), ['a', 'b', 'd']);
  assert.deepEqual(currentInOrder(moveDiagnosis(rows, 'b', 'up')).map((r) => r.id), ['b', 'a', 'd'], 'first stays first');
  assert.deepEqual(currentInOrder(applyOrder(rows, ['a', 'c', 'zzz'])).map((r) => r.id), ['a', 'b', 'd'], 'unknown / non-current ids ignored');
});

test('status changes: entered in error is final; reason-required statuses', () => {
  assert.equal(canChangeStatus('ACTIVE', 'RESOLVED'), true);
  assert.equal(canChangeStatus('RESOLVED', 'ACTIVE'), true, 'recurrence');
  assert.equal(canChangeStatus('ENTERED_IN_ERROR', 'ACTIVE'), false);
  assert.equal(canChangeStatus('ACTIVE', 'ACTIVE'), false);
  assert.equal(canChangeStatus('ACTIVE', 'DELETED'), false);
});

test('legacy client fields are derived from the current list (primary first, codes only for secondaries)', () => {
  const legacy = deriveLegacyFields([
    row({ id: 'a', rank: 2, code: 'F41.1', description: 'Generalized anxiety disorder' }),
    row({ id: 'b', rank: 1, code: 'F33.1', dsmName: 'Major depressive disorder, recurrent episode, moderate' }),
    row({ id: 'c', rank: 0, code: 'F43.10', status: 'RULED_OUT' }),
    row({ id: 'd', rank: 3, code: null, description: 'Insomnia, chronic' }),
  ]);
  assert.deepEqual(legacy, {
    primaryDiagnosisCode: 'F33.1',
    primaryDiagnosis: 'Major depressive disorder, recurrent episode, moderate',
    secondaryDiagnoses: 'F41.1, Insomnia chronic',
  });
  assert.deepEqual(deriveLegacyFields([]), { primaryDiagnosisCode: null, primaryDiagnosis: null, secondaryDiagnoses: null });
});

// ─── Backfill parsing ───────────────────────────────────────────────────────

test('backfill parsing: codes taken only where the text holds one; never guessed from words', () => {
  assert.deepEqual(parseLegacyEntry('F41.1'), { code: 'F41.1', description: '' });
  assert.deepEqual(parseLegacyEntry('f411 - Generalized anxiety disorder'), { code: 'F41.1', description: 'Generalized anxiety disorder' });
  assert.deepEqual(parseLegacyEntry('Generalized Anxiety Disorder (F41.1)'), { code: 'F41.1', description: 'Generalized Anxiety Disorder' });
  assert.deepEqual(parseLegacyEntry('Depression'), { code: null, description: 'Depression' });
  const parsed = parseLegacyDiagnoses({
    primaryDiagnosisCode: 'F33.1',
    primaryDiagnosis: 'MDD, recurrent, moderate',
    secondaryDiagnoses: 'Generalized Anxiety Disorder (F41.1), Insomnia (G47.00); F33.1, anxiety',
  });
  assert.deepEqual(parsed, [
    { code: 'F33.1', description: 'MDD, recurrent, moderate', rank: 1 },
    { code: 'F41.1', description: 'Generalized Anxiety Disorder', rank: 2 },
    { code: 'G47.00', description: 'Insomnia', rank: 3 },
    { code: null, description: 'anxiety', rank: 4 },
  ]);
  assert.deepEqual(parseLegacyDiagnoses({ primaryDiagnosisCode: 'Depression', primaryDiagnosis: null, secondaryDiagnoses: null }), [{ code: null, description: 'Depression', rank: 1 }]);

  const plan = planDiagnosisBackfill(
    { id: 'c1', sourcePlatform: 'valant', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: null, secondaryDiagnoses: 'F31.1, Z99.999, panic' },
    { hasList: false }
  );
  assert.equal(plan.action, 'create');
  if (plan.action === 'create') {
    assert.equal(plan.source, 'VALANT_IMPORT');
    assert.deepEqual(plan.counts, { coded: 3, uncoded: 1, notInCodeSet: 1, header: 1 });
    assert.equal(plan.entries[0].description, 'Major depressive disorder, recurrent, moderate', 'description from the code set');
  }
  assert.equal(planDiagnosisBackfill({ id: 'c2', sourcePlatform: null, primaryDiagnosisCode: 'F33.1', primaryDiagnosis: null, secondaryDiagnoses: null }, { hasList: true }).action, 'skip');
  const script = read('scripts/backfill-diagnoses.ts');
  assert.match(script, /const APPLY = process\.argv\.includes\('--apply'\)/, 'dry run by default');
  assert.doesNotMatch(script, /console\.log\([^)]*\b(name|code|description)\b/, 'counts only');
});

// ─── Review ─────────────────────────────────────────────────────────────────

test('review state: never reviewed is due; due after the interval; next review date', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  assert.equal(reviewState({ lastReviewedAt: null, now }).due, true);
  const recent = reviewState({ lastReviewedAt: '2026-09-01T12:00:00Z', lastReviewedBy: 'Dr A', intervalDays: 90, now });
  assert.equal(recent.due, false);
  assert.equal(recent.dueOn, '2026-11-30');
  const old = reviewState({ lastReviewedAt: '2026-05-01T12:00:00Z', intervalDays: 90, now });
  assert.equal(old.due, true);
  assert.ok(old.overdueDays > 0);
  assert.equal(reviewState({ lastReviewedAt: null, intervalDays: 180, now }).intervalDays, 180);
});

test('note sign reminders: warnings only (never block) for stale links, provisional first, review due', () => {
  const rows = [row({ id: 'a', code: 'F33.1', status: 'ACTIVE' }), row({ id: 'b', code: 'F41.1', status: 'RESOLVED' }), row({ id: 'c', code: 'F90.0', status: 'PROVISIONAL' })];
  const w = diagnosisNoteWarnings({ linkedCodes: ['F90.0', 'F41.1', 'F43.10'], rows, review: { due: true, lastReviewedAt: null, lastReviewedBy: null } });
  const ids = w.map((x) => x.id);
  assert.ok(ids.includes('dx.notCurrent.F411'));
  assert.ok(ids.includes('dx.notOnList.F4310'));
  assert.ok(ids.includes('dx.provisionalPrimary'));
  assert.ok(ids.includes('dx.reviewDue'));
  assert.ok(w.every((x) => x.severity === 'warn'));
  assert.deepEqual(diagnosisNoteWarnings({ linkedCodes: ['F43.10'], rows: [{ ...rows[0], legacy: true }], review: null }), [], 'legacy fallback rows: no list checks');
  const route = read('src/app/api/notes/[id]/standard/route.ts');
  assert.match(route, /diagnosisNoteWarnings\(/);
  assert.equal(intakeDiagnosisReviewAction({ clientId: 'c 1', noteType: 'Therapy Intake' })?.href, '/dashboard/clients/c%201?tab=diagnoses');
  assert.equal(intakeDiagnosisReviewAction({ clientId: 'c1', noteType: 'Therapy Progress' }), null);
});

// ─── Claims ─────────────────────────────────────────────────────────────────

test('claim pointers: the note’s linked diagnoses, primary first, max 12, line pointers max 4', () => {
  const codes = ['f33.1', 'F41.1', 'F41.1', 'bad', 'F43.10', 'F90.0', 'F42.2', 'F60.3', 'F31.81', 'F34.1', 'F40.10', 'F41.0', 'F43.22', 'F43.23', 'F63.81'];
  const r = claimDiagnosesFromNote(codes)!;
  assert.equal(r.codes[0], 'F33.1');
  assert.equal(r.codes.length, 12);
  assert.deepEqual(r.linePointers, [1, 2, 3, 4]);
  assert.equal(claimDiagnosesFromNote([]), null);
});

test('scrubber diagnosis findings: missing, invalid, status for the DOS, sequencing, BH primary', () => {
  const f = (codes: string[], chart: DiagnosisRow[] | null = null, dos = '2026-10-20', cpt = ['90837']) =>
    claimDiagnosisFindings({ codes, chart, cptCodes: cpt, dateOfService: dos });
  const codesOf = (x: ReturnType<typeof f>) => x.map((y) => `${y.code}:${y.severity}`);

  assert.deepEqual(codesOf(f([])), ['DX_PRIMARY_MISSING:error']);
  assert.deepEqual(codesOf(f(['F33.1'])), []);
  assert.ok(codesOf(f(['F31.1'])).includes('DX_PRIMARY_INVALID:error'), 'header code cannot be billed');
  assert.ok(codesOf(f(Array.from({ length: 13 }, () => 'F33.1'))).includes('DX_TOO_MANY:error'));
  assert.ok(codesOf(f(['F02.80', 'G30.9'])).includes('DX_PRIMARY_MANIFESTATION:error'));
  assert.ok(codesOf(f(['Z63.0'])).includes('DX_PRIMARY_NOT_BH:warning'));
  assert.ok(!codesOf(f(['Z63.0'], null, '2026-10-20', ['99213'])).includes('DX_PRIMARY_NOT_BH:warning'), 'medical E/M: no BH rule');
  assert.ok(codesOf(f(['F32.9'])).includes('DX_UNSPECIFIED:tip'));

  const chart = [
    row({ id: 'a', code: 'F33.1', status: 'RESOLVED', resolvedDate: '2026-10-01' }),
    row({ id: 'b', code: 'F41.1', status: 'RULED_OUT' }),
    row({ id: 'c', code: 'F90.0', status: 'PROVISIONAL', rank: 1, isPrimary: true }),
    row({ id: 'd', code: 'F43.10', status: 'RESOLVED', resolvedDate: '2026-10-25' }),
  ];
  assert.ok(codesOf(f(['F33.1'], chart)).includes('DX_PRIMARY_STATUS:error'), 'resolved before the DOS');
  assert.ok(!codesOf(f(['F43.10'], chart)).some((c) => c.startsWith('DX_PRIMARY_STATUS')), 'resolved after the DOS is still valid');
  assert.ok(codesOf(f(['F90.0', 'F41.1'], chart)).includes('DX_STATUS:warning'), 'ruled-out secondary');
  assert.ok(codesOf(f(['F90.0'], chart)).includes('DX_PRIMARY_PROVISIONAL:warning'));
  assert.ok(codesOf(f(['F42.2'], chart)).includes('DX_NOT_ON_CHART:warning'));
  assert.ok(!codesOf(f(['F42.2'], [{ ...chart[0], legacy: true }])).includes('DX_NOT_ON_CHART:warning'), 'no saved list: codes-only checks');
  assert.equal(isBehavioralHealthService('90834-95'), true);
  assert.equal(isBehavioralHealthService('H2017'), true);
  assert.equal(isBehavioralHealthService('99214'), false);
});

function loadWithMocks<T>(p: string, db: Record<string, unknown>): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async () => undefined };
    return originalLoad.call(this, id, ...args);
  };
  try {
    const req = createRequire(import.meta.url);
    // Fresh copies each time: the store is also pulled in (with another mock) by the scrubber
    delete req.cache[req.resolve(p)];
    delete req.cache[req.resolve('../src/lib/diagnoses/store')];
    return req(p) as T;
  } finally {
    loader._load = originalLoad;
  }
}

test('claim scrubber: a resolved primary on the chart is a scrub error', () => {
  const scrubber = loadWithMocks<typeof import('../src/lib/billing/claimScrubber')>('../src/lib/billing/claimScrubber', {});
  const claim = {
    id: 'cl1', clientId: 'c1', cptCode: '90837', units: 1, amountCents: 18000, payer: 'Maryland Medicaid', status: 'DRAFT' as const,
    submissionData: { diagnosisCodes: ['F33.1'], serviceDate: '2026-10-20' }, createdAt: new Date(), denialReason: null,
    client: { name: 'Client A', insuranceMemberId: 'M1', dateOfBirth: new Date('1990-01-01'), primaryDiagnosisCode: 'F33.1' },
    appointment: null,
    progressNote: null,
    serviceLines: [],
  };
  const clean = scrubber.evaluateClaimScrub(claim, { chartDiagnoses: [row({ code: 'F33.1', rank: 1, isPrimary: true })] });
  assert.ok(!clean.findings.some((x) => x.code.startsWith('DX_')));
  const resolved = scrubber.evaluateClaimScrub(claim, { chartDiagnoses: [row({ code: 'F33.1', status: 'RESOLVED', resolvedDate: '2026-09-01', rank: 0 })] });
  assert.ok(resolved.findings.some((x) => x.code === 'DX_PRIMARY_STATUS' && x.severity === 'error'));
  assert.equal(resolved.status, 'errors');
  const header = scrubber.evaluateClaimScrub({ ...claim, icd10Codes: ['F31.1'] });
  assert.ok(header.findings.some((x) => x.code === 'DX_PRIMARY_INVALID'), 'the claim column (837P source) is checked first');
});

// ─── Store: resolve-not-delete, one primary, history, review events ─────────

type Rec = Record<string, unknown> & { id: string };
function fakeDb() {
  let seq = 0;
  const dx: Rec[] = [];
  const events: Rec[] = [];
  const client: Rec = { id: 'c1', organizationId: 'org1', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'MDD recurrent moderate', secondaryDiagnoses: 'F41.1' };
  const match = (r: Rec, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(r[k]);
      return r[k] === v;
    });
  const checkPrimary = () => {
    const p = dx.filter((r) => r.isPrimary && r.clientId === 'c1');
    if (p.length > 1) throw Object.assign(new Error('unique primary'), { code: 'P2002' });
  };
  const db = {
    clientDiagnosis: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => dx.filter((r) => match(r, where)).sort((a, b) => Number(a.rank) - Number(b.rank) || String(a.createdAt).localeCompare(String(b.createdAt))).map((r) => ({ ...r })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r: Rec = { id: `d${++seq}`, dsmName: null, onsetDate: null, resolvedDate: null, statusReason: null, diagnosingProviderName: null, isPrimary: false, rank: 1, status: 'ACTIVE', source: 'CLINICIAN', createdAt: new Date(Date.now() + seq).toISOString(), updatedAt: new Date(), ...data };
        dx.push(r);
        checkPrimary();
        return { ...r };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = dx.find((x) => x.id === where.id)!;
        Object.assign(r, data, { updatedAt: new Date() });
        checkPrimary();
        return { ...r };
      },
      delete: async () => {
        throw new Error('diagnoses must never be deleted');
      },
    },
    clientDiagnosisEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push({ id: `e${events.length + 1}`, createdAt: new Date(), ...data });
        return {};
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => [...events].reverse().find((e) => match(e, where)) ?? null,
      findMany: async () => [...events].reverse(),
    },
    client: {
      findFirst: async () => ({ ...client }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(client, data),
    },
    notePolicySettings: { findUnique: async () => ({ diagnosisReviewDays: 90 }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, dx, events, client };
}

test('store: legacy record becomes the list on first write; add / resolve / review keep history and one primary', async () => {
  const { db, dx, events, client } = fakeDb();
  const store = loadWithMocks<typeof import('../src/lib/diagnoses/store')>('../src/lib/diagnoses/store', db);
  const actor = { organizationId: 'org1', userId: 'u1', name: 'Dr A, MD' };

  const before = await store.loadDiagnosisList('org1', 'c1');
  assert.equal(before.structured, false);
  assert.deepEqual(before.rows.map((r) => [r.code, r.isPrimary, r.legacy]), [['F33.1', true, true], ['F41.1', false, true]]);

  const added = await store.addDiagnosis(actor, 'c1', { code: 'F43.10', makePrimary: true });
  assert.equal(added.ok, true);
  assert.equal(dx.length, 3, 'two carried over + one added');
  assert.equal(dx.filter((r) => r.isPrimary).length, 1);
  assert.equal(client.primaryDiagnosisCode, 'F43.10', 'derived client field follows the list');
  assert.equal(client.secondaryDiagnoses, 'F33.1, F41.1');
  assert.ok(events.some((e) => e.action === 'IMPORTED') && events.some((e) => e.action === 'ADDED'));

  const dup = await store.addDiagnosis(actor, 'c1', { code: 'F33.1' });
  assert.equal(dup.ok, false);
  assert.equal(dup.ok === false && dup.status, 409);
  const bad = await store.addDiagnosis(actor, 'c1', { code: 'Z99.999' });
  assert.equal(bad.ok === false && bad.status, 400);

  const primaryId = dx.find((r) => r.isPrimary)!.id;
  const noReason = await store.updateDiagnosis(actor, 'c1', primaryId, { status: 'RESOLVED' });
  assert.equal(noReason.ok, false, 'resolving needs a reason');
  const resolved = await store.updateDiagnosis(actor, 'c1', primaryId, { status: 'RESOLVED', statusReason: 'Symptoms remitted', resolvedDate: '2026-10-20' });
  assert.equal(resolved.ok, true);
  assert.equal(dx.length, 3, 'nothing deleted');
  const resolvedRow = dx.find((r) => r.id === primaryId)!;
  assert.equal(resolvedRow.status, 'RESOLVED');
  assert.equal(resolvedRow.isPrimary, false);
  assert.equal(dx.filter((r) => r.isPrimary).length, 1, 'next diagnosis became primary');
  assert.equal(client.primaryDiagnosisCode, 'F33.1');
  assert.ok(events.some((e) => e.action === 'STATUS' && e.reason === 'Symptoms remitted'));

  const eie = dx.find((r) => r.code === 'F41.1')!.id;
  assert.equal((await store.updateDiagnosis(actor, 'c1', eie, { status: 'ENTERED_IN_ERROR', statusReason: 'Wrong chart' })).ok, true);
  assert.equal((await store.updateDiagnosis(actor, 'c1', eie, { status: 'ACTIVE' })).ok, false, 'entered in error is final');

  const reviewed = await store.recordDiagnosisReview(actor, 'c1', { context: 'treatment_plan_review' });
  assert.equal(reviewed.ok, true);
  const rv = events.filter((e) => e.action === 'REVIEWED');
  assert.equal(rv.length, 1);
  assert.equal(rv[0].context, 'treatment_plan_review');
  assert.equal(rv[0].actorName, 'Dr A, MD');
  const state = await store.loadReviewState('org1', 'c1');
  assert.equal(state.due, false);
  assert.equal(state.lastReviewedBy, 'Dr A, MD');
});

test('store: profile-form edit adds / resolves through the list instead of overwriting it', async () => {
  const { db, dx, client } = fakeDb();
  const store = loadWithMocks<typeof import('../src/lib/diagnoses/store')>('../src/lib/diagnoses/store', db);
  const actor = { organizationId: 'org1', userId: 'u1', name: 'Dr A' };
  const res = await store.applyLegacyDiagnosisEdit(actor, 'c1', { primaryDiagnosisCode: 'F41.1', primaryDiagnosis: 'GAD', secondaryDiagnoses: 'F90.0' });
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.added, 1);
  assert.equal(res.ok && res.resolved, 1, 'F33.1 no longer named: resolved, not deleted');
  assert.equal(client.primaryDiagnosisCode, 'F41.1');
  assert.equal(dx.find((r) => r.code === 'F33.1')!.status, 'RESOLVED');
});

// ─── Access, Part 2, audit, never delete ────────────────────────────────────

test('access: HR, Front Desk, billing and primary care roles do not read the BH list; only licensed BH / leadership write', () => {
  for (const r of ['HR', 'FRONT_DESK', 'BILLING', 'MEDICAL_ASSISTANT']) assert.equal(canSeeBhDiagnoses(r), false, r);
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'PRACTICE_DIRECTOR']) assert.equal(canSeeBhDiagnoses(r), true, r);
  assert.equal(canEditClientDiagnoses('CASE_MANAGER'), false);
  assert.equal(canEditClientDiagnoses('THERAPIST'), true);
  const gate = read('src/lib/diagnoses/routeGate.ts');
  assert.match(gate, /resolveChartAccess\(/, 'org + care team + Part 2 sensitive-record gate');
  assert.match(gate, /SENSITIVE_RECORD/);
  assert.match(gate, /canSeeBhDiagnoses\(gate\.role\)/);
  assert.match(gate, /canEditClientDiagnoses\(gate\.role\)/);
});

test('Part 2: SUD codes recognized (tobacco excluded); locked viewers get no diagnoses anywhere', () => {
  assert.equal(isPart2SudCode('F11.20'), true);
  assert.equal(isPart2SudCode('f1020'), true);
  assert.equal(isPart2SudCode('F17.210'), false, '42 CFR 2.11 excludes tobacco');
  assert.equal(isPart2SudCode('F33.1'), false);
  assert.deepEqual(diagnosesForViewer([row({})], { locked: true }), []);
  assert.equal(diagnosesForViewer([row({})], { locked: false }).length, 1);
  const overview = read('src/app/api/ehr/diagnoses/overview/route.ts');
  assert.match(overview, /diagnoses: locked \? \[\]/);
});

test('audit + never delete: every diagnosis route audits; DELETE answers 405; the store never deletes', () => {
  for (const p of [
    'src/app/api/clients/[id]/diagnoses/route.ts',
    'src/app/api/clients/[id]/diagnoses/[diagnosisId]/route.ts',
    'src/app/api/clients/[id]/diagnoses/history/route.ts',
    'src/app/api/clients/[id]/diagnoses/suggestions/route.ts',
  ]) assert.match(read(p), /auditPhiAccess\(/, p);
  assert.match(read('src/app/api/clients/[id]/diagnoses/[diagnosisId]/route.ts'), /status: 405/);
  assert.doesNotMatch(read('src/lib/diagnoses/store.ts'), /clientDiagnosis\.delete/);
  const sql = read('prisma/migrations/20261025_diagnosis_list.sql');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagnosis_one_primary_per_client"[\s\S]*WHERE "isPrimary" = true/);
  assert.doesNotMatch(sql, /\bDROP\b/);
  assert.match(read('src/app/api/clients/[id]/route.ts'), /applyLegacyDiagnosisEdit\(/, 'profile edits go through the list');
});
