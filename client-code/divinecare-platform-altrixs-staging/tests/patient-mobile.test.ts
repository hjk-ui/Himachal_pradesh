import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { hash, compare } from 'bcryptjs';
import { signPatientPasswordReset, signPatientSession } from '../src/patient/infrastructure/security/tokens';

test('patient mobile auth, recovery, profile and form routes', async (t) => {
  const patient = {
    id: 'patient-1', name: 'Synthetic Patient', email: 'patient@example.test', phone: '+14105550100',
    active: true, status: 'ACTIVE', image: null, addressLine1: null, addressLine2: null,
    city: null, state: null, postalCode: null, emergencyContactName: null, emergencyContactPhone: null,
    location: { organizationId: 'clinic-1' }, assignedTo: null,
    primaryDiagnosis: 'private clinical value',
  };
  const account = {
    id: 'account-1', clientId: patient.id, email: patient.email, status: 'ACTIVE',
    passwordHash: await hash('Original123', 12), client: patient,
  };
  const forms = [
    { id: 'form-1', clientId: patient.id, organizationId: 'clinic-1', type: 'Consent to Treat', status: 'PENDING', method: 'In-Person',
      sentAt: new Date(), signedAt: null, expiresAt: null, signedByName: null, notes: 'private staff note', createdById: 'staff-1' },
    { id: 'other-patient-form', clientId: 'patient-2', organizationId: 'clinic-1' },
    { id: 'other-clinic-form', clientId: patient.id, organizationId: 'clinic-2' },
  ];
  const mail: { text: string; to: string }[] = [];
  let mailFails = false, profileWrites = 0, databaseFails = false;
  const project = (row: any, select: any) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  const formMatches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
  const db = {
    patientAccount: {
      findUnique: async ({ where }: any) => where.email === account.email ? structuredClone(account) : null,
      // Session lookups match by id + status; password-reset proofs also pin the client id
      findFirst: async ({ where }: any) =>
        where.id === account.id && (where.clientId === undefined || where.clientId === account.clientId) && where.status === account.status ? structuredClone(account) : null,
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.client.active, true);
        if (where.id !== account.id || where.passwordHash !== account.passwordHash || account.status !== 'ACTIVE' ||
            !patient.active || patient.status === 'DISCHARGED') return { count: 0 };
        account.passwordHash = data.passwordHash;
        return { count: 1 };
      },
    },
    client: {
      findUnique: async ({ where, select }: any) => {
        assert.equal(where.id, patient.id);
        if (databaseFails) throw new Error('Database secret must not reach mobile');
        return project(patient, select);
      },
      // Forgot-password's chart-email fallback; no other synthetic client has a portal account.
      findFirst: async () => null,
      // Portal people list (login): the account's own chart
      findMany: async ({ where }: any) => (where.id.in.includes(patient.id) ? [structuredClone(patient)] : []),
      update: async ({ where, data, select }: any) => {
        assert.equal(where.id, patient.id);
        profileWrites++;
        Object.assign(patient, data);
        return project(patient, select);
      },
    },
    consentForm: {
      count: async ({ where }: any) => forms.filter((f) => formMatches(f, where)).length,
      findMany: async ({ where, select, skip, take }: any) =>
        forms.filter((f) => formMatches(f, where)).slice(skip, skip + take).map((row) => project(row, select)),
      findFirst: async ({ where, select }: any) => {
        const row = forms.find((f) => formMatches(f, where));
        return row ? project(row, select) : null;
      },
    },
    patientAuditLog: { create: async () => ({}) },
    // Pre-migration account: no PortalAccess rows (the own chart is an implicit 'self' link)
    portalAccess: { findUnique: async () => null, findMany: async () => [] },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/mail/sendEmail') return { sendEmail: async (input: any) => {
      if (mailFails) throw new Error('SMTP secret');
      mail.push(input); return { mode: 'smtp' };
    } };
    if (id === '@/lib/staff/invite') return { getAppBaseUrl: () => 'https://example.test' };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let login: typeof import('../src/app/api/patient/login/route');
  let forgot: typeof import('../src/app/api/patient/forgot-password/route');
  let reset: typeof import('../src/app/api/patient/reset-password/route');
  let me: typeof import('../src/app/api/patient/me/route');
  let formList: typeof import('../src/app/api/patient/forms/route');
  let formDetail: typeof import('../src/app/api/patient/forms/[id]/route');
  try {
    login = require('../src/app/api/patient/login/route');
    forgot = require('../src/app/api/patient/forgot-password/route');
    reset = require('../src/app/api/patient/reset-password/route');
    me = require('../src/app/api/patient/me/route');
    formList = require('../src/app/api/patient/forms/route');
    formDetail = require('../src/app/api/patient/forms/[id]/route');
  } finally { loader._load = originalLoad; }
  let ip = 0;
  let token = signPatientSession(account.id, patient.id, account.passwordHash);
  const req = (method: string, data?: unknown, auth = true, query = '') => new Request('https://example.test/api/patient/test' + query, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': 'test-' + (++ip), ...(auth ? { Authorization: 'Bearer ' + token } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });

  await t.test('login normalizes email and excludes account credentials', async () => {
    const res = await login.POST(req('POST', { email: 'PATIENT@example.test', password: 'Original123' }, false));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.client.id, patient.id);
    token = body.data.token;
    assert.equal(JSON.stringify(body).includes('passwordHash'), false);
    assert.equal((await login.POST(req('POST', { email: 'staff@example.test', password: 'Original123' }, false))).status, 401);
  });

  await t.test('all protected routes reject absent auth and reset proofs used as sessions', async () => {
    assert.equal((await me.GET(req('GET', undefined, false))).status, 401);
    assert.equal((await me.PATCH(req('PATCH', { phone: null }, false))).status, 401);
    assert.equal((await formList.GET(req('GET', undefined, false))).status, 401);
    assert.equal((await formDetail.GET(req('GET', undefined, false), { params: Promise.resolve({ id: 'form-1' }) })).status, 401);
    const original = token;
    token = signPatientPasswordReset(account.id, patient.id, account.passwordHash);
    assert.equal((await me.GET(req('GET'))).status, 401);
    token = original;
  });

  await t.test('profile is accessible without clinic assignment and only allowed fields can change', async () => {
    const location = patient.location; patient.location = null;
    assert.equal((await me.GET(req('GET'))).status, 200);
    assert.equal((await formList.GET(req('GET'))).status, 403);
    patient.location = location;
    const response = await me.PATCH(req('PATCH', { phone: '+14105550101', city: '  Baltimore  ' }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.client.city, 'Baltimore');
    assert.equal(body.data.client.email, account.email);
    assert.equal('primaryDiagnosis' in body.data.client, false);
    for (const body of [{ clientId: 'other' }, { email: 'attacker@example.test' }, { status: 'ACTIVE' }, { name: 'Changed' }, {}, { phone: 'nonsense' }]) {
      assert.equal((await me.PATCH(req('PATCH', body))).status, 400);
    }
    assert.equal(profileWrites, 1);
    assert.equal((await me.PATCH(req('PATCH', { phone: null }))).status, 200);
    assert.equal(patient.phone, null);
  });

  await t.test('malformed JSON and async failures return safe JSON envelopes', async () => {
    const bad = new Request('https://example.test/api/patient/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + token }, body: '{bad' });
    const res = await me.PATCH(bad);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    databaseFails = true;
    const failure = await me.GET(req('GET'));
    databaseFails = false;
    assert.equal(failure.status, 500);
    assert.equal((await failure.text()).includes('Database secret'), false);
    assert.equal(failure.headers.get('Cache-Control'), 'private, no-store');
  });

  await t.test('forms are patient/clinic scoped, metadata only, with validated pagination', async () => {
    const res = await formList.GET(req('GET'));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.pagination.total, 1);
    assert.deepEqual(body.data.forms.map((f: any) => f.id), ['form-1']);
    assert.equal('notes' in body.data.forms[0], false);
    assert.equal('createdById' in body.data.forms[0], false);
    for (const id of ['other-patient-form', 'other-clinic-form', 'missing']) {
      assert.equal((await formDetail.GET(req('GET'), { params: Promise.resolve({ id }) })).status, 404);
    }
    assert.equal((await formDetail.GET(req('GET'), { params: Promise.resolve({ id: 'form-1' }) })).status, 200);
    for (const query of ['?page=NaN', '?page=1.5', '?limit=Infinity', '?limit=-1', '?page=9007199254740991&limit=100']) {
      assert.equal((await formList.GET(req('GET', undefined, true, query))).status, 400);
    }
  });

  await t.test('forgot-password has the same response for active, unknown, invited and disabled accounts', async () => {
    const active = await forgot.POST(req('POST', { email: account.email }, false));
    const expected = await active.json();
    assert.equal(mail.length, 1);
    for (const email of ['unknown@example.test', account.email, account.email]) {
      account.status = email.startsWith('unknown') ? 'ACTIVE' : account.status === 'ACTIVE' ? 'INVITED' : 'DISABLED';
      const res = await forgot.POST(req('POST', { email }, false));
      assert.equal(res.status, 200); assert.deepEqual(await res.json(), expected);
    }
    account.status = 'ACTIVE';
    assert.equal(mail.length, 1);
    assert.equal(JSON.stringify(expected).includes('token'), false);
    assert.equal((await forgot.POST(req('POST', { email: 'invalid' }, false))).status, 400);
  });

  await t.test('reset rejects weak passwords and session/invite tokens', async () => {
    const url = new URL(mail[0].text.match(/https:\/\/\S+/)![0]);
    assert.equal(url.pathname, '/patient/accept');
    assert.equal(url.searchParams.get('mode'), 'reset');
    const resetToken = url.searchParams.get('token')!;
    assert.equal((await reset.POST(req('POST', { token: resetToken, password: 'weak' }, false))).status, 400);
    for (const invalid of [token, 'a'.repeat(64), resetToken.slice(0, -6) + 'xxxxxx']) {
      assert.equal((await reset.POST(req('POST', { token: invalid, password: 'Changed123' }, false))).status, 400);
    }
  });

  await t.test('concurrent reset is single-use, changes password and revokes every old session', async () => {
    const resetToken = new URL(mail[0].text.match(/https:\/\/\S+/)![0]).searchParams.get('token');
    const responses = await Promise.all([1, 2].map(() => reset.POST(req('POST', { token: resetToken, password: 'Changed123' }, false))));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
    assert.equal(await compare('Changed123', account.passwordHash), true);
    assert.equal((await reset.POST(req('POST', { token: resetToken, password: 'Another123' }, false))).status, 400);
    assert.equal((await me.GET(req('GET'))).status, 401);
    const res = await login.POST(req('POST', { email: account.email, password: 'Changed123' }, false));
    token = (await res.json()).data.token;
    assert.equal((await me.GET(req('GET'))).status, 200);
    assert.equal((await login.POST(req('POST', { email: account.email, password: 'Original123' }, false))).status, 401);
  });

  await t.test('inactive or discharged patients cannot sign in or use existing tokens', async () => {
    patient.active = false;
    assert.equal((await me.GET(req('GET'))).status, 401);
    assert.equal((await login.POST(req('POST', { email: account.email, password: 'Changed123' }, false))).status, 403);
    patient.active = true; patient.status = 'DISCHARGED';
    assert.equal((await me.GET(req('GET'))).status, 401);
    patient.status = 'ACTIVE';
  });

  await t.test('mail delivery errors stay generic and public recovery endpoints are rate limited', async () => {
    // Different synthetic address avoids the existing per-email bucket.
    account.email = 'delivery@example.test'; mailFails = true;
    const res = await forgot.POST(req('POST', { email: account.email }, false));
    assert.equal(res.status, 200); assert.equal((await res.text()).includes('SMTP'), false);
    mailFails = false;
    for (let i = 0; i < 10; i++) {
      assert.equal((await forgot.POST(new Request('https://example.test/api/patient/forgot-password', {
        method: 'POST', headers: { 'x-forwarded-for': 'rate-test' }, body: JSON.stringify({ email: 'none@example.test' }),
      }))).status, 200);
    }
    assert.equal((await forgot.POST(new Request('https://example.test/api/patient/forgot-password', {
      method: 'POST', headers: { 'x-forwarded-for': 'rate-test' }, body: '{}',
    }))).status, 429);
  });
});
