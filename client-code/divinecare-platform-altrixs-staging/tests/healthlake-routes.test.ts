import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

// HealthLake is not configured in this process: no data store, no AWS credentials.
for (const k of [
  'AWS_HEALTHLAKE_DATASTORE_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_LIVE',
  'AWS_HEALTHLAKE_IMPORT_S3_URI',
  'AWS_HEALTHLAKE_EXPORT_S3_URI',
]) {
  delete process.env[k];
}

type Route = Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;

test('HealthLake routes when not configured: clear 503, no fabricated data or jobs', async (t) => {
  const gate = { ok: true as const, userId: 'user1', role: 'PRACTICE_DIRECTOR', organizationId: 'org1', session: {} };
  const writes: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const settingsRows = new Map<string, unknown>();
  const forbidden = (name: string) => async () => {
    writes.push(name);
    throw new Error(`${name} must not be called when HealthLake is not configured`);
  };
  const db = {
    clinicModuleState: {
      findUnique: async ({ where }: { where: { organizationId_module: { organizationId: string; module: string } } }) => {
        const k = `${where.organizationId_module.organizationId}:${where.organizationId_module.module}`;
        return settingsRows.has(k) ? { data: settingsRows.get(k) } : null;
      },
      upsert: async ({ create, update }: { create: { organizationId: string; module: string; data: unknown }; update: { data: unknown } }) => {
        settingsRows.set(`${create.organizationId}:${create.module}`, update.data);
        return {};
      },
    },
    fhirSyncState: {
      groupBy: async ({ where }: { where: { organizationId: string } }) => {
        assert.equal(where.organizationId, 'org1');
        return [];
      },
      findMany: async ({ where }: { where: { organizationId: string } }) => {
        assert.equal(where.organizationId, 'org1');
        return [];
      },
      createMany: forbidden('fhirSyncState.createMany'),
      update: forbidden('fhirSyncState.update'),
    },
    fhirSyncRun: { findFirst: async () => null, create: forbidden('fhirSyncRun.create') },
    healthLakeJob: {
      findMany: async ({ where }: { where: { organizationId: string } }) => {
        assert.equal(where.organizationId, 'org1');
        return [
          {
            id: 'job_demo', jobType: 'import', jobName: 'FHIR bundle import', s3Uri: 's3://example-bucket/fhir-import/',
            status: 'COMPLETED', awsJobId: 'demo-import-1760000000000', demoMode: true,
            createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
          },
          {
            id: 'job_legacy', jobType: 'export', jobName: 'export', s3Uri: null, status: 'COMPLETED',
            awsJobId: 'demo-export-1', demoMode: false,
            createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
          },
        ];
      },
      create: forbidden('healthLakeJob.create'),
    },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return {}; } },
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let status: Route, jobs: Route, imp: Route, exp: Route, sync: Route, fhir: Route, settings: Route;
  try {
    status = require('../src/app/api/healthlake/status/route') as Route;
    jobs = require('../src/app/api/healthlake/jobs/route') as Route;
    imp = require('../src/app/api/healthlake/import/route') as Route;
    exp = require('../src/app/api/healthlake/export/route') as Route;
    sync = require('../src/app/api/healthlake/sync/route') as Route;
    fhir = require('../src/app/api/healthlake/fhir/[resourceType]/route') as Route;
    settings = require('../src/app/api/healthlake/settings/route') as Route;
  } finally {
    loader._load = originalLoad;
  }
  const req = (url: string, init?: RequestInit) => new Request(`http://localhost:3000${url}`, init);

  await t.test('status reports not connected, missing config and setup steps — no resource counts', async () => {
    const res = await status.GET(req('/api/healthlake/status'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.code, 'HEALTHLAKE_NOT_CONFIGURED');
    assert.equal(body.message, 'HealthLake is not connected — no data store configured');
    assert.ok(body.config.missing.includes('AWS_HEALTHLAKE_DATASTORE_ID'));
    assert.equal(body.datastore, null);
    assert.equal(body.resourceCounts, undefined);
    assert.equal(body.demoMode, undefined);
    assert.ok(body.setupSteps.length >= 5);
    assert.deepEqual(body.settings.enabled, false);
    assert.deepEqual(body.settings.allowPart2Sync, false);
  });

  await t.test('FHIR search returns 503 HEALTHLAKE_NOT_CONFIGURED and never a fabricated entry', async () => {
    const res = await fhir.GET(req('/api/healthlake/fhir/Patient'), { params: Promise.resolve({ resourceType: 'Patient' }) });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'HEALTHLAKE_NOT_CONFIGURED');
    assert.equal(body.entries, undefined);
    assert.equal(body.entry, undefined);
    const bad = await fhir.GET(req('/api/healthlake/fhir/Claim'), { params: Promise.resolve({ resourceType: 'Claim' }) });
    assert.equal(bad.status, 400);
  });

  await t.test('import / export / sync return 503 and create no job rows', async () => {
    for (const route of [imp, exp, sync]) {
      const res = await route.POST(req('/api/healthlake/x', { method: 'POST' }));
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, 'HEALTHLAKE_NOT_CONFIGURED');
    }
    assert.deepEqual(writes, []);
  });

  await t.test('jobs list labels old demo rows as demo', async () => {
    const res = await jobs.GET(req('/api/healthlake/jobs'));
    const body = await res.json();
    assert.deepEqual(body.jobs.map((j: { id: string; demoMode: boolean }) => [j.id, j.demoMode]), [
      ['job_demo', true],
      ['job_legacy', true],
    ]);
  });

  await t.test('settings: Part 2 needs explicit confirmation; changes are audited', async () => {
    const patch = (body: unknown) => settings.PATCH(req('/api/healthlake/settings', { method: 'PATCH', body: JSON.stringify(body) }));
    const refused = await patch({ allowPart2Sync: true });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).code, 'PART2_CONFIRMATION_REQUIRED');
    const ok = await patch({ enabled: true, allowPart2Sync: true, confirmPart2: true });
    assert.equal(ok.status, 200);
    const s = (await ok.json()).settings;
    assert.equal(s.enabled, true);
    assert.equal(s.allowPart2Sync, true);
    assert.equal(s.part2EnabledById, 'user1');
    const audit = audits.find((a) => a.action === 'HEALTHLAKE_SETTINGS_UPDATE')!;
    assert.equal(audit.organizationId, 'org1');
    assert.equal((await patch({ junk: true })).status, 400);
  });

  await t.test('non-leadership roles are forbidden', async () => {
    gate.role = 'THERAPIST';
    try {
      const res = await status.GET(req('/api/healthlake/status'));
      assert.equal(res.status, 403);
      const s = await settings.PATCH(req('/api/healthlake/settings', { method: 'PATCH', body: '{}' }));
      assert.equal(s.status, 403);
    } finally {
      gate.role = 'PRACTICE_DIRECTOR';
    }
  });
});
