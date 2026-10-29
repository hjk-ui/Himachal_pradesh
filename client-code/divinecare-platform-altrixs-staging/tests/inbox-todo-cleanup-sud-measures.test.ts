import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  SUD_MEASURES,
  SUD_MEASURE_KEYS,
  assignmentSummary,
  openMeasuresByClient,
  parseSudMeasureKeys,
  planSudMeasureAssignments,
} from '../src/lib/clinical/sudRadar/measures';
import { assignSudMeasures, type MeasureDb } from '../src/lib/clinical/sudRadar/assignMeasures';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import {
  LIKELY_INACTIVE_DAYS,
  buildSessionFrequencyItem,
  isLikelyInactive,
  redactLockedItem,
  summarizeByClinician,
  summarizeSessionFrequency,
  type ClientCadenceInput,
} from '../src/lib/clinical/sessionFrequency';
import { planDischargeReviews, DISCHARGE_REVIEW_REASON } from '../src/lib/clinical/dischargeReview';
import { applyPart2, loadAllSections, loadSection, splitGroups, summarizeInbox, type InboxDeps } from '../src/lib/inbox/core';
import { INBOX_SECTIONS } from '../src/lib/inbox/sections';
import type { InboxDraft, InboxSectionKey } from '../src/lib/inbox/types';
import {
  filesForEveryone,
  myPatientsDefault,
  placeInboxDocument,
  routesPlanReviewTo,
  routesPriorAuthTo,
} from '../src/lib/worklists/ownership';

// Synthetic ids and names only; no real patient data.

const NOW = new Date('2026-10-23T16:00:00Z');
const read = (p: string) => readFileSync(p, 'utf8');
const dayAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ymdAgo = (n: number) => dayAgo(n).toISOString().slice(0, 10);

// ─── 6. Substance-use measures from the SUD Referral Radar ──────────────────────

test('the four measures, pre-ticked in order; BAM repeats every 30 days, screens are one-time', () => {
  assert.deepEqual([...SUD_MEASURE_KEYS], ['AUDIT', 'CAGE-AID', 'NIDA-ASSIST', 'BAM']);
  assert.equal(SUD_MEASURES.find((m) => m.key === 'BAM')?.frequency, 'monthly');
  for (const k of ['AUDIT', 'CAGE-AID', 'NIDA-ASSIST']) assert.equal(SUD_MEASURES.find((m) => m.key === k)?.frequency, 'once');
  assert.deepEqual(parseSudMeasureKeys(['BAM', 'nope', 'AUDIT', 'BAM']), ['AUDIT', 'BAM']);
  assert.deepEqual(parseSudMeasureKeys('AUDIT'), []);
});

test('assignment never duplicates an open measure; paused schedules do not block', () => {
  const existing = [
    { scheduleId: 's1', patientId: 'c1', measure: 'AUDIT', active: true },
    { scheduleId: 's2', patientId: 'c1', measure: 'BAM', active: false },
    { scheduleId: 's3', patientId: 'c2', measure: 'PHQ-9', active: true },
    'garbage',
  ];
  assert.deepEqual([...(openMeasuresByClient(existing).get('c1') ?? [])], ['AUDIT']);
  const plan = planSudMeasureAssignments({
    existing,
    clients: [{ id: 'c1', name: 'Client One' }, { id: 'c2', name: 'Client Two' }, { id: 'c1', name: 'Client One' }],
    measures: ['AUDIT', 'BAM'],
    today: '2026-10-23',
    actorUserId: 'u1',
    trigger: 'manual',
    nowIso: NOW.toISOString(),
    idSeed: 'x',
  });
  assert.deepEqual(plan.add.map((a) => `${a.patientId}:${a.measure}:${a.frequency}`), ['c1:BAM:monthly', 'c2:AUDIT:once', 'c2:BAM:monthly']);
  assert.deepEqual(plan.skipped, [{ clientId: 'c1', measure: 'AUDIT', reason: 'already_assigned' }]);
  assert.ok(plan.add.every((a) => a.active && a.source === 'sud-radar' && a.nextSendDate === '2026-10-23' && a.assignedById === 'u1'));
  assert.match(assignmentSummary(plan), /Assigned 3 measures to 2 clients .*1 already assigned, skipped/);
  assert.match(assignmentSummary({ add: [], skipped: [{}] }), /already assigned/);
});

function memoryDb(initial: { clientId: string; instrumentId: string; status?: string }[]) {
  // measure_assignments in memory, with the unique (organizationId, activeKey) the table has
  const rows: { clientId: string; instrumentId: string; status: string; activeKey: string | null; source?: string }[] = initial.map((r) => ({
    status: 'active',
    activeKey: `${r.clientId}:${r.instrumentId}`,
    ...r,
  }));
  const db = {
    measureAssignment: {
      findMany: async ({ where }: { where: { clientId: { in: string[] }; status: string } }) =>
        rows.filter((r) => where.clientId.in.includes(r.clientId) && r.status === where.status).map((r) => ({ clientId: r.clientId, instrumentId: r.instrumentId })),
      createMany: async ({ data, skipDuplicates }: { data: { clientId: string; instrumentId: string; status: string; activeKey: string; source: string }[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const d of data) {
          if (rows.some((r) => r.activeKey && r.activeKey === d.activeKey)) {
            if (!skipDuplicates) throw Object.assign(new Error('unique'), { code: 'P2002' });
            continue;
          }
          rows.push({ ...d });
          count++;
        }
        return { count };
      },
    },
  };
  return { db: db as unknown as MeasureDb, rows };
}

test('assignSudMeasures writes measure_assignments (source sud_radar), skips open measures and audits each client', async () => {
  const mem = memoryDb([{ clientId: 'c1', instrumentId: 'cage-aid' }, { clientId: 'c9', instrumentId: 'gad-7' }]);
  const audits: { action: string; patientId?: string | null; metadata?: unknown }[] = [];
  const plan = await assignSudMeasures({
    organizationId: 'org',
    actor: { userId: 'u1', role: 'NP' },
    clients: [{ id: 'c1', name: 'Client One' }],
    measures: [...SUD_MEASURE_KEYS],
    trigger: 'manual',
    db: mem.db,
    audit: (async (e: { action: string; patientId?: string | null; metadata?: unknown }) => {
      audits.push(e);
    }) as never,
    now: NOW,
  });
  assert.deepEqual(plan.add.map((a) => a.measure), ['AUDIT', 'NIDA-ASSIST', 'BAM']);
  // the other client's row is untouched; c1 now has all four open
  assert.ok(mem.rows.some((r) => r.clientId === 'c9'));
  assert.deepEqual(mem.rows.filter((r) => r.clientId === 'c1').map((r) => r.instrumentId).sort(), ['audit', 'bam', 'cage-aid', 'nida-assist']);
  assert.ok(mem.rows.filter((r) => r.clientId === 'c1' && r.instrumentId !== 'cage-aid').every((r) => r.source === 'sud_radar'));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'SUD_MEASURES_ASSIGNED');
  assert.equal(audits[0].patientId, 'c1');
  assert.deepEqual((audits[0].metadata as { measures: string[] }).measures, ['AUDIT', 'NIDA-ASSIST', 'BAM']);

  // Second run: everything is open, nothing is written or audited
  const again = await assignSudMeasures({
    organizationId: 'org', actor: { userId: 'u1', role: 'NP' }, clients: [{ id: 'c1', name: 'Client One' }],
    measures: [...SUD_MEASURE_KEYS], trigger: 'auto', db: mem.db, audit: (async () => { audits.push({ action: 'x' }); }) as never, now: NOW,
  });
  assert.equal(again.add.length, 0);
  assert.equal(again.skipped.length, 4);
  assert.equal(audits.length, 1);
  assert.equal(mem.rows.filter((r) => r.clientId === 'c1').length, 4);
});

test('instruments: AUDIT and CAGE-AID have real items and scoring; NM ASSIST and BAM are pending licensed copy', () => {
  const byId = new Map(ASSESSMENT_CATALOG.map((i) => [i.id, i]));
  const audit = byId.get('audit')!;
  assert.equal(audit.questions?.length, 10);
  assert.equal(audit.maxScore, 40);
  assert.deepEqual(audit.scoreRanges?.map((r) => [r.min, r.max]), [[0, 7], [8, 15], [16, 19], [20, 40]]);
  assert.equal(audit.calculateResult({ q1: 4, q2: 4, q3: 4, q4: 4, q5: 4 }).severity, 'Possible Dependence');
  assert.equal(audit.calculateResult({ q1: 2, q2: 3, q3: 3 }).severity, 'Hazardous');
  const cage = byId.get('cage-aid')!;
  assert.equal(cage.questions?.length, 4);
  assert.ok(cage.questions!.every((q) => q.options.length === 2));
  assert.equal(cage.calculateResult({ q1: 1, q2: 1 }).severity, 'Screen Positive');
  assert.equal(cage.calculateResult({ q1: 1 }).severity, 'Screen Negative');
  for (const id of ['nida-assist', 'bam']) {
    const i = byId.get(id)!;
    assert.equal(i.itemContentPending, true, id);
    assert.equal(i.hasDigitalQuestionnaire, false, id);
    assert.deepEqual(i.scoreRanges, [], id);
    assert.match(i.description, /Item content pending licensed copy/);
    assert.equal(i.calculateResult({ q1: 3 }).severity, 'Scoring pending licensed copy');
  }
});

test('radar: button, bulk action, dialog and the leadership setting (default off) are wired', () => {
  const ui = read('src/components/clinical/SudReferralRadar.tsx');
  assert.match(ui, /Assign substance-use measures/);
  assert.match(ui, /Select all shown/);
  assert.match(ui, /\/api\/ehr\/scanner\/sud-radar\/measures/);
  assert.match(ui, /routedAction !== 'tobacco-cessation'/);
  const route = read('src/app/api/ehr/scanner/sud-radar/measures/route.ts');
  assert.match(route, /canUseSudRadar/);
  assert.match(route, /clientAccessWhere/);
  assert.match(route, /lockedSensitiveClientIds/);
  assert.match(route, /radarSignals: \{ some:/);
  const scan = read('src/lib/clinical/sudRadar/scan.ts');
  assert.match(scan, /autoAssignMeasures/);
  assert.match(scan, /trigger: 'auto'/);
  assert.match(read('src/app/api/ehr/scanner/run-ai-scan/route.ts'), /practiceSudRadarAutoAssign/);
  assert.match(read('scripts/sud-radar-scan.ts'), /practiceSudRadarAutoAssign/);
  assert.match(read('prisma/schema.prisma'), /sudRadarAutoAssignMeasures Boolean\s+@default\(false\)/);
  assert.match(read('prisma/migrations/20261023_sud_radar_auto_measures.sql'), /ADD COLUMN IF NOT EXISTS "sudRadarAutoAssignMeasures" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(read('src/lib/practice/settings.ts'), /sudRadarAutoAssignMeasures: z\.boolean\(\)\.default\(false\)/);
  assert.match(read('src/app/dashboard/practice-setup/_components/sections.tsx'), /Auto-assign substance-use measures when a patient appears on the SUD Referral Radar/);
});

// ─── 7a. Session frequency: likely inactive ─────────────────────────────────────

function cadence(id: string, lastDaysAgo: number | null, lastContact: string | null | undefined, assignedToId: string | null = 'u1'): ClientCadenceInput {
  return {
    clientId: id,
    clientName: `Client ${id}`,
    locked: false,
    assignedToId,
    assignedToName: assignedToId ? 'Clinician One' : null,
    locationId: null,
    locationName: null,
    riskLevel: 'LOW',
    plans: [],
    auths: [],
    evidence: lastDaysAgo == null ? [] : [{ at: dayAgo(lastDaysAgo), serviceType: 'therapy', source: 'appointment' }],
    scheduled: [],
    unconfirmedPastAppointments: 0,
    unknownTypeVisits: 0,
    authNotes: [],
    lastContact,
  };
}

test('280 days overdue with no contact in 180 days is "likely inactive", not overdue; badge counts active only', () => {
  assert.equal(LIKELY_INACTIVE_DAYS, 180);
  const stale = buildSessionFrequencyItem(cadence('a', 290, null), NOW);
  const recentContact = buildSessionFrequencyItem(cadence('b', 290, ymdAgo(20)), NOW);
  const activeOverdue = buildSessionFrequencyItem(cadence('c', 30, ymdAgo(30)), NOW);
  const notLoaded = buildSessionFrequencyItem(cadence('d', 290, undefined), NOW);
  const unassignedStale = buildSessionFrequencyItem(cadence('e', null, null, null), NOW);
  assert.equal(stale.bucket, 'likely_inactive');
  assert.equal(recentContact.bucket, 'overdue');
  assert.equal(activeOverdue.bucket, 'overdue');
  assert.equal(notLoaded.bucket, 'overdue', 'contact data missing: never hidden');
  assert.equal(unassignedStale.bucket, 'likely_inactive');
  const summary = summarizeSessionFrequency([stale, recentContact, activeOverdue, notLoaded, unassignedStale]);
  assert.equal(summary.overdue, 3);
  assert.equal(summary.likely_inactive, 2);
  const row = summarizeByClinician([stale, activeOverdue]).find((r) => r.id === 'u1')!;
  assert.equal(row.counts.likely_inactive, 1);
  assert.equal(row.compliancePct, 0);
  assert.equal(redactLockedItem({ ...stale, locked: true }).lastContact, undefined);
  // a booked visit keeps the client active
  assert.equal(isLikelyInactive(null, { therapy: '2026-11-01', medManagement: null }, NOW), false);
  assert.equal(isLikelyInactive(ymdAgo(181), { therapy: null, medManagement: null }, NOW), true);
  assert.equal(isLikelyInactive(ymdAgo(179), { therapy: null, medManagement: null }, NOW), false);
});

test('discharge review: opens planning cases for the group only, skips open cases and protected rows', () => {
  const items = [
    buildSessionFrequencyItem(cadence('a', 290, null), NOW),
    buildSessionFrequencyItem(cadence('b', 290, null), NOW),
    { ...buildSessionFrequencyItem(cadence('p', 290, null), NOW), locked: true },
    buildSessionFrequencyItem(cadence('c', 30, ymdAgo(30)), NOW),
  ];
  const plan = planDischargeReviews({ items, existingCases: [{ clientId: 'b', status: 'planning' }, { clientId: 'a', status: 'discharged' }] });
  assert.deepEqual(plan.start.map((i) => i.clientId), ['a']);
  assert.deepEqual(plan.alreadyOpen, ['b']);
  assert.equal(plan.skippedProtected, 1);
  assert.deepEqual(planDischargeReviews({ items, existingCases: [], requested: ['c'] }).start, []);
  assert.match(DISCHARGE_REVIEW_REASON, /likely inactive/);
  const route = read('src/app/api/clinical/session-frequency/discharge-review/route.ts');
  assert.match(route, /createBlankDischarge/);
  assert.doesNotMatch(route, /status: 'discharged'/);
  assert.match(read('src/features/caseload/sessionFrequency.tsx'), /Mark inactive \/ discharge review/);
});

// ─── 7a/7b. Inbox groups: collapsed, not counted ────────────────────────────────

function draft(over: Partial<InboxDraft> = {}): InboxDraft {
  return {
    entityKey: 'x:1', title: 'Item', detail: 'detail', clientId: 'c1', clientName: 'Client One',
    priority: 'normal', since: null, href: '/dashboard', hrefLabel: 'Open', action: null, ...over,
  };
}

function fakeDeps(data: Partial<Record<InboxSectionKey, InboxDraft[]>>, locked: string[] = []): InboxDeps {
  const loaders = Object.fromEntries(INBOX_SECTIONS.map((s) => [s.key, async () => ({ drafts: data[s.key] ?? [] })])) as unknown as InboxDeps['loaders'];
  return { loaders, lockedClientIds: async () => new Set(locked) };
}

test('grouped rows (likely inactive, Valant import, all documents) are collapsed and excluded from counts', async () => {
  const deps = fakeDeps(
    {
      session_frequency: [
        draft({ entityKey: 'sessionFrequency:a', priority: 'high' }),
        draft({ entityKey: 'sessionFrequency:b', priority: 'low', group: 'likely_inactive' }),
        draft({ entityKey: 'sessionFrequency:p', clientId: 'cp', priority: 'low', group: 'likely_inactive' }),
      ],
      documents: [
        draft({ entityKey: 'docIntake:1' }),
        draft({ entityKey: 'docIntake:2', clientId: null, group: 'valant_import' }),
        draft({ entityKey: 'docIntake:3', clientId: null, group: 'all_documents' }),
      ],
    },
    ['cp']
  );
  const actor = { organizationId: 'org', userId: 'u', role: 'ADMIN' };
  const sf = await loadSection(actor, 'session_frequency', deps, NOW);
  assert.equal(sf.items.length, 1);
  assert.deepEqual(sf.groups?.map((g) => [g.key, g.items.length]), [['likely_inactive', 2]]);
  // a masked (Part 2) row stays in its group
  assert.ok(sf.groups![0].items.some((i) => i.protected));
  const docs = await loadSection(actor, 'documents', deps, NOW);
  assert.equal(docs.items.length, 1);
  assert.deepEqual(docs.groups?.map((g) => g.key), ['valant_import', 'all_documents']);
  const summary = summarizeInbox(await loadAllSections(actor, deps, NOW), NOW);
  assert.equal(summary.sections.find((s) => s.key === 'session_frequency')?.count, 1);
  assert.equal(summary.sections.find((s) => s.key === 'documents')?.count, 1);
  const split = splitGroups(applyPart2('documents', [draft({ group: 'valant_import' })], new Set()));
  assert.equal(split.items.length, 0);
  assert.equal(split.groups[0].label, 'Valant import — needs review');
});

test('inbox loaders: overdue vs likely inactive, document placement, To-Do my patients, dismissed notes', () => {
  const src = read('src/lib/inbox/loaders.ts');
  assert.match(src, /bucket === 'likely_inactive'/);
  assert.match(src, /group: 'likely_inactive'/);
  assert.match(src, /placeInboxDocument/);
  assert.match(src, /isValantImport: d\.source === VALANT_DOC_SOURCE/);
  assert.match(src, /myPatientsDefault\(a\.role\) \? all\.filter\(\(t\) => t\.mine !== false\)/);
  assert.match(src, /dismissedAt: null/);
  const page = read('src/app/dashboard/inbox/page.tsx');
  assert.match(page, /All documents/);
  assert.match(page, /<details/);
  assert.match(page, /localStorage/);
});

test('documents: own patients or own uploads by default; All documents and the Valant pile only for filing roles', () => {
  const ctxClinician = { userId: 'np', fileForAll: false, myClientIds: new Set(['c1']) };
  const ctxLead = { userId: 'lead', fileForAll: true, myClientIds: new Set<string>() };
  const valantMine = { isValantImport: true, suggestedClientId: 'c1', uploadedById: 'admin' };
  const valantPile = { isValantImport: true, suggestedClientId: null, uploadedById: 'np' };
  const fax = { isValantImport: false, suggestedClientId: 'c2', uploadedById: null };
  const myUpload = { isValantImport: false, suggestedClientId: null, uploadedById: 'np' };
  assert.equal(placeInboxDocument(valantMine, ctxClinician), 'mine');
  assert.equal(placeInboxDocument(valantPile, ctxClinician), null, 'the import runner does not own the pile');
  assert.equal(placeInboxDocument(fax, ctxClinician), null);
  assert.equal(placeInboxDocument(myUpload, ctxClinician), 'mine');
  assert.equal(placeInboxDocument(valantPile, ctxLead), 'valant_import');
  assert.equal(placeInboxDocument(fax, ctxLead), 'all_documents');
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.ok(filesForEveryone(r), r);
  for (const r of ['NP', 'PSYCHIATRIST', 'THERAPIST']) assert.ok(!filesForEveryone(r), r);
});

// ─── 7c. My To-Do routing ───────────────────────────────────────────────────────

test('prior auths go to billing / front desk / office manager / leadership, prescribers only for their own requests', () => {
  for (const r of ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.ok(routesPriorAuthTo(r, 'x', { createdById: 'someone' }), r);
  assert.equal(routesPriorAuthTo('NP', 'np1', { createdById: 'billing1' }), false);
  assert.equal(routesPriorAuthTo('THERAPIST', 't1', { createdById: null }), false);
  assert.equal(routesPriorAuthTo('PSYCHIATRIST', 'p1', { createdById: 'p1' }), true);
});

test('treatment plan reviews go to the owner (author, else assigned clinician) and their supervisor', () => {
  const none = new Set<string>();
  assert.equal(routesPlanReviewTo('NP', 'np1', { clinicianId: 'th1', clientAssignedToId: 'th1' }, none), false);
  assert.equal(routesPlanReviewTo('NP', 'np1', { clinicianId: 'np1' }, none), true, 'a prescriber who owns the plan');
  assert.equal(routesPlanReviewTo('THERAPIST', 'th1', { clinicianId: 'th1' }, none), true);
  assert.equal(routesPlanReviewTo('THERAPIST', 'th1', { clinicianId: null, clientAssignedToId: 'th1' }, none), true);
  assert.equal(routesPlanReviewTo('THERAPIST', 'sup', { clinicianId: 'th2' }, new Set(['th2'])), true);
  assert.equal(routesPlanReviewTo('THERAPIST', 'th3', { clinicianId: 'th2' }, none), false);
  assert.equal(routesPlanReviewTo('PRACTICE_DIRECTOR', 'lead', { clinicianId: 'th2' }, none), true);
});

test('"My patients only" defaults on for clinical roles and is remembered per user; tasks carry mine', () => {
  for (const r of ['NP', 'PSYCHIATRIST', 'THERAPIST', 'CLINICIAN', 'CASE_MANAGER']) assert.ok(myPatientsDefault(r), r);
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER']) assert.ok(!myPatientsDefault(r), r);
  const manage = read('src/lib/tasks/manage.ts');
  assert.match(manage, /routesPriorAuthTo\(input\.actorRole, input\.actorUserId, \{ createdById: auth\.createdById \}\)/);
  assert.match(manage, /routesPlanReviewTo\(/);
  assert.match(manage, /supervisionTrack/);
  assert.match(manage, /ownCaseloadClientWhere\(input\.actorRole, input\.actorUserId\)/);
  assert.match(manage, /t\.mine = /);
  // dismissed notes never count in the queues
  assert.match(manage, /note: \{ client: clientWhere, dismissedAt: null/);
  assert.equal((manage.match(/progressNotes: \{ none: \{ dismissedAt: null \} \}/g) ?? []).length, 2);
  assert.match(manage, /countUnsignedNotes[\s\S]*?dismissedAt: null/);
  const page = read('src/app/dashboard/tasks/page.tsx');
  assert.match(page, /My patients only/);
  assert.match(page, /altrixs\.tasks\.myPatientsOnly\.v1/);
  assert.match(page, /myPatientsDefault\(user\.role\)/);
  assert.match(page, />\s*Type\s*</);
});
