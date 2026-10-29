import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEDICAL_DIRECTOR_PAGE_PREFIXES,
  accessBasisFor,
  canHoldMedicalDirector,
  forgetVerifiedCapabilities,
  isCaseloadScoped,
  recordVerifiedCapabilities,
  verifiedMedicalDirector,
} from '../src/lib/auth/medicalDirector';
import { canAccessApiPath, canAccessPath, shouldBlockDashboardPath } from '../src/lib/auth/roleAccess';
import { buildNavForRole, allNavPaths, hrefPath } from '../src/components/layout/navConfig';
import { clientAccessWhere, clientOrgFilter } from '../src/lib/clients/orgScope';
import { decideChartAccess } from '../src/lib/clients/chartBanner';
import { isSensitivePrivilegedRole } from '../src/lib/privacy/sensitiveRoles';
import { canCosignNote, hasCosignAuthority } from '../src/lib/notes/transitions';
import { canUseClinicModule } from '../src/lib/modules/access';

/**
 * Medical Director designation (src/lib/auth/medicalDirector.ts): a capability flag on a prescriber's
 * account. Org-wide patient scope, supervisor co-sign, oversight pages; no Part 2 / VIP bypass; never
 * self-granted; revocation honoured on cache invalidation; never across organizations.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const MD = { medicalDirector: true };
const TTL = 10_000;

// ─── Tiny evaluator for the client where-clauses clientAccessWhere builds ─────

type ClientRow = {
  id: string;
  organizationId: string | null;
  locationId: string | null;
  location: { organizationId: string } | null;
  assignedToId: string | null;
  assignedTo: { organizationId: string } | null;
  treatmentTeam: string[];
};

function matches(c: ClientRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => matches(c, w));
    if (k === 'AND') return (v as Record<string, unknown>[]).every((w) => matches(c, w));
    if (k === 'id' || k === 'organizationId' || k === 'locationId' || k === 'assignedToId') return c[k] === v;
    if (k === 'location') return c.location?.organizationId === (v as { organizationId: string }).organizationId;
    if (k === 'assignedTo') return c.assignedTo?.organizationId === (v as { organizationId: string }).organizationId;
    if (k === 'treatmentTeamMembers') return c.treatmentTeam.includes((v as { some: { providerId: string } }).some.providerId);
    if (k === 'medicalVisits' || k === 'appointments') return false;
    throw new Error(`evaluator: unsupported key ${k}`);
  });
}

const CLIENTS: ClientRow[] = [
  { id: 'a-mine', organizationId: 'org-a', locationId: 'bowie', location: { organizationId: 'org-a' }, assignedToId: 'psych1', assignedTo: { organizationId: 'org-a' }, treatmentTeam: [] },
  { id: 'a-other', organizationId: 'org-a', locationId: 'silver-spring', location: { organizationId: 'org-a' }, assignedToId: 'ther9', assignedTo: { organizationId: 'org-a' }, treatmentTeam: [] },
  { id: 'a-unassigned', organizationId: 'org-a', locationId: null, location: null, assignedToId: null, assignedTo: null, treatmentTeam: [] },
  { id: 'a-baltimore', organizationId: 'org-a', locationId: 'baltimore', location: { organizationId: 'org-a' }, assignedToId: 'np2', assignedTo: { organizationId: 'org-a' }, treatmentTeam: [] },
  { id: 'b-client', organizationId: 'org-b', locationId: 'b-loc', location: { organizationId: 'org-b' }, assignedToId: 'psych1', assignedTo: { organizationId: 'org-b' }, treatmentTeam: [] },
];

const visible = (where: Record<string, unknown>) => CLIENTS.filter((c) => matches(c, where)).map((c) => c.id).sort();

function reset() {
  for (const id of ['psych1', 'np2', 'doc3', 'ther9', 'admin1']) forgetVerifiedCapabilities(id);
}

// ─── 1. Patient scope ─────────────────────────────────────────────────────────

test('flagged psychiatrist sees every client in the org (all locations); unflagged sees only the caseload', () => {
  reset();
  const unflagged = clientAccessWhere({ organizationId: 'org-a', actorUserId: 'psych1', actorRole: 'PSYCHIATRIST' });
  assert.deepEqual(visible(unflagged as Record<string, unknown>), ['a-mine']);

  recordVerifiedCapabilities('psych1', { organizationId: 'org-a', medicalDirector: true }, TTL);
  const flagged = clientAccessWhere({ organizationId: 'org-a', actorUserId: 'psych1', actorRole: 'PSYCHIATRIST' });
  assert.deepEqual(flagged, clientOrgFilter('org-a'), 'same scope as leadership: the organization');
  assert.deepEqual(visible(flagged as Record<string, unknown>), ['a-baltimore', 'a-mine', 'a-other', 'a-unassigned']);

  // Chart access (decideChartAccess): another clinician's client opens for the medical director only
  const chart = (userId: string) =>
    decideChartAccess({
      role: 'PSYCHIATRIST', userId, organizationId: 'org-a',
      client: { assignedToId: 'ther9' }, sensitive: 'none', hasForwardedThread: () => false,
    });
  assert.deepEqual(chart('psych1'), { ok: true, sensitive: 'none' });
  forgetVerifiedCapabilities('psych1');
  assert.deepEqual(chart('psych1'), { ok: false, status: 403, reason: 'not_on_caseload' });
  reset();
});

test('isCaseloadScoped is the one caseload rule: org-wide for a verified medical director only', () => {
  reset();
  assert.equal(isCaseloadScoped({ userId: 'np2', role: 'NP', organizationId: 'org-a' }), true);
  recordVerifiedCapabilities('np2', { organizationId: 'org-a', medicalDirector: true }, TTL);
  assert.equal(isCaseloadScoped({ userId: 'np2', role: 'NP', organizationId: 'org-a' }), false);
  // A multi-role director who switched to a non-prescriber role is caseload-scoped again
  assert.equal(isCaseloadScoped({ userId: 'np2', role: 'THERAPIST', organizationId: 'org-a' }), true);
  // Server call sites use it instead of isCaseloadRole for "limit to this user's clients"
  for (const rel of ['src/lib/clients/notes.ts', 'src/lib/appointments/manage.ts', 'src/app/api/clients/[id]/route.ts', 'src/lib/dashboard/homeData.ts']) {
    assert.match(read(rel), /isCaseloadScoped\(/, rel);
  }
  reset();
});

// ─── 2. Eligibility ───────────────────────────────────────────────────────────

test('the flag is ignored for non-eligible roles', () => {
  reset();
  for (const role of ['THERAPIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'PRP_SPECIALIST', 'MEDICAL_ASSISTANT', 'FRONT_DESK', 'BILLING', 'HR', 'OFFICE_MANAGER']) {
    assert.equal(canHoldMedicalDirector(role, [role]), false, role);
    recordVerifiedCapabilities('ther9', { organizationId: 'org-a', medicalDirector: true }, TTL);
    assert.equal(verifiedMedicalDirector({ userId: 'ther9', role, organizationId: 'org-a' }), false, role);
    assert.equal(canAccessPath(role, '/dashboard/qi', MD), canAccessPath(role, '/dashboard/qi'), role);
    assert.deepEqual(buildNavForRole(role, undefined, MD), buildNavForRole(role), role);
  }
  const therapistWhere = clientAccessWhere({ organizationId: 'org-a', actorUserId: 'ther9', actorRole: 'THERAPIST' });
  assert.deepEqual(visible(therapistWhere as Record<string, unknown>), ['a-other']);
  for (const role of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'physician', 'medical_np']) {
    assert.equal(canHoldMedicalDirector(role), true, role);
  }
  assert.equal(canHoldMedicalDirector('THERAPIST', ['THERAPIST', 'PSYCHIATRIST']), true, 'any assigned prescriber role');
  reset();
});

// ─── 3. Nav ───────────────────────────────────────────────────────────────────

test('nav includes the oversight pages only when flagged (and never billing / HR / settings / staff)', () => {
  const paths = (role: string, caps?: { medicalDirector: boolean }) =>
    new Set(buildNavForRole(role, undefined, caps).flatMap((s) => s.items.map((i) => hrefPath(i.href))));
  const oversightInNav = allNavPaths().filter((p) => MEDICAL_DIRECTOR_PAGE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`)));
  assert.ok(oversightInNav.length >= 10);

  for (const role of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']) {
    const plain = paths(role);
    const director = paths(role, MD);
    for (const p of oversightInNav) assert.ok(director.has(p), `${role} director nav has ${p}`);
    for (const p of plain) assert.ok(director.has(p), `${role} keeps its own nav: ${p}`);
    // The flag adds the oversight pages and nothing else (billing, HR, settings, staff stay as the role had them)
    for (const p of director) {
      assert.ok(plain.has(p) || oversightInNav.includes(p), `${role} director nav adds only oversight pages, not ${p}`);
    }
    for (const p of ['/dashboard/billing/claims', '/dashboard/billing/payments', '/dashboard/hr', '/dashboard/admin', '/dashboard/practice-setup', '/dashboard/subscription', '/dashboard/admin/audit-log']) {
      assert.equal(director.has(p), plain.has(p), `${role}: ${p} unchanged by the flag`);
      assert.equal(canAccessPath(role, p, MD), canAccessPath(role, p), `${role}: ${p} page gate unchanged`);
    }
  }
  // Unflagged psychiatrist: no QI / grievances; unflagged physician: no alerts / insights / scanner
  assert.ok(!paths('PSYCHIATRIST').has('/dashboard/qi') && !paths('PSYCHIATRIST').has('/dashboard/grievances'));
  for (const p of ['/dashboard/alerts', '/dashboard/ai-insights', '/dashboard/ehr/scanner', '/dashboard/population', '/dashboard/ehr/supervisor-review']) {
    assert.ok(!paths('PHYSICIAN').has(p), `unflagged physician has no ${p}`);
    assert.ok(paths('PHYSICIAN', MD).has(p), `director physician has ${p}`);
  }
  // Page gate (proxy / layout) agrees with the nav
  assert.equal(shouldBlockDashboardPath('PHYSICIAN', '/dashboard/qi'), true);
  assert.equal(shouldBlockDashboardPath('PHYSICIAN', '/dashboard/qi', MD), false);
  assert.equal(shouldBlockDashboardPath('PHYSICIAN', '/dashboard/hr', MD), true);
  assert.equal(shouldBlockDashboardPath('PSYCHIATRIST', '/dashboard/billing/claims', MD), true);
  // QI / grievance / incident modules follow the page rule
  assert.equal(canUseClinicModule('PSYCHIATRIST', 'qi-indicators'), false);
  assert.equal(canUseClinicModule('PSYCHIATRIST', 'qi-indicators', MD), true);
  assert.equal(canUseClinicModule('PSYCHIATRIST', 'billing-claims', MD), false);
  assert.equal(canUseClinicModule('PSYCHIATRIST', 'credentials', MD), false);
});

// ─── 4. API gate ──────────────────────────────────────────────────────────────

test('the API gate allows the oversight APIs when flagged, nothing else', () => {
  const allowed = ['/api/risk-alerts', '/api/alerts/team', '/api/crisis/episodes', '/api/insights/clinical', '/api/reports/outcomes', '/api/ehr/scanner/sud-radar', '/api/clinical/mbc/alerts', '/api/incidents/i1', '/api/ehr/supervisor-review'];
  for (const p of ['/api/risk-alerts', '/api/alerts/team', '/api/crisis/episodes']) {
    assert.equal(canAccessApiPath('PHYSICIAN', p), false, `unflagged physician ${p}`);
  }
  for (const p of allowed) assert.equal(canAccessApiPath('PHYSICIAN', p, 'GET', MD), true, p);
  for (const p of ['/api/hr/credentialing', '/api/billing/statements', '/api/billing/denials', '/api/dashboard/overview']) {
    assert.equal(canAccessApiPath('PHYSICIAN', p, 'GET', MD), false, `director still refused ${p}`);
    assert.equal(canAccessApiPath('PSYCHIATRIST', p, 'GET', MD), false, `director still refused ${p}`);
  }
  assert.equal(canAccessApiPath('THERAPIST', '/api/hr/credentialing', 'GET', MD), false);
  // The proxy passes the JWT claim; the routes re-check the DB-verified capabilities
  assert.match(read('src/proxy.ts'), /canAccessApiPath\(role, pathname, req\.method, caps\)/);
  assert.match(read('src/app/api/insights/clinical/route.ts'), /canAccessPath\(gate\.role, INSIGHTS_PATH, gate\.capabilities\)/);
  assert.match(read('src/app/api/modules/[module]/route.ts'), /canReadClinicModule\(gate\.role, module, gate\.capabilities\)/);
});

// ─── 5. Part 2 / VIP unchanged ────────────────────────────────────────────────

test('Part 2 / VIP protections are unchanged: no bypass, break-the-glass still required', async () => {
  reset();
  recordVerifiedCapabilities('psych1', { organizationId: 'org-a', medicalDirector: true }, TTL);
  // Protected record locked for the viewer -> 403 even for a medical director (org-wide scope or not)
  const locked = decideChartAccess({
    role: 'PSYCHIATRIST', userId: 'psych1', organizationId: 'org-a',
    client: { assignedToId: 'psych1' }, sensitive: 'locked', hasForwardedThread: () => true,
  });
  assert.deepEqual(locked, { ok: false, status: 403, reason: 'sensitive_record' });
  for (const role of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']) assert.equal(isSensitivePrivilegedRole(role), false, role);
  const src = read('src/lib/privacy/sensitiveAccess.ts') + read('src/lib/privacy/sensitiveRoles.ts');
  assert.ok(!/from '@\/lib\/auth\/medicalDirector'|verifiedMedicalDirector|isMedicalDirector|accessBasis/.test(src), 'sensitive access has no medical director bypass');

  // assertClientPhiAccess for a medical director without whitelist / grant: denied + logged
  const logs: { accessType: string }[] = [];
  const db = {
    sensitiveRecord: { findFirst: async () => ({ id: 's1', accessWhitelist: [] as string[] }) },
    breakTheGlassGrant: { findFirst: async () => null },
    sensitiveAccessLog: { create: async ({ data }: { data: { accessType: string } }) => { logs.push(data); } },
  };
  const mod = loadWithStubs<{ assertClientPhiAccess: (i: object) => Promise<void>; SensitiveRecordAccessError: new () => Error }>(
    '../src/lib/privacy/sensitiveAccess', { '@/lib/db/prisma': { prisma: db } }, /privacy[\\/]sensitiveAccess/,
  );
  await assert.rejects(
    mod.assertClientPhiAccess({ organizationId: 'org-a', userId: 'psych1', role: 'PSYCHIATRIST', clientId: 'c-vip', path: '/api/clients/c-vip' }),
    (e: Error) => e.name === 'SensitiveRecordAccessError',
  );
  assert.deepEqual(logs.map((l) => l.accessType), ['denied']);
  reset();
});

test('audit rows carry accessBasis: medical_director for a verified director only', () => {
  reset();
  assert.equal(accessBasisFor({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-a' }), null);
  recordVerifiedCapabilities('psych1', { organizationId: 'org-a', medicalDirector: true }, TTL);
  assert.equal(accessBasisFor({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-a' }), 'medical_director');
  assert.equal(accessBasisFor({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-b' }), null);
  assert.match(read('src/lib/audit/writeAuditLog.ts'), /scrubbed\.accessBasis = basis/);
  reset();
});

// ─── Supervision ──────────────────────────────────────────────────────────────

test('co-sign authority: medical director yes; primary care director not for pre-licensed authors', () => {
  assert.equal(hasCosignAuthority('NP'), false);
  assert.equal(hasCosignAuthority('NP', { medicalDirector: true }), true);
  assert.equal(hasCosignAuthority('NP', { medicalDirector: true, preLicensedAuthor: true }), true);
  assert.equal(hasCosignAuthority('PHYSICIAN', { medicalDirector: true }), true);
  assert.equal(hasCosignAuthority('PHYSICIAN', { medicalDirector: true, preLicensedAuthor: true }), false);
  assert.equal(hasCosignAuthority('THERAPIST', { medicalDirector: true }), false);
  assert.equal(hasCosignAuthority('PSYCHIATRIST'), false, 'a psychiatrist without the flag is scoped to supervisees + caseload (tests/cosign-scope.test.ts)');
  assert.equal(hasCosignAuthority('PSYCHIATRIST', { medicalDirector: true }), true, 'verified Medical Director keeps org-wide co-sign');
  assert.equal(hasCosignAuthority('PRACTICE_DIRECTOR'), true, 'leadership unchanged');
  const base = { actorUserId: 'np2', actorRole: 'NP', authorIds: ['ther9'], status: 'SIGNED' as const, isDesignatedSupervisor: false };
  assert.equal(canCosignNote(base).ok, false);
  assert.equal(canCosignNote({ ...base, medicalDirectorAuthority: true }).ok, true);
  assert.equal(canCosignNote({ ...base, authorIds: ['np2'], medicalDirectorAuthority: true }).ok, false, 'never your own note');
});

// ─── Server: requireSession re-verifies from the DB; revocation; preview ──────

type UserRow = { status: string; role: string; roles: string[]; organizationId: string | null; organization: { active: boolean } | null; isMedicalDirector: boolean };

function loadWithStubs<T>(path: string, stubs: Record<string, unknown>, cacheKey: RegExp): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id in stubs) return stubs[id];
    return original.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (cacheKey.test(k)) delete require.cache[k];
  try {
    return require(path) as T;
  } finally {
    loader._load = original;
  }
}

function loadRequireSession(rows: Map<string, UserRow>, session: { user: Record<string, unknown> }) {
  const db = { user: { findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null } };
  return loadWithStubs<typeof import('../src/lib/auth/requireSession')>(
    '../src/lib/auth/requireSession',
    { '@/lib/auth': { auth: async () => session }, '@/lib/db/prisma': { prisma: db } },
    /lib[\\/]auth[\\/]requireSession/,
  );
}

test('requireSession re-reads the flag; revocation is honoured after cache invalidation', async () => {
  reset();
  const rows = new Map<string, UserRow>([
    ['psych1', { status: 'ACTIVE', role: 'PSYCHIATRIST', roles: ['PSYCHIATRIST'], organizationId: 'org-a', organization: { active: true }, isMedicalDirector: true }],
  ]);
  const session = { user: { id: 'psych1', role: 'PSYCHIATRIST', medicalDirector: false } };
  const rs = loadRequireSession(rows, session);

  const first = await rs.requireSession();
  assert.ok(first.ok);
  assert.deepEqual(first.ok && first.capabilities, { medicalDirector: true }, 'DB flag wins over a stale JWT claim');
  assert.equal(verifiedMedicalDirector({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-a' }), true);

  // Revoked in the DB: the cached row may serve until the TTL; invalidateSessionUser makes it immediate
  rows.set('psych1', { ...rows.get('psych1')!, isMedicalDirector: false });
  rs.invalidateSessionUser('psych1');
  assert.equal(verifiedMedicalDirector({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-a' }), false, 'scope dropped at once');
  const second = await rs.requireSession();
  assert.deepEqual(second.ok && second.capabilities, { medicalDirector: false });
  assert.deepEqual(
    visible(clientAccessWhere({ organizationId: 'org-a', actorUserId: 'psych1', actorRole: 'PSYCHIATRIST' }) as Record<string, unknown>),
    ['a-mine'],
  );

  // A JWT claim alone never grants it
  const forged = loadRequireSession(rows, { user: { id: 'psych1', role: 'PSYCHIATRIST', medicalDirector: true, medicalDirectorPreview: true } });
  forged.invalidateSessionUser('psych1');
  const r = await forged.requireSession();
  assert.deepEqual(r.ok && r.capabilities, { medicalDirector: false });
  reset();
});

test('admin preview: flag applies only to an ADMIN preview session, never to non-admins', async () => {
  reset();
  const rows = new Map<string, UserRow>([
    ['admin1', { status: 'ACTIVE', role: 'ADMIN', roles: ['ADMIN'], organizationId: 'org-a', organization: { active: true }, isMedicalDirector: false }],
    ['ther9', { status: 'ACTIVE', role: 'THERAPIST', roles: ['THERAPIST', 'PSYCHIATRIST'], organizationId: 'org-a', organization: { active: true }, isMedicalDirector: false }],
  ]);
  const admin = loadRequireSession(rows, { user: { id: 'admin1', role: 'PSYCHIATRIST', medicalDirectorPreview: true } });
  admin.invalidateSessionUser('admin1');
  const a = await admin.requireSession();
  assert.deepEqual(a.ok && a.capabilities, { medicalDirector: true });

  const other = loadRequireSession(rows, { user: { id: 'ther9', role: 'PSYCHIATRIST', medicalDirectorPreview: true } });
  other.invalidateSessionUser('ther9');
  const t = await other.requireSession();
  assert.deepEqual(t.ok && t.capabilities, { medicalDirector: false }, 'preview claim ignored for a non-admin');

  const { verifiedMedicalDirectorFor } = admin;
  assert.equal(verifiedMedicalDirectorFor({ status: 'ACTIVE', role: 'ADMIN', roles: ['ADMIN'] } as never, 'ADMIN', true), false, 'only on a prescriber preview role');
  assert.equal(verifiedMedicalDirectorFor({ status: 'ACTIVE', role: 'PSYCHIATRIST', roles: ['PSYCHIATRIST'], isMedicalDirector: true } as never, 'PSYCHIATRIST', false), true);
  assert.equal(verifiedMedicalDirectorFor({ status: 'DEACTIVATED', role: 'PSYCHIATRIST', roles: ['PSYCHIATRIST'], isMedicalDirector: true } as never, 'PSYCHIATRIST', false), false);
  reset();

  // JWT callback: the preview flag is only set for an ADMIN base role
  const cfg = loadWithStubs<typeof import('../src/lib/auth/config')>(
    '../src/lib/auth/config',
    {
      '@/lib/db/prisma': { prisma: { user: { findUnique: async () => ({ status: 'ACTIVE', role: 'NP', roles: ['NP'], isMedicalDirector: true, medicalDirectorScope: 'Behavioral health' }) } } },
      '@/lib/auth/otp': { verifyEmailOtp: async () => ({ ok: false }) },
      '@/lib/auth/staffSignIn': { completeSignIn: async () => null },
      '@/lib/audit/writeAuditLog': { writeAuditLog: async () => {} },
    },
    /lib[\\/]auth[\\/]config/,
  );
  const jwt = cfg.authConfig.callbacks.jwt as unknown as (a: object) => Promise<Record<string, unknown>>;
  // Session times (15 min idle / 12 h absolute, src/lib/auth/sessionPolicy.ts): a token without them is refused
  const live = { authTime: Date.now(), lastActivity: Date.now() };
  const asAdmin = await jwt({ token: { id: 'admin1', role: 'ADMIN', baseRole: 'ADMIN', roles: ['ADMIN'], ...live }, trigger: 'update', session: { activeRole: 'PSYCHIATRIST', medicalDirectorPreview: true } });
  assert.equal(asAdmin.role, 'PSYCHIATRIST');
  assert.equal(asAdmin.medicalDirectorPreview, true);
  const back = await jwt({ token: asAdmin, trigger: 'update', session: { activeRole: 'ADMIN' } });
  assert.equal(back.medicalDirectorPreview, false, 'switching role ends the preview');
  const nonAdmin = await jwt({ token: { id: 'np2', role: 'THERAPIST', baseRole: 'THERAPIST', roles: ['THERAPIST', 'NP'], ...live }, trigger: 'update', session: { activeRole: 'NP', medicalDirectorPreview: true } });
  assert.equal(nonAdmin.role, 'NP');
  assert.equal(nonAdmin.medicalDirectorPreview, false, 'non-admins cannot preview the flag');
  const refreshed = await jwt({ token: { id: 'np2', role: 'NP', baseRole: 'NP', roles: ['NP'], ...live }, trigger: 'update', session: { refreshCapabilities: true } });
  assert.equal(refreshed.medicalDirector, true, 'grant reaches the token via refreshCapabilities');
  assert.equal(refreshed.medicalDirectorScope, 'Behavioral health');
});

// ─── Staff management: eligibility, no self-grant, audit, cache invalidation ──

type StaffRow = { id: string; organizationId: string; role: string; roles: string[]; status: string; primaryLocationId: string | null; isMedicalDirector: boolean; medicalDirectorScope: string | null; passwordHash: string | null; name: string; email: string; image: null; inviteExpiresAt: null; createdAt: Date; rcopiaUsername: null; primaryLocation: null };

function loadManage(users: Map<string, StaffRow>) {
  const audits: Record<string, unknown>[] = [];
  const pick = (u: StaffRow) => ({ ...u });
  const db = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => (users.get(where.id) ? pick(users.get(where.id)!) : null),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => pick(users.get(where.id)!),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.get(where.id)!;
        for (const [k, v] of Object.entries(data)) if (v !== undefined) (u as Record<string, unknown>)[k] = v;
        return pick(u);
      },
      count: async () => 1,
      findFirst: async () => null,
    },
  };
  const invalidated: string[] = [];
  const mod = loadWithStubs<typeof import('../src/lib/staff/manage')>(
    '../src/lib/staff/manage',
    {
      '@/lib/db/prisma': { prisma: db },
      '@/lib/audit/writeAuditLog': { writeAuditLog: async (e: Record<string, unknown>) => { audits.push(e); } },
      '@/lib/auth/requireSession': { invalidateSessionUser: (id: string) => { invalidated.push(id); forgetVerifiedCapabilities(id); } },
      '@/lib/org/locations': { assignUserToLocation: async () => ({ ok: true }) },
    },
    /lib[\\/]staff[\\/]manage/,
  );
  return { mod, audits, invalidated };
}

const staff = (id: string, role: string, extra: Partial<StaffRow> = {}): StaffRow => ({
  id, organizationId: 'org-a', role, roles: [role], status: 'ACTIVE', primaryLocationId: null, isMedicalDirector: false, medicalDirectorScope: null,
  passwordHash: 'x', name: id, email: `${id}@x.test`, image: null, inviteExpiresAt: null, createdAt: new Date(0), rcopiaUsername: null, primaryLocation: null, ...extra,
});

test('staff management: grant / revoke audited with before/after, cache invalidated; only prescribers', async () => {
  const users = new Map([['admin1', staff('admin1', 'ADMIN')], ['psych1', staff('psych1', 'PSYCHIATRIST')], ['ther9', staff('ther9', 'THERAPIST')]]);
  const { mod, audits, invalidated } = loadManage(users);

  const granted = await mod.updateStaffUser('psych1', 'admin1', 'org-a', { isMedicalDirector: true, medicalDirectorScope: '  Behavioral   health ' }, { actorRole: 'ADMIN' });
  assert.ok(granted.ok);
  assert.equal(granted.ok && granted.user.isMedicalDirector, true);
  assert.equal(users.get('psych1')!.medicalDirectorScope, 'Behavioral health');
  assert.deepEqual(invalidated, ['psych1']);
  assert.equal(audits[0].action, 'STAFF_ACCESS_CHANGE');
  assert.equal((audits[0].metadata as Record<string, unknown>).beforeMedicalDirector, false);
  assert.equal((audits[0].metadata as Record<string, unknown>).afterMedicalDirector, true);

  const refused = await mod.updateStaffUser('ther9', 'admin1', 'org-a', { isMedicalDirector: true }, { actorRole: 'ADMIN' });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 400);
  assert.equal(users.get('ther9')!.isMedicalDirector, false);

  // Role change to a non-prescriber role ends the designation
  await mod.updateStaffUser('psych1', 'admin1', 'org-a', { role: 'THERAPIST', roles: ['THERAPIST'] }, { actorRole: 'ADMIN' });
  assert.equal(users.get('psych1')!.isMedicalDirector, false);
  assert.equal(users.get('psych1')!.medicalDirectorScope, null);

  // Server-side schema accepts the fields
  const route = read('src/app/api/staff/[id]/route.ts');
  assert.match(route, /isMedicalDirector: z\.boolean\(\)\.optional\(\)/);
  assert.match(route, /requireFullAdmin/);
});

test('no self-grant: a prescriber admin cannot set the flag on their own account', async () => {
  const users = new Map([['psych1', staff('psych1', 'PSYCHIATRIST', { roles: ['PSYCHIATRIST', 'ADMIN'] })]]);
  const { mod, audits } = loadManage(users);
  const r = await mod.updateStaffUser('psych1', 'psych1', 'org-a', { isMedicalDirector: true }, { actorRole: 'ADMIN' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, 'You cannot change your own Medical Director designation');
  assert.equal(users.get('psych1')!.isMedicalDirector, false);
  assert.equal(audits.length, 0);
  // Unchanged values in a full-form save are not a change
  const same = await mod.updateStaffUser('psych1', 'psych1', 'org-a', { isMedicalDirector: false, medicalDirectorScope: null }, { actorRole: 'ADMIN' });
  assert.equal(same.ok, true);
});

// ─── Cross-org ────────────────────────────────────────────────────────────────

test('cross-org access is never granted', () => {
  reset();
  recordVerifiedCapabilities('psych1', { organizationId: 'org-a', medicalDirector: true }, TTL);
  // Org A director: the org filter still excludes org B's clients
  assert.ok(!visible(clientAccessWhere({ organizationId: 'org-a', actorUserId: 'psych1', actorRole: 'PSYCHIATRIST' }) as Record<string, unknown>).includes('b-client'));
  // A query in another org's context is never widened
  assert.equal(verifiedMedicalDirector({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-b' }), false);
  const inB = clientAccessWhere({ organizationId: 'org-b', actorUserId: 'psych1', actorRole: 'PSYCHIATRIST' });
  assert.notDeepEqual(inB, clientOrgFilter('org-b'));
  assert.ok(isCaseloadScoped({ userId: 'psych1', role: 'PSYCHIATRIST', organizationId: 'org-b' }));
  // A registry entry without an organization grants nothing
  recordVerifiedCapabilities('np2', { organizationId: null, medicalDirector: true }, TTL);
  assert.equal(verifiedMedicalDirector({ userId: 'np2', role: 'NP' }), false);
  // Expired entry (no request refreshed it) fails closed
  recordVerifiedCapabilities('doc3', { organizationId: 'org-a', medicalDirector: true }, 1, Date.now() - 10);
  assert.equal(verifiedMedicalDirector({ userId: 'doc3', role: 'PHYSICIAN', organizationId: 'org-a' }), false);
  reset();
});

test('migration: idempotent, schema only, matches schema.prisma', () => {
  const sql = read('prisma/migrations/20261019_medical_director.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "isMedicalDirector" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "medicalDirectorScope" TEXT/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/i.test(sql.replace(/^--.*$/gm, '')), 'schema only');
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /isMedicalDirector\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /medicalDirectorScope\s+String\?/);
});
