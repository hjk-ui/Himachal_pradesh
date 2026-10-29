import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { hash } from 'bcryptjs';
import { signPatientSession } from '../src/patient/infrastructure/security/tokens';

test('Patient Profile API: Insurance details inclusion and tenant isolation', async (t) => {
  // Patient A with Blue health care insurance
  const patientA = {
    id: 'patient-a-id',
    name: 'Patient Alpha',
    email: 'patient.alpha@example.test',
    phone: '+14105550101',
    active: true,
    status: 'ACTIVE',
    image: null,
    addressLine1: '123 Main St',
    addressLine2: 'Apt 4B',
    city: 'Bowie',
    state: 'MD',
    postalCode: '20715',
    emergencyContactName: 'Jane Alpha',
    emergencyContactPhone: '+14105550199',
    insurancePayer: 'Blue health care',
    insuranceMemberId: '123456789',
    insuranceGroupNumber: '23',
    primaryDiagnosis: 'Major Depressive Disorder (F33.1)',
    treatmentTeam: [{ staffId: 'staff-1', role: 'Psychiatrist' }],
  };

  const accountA = {
    id: 'account-a-id',
    clientId: patientA.id,
    email: patientA.email,
    status: 'ACTIVE',
    passwordHash: await hash('Password123', 12),
    client: patientA,
  };

  // Patient B with State Medicaid insurance
  const patientB = {
    id: 'patient-b-id',
    name: 'Patient Beta',
    email: 'patient.beta@example.test',
    phone: '+14105550202',
    active: true,
    status: 'ACTIVE',
    image: null,
    addressLine1: '456 Oak St',
    addressLine2: null,
    city: 'Silver Spring',
    state: 'MD',
    postalCode: '20906',
    emergencyContactName: 'John Beta',
    emergencyContactPhone: '+14105550299',
    insurancePayer: 'Maryland Medicaid HealthChoice',
    insuranceMemberId: 'MD-998877',
    insuranceGroupNumber: 'GRP-MD-01',
    primaryDiagnosis: 'Generalized Anxiety Disorder (F41.1)',
    treatmentTeam: [{ staffId: 'staff-2', role: 'Therapist' }],
  };

  const accountB = {
    id: 'account-b-id',
    clientId: patientB.id,
    email: patientB.email,
    status: 'ACTIVE',
    passwordHash: await hash('Password456', 12),
    client: patientB,
  };

  const clients = new Map([
    [patientA.id, patientA],
    [patientB.id, patientB],
  ]);

  const accounts = new Map([
    [accountA.id, accountA],
    [accountB.id, accountB],
  ]);

  const project = (row: any, select: Record<string, boolean>) =>
    Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));

  const db = {
    patientAccount: {
      findUnique: async ({ where }: any) => {
        if (where.email === accountA.email) return structuredClone(accountA);
        if (where.email === accountB.email) return structuredClone(accountB);
        return null;
      },
      findFirst: async ({ where }: any) => {
        const found = Array.from(accounts.values()).find(
          (acc) => acc.id === where.id && acc.clientId === where.clientId
        );
        return found ? structuredClone(found) : null;
      },
    },
    client: {
      findUnique: async ({ where, select }: any) => {
        const row = clients.get(where.id);
        return row ? project(row, select) : null;
      },
      update: async ({ where, data, select }: any) => {
        const row = clients.get(where.id);
        if (!row) throw new Error('Client not found');
        Object.assign(row, data);
        return project(row, select);
      },
    },
    patientAuditLog: {
      create: async () => ({}),
    },
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    return originalLoad.call(this, id, ...args);
  };

  const require = createRequire(import.meta.url);
  let meRoute: typeof import('../src/app/api/patient/me/route');
  try {
    meRoute = require('../src/app/api/patient/me/route');
  } finally {
    loader._load = originalLoad;
  }

  const tokenA = await signPatientSession(accountA.id, patientA.id, accountA.passwordHash);
  const tokenB = await signPatientSession(accountB.id, patientB.id, accountB.passwordHash);

  const makeReq = (token: string | null, method = 'GET', body?: unknown) =>
    new Request('https://example.test/api/patient/me', {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  await t.test('1. GET /api/patient/me returns insurancePayer, insuranceMemberId, insuranceGroupNumber for authenticated patient', async () => {
    const res = await meRoute.GET(makeReq(tokenA));
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data?.client);

    const client = json.data.client;
    assert.equal(client.id, 'patient-a-id');
    assert.equal(client.name, 'Patient Alpha');
    assert.equal(client.email, 'patient.alpha@example.test');
    assert.equal(client.insurancePayer, 'Blue health care');
    assert.equal(client.insuranceMemberId, '123456789');
    assert.equal(client.insuranceGroupNumber, '23');

    // Verify sensitive clinical and staff fields are NOT exposed
    assert.equal('primaryDiagnosis' in client, false, 'Clinical diagnosis must not be exposed to mobile profile');
    assert.equal('treatmentTeam' in client, false, 'Internal staff treatment team must not be exposed');
  });

  await t.test('2. PATCH /api/patient/me returns insurance fields after profile update', async () => {
    const res = await meRoute.PATCH(
      makeReq(tokenA, 'PATCH', {
        city: 'Columbia',
        insuranceMemberId: '987654321',
      })
    );
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.success, true);

    const client = json.data.client;
    assert.equal(client.city, 'Columbia');
    assert.equal(client.insurancePayer, 'Blue health care');
    assert.equal(client.insuranceMemberId, '987654321');
    assert.equal(client.insuranceGroupNumber, '23');
  });

  await t.test('3. Patient Isolation: Patient B cannot retrieve Patient A insurance details', async () => {
    const resB = await meRoute.GET(makeReq(tokenB));
    assert.equal(resB.status, 200);

    const jsonB = await resB.json();
    const clientB = jsonB.data.client;

    // Must return Patient B details ONLY
    assert.equal(clientB.id, 'patient-b-id');
    assert.equal(clientB.name, 'Patient Beta');
    assert.equal(clientB.insurancePayer, 'Maryland Medicaid HealthChoice');
    assert.equal(clientB.insuranceMemberId, 'MD-998877');
    assert.equal(clientB.insuranceGroupNumber, 'GRP-MD-01');

    // Strict cross-patient verification: none of Patient A's insurance details should leak to Patient B
    assert.notEqual(clientB.insurancePayer, 'Blue health care');
    assert.notEqual(clientB.insuranceMemberId, '987654321');
    assert.notEqual(clientB.insuranceMemberId, '123456789');
  });

  await t.test('4. Unauthenticated request to /api/patient/me is rejected with 401', async () => {
    const res = await meRoute.GET(makeReq(null));
    assert.equal(res.status, 401);

    const json = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'unauthenticated');
  });
});
