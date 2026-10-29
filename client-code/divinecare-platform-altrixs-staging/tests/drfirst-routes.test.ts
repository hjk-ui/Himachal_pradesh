import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import { MockDrFirstProvider } from '../src/lib/drfirst/mock-provider';
import { clientBelongsToOrg } from '../src/lib/clients/orgScope';
const noDates = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/"gte":"[^"]+"/g, '"gte":"D"'));

test('DrFirst routes enforce tenant, actor, session and input boundaries without a database or network', async t => {
  const originalEnv = { ...process.env };
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  let clockOffset = 0;
  Date.now = () => originalNow() + clockOffset;
  globalThis.fetch = async () => { throw new Error('Unexpected network call in DrFirst test'); };
  t.after(() => { process.env = originalEnv; Date.now = originalNow; globalThis.fetch = originalFetch; });
  process.env = { ...process.env, NODE_ENV: 'development' };
  process.env.DRFIRST_ENABLED = 'true'; process.env.DRFIRST_ENV = 'mock'; process.env.DRFIRST_MOCK_FAILURE = 'none';
  process.env.DRFIRST_PASSWORD = 'secret-test-marker';
  const gate = { ok: true, userId: 'provider', organizationId: 'clinic', role: 'NP', status: 401 };
  let assigned = true;
  let actualPrescriber = true;
  let patientOrg = 'clinic';
  let npi: string | null = null;
  let dateOfBirth: Date | null = new Date('2000-01-01');
  let auditUnavailable = false;
  const rows = new Map<string, unknown>();
  const audits: unknown[] = [];
  t.beforeEach(() => {
    clockOffset += 60_001; // Reset the real rate-limit window between independent cases.
    gate.ok = true; gate.role = 'NP'; gate.organizationId = 'clinic'; gate.status = 401;
    assigned = true; actualPrescriber = true; patientOrg = 'clinic'; npi = null;
    dateOfBirth = new Date('2000-01-01'); auditUnavailable = false;
    rows.clear(); audits.length = 0;
    process.env.DRFIRST_ENABLED = 'true'; process.env.DRFIRST_ENV = 'mock'; process.env.DRFIRST_MOCK_FAILURE = 'none';
  });
  const db = {
    client: { findFirst: async ({ where }: Prisma.ClientFindFirstArgs) => {
      assert.deepEqual(noDates(where.AND), [{ AND: [{ OR: [
        { organizationId: gate.organizationId },
        { location: { organizationId: gate.organizationId } },
        { AND: [{ locationId: null }, { assignedTo: { organizationId: gate.organizationId } }] },
      ] }, { OR: [{ assignedToId: gate.userId }, { treatmentTeamMembers: { some: { providerId: gate.userId } } }, { appointments: { some: { clinicianId: gate.userId, startsAt: { gte: 'D' } } } }] }] }]);
      const visible = clientBelongsToOrg({ locationId: 'location', location: { organizationId: patientOrg } }, gate.organizationId);
      return assigned && visible && where.id === 'patient' ? { id: 'patient', name: 'Synthetic Patient', dateOfBirth } : null;
    } },
    user: { findFirst: async ({ where }: Prisma.UserFindFirstArgs) => {
      assert.equal(where.organizationId, gate.organizationId); assert.equal(where.status, 'ACTIVE');
      assert.deepEqual(where.organization, { active: true });
      if (where.id !== 'provider' || where.organizationId !== 'clinic') return null;
      return { id: 'provider', name: 'Synthetic Provider', npi, role: actualPrescriber ? gate.role : 'ADMIN', roles: [] };
    } },
    organization: { findFirst: async () => ({ id: 'clinic', name: 'Synthetic Clinic' }) },
    clinicModuleState: {
      upsert: async ({ create }: { create: { organizationId: string; module: string; data: unknown } }) => { rows.set(`${create.organizationId}:${create.module}`, create.data); },
      create: async (args: unknown) => { if (auditUnavailable) throw new Error('Sensitive database error'); audits.push(args); },
      findUnique: async ({ where }: { where: { organizationId_module: { organizationId: string; module: string } } }) => {
        const key = `${where.organizationId_module.organizationId}:${where.organizationId_module.module}`;
        return rows.has(key) ? { data: rows.get(key) } : null;
      },
    },
  };
  // Scope CommonJS dependency substitution to module loading; production code stays unchanged.
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function(id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  type Route = { POST: (req: Request) => Promise<Response>; GET: (req: Request) => Promise<Response> };
  let launch: Route, status: Route, prescriber: Route, patient: Route;
  let readMockLaunch: (token: string, context: typeof gate) => Promise<unknown>;
  try {
    launch = require('../src/app/api/integrations/drfirst/launch/route') as Route;
    status = require('../src/app/api/integrations/drfirst/status/route') as Route;
    prescriber = require('../src/app/api/integrations/drfirst/prescriber/sync/route') as Route;
    patient = require('../src/app/api/integrations/drfirst/patient/sync/route') as Route;
    ({ readMockLaunch } = require('../src/lib/drfirst/service'));
  } finally { loader._load = originalLoad; }
  const request = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/integrations/drfirst/launch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body),
  });
  try {
    await t.test('status API returns only whitelisted configuration', async () => {
      const response = await status.GET(new Request('http://localhost:3000/api/integrations/drfirst/status'));
      assert.deepEqual(await response.json(), { enabled: true, environment: 'mock', configured: false, mock: true });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
    await t.test('all four routes require staff authentication and block billing; admins can only read status', async () => {
      for (const [role, ok, expected] of [['NP', false, 401], ['BILLING', true, 403], ['ADMIN', true, 403]] as const) {
        gate.ok = ok; gate.role = role;
        for (const route of [launch, patient, prescriber]) assert.equal((await route.POST(request({ clientId: 'patient' }))).status, expected);
        assert.equal((await status.GET(new Request('http://localhost:3000'))).status, role === 'ADMIN' ? 200 : expected);
      }
    });
    await t.test('disabled, spoofed origin and unrecognized fields are blocked', async () => {
      process.env.DRFIRST_ENABLED = 'false';
      assert.equal((await (await launch.POST(request({ clientId: 'patient' }))).json()).code, 'DRFIRST_DISABLED');
      process.env.DRFIRST_ENABLED = 'true';
      assert.equal((await launch.POST(request({ clientId: 'patient' }, 'https://untrusted.invalid'))).status, 403);
      assert.equal((await launch.POST(request({ clientId: 'patient', organizationId: 'other' }))).status, 400);
      assert.equal((await prescriber.POST(request({ userId: 'other' }))).status, 403);
    });
    await t.test('wrong tenant, wrong caseload and admin role preview are independently blocked', async () => {
      assigned = false; assert.equal((await launch.POST(request({ clientId: 'patient' }))).status, 403); assigned = true;
      patientOrg = 'other-clinic'; assert.equal((await patient.POST(request({ clientId: 'patient' }))).status, 403); patientOrg = 'clinic';
      gate.organizationId = 'other-clinic'; assert.equal((await prescriber.POST(request({}))).status, 403); gate.organizationId = 'clinic';
      actualPrescriber = false; assert.equal((await launch.POST(request({ clientId: 'patient' }))).status, 403);
      assert.equal((await status.GET(new Request('http://localhost:3000'))).status, 403);
    });
    await t.test('authorized launch stores hash-bound expiring session and PHI-free audit', async () => {
      const response = await launch.POST(request({ clientId: 'patient' }));
      assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.data.mode, 'MOCK'); assert.equal(body.token, undefined);
      const cookie = response.headers.get('set-cookie')!;
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=strict/i);
      const token = /drfirst-mock-launch=([^;]+)/.exec(cookie)![1];
      assert.ok(await readMockLaunch(token, gate));
      const auditCount = audits.length;
      assert.ok(await readMockLaunch(token, gate)); // Display-only refresh is intentionally reusable.
      assert.equal(audits.length, auditCount);
      await assert.rejects(readMockLaunch(token, { ...gate, userId: 'someone-else' }));
      await assert.rejects(readMockLaunch(token, { ...gate, organizationId: 'other-clinic' }));
      assigned = false; await assert.rejects(readMockLaunch(token, gate)); assigned = true;
      const session = [...rows.values()].find(value => (value as { session?: unknown }).session) as { session: { expiresAt: string } };
      session.session.expiresAt = '2000-01-01T00:00:00.000Z';
      await assert.rejects(readMockLaunch(token, gate), { code: 'DRFIRST_SESSION_EXPIRED' });
      const audit = JSON.stringify(audits);
      for (const secret of ['Synthetic Patient', 'Synthetic Provider', '1234567890', 'secret-test-marker', token]) assert.equal(audit.includes(secret), false);
      assert.equal(JSON.stringify([...rows]).includes(token), false);
      const events = audits as { data: { organizationId: string; data: { operationId: string; action: string; outcome: string; actorId: string; patientRef?: string; prescriberRef: string; environment: string } } }[];
      const launches = events.filter(event => event.data.data.action === 'launch');
      assert.deepEqual(launches.map(event => event.data.data.outcome), ['attempted', 'succeeded']);
      assert.equal(launches[0].data.data.operationId, launches[1].data.data.operationId);
      assert.match(launches[0].data.data.patientRef!, /^[a-f0-9]{64}$/);
      assert.match(launches[0].data.data.prescriberRef, /^[a-f0-9]{64}$/);
      assert.equal(launches[0].data.organizationId, 'clinic');
    });
    await t.test('psychiatrist can launch and existing mapping IDs reach the provider on resync', async child => {
      gate.role = 'PSYCHIATRIST';
      assert.equal((await launch.POST(request({ clientId: 'patient' }))).status, 200);
      const originalSync = MockDrFirstProvider.prototype.createOrSyncPatient;
      let reused = '';
      child.mock.method(MockDrFirstProvider.prototype, 'createOrSyncPatient', async function(value) {
        reused = value.externalId;
        return originalSync.call(this, value);
      });
      assert.equal((await patient.POST(request({ clientId: 'patient' }))).status, 200);
      assert.match(reused, /^mock_patient_/);
    });
    await t.test('invalid patient/prescriber and simulated unavailable service return normalized failures', async () => {
      dateOfBirth = null;
      assert.equal((await (await patient.POST(request({ clientId: 'patient' }))).json()).code, 'DRFIRST_PATIENT_INVALID');
      dateOfBirth = new Date('2000-01-01'); npi = 'invalid';
      assert.equal((await (await prescriber.POST(request({}))).json()).code, 'DRFIRST_PRESCRIBER_INVALID');
      npi = null;
      assert.equal((await (await launch.POST(request({ clientId: 'patient', failure: 'unavailable' }))).json()).code, 'DRFIRST_EXTERNAL_SERVICE_ERROR');
      assert.ok(JSON.stringify(audits).includes('failed'));
    });
    await t.test('staging and production fail closed, even with supplied placeholder credentials', async () => {
      for (const environment of ['staging', 'production']) {
        process.env.DRFIRST_ENV = environment;
        const response = await launch.POST(request({ clientId: 'patient' }));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, 'DRFIRST_NOT_CONFIGURED');
      }
      assert.equal(rows.size, 0);
    });
    await t.test('malformed JSON, blank IDs, wrong media type and oversized streamed body are rejected', async () => {
      assert.equal((await launch.POST(new Request('http://localhost:3000/api/integrations/drfirst/launch', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{' }))).status, 400);
      assert.equal((await launch.POST(request({ clientId: ' ' }))).status, 400);
      const wrongType = request({ clientId: 'patient' }); wrongType.headers.set('content-type', 'text/plain');
      assert.equal((await launch.POST(wrongType)).status, 415);
      const large = request({ clientId: 'x'.repeat(5000) }); large.headers.set('content-length', '1');
      assert.equal((await launch.POST(large)).status, 413);
    });
    await t.test('adapter secrets are stripped before HTTP and unsafe redirects cannot escape launch boundary', async child => {
      const originalSync = MockDrFirstProvider.prototype.createOrSyncPrescriber;
      child.mock.method(MockDrFirstProvider.prototype, 'createOrSyncPrescriber', async function(value) {
        return { ...await originalSync.call(this, value), secret: 'secret-upstream-marker' };
      });
      const response = await prescriber.POST(request({}));
      assert.equal(response.status, 200); assert.equal((await response.text()).includes('secret-upstream-marker'), false);
      child.mock.method(MockDrFirstProvider.prototype, 'getLaunchUrl', () => 'javascript:alert(1)');
      const rejected = await launch.POST(request({ clientId: 'patient' }));
      assert.equal(rejected.status, 503); assert.equal(rejected.headers.get('set-cookie'), null);
    });
    await t.test('wrong-environment provider IDs are neither persisted nor returned', async child => {
      child.mock.method(MockDrFirstProvider.prototype, 'createOrSyncPatient', async () => ({ externalId: 'other-id', environment: 'production', mode: 'LIVE' }));
      assert.equal((await patient.POST(request({ clientId: 'patient' }))).status, 503);
      assert.equal(rows.size, 0);
    });
    await t.test('audit outage fails closed and authentication outage uses service-error code', async () => {
      auditUnavailable = true;
      const result = await launch.POST(request({ clientId: 'patient' }));
      assert.equal(result.status, 503); assert.equal((await result.text()).includes('Sensitive'), false); assert.equal(rows.size, 0);
      gate.ok = false; gate.status = 503;
      assert.equal((await (await status.GET(new Request('http://localhost:3000'))).json()).code, 'DRFIRST_EXTERNAL_SERVICE_ERROR');
    });
    await t.test('existing rate limit blocks the twenty-first write', async () => {
      for (let i = 0; i < 20; i++) assert.equal((await prescriber.POST(request({}))).status, 200);
      assert.equal((await prescriber.POST(request({}))).status, 429);
    });
  } finally { process.env = originalEnv; }
});
