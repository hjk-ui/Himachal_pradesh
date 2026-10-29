import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

// LIVE SMART mode for this process (config is read at module load, so set env before require).
process.env.SMART_SIGNING_SECRET = 'test-only-smart-secret';
process.env.API_BASE_URL = 'https://staging.example.test';

type Route = { GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };

test('SMART FHIR reads: no real data without a valid access token, org-scoped, audited', async (t) => {
  const audits: Array<Record<string, unknown>> = [];
  const lookups: unknown[] = [];
  const db = {
    client: {
      findFirst: async (args: { where: unknown }) => {
        lookups.push(args.where);
        const w = JSON.stringify(args.where);
        if (!w.includes('"id":"ckpatient1"') || !w.includes('"organizationId":"orgA"')) return null;
        return {
          id: 'ckpatient1', organizationId: 'orgA', name: 'Synthetic Person', legalFirstName: null, middleInitial: null,
          legalLastName: null, email: null, phone: null, phoneSecondary: null, status: 'ACTIVE', mrn: 'MRN1',
          sourcePlatform: null, sourceId: null, dateOfBirth: new Date('1980-01-01T00:00:00Z'), gender: 'M',
          addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
          emergencyContactName: null, emergencyContactPhone: null, primaryDiagnosis: null, primaryDiagnosisCode: null,
          secondaryDiagnoses: null, assignedToId: null, sensitiveRecord: null,
        };
      },
    },
    user: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        where.id === 'ckuser1' && where.organizationId === 'orgA'
          ? { id: 'ckuser1', name: 'Synthetic Clinician', email: 'c@example.test', role: 'THERAPIST', status: 'ACTIVE', npi: null, licenseNumber: null }
          : null,
    },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return {}; } },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let patient: Route, practitioner: Route;
  let smart: typeof import('../src/lib/fhir/smart');
  try {
    patient = require('../src/app/fhir/Patient/[id]/route') as Route;
    practitioner = require('../src/app/fhir/Practitioner/[id]/route') as Route;
    smart = require('../src/lib/fhir/smart');
  } finally {
    loader._load = originalLoad;
  }
  const iss = 'https://staging.example.test/fhir';
  const access = (claims: Record<string, unknown>) =>
    smart.signJwt({ iss, aud: iss, token_use: smart.TOKEN_USE_ACCESS, org: 'orgA', patient: 'ckpatient1', sub: 'ckuser1', ...claims }, 60);
  const get = (route: Route, id: string, token?: string) =>
    route.GET(new Request(`https://staging.example.test/fhir/X/${id}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), {
      params: Promise.resolve({ id }),
    });

  await t.test('no token / garbage / launch token / wrong audience -> 401, no lookup', async () => {
    assert.equal((await get(patient, 'ckpatient1')).status, 401);
    assert.equal((await get(patient, 'ckpatient1', 'DEMO-ACCESS-123')).status, 401);
    const launch = smart.signJwt({ iss, token_use: smart.TOKEN_USE_LAUNCH, org: 'orgA', launch_patient: 'ckpatient1', patient: 'ckpatient1', launch_user: 'ckuser1', sub: 'ckuser1', aud: iss }, 60);
    assert.equal((await get(patient, 'ckpatient1', launch)).status, 401, 'a launch token is not an access token');
    assert.equal((await get(patient, 'ckpatient1', access({ aud: 'https://other.example/fhir' }))).status, 401);
    assert.equal((await get(patient, 'ckpatient1', access({ org: undefined }))).status, 401, 'org context required');
    const forged = smart.signJwt({ iss, aud: iss, token_use: smart.TOKEN_USE_ACCESS, org: 'orgA', patient: 'ckpatient1', sub: 'ckuser1' }, 60, 'other-secret');
    assert.equal((await get(patient, 'ckpatient1', forged)).status, 401);
    assert.equal(lookups.length, 0);
  });

  await t.test('token for another patient -> 403 (audited as DENIED)', async () => {
    const res = await get(patient, 'ckpatient2', access({}));
    assert.equal(res.status, 403);
    assert.equal(lookups.length, 0);
    assert.equal(audits.at(-1)!.outcome, 'DENIED');
  });

  await t.test('valid token -> Patient read scoped to the token org, audited', async () => {
    const res = await get(patient, 'ckpatient1', access({}));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resourceType, 'Patient');
    assert.equal(body.id, 'ckpatient1');
    assert.equal(body.address, undefined, 'no defaulted state');
    assert.ok(JSON.stringify(lookups.at(-1)).includes('"organizationId":"orgA"'));
    const audit = audits.at(-1)!;
    assert.equal(audit.action, 'FHIR_PATIENT_READ');
    assert.equal(audit.patientId, 'ckpatient1');
    assert.equal(audit.organizationId, 'orgA');
    // same patient id in another org's token -> not found
    assert.equal((await get(patient, 'ckpatient1', access({ org: 'orgB' }))).status, 404);
  });

  await t.test('Practitioner: only the token user, from the token org; no invented NPI', async () => {
    assert.equal((await get(practitioner, 'ckuser1')).status, 401);
    assert.equal((await get(practitioner, 'ckother', access({}))).status, 403);
    const res = await get(practitioner, 'ckuser1', access({}));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(!JSON.stringify(body).includes('0000000000'));
    assert.equal(body.name[0].text, 'Synthetic Clinician');
  });
});
