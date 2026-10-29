import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
const noDates = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/"gte":"[^"]+"/g, '"gte":"D"'));

test('assessment API enforces access, atomic safety events and idempotency', async (t) => {
  const gate = { ok: true, userId: 'clinician', organizationId: 'clinic', role: 'THERAPIST', status: 401, error: 'Unauthorized' };
  let allowed = true, alertFails = false;
  let stored: unknown = null; let alerts: unknown[] = [];
  const db = {
    client: {
      findFirst: async ({ where }: Prisma.ClientFindFirstArgs) => {
        assert.deepEqual(noDates(where.AND), [{ OR: [{ organizationId: 'clinic' }, { location: { organizationId: 'clinic' } }, { AND: [{ locationId: null }, { assignedTo: { organizationId: 'clinic' } }] }] }, { OR: [{ assignedToId: 'clinician' }, { treatmentTeamMembers: { some: { providerId: 'clinician' } } }, { appointments: { some: { clinicianId: 'clinician', startsAt: { gte: 'D' } } } }] }]);
        return allowed && where.id === 'patient' ? { id: 'patient', name: 'Synthetic Patient', assignedToId: 'clinician' } : null;
      },
      findMany: async () => allowed ? [{ id: 'patient', name: 'Synthetic Patient' }] : [],
    },
    clinicModuleState: {
      findUnique: async ({ where }: Prisma.ClinicModuleStateFindUniqueArgs) => {
        assert.equal(where.organizationId_module?.organizationId, 'clinic');
        return stored === null ? null : { data: structuredClone(stored), updatedAt: new Date('2026-09-08T12:00:00Z') };
      },
      upsert: async ({ create }: Prisma.ClinicModuleStateUpsertArgs) => { stored = structuredClone(create.data); },
    },
    riskAlert: { create: async ({ data }: Prisma.RiskAlertCreateArgs) => {
      if (alertFails) throw new Error('Sensitive database failure');
      alerts.push(data);
    } },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => {
      const before = structuredClone(stored), beforeAlerts = structuredClone(alerts);
      try { return await fn(db); } catch (error) { stored = before; alerts = beforeAlerts; throw error; }
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function(id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    return original.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let route: { POST: (request: Request) => Promise<Response>; GET: () => Promise<Response> };
  try { route = require('../src/app/api/assessments/route'); } finally { loader._load = original; }
  const body = { clientId: 'patient', submissionId: 'c3c2dd9d-b910-4e51-8764-281707331c68', type: 'PHQ-9', responses: [0,0,0,0,0,0,0,0,1] };
  const post = (data: unknown = body) => route.POST(new Request('http://localhost/api/assessments', { method: 'POST', body: JSON.stringify(data) }));
  await t.test('unauthenticated, billing and other-caseload requests cannot write', async () => {
    gate.ok = false; assert.equal((await post()).status, 401); gate.ok = true;
    gate.role = 'BILLING'; assert.equal((await post()).status, 403); gate.role = 'THERAPIST';
    allowed = false; assert.equal((await post()).status, 404); allowed = true;
    assert.equal(stored, null);
  });
  await t.test('failed alert creation rolls back the assessment and hides backend errors', async () => {
    alertFails = true; const response = await post(); assert.equal(response.status, 500);
    assert.equal((await response.text()).includes('Sensitive'), false); assert.equal(stored, null); assert.equal(alerts.length, 0);
    alertFails = false;
  });
  await t.test('successful positive item 9 commits one high alert and repeat is idempotent', async () => {
    const first = await post(); assert.equal(first.status, 201); assert.equal((await first.json()).crisisReviewRequired, true);
    assert.equal(alerts.length, 1); assert.equal((alerts[0] as { severity: string }).severity, 'HIGH');
    const again = await post(); assert.equal(again.status, 200); assert.equal((await again.json()).duplicate, true); assert.equal(alerts.length, 1);
    assert.equal((await post({ ...body, responses: Array(9).fill(0) })).status, 409);
  });
  await t.test('read filters invisible clients and does not mutate stored records', async () => {
    allowed = false; const before = structuredClone(stored); const response = await route.GET();
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.deepEqual((await response.json()).data, []);
    assert.deepEqual(stored, before);
  });
});
