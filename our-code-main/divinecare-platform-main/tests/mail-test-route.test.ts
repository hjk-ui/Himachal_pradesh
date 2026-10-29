import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module from 'node:module';

test('SMTP readiness and delivery-test route stays admin-only and fail-closed', async (t) => {
  let gate: any = {
    ok: true,
    userId: 'admin-1',
    organizationId: 'org-1',
    role: 'ADMIN',
  };
  let configured = true;
  let verifyResult: any = { ok: true };
  const sent: any[] = [];

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/auth/tenant') {
      return { requireOrgContext: async () => gate };
    }
    if (id === '@/lib/email/smtp') {
      return {
        isSmtpConfigured: () => configured,
        verifySmtpConnection: async () => verifyResult,
        sendEmail: async (input: any) => {
          sent.push(input);
          return { mode: 'smtp' };
        },
      };
    }
    return originalLoad.call(this, id, ...args);
  };

  const previousRecipient = process.env.SMTP_TEST_TO;
  process.env.SMTP_TEST_TO = 'verified-test@example.com';
  t.after(() => {
    loader._load = originalLoad;
    if (previousRecipient === undefined) delete process.env.SMTP_TEST_TO;
    else process.env.SMTP_TEST_TO = previousRecipient;
  });

  const { GET, POST } = await import('../src/app/api/mail/test/route');

  await t.test('requires authentication and an email-admin role', async () => {
    gate = { ok: false, status: 401, error: 'Unauthorized' };
    let response = await GET();
    assert.equal(response.status, 401);

    gate = { ok: true, userId: 'np-1', organizationId: 'org-1', role: 'NP' };
    response = await GET();
    assert.equal(response.status, 403);
  });

  await t.test('reports readiness without exposing configuration or provider errors', async () => {
    gate = { ok: true, userId: 'admin-1', organizationId: 'org-1', role: 'ADMIN' };
    configured = false;
    let response = await GET();
    assert.equal(response.status, 503);
    let body = await response.json();
    assert.equal(body.code, 'SMTP_NOT_CONFIGURED');
    assert.deepEqual(body.data, { configured: false, reachable: false });
    assert.equal(JSON.stringify(body).includes('SMTP_HOST'), false);

    configured = true;
    verifyResult = { ok: false, error: '535 Authentication credentials invalid for smtp-user-secret' };
    response = await GET();
    assert.equal(response.status, 503);
    body = await response.json();
    assert.equal(body.code, 'SMTP_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('smtp-user-secret'), false);

    verifyResult = { ok: true };
    response = await GET();
    assert.equal(response.status, 200);
    body = await response.json();
    assert.deepEqual(body.data, { configured: true, reachable: true });
  });

  await t.test('rejects cross-origin and user-selected recipients', async () => {
    let response = await POST(new Request('http://localhost/api/mail/test', {
      method: 'POST',
      headers: { origin: 'https://attacker.test', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.status, 403);

    response = await POST(new Request('http://localhost/api/mail/test', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'victim@example.com' }),
    }));
    assert.equal(response.status, 400);
    assert.equal(sent.length, 0);
  });

  await t.test('sends only to the server-controlled test inbox', async () => {
    const response = await POST(new Request('http://localhost/api/mail/test', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'verified-test@example.com');
    assert.equal(JSON.stringify(await response.json()).includes('verified-test@example.com'), false);
  });
});

