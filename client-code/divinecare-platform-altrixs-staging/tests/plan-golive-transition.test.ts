import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  DEFAULT_THERAPY_WORKFLOW_SETTINGS,
  PLAN_PENDING_LABEL,
  isValantClient,
  parseTherapyWorkflowSettings,
  planPendingClaimWarning,
  transitionUntilDate,
  treatmentPlanGate,
  type PlanSignatureState,
  type TherapyWorkflowSettings,
} from '../src/lib/ehr/therapy/rules';
import { planPendingInboxDraft } from '../src/lib/inbox/core';
import { sectionsForRole } from '../src/lib/inbox/sections';

// Go-live transition for "treatment plan required before a therapy progress note is signed".
// Synthetic ids and names only; no real patient data.

const settings: TherapyWorkflowSettings = { ...DEFAULT_THERAPY_WORKFLOW_SETTINGS };
const progress = { noteType: 'Therapy Progress', cptCode: '90837' };

function expiredValantPlan(): PlanSignatureState {
  return {
    id: 'plan-valant',
    title: 'Treatment Plan (Valant)',
    status: 'ACTIVE',
    reviewDueAt: '2026-06-01',
    clinicianSignedAt: null,
    supervisorRequired: false,
    supervisorSignedAt: null,
    patientSignatureStatus: null,
    imported: true,
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

test('default go-live 2026-11-01, transition through go-live + 30 days', () => {
  assert.equal(settings.goLiveDate, '2026-11-01');
  assert.equal(settings.transitionUntil, null);
  assert.equal(transitionUntilDate(settings), '2026-12-01');
});

test('explicit transitionUntil wins; a changed go-live date moves the default', () => {
  assert.equal(transitionUntilDate({ goLiveDate: '2026-11-08', transitionUntil: '2026-12-31' }), '2026-12-31');
  assert.equal(transitionUntilDate({ goLiveDate: '2026-11-15', transitionUntil: null }), '2026-12-15');
});

test('settings parse: bad dates fall back, stored dates kept', () => {
  assert.deepEqual(parseTherapyWorkflowSettings({ goLiveDate: '2026-02-30', transitionUntil: 'soon' }), DEFAULT_THERAPY_WORKFLOW_SETTINGS);
  const s = parseTherapyWorkflowSettings({ goLiveDate: '2026-11-01', transitionUntil: '2026-11-20' });
  assert.equal(s.goLiveDate, '2026-11-01');
  assert.equal(s.transitionUntil, '2026-11-20');
});

test('Valant client = Client.sourcePlatform from a Valant import', () => {
  assert.equal(isValantClient({ sourcePlatform: 'valant' }), true);
  assert.equal(isValantClient({ sourcePlatform: 'VALANT_EXPORT' }), true);
  assert.equal(isValantClient({ sourcePlatform: null }), false);
  assert.equal(isValantClient(null), false);
});

// ─── Gate ───────────────────────────────────────────────────────────────────

test('Valant client, no plan, before transitionUntil: allowed with the transition flag', () => {
  const g = treatmentPlanGate({ ...progress, plans: [], today: '2026-11-20', settings, valantClient: true });
  assert.equal(g.ok, true);
  assert.equal(g.required, true);
  assert.deepEqual(g.ok && g.transition, { reason: 'golive_transition', until: '2026-12-01' });
  assert.match(g.message, /allowed until 2026-12-01 \(go-live transition\)/);
});

test('Valant client with only an expired imported plan: allowed during the transition', () => {
  const g = treatmentPlanGate({ ...progress, plans: [expiredValantPlan()], today: '2026-10-18', settings, valantClient: true });
  assert.equal(g.ok, true);
  assert.equal(g.ok && g.transition?.until, '2026-12-01');
  assert.equal(g.planId, 'plan-valant');
});

test('transitionUntil is inclusive; the day after, the rule applies to Valant clients too', () => {
  const onLastDay = treatmentPlanGate({ ...progress, plans: [], today: '2026-12-01', settings, valantClient: true });
  assert.equal(onLastDay.ok, true);
  const after = treatmentPlanGate({ ...progress, plans: [], today: '2026-12-02', settings, valantClient: true });
  assert.equal(after.ok, false);
  assert.equal('transition' in after, false);
});

test('Altrixs client (not from Valant) is blocked immediately, even during the transition', () => {
  const g = treatmentPlanGate({ ...progress, plans: [], today: '2026-11-20', settings, valantClient: false });
  assert.equal(g.ok, false);
  const omitted = treatmentPlanGate({ ...progress, plans: [], today: '2026-11-20', settings });
  assert.equal(omitted.ok, false);
});

test('an active plan never uses the transition', () => {
  const active: PlanSignatureState = { ...expiredValantPlan(), id: 'p2', imported: false, reviewDueAt: '2027-03-01', clinicianSignedAt: '2026-10-01T12:00:00Z' };
  const g = treatmentPlanGate({ ...progress, plans: [active], today: '2026-11-20', settings, valantClient: true });
  assert.equal(g.ok, true);
  assert.equal(g.ok && g.transition, undefined);
  assert.equal(g.planId, 'p2');
});

test('intake and crisis notes stay exempt (no plan needed, no transition flag) for both kinds of client', () => {
  for (const cptCode of ['90791', '90792', '90839', '90840']) {
    for (const valantClient of [true, false]) {
      for (const today of ['2026-11-20', '2027-01-15']) {
        const g = treatmentPlanGate({ noteType: 'Therapy Progress', cptCode, plans: [], today, settings, valantClient });
        assert.equal(g.ok, true, `${cptCode} ${valantClient} ${today}`);
        assert.equal(g.required, false);
        assert.equal(g.ok && g.transition, undefined);
      }
    }
  }
});

test('practice switch off: nothing required, no transition flag', () => {
  const g = treatmentPlanGate({ ...progress, plans: [], today: '2026-11-20', settings: { ...settings, requirePlanForProgressNotes: false }, valantClient: true });
  assert.equal(g.ok, true);
  assert.equal(g.required, false);
  assert.equal(g.ok && g.transition, undefined);
});

// ─── Claim warning, inbox item ──────────────────────────────────────────────

test('claim warning only for a note signed with the plan pending', () => {
  assert.equal(planPendingClaimWarning(null), null);
  assert.equal(planPendingClaimWarning({ planPendingUntil: null }), null);
  assert.match(planPendingClaimWarning({ planPendingUntil: new Date('2026-12-08T00:00:00Z') })!, /^Treatment plan pending: .*plan due by 2026-12-08/);
});

test('inbox item "Plan needed by <date>", priority rises near and after the end', () => {
  const c = { clientId: 'c1', clientName: 'Client A', noteCount: 2, lastSignedAt: '2026-11-20T15:00:00Z', until: '2026-12-08' };
  const d = planPendingInboxDraft(c, '2026-11-20');
  assert.equal(d.title, 'Plan needed by 2026-12-08');
  assert.equal(d.entityKey, 'plan-pending:c1');
  assert.equal(d.priority, 'normal');
  assert.match(d.href, /treatment-plans\/therapy\?clientId=c1/);
  assert.equal(planPendingInboxDraft(c, '2026-12-02').priority, 'high');
  assert.equal(planPendingInboxDraft(c, '2026-12-09').priority, 'urgent');
});

test('inbox section for note authors only', () => {
  assert.ok(sectionsForRole('THERAPIST').some((s) => s.key === 'plans_needed'));
  assert.ok(!sectionsForRole('BILLING').some((s) => s.key === 'plans_needed'));
  assert.ok(!sectionsForRole('FRONT_DESK').some((s) => s.key === 'plans_needed'));
});

// ─── Server: sign stamps + audits; pending list; scrubber ───────────────────

type Upsert = { create: Record<string, unknown>; update: Record<string, unknown> };

// Modules are cached after the first require, so one mock database with switchable state.
const opts: { sourcePlatform: string | null; moduleData: Record<string, unknown> | null } = { sourcePlatform: null, moduleData: null };
const upserts: Upsert[] = [];
const audits: Record<string, unknown>[] = [];
const workflowFindMany: unknown[] = [];

function loadServer() {
  const note = {
    id: 'n1',
    body: 'Session content (synthetic).',
    noteType: null,
    cptCode: '90837',
    durationMinutes: 55,
    dateOfService: new Date('2026-11-20T00:00:00Z'),
    createdAt: new Date('2026-11-20T14:00:00Z'),
    client: { id: 'c1', name: 'Client A', image: null },
    clinician: { id: 'u1', name: 'Therapist T', image: null },
  };
  const pendingRows = [
    { clientId: 'c1', signedAt: new Date('2026-11-21T15:00:00Z'), planPendingUntil: new Date('2026-12-08T00:00:00Z'), signedByName: 'Therapist T', clinicianName: 'Therapist T', note: { client: { name: 'Client A' } } },
    { clientId: 'c1', signedAt: new Date('2026-11-20T15:00:00Z'), planPendingUntil: new Date('2026-12-08T00:00:00Z'), signedByName: 'Therapist T', clinicianName: 'Therapist T', note: { client: { name: 'Client A' } } },
    { clientId: 'c2', signedAt: new Date('2026-11-20T16:00:00Z'), planPendingUntil: new Date('2026-12-08T00:00:00Z'), signedByName: 'Therapist T', clinicianName: 'Therapist T', note: { client: { name: 'Client B' } } },
  ];
  const db = {
    $executeRawUnsafe: async () => 0,
    progressNote: {
      findFirst: async () => note,
      findUnique: async () => ({ body: note.body, noteType: note.noteType, cptCode: note.cptCode }),
    },
    user: {
      findUnique: async () => ({ name: 'Therapist T', email: 't@example.test' }),
      findFirst: async () => ({ licenseLevel: 'LICENSED', staffCredentials: [] }),
    },
    supervisionTrack: { findFirst: async () => null },
    clinicModuleState: { findUnique: async () => (opts.moduleData ? { data: opts.moduleData } : null) },
    client: { findFirst: async () => ({ sourcePlatform: opts.sourcePlatform }) },
    treatmentPlan: {
      // c2 now has a signed, current plan written in Altrixs
      findMany: async ({ where }: { where: { clientId: unknown } }) =>
        typeof where.clientId === 'object'
          ? [{ id: 'p-c2', clientId: 'c2', title: 'Plan', status: 'ACTIVE', reviewDueAt: new Date('2027-05-01'), clinicianSignedAt: new Date('2026-11-25'), supervisorRequired: false, supervisorSignedAt: null, patientSignatureStatus: null, goals: null, createdAt: new Date() }]
          : [],
    },
    // Notes standard: a billable note links a chart diagnosis before signing (synthetic code)
    progressNoteServiceDetail: { findUnique: async () => ({ noteId: 'n1', diagnosisCodes: ['F41.1'], startTime: null, endTime: null, telehealthModality: null, patientLocationType: null, patientLocationState: null, telehealthConsent: null }) },
    progressNoteWorkflow: {
      findMany: async (args: unknown) => {
        workflowFindMany.push(args);
        return pendingRows;
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: async () => [],
        progressNote: { findFirst: async () => note },
        progressNoteWorkflow: {
          findUnique: async () => null,
          upsert: async (args: Upsert) => {
            upserts.push(args);
            return { noteId: note.id, status: args.create.status, cosignRequired: false, signedByName: 'Therapist T', ...args.create, createdAt: note.createdAt, updatedAt: new Date() };
          },
        },
      }),
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: Record<string, unknown>) => void audits.push(e) };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  try {
    const store = require('../src/lib/notes/workflow-store') as typeof import('../src/lib/notes/workflow-store');
    const planStore = require('../src/lib/ehr/therapy/planStore') as typeof import('../src/lib/ehr/therapy/planStore');
    const scrubber = require('../src/lib/billing/claimScrubber') as typeof import('../src/lib/billing/claimScrubber');
    return { store, planStore, scrubber };
  } finally {
    loader._load = originalLoad;
  }
}

const server = loadServer();
function setup(next: typeof opts) {
  Object.assign(opts, next);
  upserts.length = 0;
  audits.length = 0;
  workflowFindMany.length = 0;
  return { ...server, upserts, audits, workflowFindMany };
}

const sign = (s: ReturnType<typeof setup>) =>
  s.store.updateProgressNoteWorkflow({ noteId: 'n1', organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST', status: 'Signed', attested: true });

// The server uses today's clinic date: the explicit settings below put "today" inside or after the window.
const OPEN_WINDOW = { goLiveDate: '2026-01-01', transitionUntil: '2099-12-31' };
const CLOSED_WINDOW = { goLiveDate: '2026-01-01', transitionUntil: '2026-01-31' };

test('Valant client signed during the transition: flag persisted on the workflow and the override audited', async () => {
  const s = setup({ sourcePlatform: 'valant', moduleData: OPEN_WINDOW });
  const res = await sign(s);
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.signed, true);
  assert.deepEqual(res.ok && res.planTransition, { reason: 'golive_transition', until: '2099-12-31' });
  assert.equal(s.upserts.length, 1);
  assert.equal((s.upserts[0].create.planPendingUntil as Date).toISOString().slice(0, 10), '2099-12-31');
  assert.equal((s.upserts[0].update.planPendingUntil as Date).toISOString().slice(0, 10), '2099-12-31');
  const override = s.audits.find((a) => a.action === 'TREATMENT_PLAN_GATE_OVERRIDE');
  assert.ok(override, 'override audited');
  assert.equal(override!.resourceId, 'n1');
  assert.equal(override!.patientId, 'c1');
  assert.deepEqual(override!.metadata, { reason: 'golive_transition', transitionUntil: '2099-12-31', status: 'Signed' });
});

test('Valant client after transitionUntil: signing refused, nothing stamped or audited', async () => {
  const s = setup({ sourcePlatform: 'VALANT_EXPORT', moduleData: CLOSED_WINDOW });
  const res = await sign(s);
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.status, 409);
  assert.equal(s.upserts.length, 0);
  assert.equal(s.audits.length, 0);
});

test('Altrixs client during the transition: signing refused', async () => {
  const s = setup({ sourcePlatform: null, moduleData: OPEN_WINDOW });
  const res = await sign(s);
  assert.equal(res.ok, false);
  assert.match(!res.ok ? res.error : '', /signed, active treatment plan is required/);
  assert.equal(s.upserts.length, 0);
});

test('pending-plan list: grouped per client, drops clients that now have an active plan, scoped to the author', async () => {
  const s = setup({ sourcePlatform: 'valant', moduleData: OPEN_WINDOW });
  const list = await s.planStore.listPlanPendingClients({ organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST' }, { authorId: 'u1' });
  assert.deepEqual(list.map((c) => [c.clientId, c.noteCount, c.until]), [['c1', 2, '2026-12-08']]);
  assert.equal(list[0].lastSignedAt, '2026-11-21T15:00:00.000Z');
  const where = JSON.stringify((s.workflowFindMany[0] as { where: unknown }).where);
  assert.match(where, /"planPendingUntil":\{"not":null\}/);
  assert.match(where, /"signedById":"u1"/);
});

test('claim scrubber: PLAN_PENDING is a warning (not an error) on a note signed with the plan pending', () => {
  const s = setup({ sourcePlatform: null, moduleData: null });
  const base = {
    id: 'cl1',
    cptCode: '90837',
    units: 1,
    amountCents: 15000,
    payer: 'Payer X',
    status: 'DRAFT' as const,
    submissionData: { diagnosisCodes: ['F41.1'], payerId: 'P1' },
    createdAt: new Date(),
    denialReason: null,
    client: { name: 'Client A', insuranceMemberId: 'M1', dateOfBirth: new Date('1990-01-01'), primaryDiagnosisCode: 'F41.1' },
    appointment: { startsAt: new Date(), clinician: { npi: '1234567893' } },
  };
  const flagged = s.scrubber.evaluateClaimScrub({ ...base, progressNote: { workflow: { status: 'SIGNED', planPendingUntil: new Date('2026-12-08T00:00:00Z') } } });
  const finding = flagged.findings.find((f) => f.code === 'PLAN_PENDING');
  assert.equal(finding?.severity, 'warning');
  assert.notEqual(flagged.status, 'errors');
  const normal = s.scrubber.evaluateClaimScrub({ ...base, progressNote: { workflow: { status: 'SIGNED', planPendingUntil: null } } });
  assert.equal(normal.findings.some((f) => f.code === 'PLAN_PENDING'), false);
  assert.ok(s.scrubber.SCRUB_RULES.some((r) => r.code === 'PLAN_PENDING'));
});

test('chip label', () => {
  assert.equal(PLAN_PENDING_LABEL, 'Treatment plan pending (go-live transition)');
});
