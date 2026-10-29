import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { hash } from 'bcryptjs';
import {
  ageInYears,
  defaultAccessLevel,
  linkState,
  proxyMayUse,
  proxyMayView,
  validateGrant,
  validateVerification,
} from '../src/patient/domain/proxy-policy';
import { signPatientSession, verifyPatientSession } from '../src/patient/infrastructure/security/tokens';

/**
 * Portal proxy (guardian) access: one email linked to two children, switching (web + mobile bearer),
 * tamper rejection, limited / confidential / Part 2 filtering, auto-expiry at 18, immediate
 * revocation, pre-migration single accounts, audit rows. In-memory Prisma; no database or email.
 */

// ── Pure rules ────────────────────────────────────────────────────────────────────────────────
test('proxy rules: Maryland age defaults, grant + verification checks, link state', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  assert.equal(ageInYears(new Date('2016-05-01'), now), 10);
  assert.equal(ageInYears(new Date('2008-10-21'), now), 18);
  assert.equal(ageInYears(new Date('2008-10-22'), now), 17);
  assert.equal(defaultAccessLevel('parent', 10), 'full');
  assert.equal(defaultAccessLevel('parent', 12), 'limited');
  assert.equal(defaultAccessLevel('legal_guardian', 17), 'limited');
  assert.equal(defaultAccessLevel('authorized_representative', 40), null);
  assert.equal(defaultAccessLevel('self', 40), 'full');

  assert.match(validateGrant({ relationship: 'parent', accessLevel: null, ageYears: 30 })!, /adult/);
  assert.match(validateGrant({ relationship: 'legal_guardian', accessLevel: null, ageYears: 30 })!, /full or limited/);
  assert.equal(validateGrant({ relationship: 'legal_guardian', accessLevel: 'full', accessLevelReason: 'Court guardianship of the person', ageYears: 30 }), null);
  assert.match(validateGrant({ relationship: 'parent', accessLevel: 'full', ageYears: 14 })!, /default for this age is limited/);
  assert.equal(validateGrant({ relationship: 'parent', accessLevel: null, ageYears: 14 }), null);
  assert.match(validateGrant({ relationship: 'parent', accessLevel: null, ageYears: null })!, /date of birth/);

  assert.match(validateVerification({ relationship: 'parent', method: '', ageYears: 9 })!, /Choose/);
  assert.equal(validateVerification({ relationship: 'parent', method: 'photo_id_in_person', ageYears: 9 }), null);
  assert.match(validateVerification({ relationship: 'legal_guardian', method: 'guardianship_order', ageYears: 9 })!, /document/);
  assert.equal(validateVerification({ relationship: 'legal_guardian', method: 'guardianship_order', legalDocumentRef: 'scan-123.pdf', ageYears: 9 }), null);

  const link = { id: 'l', relationship: 'parent', accessLevel: 'full', minorAtGrant: true, verifiedAt: now, expiresAt: null, revokedAt: null };
  assert.equal(linkState(link, { dateOfBirth: new Date('2016-01-01') }, now), 'active');
  assert.equal(linkState({ ...link, verifiedAt: null }, { dateOfBirth: new Date('2016-01-01') }, now), 'pending_verification');
  assert.equal(linkState(link, { dateOfBirth: new Date('2008-10-21') }, now), 'aged_out');
  assert.equal(linkState({ ...link, expiresAt: new Date('2026-01-01') }, { dateOfBirth: new Date('2016-01-01') }, now), 'expired');
  assert.equal(linkState({ ...link, revokedAt: now, endedReason: 'revoked' }, { dateOfBirth: null }, now), 'revoked');

  const full = { isProxy: true, accessLevel: 'full' as const, minorSelfConsentMh: true };
  const limited = { isProxy: true, accessLevel: 'limited' as const, minorSelfConsentMh: true };
  const self = { isProxy: false, accessLevel: 'full' as const, minorSelfConsentMh: true };
  assert.equal(proxyMayView(self, { part2: true, override: 'confidential' }), true);
  assert.equal(proxyMayView(full, { override: 'confidential' }), false);
  assert.equal(proxyMayView(full, { part2: true }), false);
  assert.equal(proxyMayView(full, { part2: true, override: 'shared_with_guardian' }), true);
  assert.equal(proxyMayView(full, { category: 'mental_health' }), true);
  assert.equal(proxyMayView(limited, { category: 'mental_health' }), false);
  assert.equal(proxyMayView({ ...limited, minorSelfConsentMh: false }, { category: 'mental_health' }), true);
  assert.equal(proxyMayUse(full, 'check-ins'), false);
  assert.equal(proxyMayUse(full, 'account.delete'), false);
  assert.equal(proxyMayUse(full, 'appointments'), true);
  assert.equal(proxyMayUse(limited, 'medications'), false);
  assert.equal(proxyMayUse(limited, 'profile.edit'), false);
});

// ── In-memory Prisma ─────────────────────────────────────────────────────────────────────────
const OPS = new Set(['in', 'notIn', 'not', 'startsWith', 'contains', 'equals', 'mode', 'gte', 'gt', 'lte', 'lt']);

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries<any>(where)) {
    if (k === 'OR') { if (!v.some((w: any) => matches(row, w))) return false; continue; }
    if (k === 'AND') { if (![].concat(v).every((w: any) => matches(row, w))) return false; continue; }
    if (k === 'NOT') { if ([].concat(v).some((w: any) => matches(row, w))) return false; continue; }
    if (k === 'portalUserId_clientId' || k === 'itemType_itemId') { if (!matches(row, v)) return false; continue; }
    const rv = row?.[k];
    if (v === null) { if (rv != null) return false; continue; }
    if (v instanceof Date) { if (!(rv instanceof Date) || rv.getTime() !== v.getTime()) return false; continue; }
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).some((x) => OPS.has(x))) {
        if ('in' in v && !v.in.includes(rv)) return false;
        if ('notIn' in v && v.notIn.includes(rv)) return false;
        if ('not' in v) { if (v.not === null ? rv == null : rv == null || rv === v.not) return false; }
        if ('startsWith' in v && !(typeof rv === 'string' && rv.startsWith(v.startsWith))) return false;
        if ('gte' in v && !(rv >= v.gte)) return false;
        if ('gt' in v && !(rv > v.gt)) return false;
        continue;
      }
      if (rv == null || !matches(rv, v)) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

let seq = 0;
function makeDb(seed: Record<string, any[]>) {
  const t: Record<string, any[]> = new Proxy(seed, { get: (o, k: string) => (o[k] ??= []) });
  const rel = (model: string, row: any) => {
    if (!row) return row;
    const r = { ...row };
    if (model === 'portalAccess') {
      r.portalUser = t.patientAccount.find((a) => a.id === row.portalUserId);
      r.client = withClient(t.client.find((c) => c.id === row.clientId));
    }
    if (model === 'patientAccount') r.client = row.clientId ? withClient(t.client.find((c) => c.id === row.clientId)) : null;
    if (model === 'client') return withClient(row);
    return r;
  };
  const withClient = (c: any) => (c ? { ...c, patientAccount: t.patientAccount.find((a) => a.clientId === c.id) ?? null } : c);
  const model = (name: string) => ({
    findUnique: async ({ where }: any) => rel(name, t[name].find((r) => matches(r, where)) ?? null),
    findFirst: async ({ where }: any = {}) => rel(name, t[name].find((r) => matches(r, where)) ?? null),
    findMany: async ({ where, take }: any = {}) => t[name].filter((r) => matches(rel(name, r), where)).slice(0, take ?? 1e9).map((r) => rel(name, r)),
    count: async ({ where }: any = {}) => t[name].filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; t[name].push(row); return rel(name, row); },
    update: async ({ where, data }: any) => {
      const row = t[name].find((r) => matches(r, where));
      if (!row) throw new Error(`${name} not found`);
      Object.assign(row, data);
      return rel(name, row);
    },
    updateMany: async ({ where, data }: any) => {
      const rows = t[name].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = t[name].find((r) => matches(r, where));
      if (row) { Object.assign(row, update); return rel(name, row); }
      const created = { id: `${name}-${++seq}`, ...create };
      t[name].push(created);
      return rel(name, created);
    },
    deleteMany: async ({ where }: any) => {
      const keep = t[name].filter((r) => !matches(r, where));
      const count = t[name].length - keep.length;
      t[name].splice(0, t[name].length, ...keep);
      return { count };
    },
  });
  const db: any = new Proxy({}, {
    get: (_o, k: string) => {
      if (k === '$transaction') return async (fn: any) => fn(db);
      if (k === 'then') return undefined;
      return model(k);
    },
  });
  return { db, t };
}

test('guardian (proxy) portal access end to end', async (t) => {
  const NOW = new Date();
  const yearsAgo = (y: number, dayShift = 0) => new Date(Date.UTC(NOW.getUTCFullYear() - y, NOW.getUTCMonth(), NOW.getUTCDate() + dayShift));
  const loc = { organizationId: 'org-1' };
  const kid = (id: string, name: string, dob: Date, extra: any = {}) => ({
    id, name, email: null, phone: null, active: true, status: 'ACTIVE', dateOfBirth: dob, organizationId: 'org-1', location: loc,
    assignedTo: { id: 'doc-1', name: 'Dr Synthetic', organizationId: 'org-1', status: 'ACTIVE' }, preferredName: null,
    portalMinorSelfConsentMh: false, ...extra,
  });
  const childA = kid('child-a', 'Alex Synthetic', yearsAgo(9));
  const childB = kid('child-b', 'Blair Synthetic', yearsAgo(14), { portalMinorSelfConsentMh: true });
  const teen = kid('teen-c', 'Casey Synthetic', yearsAgo(18, 1), { email: 'casey@example.test' }); // turns 18 tomorrow
  const stranger = kid('other-d', 'Dana Other', yearsAgo(10));
  const adult = kid('adult-e', 'Eli Legacy', yearsAgo(40), { email: 'eli@example.test' });
  const pw = await hash('Guardian123', 4);
  const legacyPw = await hash('Legacy123', 4);
  const { db, t: tables } = makeDb({
    client: [childA, childB, teen, stranger, adult],
    // Legacy single-client account (pre-migration): no PortalAccess rows at all
    patientAccount: [
      { id: 'acct-legacy', clientId: 'adult-e', email: 'eli@example.test', displayName: null, passwordHash: legacyPw, status: 'ACTIVE', lastActiveClientId: null },
    ],
    portalAccess: [],
    portalItemVisibility: [],
    patientAuditLog: [],
    consentForm: [
      { id: 'form-hipaa', clientId: 'child-b', organizationId: 'org-1', type: 'HIPAA Acknowledgment', formKey: 'library:hipaa-acknowledgment', status: 'SIGNED', method: 'portal', sentAt: new Date('2026-10-01'), signedAt: null, expiresAt: null, signedByName: null },
      { id: 'form-part2', clientId: 'child-b', organizationId: 'org-1', type: '42 CFR Part 2 Consent', formKey: 'library:part2-consent', status: 'SIGNED', method: 'portal', sentAt: new Date('2026-10-02'), signedAt: null, expiresAt: null, signedByName: null },
      { id: 'form-conf', clientId: 'child-b', organizationId: 'org-1', type: 'Release of Information', formKey: 'library:roi-authorization', status: 'SIGNED', method: 'portal', sentAt: new Date('2026-10-03'), signedAt: null, expiresAt: null, signedByName: null },
    ],
    consentPacket: [
      { id: 'pkt-plain', clientId: 'child-b', items: [{ key: 'hipaa-acknowledgment' }, { key: 'confidentiality-part2-notice' }] },
      { id: 'pkt-part2', clientId: 'child-b', items: [{ key: 'part2-consent' }] },
    ],
    resourceAssignment: [
      { id: 'res-sleep', clientId: 'child-b', part2: false, item: { sudRelated: false } },
      { id: 'res-sud', clientId: 'child-b', part2: true, item: { sudRelated: true } },
    ],
    messageThread: [
      { id: 'thread-teen-own', clientId: 'child-b', organizationId: 'org-1', proxyPortalUserId: null, topic: 'GENERAL', status: 'WAITING', lastMessage: 'private', lastMessageAt: new Date(), unreadCount: 0, assignedStaff: null },
    ],
    threadMessage: [],
  });

  const audits: any[] = [];
  const mail: any[] = [];
  const respondCalls: any[] = [];
  const docs = [
    { id: 'plan-b', kind: 'treatment-plan', title: 'Plan', status: 'AWAITING', sentAt: '2026-10-01' },
    { id: 'pkt-plain', kind: 'consent-packet', title: 'Consent packet', status: 'AWAITING', sentAt: '2026-10-02' },
    { id: 'pkt-part2', kind: 'consent-packet', title: 'Consent form', status: 'AWAITING', sentAt: '2026-10-03' },
  ];
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: any) => { audits.push(e); }, AUDIT_RETENTION_YEARS: 6 };
    if (id === '@/lib/mail/sendEmail') return { sendEmail: async (m: any) => { mail.push(m); return { mode: 'console' }; } };
    if (id === '@/lib/staff/invite') return { getAppBaseUrl: () => 'https://example.test' };
    if (id === '@/lib/ehr/therapy/planStore') return {
      listPatientDocuments: async (s: any) => docs.filter((d) => d.kind === 'treatment-plan' && s.clientId === 'child-b'),
      getPatientDocument: async (s: any, docId: string) => (s.clientId === 'child-b' ? docs.find((d) => d.id === docId && d.kind === 'treatment-plan') ?? null : null),
      patientRespond: async (_s: any, docId: string, input: any) => { respondCalls.push({ docId, input }); return { ok: true, document: { id: docId } }; },
    };
    if (id === '@/lib/consents/carelon/store') return { listPatientAttestations: async () => [], getPatientAttestation: async () => null, patientSignAttestation: async () => ({ ok: false, status: 404, error: 'x' }) };
    if (id === '@/lib/consents/library/store2') return {
      listPatientPackets: async (s: any) => docs.filter((d) => d.kind === 'consent-packet' && s.clientId === 'child-b'),
      getPatientPacket: async (s: any, docId: string) => (s.clientId === 'child-b' ? docs.find((d) => d.id === docId && d.kind === 'consent-packet') ?? null : null),
      patientSignPacket: async () => ({ ok: true }),
    };
    if (id === '@/lib/resources/store') return {
      listPatientResources: async (s: any) => tables.resourceAssignment.filter((r) => r.clientId === s.clientId).map((r) => ({ id: r.id, title: r.id })),
    };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let login: any, me: any, sessionRoute: any, switchRoute: any, documents: any, respond: any, forms: any, resources: any, checkIns: any, conversations: any;
  let manage: typeof import('../src/patient/application/proxy/manage');
  let expiry: typeof import('../src/patient/application/proxy/expiry');
  try {
    login = require('../src/app/api/patient/login/route');
    me = require('../src/app/api/patient/me/route');
    sessionRoute = require('../src/app/api/patient/session/route');
    switchRoute = require('../src/app/api/patient/session/switch/route');
    documents = require('../src/app/api/patient/documents/route');
    respond = require('../src/app/api/patient/documents/[id]/respond/route');
    forms = require('../src/app/api/patient/forms/route');
    resources = require('../src/app/api/patient/resources/route');
    checkIns = require('../src/app/api/patient/check-ins/route');
    conversations = require('../src/app/api/patient/conversations/route');
    manage = require('../src/patient/application/proxy/manage');
    expiry = require('../src/patient/application/proxy/expiry');
  } finally {
    loader._load = originalLoad;
  }

  let ip = 0;
  const req = (method: string, path: string, token: string | null, body?: unknown) => new Request(`https://example.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `proxy-test-${++ip}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (res: Response) => res.json() as Promise<any>;
  const actor = { organizationId: 'org-1', userId: 'staff-1' };
  const byId = (id: string) => ({ id });
  const verifyNow = { method: 'photo_id_in_person', note: 'DL checked at front desk' };
  const dadEmail = 'dad@example.test';

  await t.test('staff: one email linked to two children (one guardian login, no PHI in the invite)', async () => {
    const a = await manage.grantProxyAccess(actor, byId('child-a'), { email: 'DAD@example.test', displayName: 'Jordan Synthetic', relationship: 'parent', verification: verifyNow });
    assert.equal(a.newLogin, true);
    assert.equal(a.accessLevel, 'full'); // under 12
    assert.equal(a.verified, true);
    assert.equal(a.notification, 'invite_sent');
    const invite = mail.at(-1);
    assert.equal(invite.to, dadEmail);
    for (const phi of ['Alex', 'Blair', 'Synthetic Patient', 'child-a']) assert.equal(`${invite.text}${invite.html}`.includes(phi), false, `invite leaks ${phi}`);

    const b = await manage.grantProxyAccess(actor, byId('child-b'), { email: dadEmail, displayName: 'Jordan Synthetic', relationship: 'parent' });
    assert.equal(b.newLogin, false);
    assert.equal(b.portalUserId, a.portalUserId);
    assert.equal(b.accessLevel, 'limited'); // 14 years old
    assert.equal(b.verified, false); // pending until staff record verification
    assert.equal(tables.patientAccount.filter((x) => x.email === dadEmail).length, 1);
    assert.equal(tables.patientAccount.find((x) => x.email === dadEmail).clientId, null);
    await assert.rejects(manage.grantProxyAccess(actor, byId('child-a'), { email: dadEmail, displayName: 'Jordan Synthetic', relationship: 'parent', verification: verifyNow }), /already has access/);
    await assert.rejects(manage.grantProxyAccess(actor, byId('adult-e'), { email: 'x@example.test', displayName: 'Some One', relationship: 'parent' }), /adult/);

    // Guardian activates the login (invite token from the email link)
    const account = tables.patientAccount.find((x) => x.email === dadEmail);
    account.passwordHash = pw;
    account.status = 'ACTIVE';
  });

  let dadToken = '';
  await t.test('login lists only verified, active children; pending link is not usable', async () => {
    const res = await login.POST(req('POST', '/api/patient/login', null, { email: dadEmail, password: 'Guardian123' }));
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(body.data.people.map((p: any) => p.clientId), ['child-a']);
    assert.equal(body.data.actingAs.isProxy, true);
    assert.equal(body.data.actingAs.clientId, 'child-a');
    dadToken = body.data.token;

    // Staff record verification for child B: now both children
    const link = tables.portalAccess.find((l) => l.clientId === 'child-b');
    await manage.verifyProxyAccess(actor, 'child-b', link.id, { method: 'birth_certificate', legalDocumentRef: 'scan-bc-0042.pdf' });
    const people = await json(await sessionRoute.GET(req('GET', '/api/patient/session', dadToken)));
    assert.deepEqual(people.data.people.map((p: any) => p.clientId).sort(), ['child-a', 'child-b']);
  });

  let childBToken = '';
  await t.test('switch (mobile bearer): new token for child B; old token still child A; tampering rejected', async () => {
    const res = await switchRoute.POST(req('POST', '/api/patient/session/switch', dadToken, { clientId: 'child-b' }));
    assert.equal(res.status, 200);
    const body = await json(res);
    childBToken = body.data.token;
    assert.equal(verifyPatientSession(childBToken).clientId, 'child-b');
    assert.equal(body.data.actingAs.accessLevel, 'limited');
    const meB = await json(await me.GET(req('GET', '/api/patient/me', childBToken)));
    assert.equal(meB.data.actingAs.clientName, 'Blair Synthetic');
    assert.equal(meB.data.actingAs.isProxy, true);
    const meA = await json(await me.GET(req('GET', '/api/patient/me', dadToken)));
    assert.equal(meA.data.actingAs.clientId, 'child-a');

    // Switch to a client the login is not linked to: refused, and audited
    const denied = await switchRoute.POST(req('POST', '/api/patient/session/switch', dadToken, { clientId: 'other-d' }));
    assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes('Dana'), false);
    assert.equal((await switchRoute.POST(req('POST', '/api/patient/session/switch', dadToken, { clientId: 'no-such-id' }))).status, 403);
    // A validly signed token for an unlinked client (e.g. edited claims with a leaked key) is still refused server-side
    const forged = signPatientSession(tables.patientAccount.find((x) => x.email === dadEmail).id, 'other-d', pw);
    assert.equal((await me.GET(req('GET', '/api/patient/me', forged))).status, 401);
    assert.equal((await switchRoute.POST(req('POST', '/api/patient/session/switch', null, { clientId: 'child-b' }))).status, 401);
  });

  await t.test('limited access hides confidential, Part 2 and minor-consented mental health items', async () => {
    // Clinician marks the ROI form confidential
    await manage.setPortalItemVisibility(actor, 'child-b', { itemType: 'consent_form', itemId: 'form-conf', visibility: 'confidential', reason: 'Teen request' });
    await assert.rejects(manage.setPortalItemVisibility(actor, 'child-b', { itemType: 'consent_form', itemId: 'other-clients-form', visibility: 'confidential' }), /not found/);

    const formList = await json(await forms.GET(req('GET', '/api/patient/forms', childBToken)));
    assert.deepEqual(formList.data.forms.map((f: any) => f.id), ['form-hipaa']);
    assert.equal(formList.data.pagination.total, 1);

    const docList = await json(await documents.GET(req('GET', '/api/patient/documents', childBToken)));
    // plan-b hidden (limited + minor consented to own MH care), pkt-part2 hidden (Part 2), notice-only packet visible
    assert.deepEqual(docList.data.documents.map((d: any) => d.id), ['pkt-plain']);

    // Clinician shares the plan with the guardian: now visible
    tables.portalItemVisibility.push({ id: 'v2', organizationId: 'org-1', clientId: 'child-b', itemType: 'treatment_plan', itemId: 'plan-b', visibility: 'shared_with_guardian' });
    const docList2 = await json(await documents.GET(req('GET', '/api/patient/documents', childBToken)));
    assert.deepEqual(docList2.data.documents.map((d: any) => d.id).sort(), ['pkt-plain', 'plan-b']);

    const res = await json(await resources.GET(req('GET', '/api/patient/resources', childBToken)));
    assert.deepEqual(res.data.resources.map((r: any) => r.id), ['res-sleep']);

    // The minor's own mood check-ins and private messages stay private
    assert.equal((await checkIns.GET(req('GET', '/api/patient/check-ins', childBToken))).status, 403);
    const convos = await json(await conversations.GET(req('GET', '/api/patient/conversations', childBToken)));
    assert.equal(JSON.stringify(convos).includes('thread-teen-own'), false);
  });

  await t.test('signing as representative records the guardian, never "Self"', async () => {
    const res = await respond.POST(
      req('POST', '/api/patient/documents/plan-b/respond', childBToken, { decision: 'sign', typedName: 'Jordan Synthetic', signerRelationship: 'Self', agree: true }),
      { params: Promise.resolve({ id: 'plan-b' }) }
    );
    assert.equal(res.status, 200);
    assert.equal(respondCalls.at(-1).input.signerRelationship, 'Parent');
    const signAudit = audits.filter((a) => a.action === 'SIGN').at(-1);
    assert.equal(signAudit.actorRole, 'PATIENT_PROXY');
    assert.equal(signAudit.metadata.signedAsRepresentative, true);
    assert.equal(signAudit.metadata.signedByPortalUserId, tables.patientAccount.find((x) => x.email === dadEmail).id);
    // A Part 2 packet cannot be opened or signed by the proxy
    const p2 = await respond.POST(
      req('POST', '/api/patient/documents/pkt-part2/respond', childBToken, { decision: 'sign', typedName: 'Jordan Synthetic', signerRelationship: 'Parent', agree: true }),
      { params: Promise.resolve({ id: 'pkt-part2' }) }
    );
    assert.equal(p2.status, 404);
  });

  await t.test('revocation is immediate for every token of that person', async () => {
    const link = tables.portalAccess.find((l) => l.clientId === 'child-b');
    await manage.revokeProxyAccess(actor, 'child-b', link.id, 'Custody order changed');
    const res = await me.GET(req('GET', '/api/patient/me', childBToken));
    assert.equal(res.status, 403);
    assert.equal((await json(res)).error.code, 'access_ended');
    assert.equal((await switchRoute.POST(req('POST', '/api/patient/session/switch', dadToken, { clientId: 'child-b' }))).status, 403);
    // Child A is untouched
    assert.equal((await me.GET(req('GET', '/api/patient/me', dadToken))).status, 200);
    const people = await json(await sessionRoute.GET(req('GET', '/api/patient/session', childBToken)));
    assert.equal(people.data.activeClientId, null);
    assert.deepEqual(people.data.people.map((p: any) => p.clientId), ['child-a']);
  });

  await t.test('auto-expiry at 18: request check + nightly job, then the client gets their own invite', async () => {
    const g = await manage.grantProxyAccess(actor, byId('teen-c'), { email: dadEmail, displayName: 'Jordan Synthetic', relationship: 'parent', verification: verifyNow });
    const link = tables.portalAccess.find((l) => l.id === g.accessId);
    assert.equal(link.minorAtGrant, true);
    const sw = await json(await switchRoute.POST(req('POST', '/api/patient/session/switch', dadToken, { clientId: 'teen-c' })));
    const teenToken = sw.data.token;
    assert.equal((await me.GET(req('GET', '/api/patient/me', teenToken))).status, 200);

    // Birthday arrives (move the DOB back one day instead of the clock)
    teen.dateOfBirth = yearsAgo(18);
    const res = await me.GET(req('GET', '/api/patient/me', teenToken));
    assert.equal(res.status, 403);
    assert.equal(link.endedReason, 'aged_out');
    assert.ok(link.revokedAt);

    // Nightly job: already ended by the request (idempotent), so reset to exercise the job path
    link.revokedAt = null; link.endedReason = null;
    const invited: string[] = [];
    const r = await expiry.runProxyExpiry(new Date(), { inviteClient: async (id) => { invited.push(id); return { invited: true }; } });
    assert.equal(r.agedOut, 1);
    assert.equal(link.endedReason, 'aged_out');
    assert.deepEqual(invited, ['teen-c']);
    const again = await expiry.runProxyExpiry(new Date(), { inviteClient: async (id) => { invited.push(id); return { invited: true }; } });
    assert.equal(again.agedOut, 0);
    assert.deepEqual(invited, ['teen-c']);
  });

  await t.test('existing single-client accounts keep working before and after the self-link backfill', async () => {
    const res = await login.POST(req('POST', '/api/patient/login', null, { email: 'eli@example.test', password: 'Legacy123' }));
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.data.client.id, 'adult-e');
    assert.equal(body.data.actingAs.isProxy, false);
    assert.deepEqual(body.data.people.map((p: any) => p.relationship), ['self']);
    // Token issued before proxy access existed (same claims) still works
    const oldToken = signPatientSession('acct-legacy', 'adult-e', legacyPw);
    assert.equal((await me.GET(req('GET', '/api/patient/me', oldToken))).status, 200);
    // After the migration script creates the explicit self row
    tables.portalAccess.push({ id: 'self-e', portalUserId: 'acct-legacy', clientId: 'adult-e', relationship: 'self', accessLevel: 'full', minorAtGrant: false, verifiedAt: new Date(), expiresAt: null, revokedAt: null, endedReason: null });
    const meRes = await json(await me.GET(req('GET', '/api/patient/me', oldToken)));
    assert.equal(meRes.data.actingAs.relationship, 'self');
    // A self login can still use its own features
    assert.notEqual((await checkIns.GET(req('GET', '/api/patient/check-ins', oldToken))).status, 403);
    // It cannot switch into someone else's chart
    assert.equal((await switchRoute.POST(req('POST', '/api/patient/session/switch', oldToken, { clientId: 'child-a' }))).status, 403);
  });

  await t.test('convert a child’s own login (parent’s email) into the guardian login', async () => {
    tables.client.push(kid('child-f', 'Frankie Synthetic', yearsAgo(7)));
    tables.patientAccount.push({ id: 'acct-f', clientId: 'child-f', email: 'mom@example.test', displayName: null, passwordHash: pw, status: 'ACTIVE', lastActiveClientId: null });
    await assert.rejects(manage.grantProxyAccess(actor, byId('child-f'), { email: 'mom@example.test', displayName: 'Morgan Synthetic', relationship: 'parent' }), /own portal login/);
    const r = await manage.convertSelfLoginToGuardian(actor, byId('child-f'), { displayName: 'Morgan Synthetic', relationship: 'parent', verification: verifyNow });
    assert.equal(r.portalUserId, 'acct-f');
    const acct = tables.patientAccount.find((a) => a.id === 'acct-f');
    assert.equal(acct.clientId, null);
    const l = await login.POST(req('POST', '/api/patient/login', null, { email: 'mom@example.test', password: 'Guardian123' }));
    const body = await json(l);
    assert.equal(body.data.actingAs.relationship, 'parent');
    assert.equal(body.data.actingAs.clientId, 'child-f');
  });

  await t.test('audit: proxy login, switch, denied switch, every proxy request, aged-out', async () => {
    const actions = tables.patientAuditLog.map((a) => a.action);
    for (const a of ['proxy.login', 'proxy.switch', 'proxy.switch_denied', 'proxy.access', 'proxy.access_blocked', 'proxy.access_denied', 'proxy.aged_out']) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
    const access = tables.patientAuditLog.find((a) => a.action === 'proxy.access');
    assert.equal(access.relationship, 'parent');
    assert.ok(access.portalAccessId);
    assert.ok(audits.some((a) => a.action === 'PORTAL_SWITCH' && a.outcome === 'SUCCESS'));
    assert.ok(audits.some((a) => a.action === 'PORTAL_SWITCH' && a.outcome === 'DENIED'));
    assert.ok(audits.some((a) => a.action === 'LOGIN' && a.actorRole === 'PATIENT_PROXY' && a.metadata.proxy === true));
    // Audit rows carry ids and enums, never message text or names
    assert.equal(JSON.stringify(tables.patientAuditLog).includes('Blair'), false);
  });
});
