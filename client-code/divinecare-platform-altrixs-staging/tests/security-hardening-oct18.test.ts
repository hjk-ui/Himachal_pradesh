import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

/**
 * Oct 18 security hardening: telehealth join tokens, denial-status IDOR, admin baseRole trust,
 * staff self-role change, public-intake duplicate handling, patient Chime view.
 * Every dependency that touches the DB is replaced with an in-memory fake.
 */

type Loader = { _load: (id: string, ...args: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '..');

/** Load a module with some import ids replaced; restores the loader afterwards. */
function loadWith<T>(modulePath: string, stubs: Record<string, unknown>): T {
  const original = loader._load;
  loader._load = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    if (id in stubs) return stubs[id];
    return original.call(this, id, ...args);
  };
  try {
    return require(modulePath) as T;
  } finally {
    loader._load = original;
  }
}

type AuditEntry = Record<string, unknown> & { action: string; metadata?: Record<string, unknown> };

// ---------------------------------------------------------------------------------------------
// 1. Telehealth join / check-in
// ---------------------------------------------------------------------------------------------
test('telehealth join link: only a stored joinToken or a signed token works', async (t) => {
  const audits: AuditEntry[] = [];
  const sessions = [
    {
      id: 'sess_aaaaaaaaaaaaaaaa',
      appointmentId: 'appt_bbbbbbbbbbbbbbbb',
      clientId: 'client_1',
      organizationId: 'org_1',
      joinToken: 'stored-random-join-token-0001',
      status: 'UPCOMING',
      clientName: 'Synthetic Patient',
      clinicianName: 'Dr. Synthetic',
      sessionDate: new Date('2026-10-20T00:00:00Z'),
      startTime: '10:00',
      notesSummary: 'secret clinical note',
      patientJoinToken: 'chime-patient-secret',
      clinicianJoinToken: 'chime-clinician-secret',
      patientPhone: '+14105550100',
      patientEmail: 'synthetic@example.test',
      transcriptUri: 's3://bucket/transcript',
      recordingUrl: 's3://bucket/recording',
      chimeMeetingId: null,
      chimeData: null,
      patientCheckedIn: false,
    },
  ];
  const whereLog: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR && !where.OR.some((w: unknown) => matches(row, w))) return false;
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR') continue;
      if (row[k] !== v) return false;
    }
    return true;
  };
  const db = {
    telehealthSession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) => {
        whereLog.push(where);
        return sessions.find((s) => matches(s, where)) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        const row = sessions.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return { ...row, client: { name: row.clientName, image: null } };
      },
    },
    appointment: { findFirst: async () => null, update: async () => null },
    telehealthAuditLog: { create: async () => ({}) },
  };
  const stubs = {
    '@/lib/db/prisma': { prisma: db },
    '@/lib/audit/writeAuditLog': { writeAuditLog: async (e: AuditEntry) => void audits.push(e) },
    '@/lib/telehealth/chime': {
      createChimeAttendee: async () => ({ attendee: {}, joinToken: 'x', demoMode: true }),
      loadStoredChimeMeeting: async () => null,
    },
    '@/lib/time/practiceTimeServer': { getPracticeTimeZone: async () => 'America/New_York' },
  };
  const joinRoute = loadWith<{ GET: (r: Request, c: unknown) => Promise<Response> }>(
    '../src/app/api/telehealth/join/[token]/route',
    stubs
  );
  const checkInRoute = loadWith<{ POST: (r: Request, c: unknown) => Promise<Response> }>(
    '../src/app/api/telehealth/join/[token]/check-in/route',
    stubs
  );
  const { createTelehealthJoinToken } = loadWith<{
    createTelehealthJoinToken: (i: { appointmentId: string; clientId: string }) => string;
  }>('../src/lib/telehealth/join-token', {});

  const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
  const getJoin = (token: string) => joinRoute.GET(new Request(`http://localhost/api/telehealth/join/${token}`), ctx(token));
  const checkIn = (token: string) =>
    checkInRoute.POST(
      new Request(`http://localhost/api/telehealth/join/${token}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ consentSigned: true, locationState: 'MD' }),
      }),
      ctx(token)
    );

  await t.test('the session id and appointmentId are not accepted as join tokens', async () => {
    for (const guess of ['sess_aaaaaaaaaaaaaaaa', 'appt_bbbbbbbbbbbbbbbb']) {
      const res = await getJoin(guess);
      assert.ok(res.status === 401 || res.status === 404, `GET ${guess} -> ${res.status}`);
      const ci = await checkIn(guess);
      assert.equal(ci.status, 404, `check-in ${guess}`);
    }
    for (const w of whereLog) {
      const json = JSON.stringify(w);
      assert.ok(!/"id":"sess_|"appointmentId":"appt_/.test(json) || /"clientId"/.test(json), `unsafe lookup ${json}`);
    }
  });

  await t.test('the stored join token works', async () => {
    const res = await getJoin('stored-random-join-token-0001');
    assert.equal(res.status, 200);
  });

  await t.test('signed token check-in must match the client it was issued for', async () => {
    const wrongClient = createTelehealthJoinToken({ appointmentId: 'sess_aaaaaaaaaaaaaaaa', clientId: 'client_OTHER' });
    assert.equal((await checkIn(wrongClient)).status, 404);
    const good = createTelehealthJoinToken({ appointmentId: 'sess_aaaaaaaaaaaaaaaa', clientId: 'client_1' });
    const res = await checkIn(good);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body.session).sort(), ['clinicianName', 'date', 'startTime', 'status']);
    const text = JSON.stringify(body);
    for (const secret of ['chime-patient-secret', 'chime-clinician-secret', '+14105550100', 'synthetic@example.test', 'secret clinical note', 's3://']) {
      assert.equal(text.includes(secret), false, `check-in leaked ${secret}`);
    }
    assert.ok(audits.some((a) => a.action === 'TELEHEALTH_CHECK_IN'));
  });

  await t.test('internal errors are not echoed to the public caller', async () => {
    const original = db.telehealthSession.findFirst;
    db.telehealthSession.findFirst = async () => {
      throw new Error('Sensitive prisma detail: relation "TelehealthSession" column x');
    };
    try {
      const a = await getJoin('stored-random-join-token-0001');
      assert.equal((await a.text()).includes('Sensitive'), false);
      const b = await checkIn('stored-random-join-token-0001');
      assert.equal((await b.text()).includes('Sensitive'), false);
    } finally {
      db.telehealthSession.findFirst = original;
    }
  });
});

test('staff telehealth UI never builds a join link from session.id', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/dashboard/telehealth/page.tsx'), 'utf8');
  assert.equal(/telehealth\/join\/\$\{encodeURIComponent\(session\.id\)\}/.test(src), false);
});

test('patient join page gets the client Chime view, never the EHR drawer', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/app/telehealth/join/[token]/page.tsx'), 'utf8');
  const view = fs.readFileSync(path.join(ROOT, 'src/components/telehealth/ChimeMeetingView.tsx'), 'utf8');
  const chimeUse = page.slice(page.indexOf('<ChimeMeetingView'), page.indexOf('/>', page.indexOf('<ChimeMeetingView')));
  assert.match(chimeUse, /role="client"/);
  assert.match(view, /role = 'client'/);
  assert.equal(view.includes("role = 'DOCTOR_PSYCHIATRIST'"), false);
  // Drawer, EHR toggle, invite link and phone fallback all sit behind isStaffView
  assert.match(view, /isStaffView \? \(\s*<InCallEhrDrawer/);
  assert.match(view, /isStaffView && patientJoinUrl/);
  assert.match(view, /isStaffView && phoneFallbackOpen/);
  assert.match(view, /\{isStaffView \? \(\s*<button[\s\S]{0,200}setEhrDrawerOpen/);
  // The drawer APIs are not on the public allowlist
  const proxy = fs.readFileSync(path.join(ROOT, 'src/proxy.ts'), 'utf8');
  for (const api of ['/api/telehealth/in-call', '/api/drfirst', '/api/crisis', '/api/labs']) {
    assert.equal(proxy.includes(`startsWith('${api}`), false, `${api} must not be public`);
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Denial status IDOR
// ---------------------------------------------------------------------------------------------
test('denial status update is org-scoped, validated, minimal and audited', async (t) => {
  const gate = { ok: true, userId: 'biller', organizationId: 'org_1', role: 'BILLING', status: 401, error: 'Unauthorized', session: { user: { id: 'biller' } } };
  const audits: AuditEntry[] = [];
  const denials = [
    { id: 'den_1', organizationId: 'org_1', claimId: 'clm_1', status: 'OPEN', appealLetterBody: 'LETTER BODY PHI', claim: { clientId: 'c1' } },
    { id: 'den_2', organizationId: 'org_2', claimId: 'clm_2', status: 'OPEN', appealLetterBody: 'OTHER ORG', claim: { clientId: 'c2' } },
  ];
  let lastWhere: Record<string, unknown> | null = null;
  let failUpdate = false;
  const db = {
    claimDenial: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) => {
        lastWhere = where;
        return (
          denials.find(
            (d) => d.organizationId === where.organizationId && (d.id === where.OR[0].id || d.claimId === where.OR[1].claimId)
          ) ?? null
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data, select }: any) => {
        if (failUpdate) throw new Error('Sensitive constraint "ClaimDenial_pkey"');
        const d = denials.find((x) => x.id === where.id)!;
        Object.assign(d, data);
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (d as Record<string, unknown>)[k] ?? null;
        out.updatedAt = new Date();
        return out;
      },
    },
  };
  const route = loadWith<{ PUT: (r: Request, c: unknown) => Promise<Response> }>(
    '../src/app/api/billing/denials/[id]/status/route',
    {
      '@/lib/db/prisma': { prisma: db },
      '@/lib/auth/tenant': { requireOrgContext: async () => gate },
      '@/lib/audit/requestMeta': {
        auditPhiAccess: async ({ gate: g, req: _r, ...e }: AuditEntry & { gate: { userId: string } }) =>
          void audits.push({ ...e, actorUserId: g.userId }),
      },
    }
  );
  const put = (id: string, body: unknown) =>
    route.PUT(
      new Request(`http://localhost/api/billing/denials/${id}/status`, { method: 'PUT', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) }
    );

  await t.test('another org\'s denial is a 404 and the query carries organizationId', async () => {
    const res = await put('den_2', { status: 'APPEALED' });
    assert.equal(res.status, 404);
    assert.equal((lastWhere as unknown as { organizationId: string }).organizationId, 'org_1');
    assert.ok((lastWhere as unknown as { claim: unknown }).claim, 'care-team scope on claim.client');
    assert.equal(denials[1].status, 'OPEN');
    assert.ok(audits.some((a) => a.outcome === 'DENIED'));
  });

  await t.test('only real ClaimDenial statuses are accepted', async () => {
    assert.equal((await put('den_1', { status: 'PAID' })).status, 400);
    assert.equal((await put('den_1', { status: "OPEN'; DROP" })).status, 400);
    assert.equal(denials[0].status, 'OPEN');
  });

  await t.test('UI labels map to the enum, response omits appealLetterBody, audit written', async () => {
    const res = await put('den_1', { status: 'in_appeal', resolutionNote: 'sent' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.denial.status, 'APPEALED');
    assert.equal('appealLetterBody' in body.denial, false);
    assert.equal(JSON.stringify(body).includes('LETTER BODY'), false);
    const entry = audits.find((a) => a.action === 'UPDATE' && a.outcome !== 'DENIED');
    assert.ok(entry);
    assert.equal(entry!.metadata!.toStatus, 'APPEALED');
  });

  await t.test('billing-ineligible roles are refused; internal errors stay generic', async () => {
    gate.role = 'THERAPIST';
    assert.equal((await put('den_1', { status: 'WON' })).status, 403);
    gate.role = 'BILLING';
    failUpdate = true;
    const res = await put('den_1', { status: 'WON' });
    assert.equal(res.status, 500);
    assert.equal((await res.text()).includes('Sensitive'), false);
    failUpdate = false;
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Admin baseRole trust + staff self-role change + 4. invalidate/audit
// ---------------------------------------------------------------------------------------------
test('requireAdmin ignores a stale JWT baseRole and re-reads the DB role', async () => {
  const gate = {
    ok: true,
    userId: 'u1',
    organizationId: 'org_1',
    role: 'THERAPIST',
    session: { user: { id: 'u1', baseRole: 'ADMIN' } },
  };
  let dbAdmin: 'ADMIN' | null = null;
  const mod = loadWith<{
    requireAdmin: () => Promise<{ ok: boolean; status?: number }>;
    requireFullAdmin: () => Promise<{ ok: boolean; status?: number }>;
  }>('../src/lib/auth/requireAdmin', {
    '@/lib/auth/tenant': { requireOrgContext: async () => gate },
    '@/lib/auth/requireSession': { verifiedAdminBaseRole: async () => dbAdmin },
  });
  // JWT says ADMIN, DB says demoted: refused
  assert.equal((await mod.requireAdmin()).ok, false);
  assert.equal((await mod.requireFullAdmin()).ok, false);
  // DB says ADMIN (admin previewing THERAPIST): allowed
  dbAdmin = 'ADMIN';
  assert.equal((await mod.requireAdmin()).ok, true);
  assert.equal((await mod.requireFullAdmin()).ok, true);

  for (const f of ['src/lib/auth/requireAdmin.ts', 'src/app/api/clients/route.ts', 'src/app/api/clients/[id]/notes/route.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/user\??\.baseRole/.test(src), false, `${f} still trusts JWT baseRole`);
  }
});

test('verifiedAdminBaseRole reads the DB row (inactive or demoted users get null)', async () => {
  const rows: Record<string, unknown> = {
    admin: { status: 'ACTIVE', role: 'ADMIN', roles: [], organizationId: 'o', organization: { active: true } },
    multi: { status: 'ACTIVE', role: 'THERAPIST', roles: ['PRACTICE_DIRECTOR'], organizationId: 'o', organization: { active: true } },
    demoted: { status: 'ACTIVE', role: 'THERAPIST', roles: ['THERAPIST'], organizationId: 'o', organization: { active: true } },
    gone: { status: 'DEACTIVATED', role: 'ADMIN', roles: [], organizationId: 'o', organization: { active: true } },
  };
  const mod = loadWith<{ verifiedAdminBaseRole: (id: string) => Promise<string | null> }>('../src/lib/auth/requireSession', {
    '@/lib/auth': { auth: async () => null },
    '@/lib/db/prisma': {
      prisma: { user: { findUnique: async ({ where }: { where: { id: string } }) => rows[where.id] ?? null } },
    },
  });
  assert.equal(await mod.verifiedAdminBaseRole('admin'), 'ADMIN');
  assert.equal(await mod.verifiedAdminBaseRole('multi'), 'PRACTICE_DIRECTOR');
  assert.equal(await mod.verifiedAdminBaseRole('demoted'), null);
  assert.equal(await mod.verifiedAdminBaseRole('gone'), null);
  assert.equal(await mod.verifiedAdminBaseRole('missing'), null);
});

test('updateStaffUser: no self role/status change; invalidates session and audits changes', async (t) => {
  const audits: AuditEntry[] = [];
  const invalidated: string[] = [];
  const users: Record<string, Record<string, unknown>> = {
    admin: { id: 'admin', role: 'ADMIN', roles: ['ADMIN'], status: 'ACTIVE', organizationId: 'org_1', primaryLocationId: null, passwordHash: 'x' },
    staff: { id: 'staff', role: 'THERAPIST', roles: ['THERAPIST'], status: 'ACTIVE', organizationId: 'org_1', primaryLocationId: null, passwordHash: 'x' },
  };
  const view = (u: Record<string, unknown>) => ({
    ...u,
    name: 'Staff',
    email: `${u.id}@example.test`,
    image: null,
    inviteExpiresAt: null,
    createdAt: new Date(),
    rcopiaUsername: null,
    primaryLocation: null,
  });
  const db = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => (users[where.id] ? { ...users[where.id] } : null),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => view(users[where.id]),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(users[where.id], data),
      count: async () => 1,
      findFirst: async () => null,
    },
  };
  const mod = loadWith<{
    updateStaffUser: (
      t: string,
      a: string,
      o: string,
      i: Record<string, unknown>,
      m?: Record<string, unknown>
    ) => Promise<{ ok: boolean; status?: number; error?: string }>;
  }>('../src/lib/staff/manage', {
    '@/lib/db/prisma': { prisma: db },
    '@/lib/org/locations': { assignUserToLocation: async () => ({ ok: true }) },
    '@/lib/auth/requireSession': { invalidateSessionUser: (id: string) => void invalidated.push(id) },
    '@/lib/audit/writeAuditLog': { writeAuditLog: async (e: AuditEntry) => void audits.push(e) },
  });

  await t.test('an admin cannot change their own role or status', async () => {
    const a = await mod.updateStaffUser('admin', 'admin', 'org_1', { role: 'THERAPIST' });
    assert.equal(a.ok, false);
    assert.equal(a.status, 400);
    assert.equal(a.error, 'You cannot change your own role');
    const b = await mod.updateStaffUser('admin', 'admin', 'org_1', { roles: ['ADMIN', 'PSYCHIATRIST'] });
    assert.equal(b.status, 400);
    const c = await mod.updateStaffUser('admin', 'admin', 'org_1', { status: 'DEACTIVATED' });
    assert.equal(c.status, 400);
    assert.equal(users.admin.role, 'ADMIN');
    assert.equal(users.admin.status, 'ACTIVE');
    assert.equal(audits.length, 0);
  });

  await t.test('changing someone else invalidates their cached session row and audits before/after', async () => {
    const r = await mod.updateStaffUser('staff', 'admin', 'org_1', { role: 'PSYCHIATRIST', roles: ['PSYCHIATRIST'] }, { actorRole: 'ADMIN' });
    assert.equal(r.ok, true);
    assert.deepEqual(invalidated, ['staff']);
    const entry = audits.find((a) => a.action === 'STAFF_ACCESS_CHANGE');
    assert.ok(entry);
    assert.equal(entry!.actorUserId, 'admin');
    assert.equal(entry!.resourceId, 'staff');
    assert.equal(entry!.metadata!.beforeRole, 'THERAPIST');
    assert.equal(entry!.metadata!.afterRole, 'PSYCHIATRIST');
  });
});

test('updatePlatformUser invalidates the session row and audits role/status changes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/platform/manage.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function updatePlatformUser'));
  assert.match(fn, /invalidateSessionUser\(userId\)/);
  assert.match(fn, /action: 'STAFF_ACCESS_CHANGE'/);
});

// ---------------------------------------------------------------------------------------------
// 5. Public intake: never overwrite an existing chart by email
// ---------------------------------------------------------------------------------------------
test('public intake with a taken email creates a flagged new chart and never overwrites', async () => {
  const audits: AuditEntry[] = [];
  const clients: Record<string, Record<string, unknown>> = {
    existing: { id: 'existing', organizationId: 'org_1', email: 'shared@example.test', name: 'Original Person', insurancePayer: 'Payer A' },
  };
  const clientUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const createdInputs: Array<Record<string, unknown>> = [];
  const invite = {
    id: 'inv_1',
    token: 'tok',
    organizationId: 'org_1',
    clientId: null,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 86_400_000),
    clientName: 'New Person',
    clientEmail: 'shared@example.test',
    clientPhone: null,
    createdById: 'staff_1',
    assignedToId: null,
    insurancePayer: null,
    waitlistEntryId: null,
  };
  const db = {
    intakeInvite: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => invite,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        ...invite,
        ...data,
        sentCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        firstAppointment: null,
      }),
    },
    client: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        Object.values(clients).find((c) => c.email === where.email) ?? null,
      findFirst: async () => null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        clientUpdates.push({ id: where.id, data });
        Object.assign(clients[where.id] ?? {}, data);
        return clients[where.id];
      },
    },
    user: { findFirst: async () => null },
    waitlistEntry: { updateMany: async () => ({ count: 0 }) },
  };
  const mod = loadWith<{
    completeIntakeInvite: (token: string, payload: unknown) => Promise<{ ok: boolean; clientId?: string | null }>;
  }>('../src/lib/intake/manage', {
    '@/lib/db/prisma': { prisma: db },
    '@/lib/audit/writeAuditLog': { writeAuditLog: async (e: AuditEntry) => void audits.push(e) },
    '@/lib/clients/manage': {
      createClient: async (input: Record<string, unknown>) => {
        createdInputs.push(input);
        if (input.email && Object.values(clients).some((c) => c.email === input.email)) {
          return { ok: false, status: 409, error: 'A client with this email already exists' };
        }
        const id = `new_${createdInputs.length}`;
        clients[id] = { id, organizationId: 'org_1', ...input };
        return { ok: true, client: { id } };
      },
    },
  });

  const result = await mod.completeIntakeInvite('tok', {
    demographics: { firstName: 'New', lastName: 'Person', email: 'shared@example.test', phone: '4105550199', dateOfBirth: '1990-01-01' },
    insurance: { primaryPayer: 'Payer B', memberId: 'M1', groupNumber: null },
    signature: { fullName: 'New Person' },
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.clientId, 'existing', 'must not attach to the existing chart');
  // Existing chart untouched
  assert.equal(clientUpdates.some((u) => u.id === 'existing'), false);
  assert.equal(clients.existing.name, 'Original Person');
  assert.equal(clients.existing.insurancePayer, 'Payer A');
  // New chart flagged for identity review, holding the email as unverified
  const newId = result.clientId as string;
  assert.equal(clients[newId].email, null);
  assert.equal(clients[newId].unverifiedEmail, 'shared@example.test');
  assert.equal(clients[newId].identityVerifyRequired, true);
  assert.equal(clients[newId].identityVerifyReason, 'possible_duplicate_email');
  const entry = audits.find((a) => a.action === 'INTAKE_POSSIBLE_DUPLICATE');
  assert.ok(entry, 'staff review audit entry');
  assert.equal(entry!.metadata!.possibleDuplicateOfClientId, 'existing');
  assert.equal(entry!.metadata!.merged, false);
});
