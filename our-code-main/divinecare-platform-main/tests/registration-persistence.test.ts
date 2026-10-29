import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

test('registration validates input and commits all account records atomically', async () => {
  let committed: string[] = [];
  let failSettings = false;
  let duplicateEmail = false;
  const db = {
    user: { findUnique: async () => duplicateEmail ? { id: 'existing' } : null },
    organization: { findUnique: async () => null },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const pending: string[] = [];
      const result = await run({
        organization: { create: async () => { pending.push('organization'); return { id: 'org', name: 'Test Practice', slug: 'test-practice', locations: [{ id: 'location' }] }; } },
        user: { create: async ({ data }: { data: Record<string, unknown> }) => { pending.push('user'); assert.equal(data.organizationId, 'org'); return { id: 'user' }; } },
        userLocation: { create: async () => { pending.push('membership'); } },
        clinicModuleState: { createMany: async ({ data }: { data: Array<{ module: string }> }) => {
          if (failSettings) throw new Error('Sensitive database failure');
          pending.push(...data.map((row) => row.module));
        } },
        baaAcceptance: { create: async () => { pending.push('baa-acceptance'); } },
      });
      committed = pending;
      return result;
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === 'bcryptjs') return { hash: async () => 'test-hash' };
    return original.call(this, id, ...args);
  };
  let post: (req: Request) => Promise<Response>;
  try { post = createRequire(import.meta.url)('../src/app/api/auth/register/route').POST; }
  finally { loader._load = original; }
  const request = (data: unknown) => new Request('http://localhost/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
  const { BAA_VERSION } = createRequire(import.meta.url)('../src/lib/legal/baa');
  const valid = {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    password: 'ClinicSecure!99x',
    orgName: 'Rivera Practice',
    baa: {
      accepted: true,
      version: BAA_VERSION,
      signerName: 'Alex Rivera',
      signerTitle: 'Owner',
      signerEmail: 'alex.rivera@example.com',
    },
  };
  assert.equal((await post(request({}))).status, 400);
  assert.deepEqual(committed, []);
  assert.equal((await post(request(valid))).status, 200);
  assert.deepEqual(committed, [
    'organization',
    'user',
    'membership',
    'subscription-state',
    'solo-practice-settings',
    'baa-acceptance',
  ]);
  committed = [];
  duplicateEmail = true;
  const duplicate = await post(request(valid));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(committed, []);
  duplicateEmail = false;
  committed = [];
  failSettings = true;
  const failed = await post(request(valid));
  assert.equal(failed.status, 500);
  assert.equal((await failed.text()).includes('Sensitive'), false);
  assert.deepEqual(committed, []);
});
