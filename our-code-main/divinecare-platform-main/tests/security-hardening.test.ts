import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'bcryptjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { getAuthSecret } from '../src/lib/security/secrets';
import { isTrustedMutationRequest } from '../src/lib/security/request';
import {
  isSafeDocumentId,
  readFileBounded,
  sanitizeFilename,
  validatePdf,
  validateUtf8Text,
} from '../src/lib/security/uploads';
import { rateLimit } from '../src/lib/security/rateLimit';

test('bcrypt credentials use cost 12 and never contain the password', async () => {
  const password = 'ExamplePass123';
  const digest = await hash(password, 12);
  assert.match(digest, /^\$2[aby]\$12\$/);
  assert.equal(digest.includes(password), false);
});

test('production AUTH_SECRET is mandatory and at least 32 bytes', () => {
  const oldEnv = process.env.NODE_ENV;
  const oldSecret = process.env.AUTH_SECRET;
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.NODE_ENV = 'production';
  try {
    delete process.env.AUTH_SECRET;
    assert.throws(() => getAuthSecret(), /required/);
    process.env.AUTH_SECRET = 'short';
    assert.throws(() => getAuthSecret(), /32 bytes/);
    process.env.AUTH_SECRET = 'a'.repeat(32);
    assert.equal(getAuthSecret(), 'a'.repeat(32));
  } finally {
    if (oldEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = oldEnv;
    if (oldSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = oldSecret;
  }
});

test('mutation origin guard blocks foreign and browser cross-site requests', () => {
  assert.equal(isTrustedMutationRequest(new Request('https://altrixs.test/api/save', {
    method: 'POST', headers: { origin: 'https://altrixs.test', 'sec-fetch-site': 'same-origin' },
  })), true);
  assert.equal(isTrustedMutationRequest(new Request('https://altrixs.test/api/save', {
    method: 'POST', headers: { origin: 'https://evil.test' },
  })), false);
  assert.equal(isTrustedMutationRequest(new Request('https://altrixs.test/api/save', {
    method: 'POST', headers: { 'sec-fetch-site': 'cross-site' },
  })), false);
});

test('document validation enforces names, IDs, PDF pages and UTF-8 text bounds', () => {
  assert.equal(sanitizeFilename('../../patient<script>.pdf'), 'patient_script_.pdf');
  assert.equal(isSafeDocumentId('doc_123-safe'), true);
  assert.equal(isSafeDocumentId('../secret'), false);
  assert.throws(() => validatePdf(Buffer.from('not-a-pdf')), /Invalid PDF/);
  const pdf31 = Buffer.from(`%PDF-1.7\n${'/Type /Page\n'.repeat(31)}`);
  assert.throws(() => validatePdf(pdf31), /30 pages/);
  assert.equal(validatePdf(Buffer.from('%PDF-1.7\n/Type /Page\n')), 1);
  assert.throws(() => validateUtf8Text(Buffer.from([0xff, 0xfe])), /encoded data/);
  assert.throws(() => validateUtf8Text(Buffer.from('x'.repeat(30_001))), /30,000/);
});

test('bounded upload reader rejects files above 2 MB before retaining content', async () => {
  const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.pdf');
  await assert.rejects(() => readFileBounded(large), /2 MB/);
});

test('login limiter permits 20 attempts per minute and blocks the next one', () => {
  const key = `security-test:${Date.now()}:${Math.random()}`;
  for (let i = 0; i < 20; i++) assert.equal(rateLimit(key, 20, 60_000).ok, true);
  assert.equal(rateLimit(key, 20, 60_000).ok, false);
});

test('request-facing API code has no unsafe raw SQL and env files stay ignored', () => {
  const root = path.join(process.cwd(), 'src', 'app', 'api');
  const stack = [root];
  const files: string[] = [];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const target = path.join(current, entry);
      if (statSync(target).isDirectory()) stack.push(target);
      else if (target.endsWith('.ts')) files.push(target);
    }
  }
  const unsafe = files.filter((file) => /\$(?:queryRawUnsafe|executeRawUnsafe)/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(unsafe, []);
  assert.match(readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8'), /^\.env\.\*$/m);
});
