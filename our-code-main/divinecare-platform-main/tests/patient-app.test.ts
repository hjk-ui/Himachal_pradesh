import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { assertPatientPassword } from '../src/patient/domain/password-policy';
import { matchesPatientCredential, signPatientPasswordReset, verifyPatientPasswordReset, hashInviteToken, signPatientSession, verifyPatientSession } from '../src/patient/infrastructure/security/tokens';

test('invite token hash is stable', () => {
  const raw = 'a'.repeat(32);
  assert.equal(hashInviteToken(raw), hashInviteToken(raw));
  assert.notEqual(hashInviteToken(raw), hashInviteToken('b'.repeat(32)));
});

test('patient JWT round-trips and rejects staff-shaped tokens', async () => {
  const token = await signPatientSession('acc_1', 'cli_1', 'synthetic-password-hash');
  const parsed = await verifyPatientSession(token);
  assert.equal(parsed.accountId, 'acc_1');
  assert.equal(parsed.clientId, 'cli_1');
  await assert.rejects(() => verifyPatientSession(token.slice(0, -4) + 'xxxx'));
});

test('session and password-reset proofs cannot substitute for one another', async () => {
  const session = await signPatientSession('account', 'client', 'original-hash');
  const reset = await signPatientPasswordReset('account', 'client', 'original-hash');
  await assert.rejects(() => verifyPatientSession(reset));
  await assert.rejects(() => verifyPatientPasswordReset(session));
  assert.equal(matchesPatientCredential((await verifyPatientSession(session)).credential, 'original-hash'), true);
  assert.equal(matchesPatientCredential((await verifyPatientSession(session)).credential, 'changed-hash'), false);
  assert.equal(matchesPatientCredential((await verifyPatientPasswordReset(reset)).credential, 'changed-hash'), false);
  assert.equal(session.includes('original-hash'), false);
});

test('reset links expire at the exact 30-minute boundary', async (t) => {
  const issued = Date.now();
  const reset = await signPatientPasswordReset('account', 'client', 'password-hash');
  t.mock.method(Date, 'now', () => issued + 30 * 60 * 1000);
  await assert.rejects(() => verifyPatientPasswordReset(reset));
});

test('legacy sessions and signed tokens with the wrong header or purpose are rejected', async () => {
  const secret = process.env.AUTH_SECRET?.trim() || 'dev-patient-jwt';
  const makeToken = (header: unknown, claims: unknown) => {
    const data = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' +
      Buffer.from(JSON.stringify(claims)).toString('base64url');
    return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
  };
  const claims = { sub: 'account', clientId: 'client', typ: 'patient', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 };
  await assert.rejects(() => verifyPatientSession(makeToken({ alg: 'HS256', typ: 'JWT' }, claims)));
  await assert.rejects(() => verifyPatientSession(makeToken({ alg: 'none', typ: 'JWT' }, { ...claims, credential: 'a'.repeat(64) })));
  await assert.rejects(() => verifyPatientSession(makeToken({ alg: 'HS256', typ: 'JWT' }, { ...claims, typ: 'staff', credential: 'a'.repeat(64) })));
});

test('patient passwords reject bcrypt-truncated UTF-8 input', () => {
  assertPatientPassword('Password123');
  assert.throws(() => assertPatientPassword('A1' + '\u00e9'.repeat(36)));
});
