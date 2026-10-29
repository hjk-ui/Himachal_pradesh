import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module from 'node:module';

test('PDMP checkpoint is prescriber-only, tenant-scoped and fail-closed', async (t) => {
  let gate: any = {
    ok: true,
    userId: 'provider-1',
    organizationId: 'org-1',
    role: 'NP',
  };
  let actor: any = {
    id: 'provider-1',
    npi: '1234567890',
    primaryLocationId: 'location-1',
    role: 'NP',
    roles: [],
  };
  let patient: any = { id: 'patient-1' };
  let latestAudit: any = null;
  let throwOnRead = false;
  let createdData: any = null;

  const prisma = {
    user: {
      findFirst: async () => actor,
    },
    client: {
      findFirst: async ({ where }: any) => {
        if (where.id !== 'patient-1') return null;
        return patient;
      },
    },
    marylandPdmpAudit: {
      findFirst: async () => {
        if (throwOnRead) throw new Error('database secret');
        return latestAudit;
      },
      create: async ({ data }: any) => {
        createdData = data;
        return {
          id: 'audit-1',
          consultationTimestamp: data.consultationTimestamp,
          status: data.status,
        };
      },
    },
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/auth/tenant') {
      return { requireOrgContext: async () => gate };
    }
    if (id === '@/lib/db/prisma') return { prisma };
    return originalLoad.call(this, id, ...args);
  };
  t.after(() => {
    loader._load = originalLoad;
  });

  const { GET, POST } = await import('../src/app/api/prescribing/pdmp-check/route');

  await t.test('rejects unauthenticated and non-prescriber sessions', async () => {
    gate = { ok: false, status: 401, error: 'Unauthorized' };
    let response = await GET(new Request('http://localhost/api/prescribing/pdmp-check?clientId=patient-1'));
    assert.equal(response.status, 401);

    gate = { ok: true, userId: 'therapist-1', organizationId: 'org-1', role: 'THERAPIST' };
    response = await GET(new Request('http://localhost/api/prescribing/pdmp-check?clientId=patient-1'));
    assert.equal(response.status, 403);
  });

  await t.test('hides patients outside the actor scope', async () => {
    gate = { ok: true, userId: 'provider-1', organizationId: 'org-1', role: 'NP' };
    actor = { id: 'provider-1', npi: '1234567890', primaryLocationId: null, role: 'NP', roles: [] };
    patient = null;
    const response = await GET(new Request('http://localhost/api/prescribing/pdmp-check?clientId=patient-1'));
    assert.equal(response.status, 404);
    patient = { id: 'patient-1' };
  });

  await t.test('database errors never fabricate a compliant review', async () => {
    throwOnRead = true;
    const response = await GET(new Request('http://localhost/api/prescribing/pdmp-check?clientId=patient-1'));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal('compliant' in (body.data ?? {}), false);
    throwOnRead = false;
  });

  await t.test('returns only a local attestation state', async () => {
    latestAudit = {
      consultationTimestamp: new Date(),
      status: 'attested',
    };
    const response = await GET(new Request('http://localhost/api/prescribing/pdmp-check?clientId=patient-1'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.reviewedWithinWindow, true);
    assert.equal(body.data.externalQueryVerified, false);
    assert.equal(body.data.source, 'local_prescriber_attestation');
    assert.equal(body.data.reviewerNpi, undefined);
  });

  await t.test('requires same-origin JSON and a database-backed NPI', async () => {
    let response = await POST(new Request('http://localhost/api/prescribing/pdmp-check', {
      method: 'POST',
      headers: { origin: 'https://attacker.test', 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'patient-1', confirmation: 'PDMP_REVIEW_COMPLETED' }),
    }));
    assert.equal(response.status, 403);

    actor = { ...actor, npi: null };
    response = await POST(new Request('http://localhost/api/prescribing/pdmp-check', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'patient-1', confirmation: 'PDMP_REVIEW_COMPLETED' }),
    }));
    assert.equal(response.status, 422);
  });

  await t.test('rejects spoofed reviewer data and derives the audit actor', async () => {
    actor = {
      id: 'provider-1',
      npi: '1234567890',
      primaryLocationId: 'location-1',
      role: 'NP',
      roles: [],
    };

    let response = await POST(new Request('http://localhost/api/prescribing/pdmp-check', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'patient-1',
        confirmation: 'PDMP_REVIEW_COMPLETED',
        reviewerNpi: '9999999999',
      }),
    }));
    assert.equal(response.status, 400);
    assert.equal(createdData, null);

    response = await POST(new Request('http://localhost/api/prescribing/pdmp-check', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'patient-1',
        confirmation: 'PDMP_REVIEW_COMPLETED',
      }),
    }));
    assert.equal(response.status, 201);
    assert.equal(createdData.reviewerUsername, 'provider-1');
    assert.equal(createdData.reviewerNpi, '1234567890');
    assert.equal(createdData.locationId, 'location-1');
    assert.equal(createdData.status, 'attested');

    const body = await response.json();
    assert.equal(body.data.externalQueryVerified, false);
    assert.equal(body.data.reviewerNpi, undefined);
  });
});
