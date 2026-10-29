/**
 * Click-through Business Associate Agreement (owner 2026-10-26).
 *  - Registration is refused unless the authorized signer accepts the CURRENT BAA version.
 *  - Each acceptance stores org, user, signer name/title/email, version, SHA-256 of the text,
 *    time, IP and user agent, and writes a BAA_ACCEPTED audit row.
 *  - Only Admin / Practice Director can view the record or accept for an existing organization.
 *  - The text carries the HHS sample BAA provisions (45 CFR 164.504(e)) and a 42 CFR Part 2 QSO addendum.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import {
  BAA_BREACH_NOTICE_BUSINESS_DAYS,
  BAA_DRAFT_BANNER,
  BAA_LEGAL_REVIEWED,
  BAA_OPEN_ITEMS,
  BAA_VERSION,
  baaAttestationLabel,
  baaPlainText,
} from '../src/lib/legal/baa';
import { needsCurrentBaa, parseBaaAcceptance } from '../src/lib/legal/baaAcceptance';
import { shouldBlockDashboardPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const ACCEPT = {
  accepted: true,
  version: BAA_VERSION,
  signerName: 'Dana Owner',
  signerTitle: 'Practice Director',
  signerEmail: 'Dana@Example.com',
};

type Row = Record<string, unknown>;

/**
 * One prisma stand-in for every route in this file: modules such as writeAuditLog are cached after
 * the first load, so each test swaps the delegates on this object instead of passing a new one.
 */
const sharedDb: Row = {};
const useDb = (delegates: Row) => {
  for (const k of Object.keys(sharedDb)) delete sharedDb[k];
  Object.assign(sharedDb, delegates);
};

function loadWithMocks<T>(modulePath: string, mocks: Record<string, unknown>): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id in mocks) return mocks[id];
    return original.call(this, id, ...args);
  };
  try {
    return createRequire(import.meta.url)(modulePath) as T;
  } finally {
    loader._load = original;
  }
}

test('BAA version, draft flag and attestation wording', () => {
  assert.equal(BAA_VERSION, '2026-10-26-draft');
  assert.equal(BAA_LEGAL_REVIEWED, false);
  assert.equal(BAA_DRAFT_BANNER, 'Draft — pending legal review');
  assert.equal(
    baaAttestationLabel('Bowie Counseling'),
    'I am authorized to sign for Bowie Counseling and I agree to the Business Associate Agreement'
  );
  assert.ok(BAA_OPEN_ITEMS.some((i) => /10 business days/.test(i)), 'breach timing listed for owner confirmation');
  const page = read('src/app/legal/baa/page.tsx');
  assert.match(page, /!BAA_LEGAL_REVIEWED \?/, '/legal/baa shows the draft banner while not reviewed');
  assert.match(page, /BAA_DRAFT_BANNER/);
});

test('BAA text contains the required HHS provisions and the Part 2 addendum', () => {
  const t = baaPlainText();
  const required: [string, RegExp][] = [
    ['not use or disclose other than permitted', /Not use or disclose PHI other than as permitted or required by this Agreement or as Required By Law/],
    ['Security Rule safeguards', /comply with Subpart C of 45 CFR Part 164/],
    ['report uses, breaches and security incidents', /including Breaches of Unsecured PHI as required at 45 CFR 164\.410[\s\S]*Security Incident/],
    ['subcontractor flow-down', /164\.502\(e\)\(1\)\(ii\) and 164\.308\(b\)\(2\)[\s\S]*agree in writing to the same restrictions/],
    ['access', /45 CFR 164\.524/],
    ['amendment', /45 CFR 164\.526/],
    ['accounting of disclosures', /45 CFR 164\.528/],
    ['Subpart E when carrying out CE obligations', /comply with the requirements of Subpart E/],
    ['books and records to the Secretary', /available to the Secretary/],
    ['minimum necessary', /minimum necessary/],
    ['management and administration', /proper management and administration/],
    ['CE informs BA of NPP limits / restrictions', /164\.520[\s\S]*164\.522/],
    ['permissible requests', /Permissible Requests by Covered Entity/],
    ['termination for cause', /Termination for cause/],
    ['return or destroy at termination', /return to Covered Entity or, if agreed by Covered Entity, destroy the remaining PHI/],
    ['infeasible return extends protections', /extend the protections of this Agreement/],
    ['breach: 60-day outer limit', /no later than sixty \(60\) calendar days after discovery/],
    ['breach: contractual business days', new RegExp(`no case later than ${BAA_BREACH_NOTICE_BUSINESS_DAYS} business days after discovery`)],
    ['AWS subcontractor', /Amazon Web Services[\s\S]*business associate addendum/],
    ['no AI training on PHI', /Not use PHI to train artificial intelligence/],
    ['Part 2 QSO addendum', /Addendum A\. 42 CFR Part 2 Qualified Service Organization Agreement/],
    ['Part 2: fully bound', /fully bound by the provisions of 42 CFR Part 2/],
    ['Part 2: resist judicial efforts', /resist in judicial proceedings any efforts to obtain access/],
    ['Part 2: QSO definition', /42 CFR 2\.11/],
    ['electronic acceptance', /Electronic acceptance/],
  ];
  for (const [label, re] of required) assert.match(t, re, label);
  assert.match(t, new RegExp(`Version ${BAA_VERSION}`));
  assert.doesNotMatch(t, /\p{Extended_Pictographic}/u);
});

test('parseBaaAcceptance: missing, unchecked, incomplete and stale acceptance are refused', () => {
  assert.equal(parseBaaAcceptance(undefined).status, 400);
  assert.equal(parseBaaAcceptance({ ...ACCEPT, accepted: false }).status, 400);
  assert.equal(parseBaaAcceptance({ ...ACCEPT, signerTitle: '' }).status, 400);
  assert.equal(parseBaaAcceptance({ ...ACCEPT, signerEmail: 'nope' }).status, 400);
  assert.equal(parseBaaAcceptance({ ...ACCEPT, version: '2020-01-01' }).status, 409);
  const ok = parseBaaAcceptance(ACCEPT);
  assert.ok(ok.ok);
  assert.equal(ok.value!.signerEmail, 'dana@example.com');
  assert.equal(needsCurrentBaa([]), true);
  assert.equal(needsCurrentBaa(['old']), true);
  assert.equal(needsCurrentBaa(['old', BAA_VERSION]), false);
});

test('registration: blocked without acceptance; stores signer, version, hash, IP, UA; audits', async () => {
  let committed: string[] = [];
  const stored: Row[] = [];
  const audits: Row[] = [];
  useDb({
    user: { findUnique: async () => null },
    organization: { findUnique: async () => null },
    auditLog: { create: async ({ data }: { data: Row }) => { audits.push(data); return {}; } },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const pending: string[] = [];
      const result = await run({
        organization: { create: async () => { pending.push('organization'); return { id: 'org1', name: 'Bowie Counseling', slug: 'bowie', locations: [{ id: 'loc' }] }; } },
        user: { create: async () => { pending.push('user'); return { id: 'user1', role: 'PRACTICE_DIRECTOR', organizationId: 'org1' }; } },
        userLocation: { create: async () => { pending.push('membership'); } },
        clinicModuleState: { createMany: async () => { pending.push('settings'); } },
        baaAcceptance: { create: async ({ data }: { data: Row }) => { pending.push('baa'); stored.push(data); return { id: 'baa1' }; } },
      });
      committed = pending;
      return result;
    },
  });
  const { POST } = loadWithMocks<{ POST: (req: Request) => Promise<Response> }>('../src/app/api/auth/register/route', {
    '@/lib/db/prisma': { prisma: sharedDb },
    bcryptjs: { hash: async () => 'hash' },
  });
  const base = { name: 'Dana Owner', email: 'dana@example.com', password: 'violet-harbor-lantern-42', orgName: 'Bowie Counseling', role: 'practice_director' };
  const req = (body: unknown) =>
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'TestBrowser/1.0', 'x-forwarded-proto': 'https' },
      body: JSON.stringify(body),
    });

  for (const bad of [base, { ...base, baa: { ...ACCEPT, accepted: false } }, { ...base, baa: { ...ACCEPT, signerName: '' } }]) {
    const res = await POST(req(bad));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code?: string }).code, 'BAA_REQUIRED');
  }
  assert.equal((await POST(req({ ...base, baa: { ...ACCEPT, version: 'old' } }))).status, 409);
  assert.deepEqual(committed, [], 'nothing created without acceptance');
  assert.equal(stored.length, 0);

  const ok = await POST(req({ ...base, baa: ACCEPT }));
  assert.equal(ok.status, 200);
  assert.deepEqual(committed, ['organization', 'user', 'membership', 'settings', 'baa'], 'acceptance is in the same transaction');
  const row = stored[0];
  assert.equal(row.organizationId, 'org1');
  assert.equal(row.userId, 'user1');
  assert.equal(row.signerName, 'Dana Owner');
  assert.equal(row.signerTitle, 'Practice Director');
  assert.equal(row.signerEmail, 'dana@example.com');
  assert.equal(row.baaVersion, BAA_VERSION);
  assert.equal(row.textSha256, sha(baaPlainText()));
  assert.match(String(row.textSha256), /^[0-9a-f]{64}$/);
  assert.ok(row.acceptedAt instanceof Date);
  assert.equal(row.ipAddress, '203.0.113.7');
  assert.equal(row.userAgent, 'TestBrowser/1.0');
  assert.equal(row.source, 'registration');

  const audit = audits.find((a) => a.action === 'BAA_ACCEPTED');
  assert.ok(audit, 'BAA_ACCEPTED audit row');
  assert.equal(audit!.organizationId, 'org1');
  assert.equal(audit!.actorUserId, 'user1');
  assert.equal(audit!.resourceType, 'BaaAcceptance');
  assert.equal(audit!.resourceId, 'baa1');
  const meta = audit!.metadata as Row;
  assert.equal(meta.baaVersion, BAA_VERSION);
  assert.equal(meta.textSha256, sha(baaPlainText()));
  assert.equal(JSON.stringify(meta).includes('Dana'), false, 'no signer details in audit metadata');
});

test('admin BAA record: Admin / Practice Director only (API and page)', async () => {
  let gate: Row = { ok: false, status: 403, error: 'forbidden' };
  const created: Row[] = [];
  const audits: Row[] = [];
  useDb({
    baaAcceptance: {
      findMany: async () => [
        { id: 'a1', organizationId: 'org1', userId: 'u1', signerName: 'Dana', signerTitle: 'Owner', signerEmail: 'd@x.com', baaVersion: BAA_VERSION, textSha256: sha(baaPlainText()), acceptedAt: new Date('2026-10-26T12:00:00Z'), ipAddress: '1.2.3.4', userAgent: 'UA', source: 'registration' },
      ],
      create: async ({ data }: { data: Row }) => { created.push(data); return { id: 'a2' }; },
    },
    organization: { findUnique: async () => ({ name: 'Bowie Counseling' }) },
    auditLog: { create: async ({ data }: { data: Row }) => { audits.push(data); return {}; } },
  });
  const route = loadWithMocks<{ GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> }>(
    '../src/app/api/admin/baa/route',
    {
      '@/lib/db/prisma': { prisma: sharedDb },
      '@/lib/auth/requireAdmin': { requireFullAdmin: async () => gate },
    }
  );
  const get = (q = '') => route.GET(new Request(`http://localhost/api/admin/baa${q}`));
  const post = (body: unknown) => route.POST(new Request('http://localhost/api/admin/baa', { method: 'POST', body: JSON.stringify(body) }));

  assert.equal((await get()).status, 403);
  assert.equal((await post(ACCEPT)).status, 403);
  assert.equal(created.length, 0);

  gate = { ok: true, userId: 'u9', role: 'ADMIN', organizationId: 'org1' };
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { acceptances: Row[]; needsAcceptance: boolean; organizationName: string };
  assert.equal(body.organizationName, 'Bowie Counseling');
  assert.equal(body.needsAcceptance, false);
  assert.equal(body.acceptances[0].signerTitle, 'Owner');
  assert.ok(audits.some((a) => a.action === 'READ' && a.resourceType === 'BaaAcceptance'), 'viewing is audited');

  assert.equal((await post({ ...ACCEPT, accepted: false })).status, 400);
  const accepted = await post(ACCEPT);
  assert.equal(accepted.status, 200);
  assert.equal(created[0].source, 'admin');
  assert.equal(created[0].organizationId, 'org1');
  assert.equal(created[0].userId, 'u9');
  assert.ok(audits.some((a) => a.action === 'BAA_ACCEPTED' && a.resourceId === 'a2'));

  // Page gate mirrors the API.
  assert.equal(shouldBlockDashboardPath('ADMIN', '/dashboard/admin/baa'), false);
  assert.equal(shouldBlockDashboardPath('PRACTICE_DIRECTOR', '/dashboard/admin/baa'), false);
  for (const role of ['THERAPIST', 'OFFICE_MANAGER', 'BILLING_SPECIALIST', 'HR']) {
    assert.equal(shouldBlockDashboardPath(role, '/dashboard/admin/baa'), true, role);
  }
  // Existing orgs: non-blocking notice for admins only.
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /role === 'ADMIN' \|\| role === 'PRACTICE_DIRECTOR' \? <BaaNotice \/>/);
});

test('get-started sends the acceptance and shows the attestation with viewable text', () => {
  const page = read('src/app/get-started/page.tsx');
  assert.match(page, /baa: baaRequestBody\(baa\)/);
  assert.match(page, /baaClientError\(baa\)/);
  const fields = read('src/components/legal/BaaAcceptanceFields.tsx');
  assert.match(fields, /baaAttestationLabel\(organizationName\)/);
  assert.match(fields, /<BaaDocument/);
  assert.match(fields, /href="\/legal\/baa"/);
  const sql = read('prisma/migrations/20261026_baa_acceptance.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "BaaAcceptance"/);
  for (const col of ['organizationId', 'userId', 'signerName', 'signerTitle', 'signerEmail', 'baaVersion', 'textSha256', 'acceptedAt', 'ipAddress', 'userAgent']) {
    assert.match(sql, new RegExp(`"${col}"`), col);
  }
});
