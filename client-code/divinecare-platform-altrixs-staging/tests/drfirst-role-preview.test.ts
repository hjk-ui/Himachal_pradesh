import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import { getPrescribingUiState } from '../src/lib/drfirst/uiState';
import { assertDrFirstPrescriber, type DrFirstContext } from '../src/lib/drfirst/access';
import { canPrescribe } from '../src/types/roles';

test('DrFirst Role Preview UI and Prescribing Security Constraints', async t => {
  const originalEnv = { ...process.env };
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  let clockOffset = 0;
  Date.now = () => originalNow() + clockOffset;
  globalThis.fetch = async () => {
    throw new Error('Unexpected network call in DrFirst role preview test');
  };
  t.after(() => {
    process.env = originalEnv;
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  });

  process.env = { ...process.env, NODE_ENV: 'development' };
  process.env.DRFIRST_ENABLED = 'true';
  process.env.DRFIRST_ENV = 'mock';
  process.env.DRFIRST_MOCK_FAILURE = 'none';
  process.env.DRFIRST_PASSWORD = 'secret-test-marker';

  // Mock DB storage
  const users = new Map<string, { id: string; name: string; npi: string | null; role: string; roles: string[] }>();
  const rows = new Map<string, unknown>();
  const audits: unknown[] = [];

  const gate: { ok: boolean; userId: string; organizationId: string; role: any; status: number } = {
    ok: true,
    userId: 'user-1',
    organizationId: 'clinic-1',
    role: 'PSYCHIATRIST',
    status: 200,
  };

  const db = {
    client: {
      findFirst: async ({ where }: Prisma.ClientFindFirstArgs) => {
        if (where?.id === 'patient-1') {
          return { id: 'patient-1', name: 'Test Patient', dateOfBirth: new Date('1990-01-01') };
        }
        return null;
      },
    },
    user: {
      findFirst: async ({ where }: Prisma.UserFindFirstArgs) => {
        if (!where?.id || typeof where.id !== 'string') return null;
        return users.get(where.id) ?? null;
      },
    },
    organization: {
      findFirst: async () => ({ id: 'clinic-1', name: 'Altrixs Clinic' }),
    },
    clinicModuleState: {
      upsert: async ({ create }: { create: { organizationId: string; module: string; data: unknown } }) => {
        rows.set(`${create.organizationId}:${create.module}`, create.data);
      },
      create: async (args: unknown) => {
        audits.push(args);
      },
      findUnique: async ({ where }: { where: { organizationId_module: { organizationId: string; module: string } } }) => {
        const key = `${where.organizationId_module.organizationId}:${where.organizationId_module.module}`;
        return rows.has(key) ? { data: rows.get(key) } : null;
      },
    },
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
  type Route = { POST: (req: Request) => Promise<Response>; GET: (req: Request) => Promise<Response> };
  let launchRoute: Route;
  let statusRoute: Route;
  let prescriberRoute: Route;
  let patientRoute: Route;
  let checkDrFirstConnection: (context: DrFirstContext) => Promise<{ enabled: boolean; environment: string; configured: boolean }>;
  let prepareDrFirstLaunch: (input: { clientId: string; prescriberId: string; organizationId: string }, context: DrFirstContext) => Promise<{ session: { mode: string } }>;
  let syncPatientToDrFirst: (clientId: string, context: DrFirstContext) => Promise<unknown>;
  let syncPrescriberToDrFirst: (userId: string, context: DrFirstContext) => Promise<unknown>;
  let readMockLaunch: (token: string, context: DrFirstContext) => Promise<unknown>;

  try {
    launchRoute = require('../src/app/api/integrations/drfirst/launch/route') as Route;
    statusRoute = require('../src/app/api/integrations/drfirst/status/route') as Route;
    prescriberRoute = require('../src/app/api/integrations/drfirst/prescriber/sync/route') as Route;
    patientRoute = require('../src/app/api/integrations/drfirst/patient/sync/route') as Route;
    ({
      checkDrFirstConnection,
      prepareDrFirstLaunch,
      syncPatientToDrFirst,
      syncPrescriberToDrFirst,
      readMockLaunch,
    } = require('../src/lib/drfirst/service'));
  } finally {
    loader._load = originalLoad;
  }

  const postRequest = (body: unknown, origin = 'http://localhost:3000') =>
    new Request('http://localhost:3000/api/integrations/drfirst/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin },
      body: JSON.stringify(body),
    });

  t.beforeEach(() => {
    clockOffset += 60_001;
    users.clear();
    rows.clear();
    audits.length = 0;
    process.env.DRFIRST_ENABLED = 'true';
    process.env.DRFIRST_ENV = 'mock';
  });

  await t.test('1. ADMIN + preview PSYCHIATRIST => UI renders preview form/demo state', () => {
    const userSession = {
      role: 'PSYCHIATRIST' as const,
      baseRole: 'ADMIN' as const,
      rolePreview: true,
    };
    const state = getPrescribingUiState(userSession);

    // In the UI, the prescriber form is open for exploration/review
    assert.equal(state.canPrescribe, true, 'canPrescribe should be true for previewing PSYCHIATRIST');
    assert.equal(state.isRolePreview, true, 'isRolePreview should be true');
    assert.equal(state.isPrescribingPreview, true, 'isPrescribingPreview should be true');
    // Gateway launch is disabled in preview, while local clinical entry / mobile testing is enabled
    assert.equal(state.canLaunchGateway, false, 'gateway launch must be disabled in preview mode');
    assert.equal(state.canCreatePrescription, true, 'clinical prescription entry is enabled for mobile notification testing');
    assert.equal(state.panelMode, 'preview', 'panelMode must be preview');
  });

  await t.test('2. ADMIN + preview NP => UI renders preview form/demo state', () => {
    const userSession = {
      role: 'NP' as const,
      baseRole: 'ADMIN' as const,
      rolePreview: true,
    };
    const state = getPrescribingUiState(userSession);

    assert.equal(state.canPrescribe, true, 'canPrescribe should be true for previewing NP');
    assert.equal(state.isRolePreview, true, 'isRolePreview should be true');
    assert.equal(state.isPrescribingPreview, true, 'isPrescribingPreview should be true');
    assert.equal(state.canLaunchGateway, false, 'gateway launch must be disabled in preview mode');
    assert.equal(state.canCreatePrescription, true, 'clinical prescription entry is enabled for mobile notification testing');
    assert.equal(state.panelMode, 'preview', 'panelMode must be preview');
  });

  await t.test('3. ADMIN without preview => no prescribing access', () => {
    const userSession = {
      role: 'ADMIN' as const,
      baseRole: 'ADMIN' as const,
      rolePreview: false,
    };
    const state = getPrescribingUiState(userSession);

    assert.equal(state.canPrescribe, false, 'canPrescribe must be false for normal ADMIN');
    assert.equal(state.isRolePreview, false, 'isRolePreview must be false');
    assert.equal(state.isPrescribingPreview, false, 'isPrescribingPreview must be false');
    assert.equal(state.canLaunchGateway, false, 'gateway launch must be disabled for ADMIN');
    assert.equal(state.canCreatePrescription, false, 'saving prescriptions must be disabled for ADMIN');
    assert.equal(state.panelMode, 'read-only', 'panelMode must be read-only for ADMIN');

    // Production security constraint: canPrescribe does NOT include ADMIN
    assert.equal(canPrescribe('ADMIN'), false, 'canPrescribe helper must not include ADMIN');
    assert.throws(
      () => assertDrFirstPrescriber({ userId: 'admin-1', organizationId: 'clinic-1', role: 'ADMIN' as any }),
      { code: 'DRFIRST_UNAUTHORIZED' },
      'assertDrFirstPrescriber must reject ADMIN with 403'
    );
  });

  await t.test('4. Real PSYCHIATRIST => normal DrFirst flow still works', async () => {
    const userSession = {
      role: 'PSYCHIATRIST' as const,
      baseRole: 'PSYCHIATRIST' as const,
      rolePreview: false,
    };
    const state = getPrescribingUiState(userSession);

    assert.equal(state.canPrescribe, true, 'canPrescribe is true for real PSYCHIATRIST');
    assert.equal(state.isRolePreview, false, 'isRolePreview is false for real PSYCHIATRIST');
    assert.equal(state.isPrescribingPreview, false, 'isPrescribingPreview is false for real PSYCHIATRIST');
    assert.equal(state.canLaunchGateway, true, 'gateway launch is enabled for real PSYCHIATRIST');
    assert.equal(state.canCreatePrescription, true, 'saving prescription is enabled for real PSYCHIATRIST');
    assert.equal(state.panelMode, 'prescriber', 'panelMode is prescriber');

    // Real DB user is PSYCHIATRIST
    users.set('psych-1', {
      id: 'psych-1',
      name: 'Dr. Sarah Psychiatrist',
      npi: '1234567890',
      role: 'PSYCHIATRIST',
      roles: [],
    });

    const psychContext: DrFirstContext = {
      userId: 'psych-1',
      organizationId: 'clinic-1',
      role: 'PSYCHIATRIST' as any,
    };

    assert.doesNotThrow(() => assertDrFirstPrescriber(psychContext));

    const conn = await checkDrFirstConnection(psychContext);
    assert.deepEqual(conn, { enabled: true, environment: 'mock', configured: false, mock: true });

    const launchResult = await prepareDrFirstLaunch(
      { clientId: 'patient-1', prescriberId: 'psych-1', organizationId: 'clinic-1' },
      psychContext
    );
    assert.equal(launchResult.session.mode, 'MOCK');
  });

  await t.test('5. Real NP => normal DrFirst flow still works', async () => {
    const userSession = {
      role: 'NP' as const,
      baseRole: 'NP' as const,
      rolePreview: false,
    };
    const state = getPrescribingUiState(userSession);

    assert.equal(state.canPrescribe, true, 'canPrescribe is true for real NP');
    assert.equal(state.isRolePreview, false, 'isRolePreview is false for real NP');
    assert.equal(state.isPrescribingPreview, false, 'isPrescribingPreview is false for real NP');
    assert.equal(state.canLaunchGateway, true, 'gateway launch is enabled for real NP');
    assert.equal(state.canCreatePrescription, true, 'saving prescription is enabled for real NP');
    assert.equal(state.panelMode, 'prescriber', 'panelMode is prescriber');

    // Real DB user is NP
    users.set('np-1', {
      id: 'np-1',
      name: 'Nurse Practitioner John',
      npi: '9876543210',
      role: 'NP',
      roles: [],
    });

    const npContext: DrFirstContext = {
      userId: 'np-1',
      organizationId: 'clinic-1',
      role: 'NP' as any,
    };

    assert.doesNotThrow(() => assertDrFirstPrescriber(npContext));

    const conn = await checkDrFirstConnection(npContext);
    assert.deepEqual(conn, { enabled: true, environment: 'mock', configured: false, mock: true });

    const launchResult = await prepareDrFirstLaunch(
      { clientId: 'patient-1', prescriberId: 'np-1', organizationId: 'clinic-1' },
      npContext
    );
    assert.equal(launchResult.session.mode, 'MOCK');
  });

  await t.test('6. ADMIN cannot call protected DrFirst APIs directly', async () => {
    // Real DB user has role ADMIN (no prescribing credential in DB)
    users.set('admin-1', {
      id: 'admin-1',
      name: 'Admin User',
      npi: null,
      role: 'ADMIN',
      roles: [],
    });

    // 6a: ADMIN attempting direct backend calls while in Role Preview (session role is PSYCHIATRIST)
    const previewAdminContext: DrFirstContext = {
      userId: 'admin-1',
      organizationId: 'clinic-1',
      role: 'PSYCHIATRIST' as any,
    };

    gate.userId = 'admin-1';
    gate.organizationId = 'clinic-1';
    gate.role = 'PSYCHIATRIST';

    // checkDrFirstConnection verifies prescriberDto from the DB and rejects
    await assert.rejects(
      async () => checkDrFirstConnection(previewAdminContext),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403,
      'checkDrFirstConnection must reject role preview admin'
    );

    // prepareDrFirstLaunch rejects because admin is not a DB prescriber
    await assert.rejects(
      async () =>
        prepareDrFirstLaunch(
          { clientId: 'patient-1', prescriberId: 'admin-1', organizationId: 'clinic-1' },
          previewAdminContext
        ),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403,
      'prepareDrFirstLaunch must reject role preview admin'
    );

    // syncPatientToDrFirst rejects
    await assert.rejects(
      async () => syncPatientToDrFirst('patient-1', previewAdminContext),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403,
      'syncPatientToDrFirst must reject role preview admin'
    );

    // syncPrescriberToDrFirst rejects
    await assert.rejects(
      async () => syncPrescriberToDrFirst('admin-1', previewAdminContext),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403,
      'syncPrescriberToDrFirst must reject role preview admin'
    );

    // readMockLaunch rejects
    await assert.rejects(
      async () => readMockLaunch('fake-token', previewAdminContext),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403,
      'readMockLaunch must reject role preview admin'
    );

    // HTTP Route calls by role preview admin also return 403
    const launchRes = await launchRoute.POST(postRequest({ clientId: 'patient-1' }));
    assert.equal(launchRes.status, 403, 'launch API route must return 403 for role preview admin');

    const patientRes = await patientRoute.POST(postRequest({ clientId: 'patient-1' }));
    assert.equal(patientRes.status, 403, 'patient sync API route must return 403 for role preview admin');

    const prescriberRes = await prescriberRoute.POST(postRequest({ userId: 'admin-1' }));
    assert.equal(prescriberRes.status, 403, 'prescriber sync API route must return 403 for role preview admin');

    // 6b: ADMIN attempting direct backend calls without role preview (session role is ADMIN)
    const rawAdminContext: DrFirstContext = {
      userId: 'admin-1',
      organizationId: 'clinic-1',
      role: 'ADMIN' as any,
    };

    gate.role = 'ADMIN';

    assert.throws(
      () => assertDrFirstPrescriber(rawAdminContext),
      (err: any) => err.code === 'DRFIRST_UNAUTHORIZED' && err.status === 403
    );

    const rawLaunchRes = await launchRoute.POST(postRequest({ clientId: 'patient-1' }));
    assert.equal(rawLaunchRes.status, 403, 'launch API route must return 403 for raw admin');

    const rawPatientRes = await patientRoute.POST(postRequest({ clientId: 'patient-1' }));
    assert.equal(rawPatientRes.status, 403, 'patient sync API route must return 403 for raw admin');

    const rawPrescriberRes = await prescriberRoute.POST(postRequest({ userId: 'admin-1' }));
    assert.equal(rawPrescriberRes.status, 403, 'prescriber sync API route must return 403 for raw admin');
  });
});
