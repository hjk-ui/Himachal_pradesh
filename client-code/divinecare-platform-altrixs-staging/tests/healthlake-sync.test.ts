import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

/** End-to-end: runOrgSync over an in-memory database and a fake HealthLake transport (no AWS). */
test('runOrgSync: scan -> outbox -> PUT, idempotent re-run, change + delete, audit counts only', async (t) => {
  const ORG = 'orgA';
  const data = {
    clients: [
      {
        id: 'ckclient1', organizationId: ORG, name: 'Synthetic One', legalFirstName: null, middleInitial: null, legalLastName: null,
        email: null, phone: '410-555-0100', phoneSecondary: null, status: 'ACTIVE', mrn: 'M1', sourcePlatform: null, sourceId: null,
        dateOfBirth: new Date('1990-01-01T00:00:00Z'), gender: 'F', addressLine1: null, addressLine2: null, city: null, state: null,
        postalCode: null, emergencyContactName: null, emergencyContactPhone: null, primaryDiagnosis: 'GAD', primaryDiagnosisCode: 'F41.1',
        secondaryDiagnoses: null, assignedToId: 'ckuser1', sensitiveRecord: null,
      },
    ],
    users: [{ id: 'ckuser1', name: 'Synthetic Clinician', email: 'c@example.test', role: 'THERAPIST', status: 'ACTIVE', npi: null, licenseNumber: null }],
    allergies: [{ id: 'ckalg1', clientId: 'ckclient1', allergen: 'Penicillin', reaction: null, severity: 'Mild', status: 'Active', source: null, rcopiaAllergyId: null, createdAt: new Date('2026-01-01T00:00:00Z') }],
  };
  type Row = Record<string, any>;
  const outbox: Row[] = [];
  const runs: Row[] = [];
  const audits: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  const db: Record<string, any> = {
    organization: { findUnique: async () => ({ id: ORG, name: 'Synthetic Clinic', active: true }) },
    location: { findMany: async () => [] },
    user: { findMany: async ({ where }: Row) => (assert.equal(where.organizationId, ORG), data.users) },
    client: { findMany: async ({ where }: Row) => (assert.ok(JSON.stringify(where).includes(ORG)), data.clients) },
    medicalProblem: { findMany: async () => [] },
    clientMedication: { findMany: async () => [] },
    medicalAllergy: { findMany: async () => data.allergies },
    appointment: { findMany: async () => [] },
    medicalVisit: { findMany: async () => [] },
    progressNote: { findMany: async () => [] },
    clinicalAssessmentRecord: { findMany: async () => [] },
    clinicModuleState: { findUnique: async () => ({ data: { enabled: true } }) },
    fhirSyncState: {
      findMany: async ({ where }: Row) => outbox.filter((r) => match(r, where)).map((r) => ({ ...r })),
      createMany: async ({ data: rows, skipDuplicates }: Row) => {
        for (const r of rows) {
          if (outbox.some((o) => o.resourceType === r.resourceType && o.resourceId === r.resourceId)) {
            if (skipDuplicates) continue;
            throw new Error('unique');
          }
          outbox.push({ ...r, id: `row${++seq}` });
        }
      },
      update: async ({ where, data: patch }: Row) => Object.assign(outbox.find((r) => r.id === where.id)!, patch),
    },
    fhirSyncRun: {
      create: async ({ data: d }: Row) => {
        const r = { ...d, id: `run${runs.length + 1}` };
        runs.push(r);
        return r;
      },
      update: async ({ where, data: d }: Row) => Object.assign(runs.find((r) => r.id === where.id)!, d),
    },
    auditLog: { create: async ({ data: d }: Row) => (audits.push(d), {}) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let sync: typeof import('../src/lib/healthlake/sync');
  try {
    sync = require('../src/lib/healthlake/sync');
  } finally {
    loader._load = originalLoad;
  }

  const calls: string[] = [];
  const remote = new Map<string, unknown>();
  const transport = {
    put: async (r: { resourceType: string; id: string }) => {
      calls.push(`PUT ${r.resourceType}/${r.id}`);
      remote.set(`${r.resourceType}/${r.id}`, r);
      return { ok: true as const, status: 200, versionId: '1' };
    },
    delete: async (type: string, id: string) => {
      calls.push(`DELETE ${type}/${id}`);
      remote.delete(`${type}/${id}`);
      return { ok: true as const, status: 200 };
    },
  };
  const run = () => sync.runOrgSync({ db: db as never, organizationId: ORG, transport, trigger: 'cron' });

  await t.test('first run writes every resource, Organization first', async () => {
    const s = await run();
    assert.equal(s.status, 'SUCCESS');
    assert.deepEqual(
      [...remote.keys()].sort(),
      ['AllergyIntolerance/alg-ckalg1', 'Condition/dx-ckclient1-F41.1', 'Organization/orgA', 'Patient/ckclient1', 'Practitioner/ckuser1']
    );
    assert.equal(calls[0], 'PUT Organization/orgA');
    assert.ok(outbox.every((r) => r.status === 'SYNCED' && r.syncedHash === r.hash));
    assert.equal(runs[0]!.status, 'SUCCESS');
    const audit = audits.at(-1)!;
    assert.equal(audit.action, 'HEALTHLAKE_SYNC_ORG');
    assert.equal(audit.organizationId, ORG);
    const meta = JSON.stringify(audit.metadata ?? {});
    assert.ok(!meta.includes('Synthetic') && !meta.includes('410-555'), 'audit metadata is counts only');
  });

  await t.test('second run with no changes sends nothing', async () => {
    calls.length = 0;
    const s = await run();
    assert.equal(s.synced, 0);
    assert.deepEqual(calls, []);
  });

  await t.test('a change re-PUTs only that resource; a removed row is DELETEd', async () => {
    calls.length = 0;
    data.clients[0]!.phone = '410-555-0199';
    data.allergies.length = 0;
    const s = await run();
    assert.deepEqual(calls, ['PUT Patient/ckclient1', 'DELETE AllergyIntolerance/alg-ckalg1']);
    assert.equal(s.synced, 1);
    assert.equal(s.deleted, 1);
    assert.equal(outbox.find((r) => r.resourceType === 'AllergyIntolerance')!.status, 'DELETED');
  });

  await t.test('sync turned off for the org -> SKIPPED, nothing recorded', async () => {
    db.clinicModuleState.findUnique = async () => ({ data: { enabled: false } });
    const before = runs.length;
    const s = await run();
    assert.equal(s.status, 'SKIPPED');
    assert.equal(runs.length, before);
  });
});
