import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideChartAccess } from '../src/lib/clients/chartBanner';
import {
  CASELOAD_APPOINTMENT_LOOKBACK_DAYS,
  CARE_TEAM_CHANGE_DENIED,
  canManageCareTeam,
  careTeamClientWhereForRole,
  clientAccessWhere,
  medicalCareTeamClientWhere,
  peerCareTeamClientWhere,
} from '../src/lib/clients/orgScope';
import { forgetVerifiedCapabilities, recordVerifiedCapabilities } from '../src/lib/auth/medicalDirector';
import { teamSlotChanges } from '../src/lib/clients/teamSlots';
import { canSeeMember } from '../src/lib/groups/access';
import { invalidateCaseloadScopedCaches, registerCaseloadScopedCache, scopedKey, TtlCache } from '../src/lib/perf/cache';

/**
 * "Assigned a client -> can open the client": the per-client gates (chart, sections, profile,
 * scheduling, telehealth, notes, check-ins, avatar) use the same care-team rule as the client list
 * (orgScope.clientAccessWhere): primary assignee, treatment-team member, recent / upcoming visit
 * clinician; primary care and Peer Support variants; verified Medical Director org-wide. Part 2 /
 * sensitive locks still apply on top.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const BH_ROLES = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'CLINICIAN', 'CRISIS_RESPONDER'];
const notMine = { assignedToId: 'other-clinician' };

// ─── Tiny evaluator for the client where-clauses (no database) ──────────────

type Row = {
  id: string;
  organizationId: string;
  assignedToId: string | null;
  team: string[];
  appointments: { clinicianId: string; startsAt: Date }[];
  medicalVisits: string[];
};

function matches(c: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => matches(c, w));
    if (k === 'AND') return (v as Record<string, unknown>[]).every((w) => matches(c, w));
    if (k === 'id' || k === 'organizationId' || k === 'assignedToId') return c[k] === v;
    if (k === 'location' || k === 'assignedTo') return false;
    if (k === 'locationId') return false;
    if (k === 'treatmentTeamMembers') return c.team.includes((v as { some: { providerId: string } }).some.providerId);
    if (k === 'medicalVisits') return c.medicalVisits.includes((v as { some: { providerId: string } }).some.providerId);
    if (k === 'appointments') {
      const some = (v as { some: { clinicianId: string; startsAt?: { gte: Date } } }).some;
      return c.appointments.some((a) => a.clinicianId === some.clinicianId && (!some.startsAt || a.startsAt >= some.startsAt.gte));
    }
    throw new Error(`evaluator: unsupported key ${k}`);
  });
}

const NOW = new Date();
const DAY = 86_400_000;
const client = (over: Partial<Row>): Row => ({ id: 'c1', organizationId: 'org-a', assignedToId: 'ther-primary', team: [], appointments: [], medicalVisits: [], ...over });

// ─── decideChartAccess (pure chart gate) ────────────────────────────────────

test('BH treatment-team member opens a client whose primary is someone else', async () => {
  for (const role of BH_ROLES) {
    const r = await decideChartAccess({ role, userId: 'u', organizationId: 'org-a', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: async () => true });
    assert.deepEqual(r, { ok: true, sensitive: 'none' }, role);
  }
});

test('visit clinician (appointment in the lookback or upcoming) is on the care team; a stale one is not', () => {
  const seen = client({ appointments: [{ clinicianId: 'psych', startsAt: new Date(NOW.getTime() - 30 * DAY) }] });
  const upcoming = client({ appointments: [{ clinicianId: 'psych', startsAt: new Date(NOW.getTime() + 7 * DAY) }] });
  const stale = client({ appointments: [{ clinicianId: 'psych', startsAt: new Date(NOW.getTime() - (CASELOAD_APPOINTMENT_LOOKBACK_DAYS + 5) * DAY) }] });
  const w = careTeamClientWhereForRole('psych', 'PSYCHIATRIST', NOW) as Record<string, unknown>;
  assert.equal(matches(seen, w), true);
  assert.equal(matches(upcoming, w), true);
  assert.equal(matches(stale, w), false);
  assert.equal(matches(client({ team: ['psych'] }), w), true, 'treatment team');
  assert.equal(matches(client({ assignedToId: 'psych' }), w), true, 'primary');
});

test('non-linked clinician gets 403 not_on_caseload (forwarded thread still allowed)', async () => {
  for (const role of BH_ROLES) {
    const no = await decideChartAccess({ role, userId: 'u', organizationId: 'org-a', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => false });
    assert.deepEqual(no, { ok: false, status: 403, reason: 'not_on_caseload' }, role);
    const fwd = await decideChartAccess({ role, userId: 'u', organizationId: 'org-a', client: notMine, sensitive: 'none', hasForwardedThread: async () => true, hasCareTeamLink: () => false });
    assert.deepEqual(fwd, { ok: true, sensitive: 'none' }, role);
  }
  // Roles without roster access never get in through a care-team link
  for (const role of ['HR', 'PATIENT']) {
    const r = await decideChartAccess({ role, userId: 'u', client: notMine, sensitive: 'none', hasForwardedThread: () => true, hasCareTeamLink: () => true });
    assert.deepEqual(r, { ok: false, status: 403, reason: 'role_not_permitted' }, role);
  }
});

test('sensitive / Part 2 lock is still 403 for a care-team member or the primary', async () => {
  for (const c of [notMine, { assignedToId: 'u' }]) {
    const r = await decideChartAccess({ role: 'THERAPIST', userId: 'u', organizationId: 'org-a', client: c, sensitive: 'locked', hasForwardedThread: () => true, hasCareTeamLink: () => true });
    assert.deepEqual(r, { ok: false, status: 403, reason: 'sensitive_record' });
  }
});

test('verified Medical Director is org-wide (no care-team query), revocation restores the caseload rule', async () => {
  recordVerifiedCapabilities('md1', { organizationId: 'org-a', medicalDirector: true }, 10_000);
  let asked = false;
  const r = await decideChartAccess({ role: 'PSYCHIATRIST', userId: 'md1', organizationId: 'org-a', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => ((asked = true), false) });
  assert.deepEqual(r, { ok: true, sensitive: 'none' });
  assert.equal(asked, false);
  forgetVerifiedCapabilities('md1');
  const after = await decideChartAccess({ role: 'PSYCHIATRIST', userId: 'md1', organizationId: 'org-a', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => false });
  assert.deepEqual(after, { ok: false, status: 403, reason: 'not_on_caseload' });
});

test('primary assignee needs no care-team query', async () => {
  let asked = false;
  const r = await decideChartAccess({ role: 'THERAPIST', userId: 'u', client: { assignedToId: 'u' }, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => ((asked = true), false) });
  assert.deepEqual(r, { ok: true, sensitive: 'none' });
  assert.equal(asked, false);
});

// ─── List rule == gate rule ─────────────────────────────────────────────────

const noDates = (w: unknown) => JSON.stringify(w).replace(/"\d{4}-\d{2}-\d{2}T[^"]+"/g, '"D"');

test('clientAccessWhere uses careTeamClientWhereForRole for every caseload role (one rule)', () => {
  for (const role of [...BH_ROLES, 'PEER_SUPPORT', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    const list = noDates(clientAccessWhere({ organizationId: 'o', actorUserId: 'u', actorRole: role as never }));
    assert.ok(list.includes(noDates(careTeamClientWhereForRole('u', role))), role);
  }
  assert.deepEqual(careTeamClientWhereForRole('u', 'PHYSICIAN'), medicalCareTeamClientWhere('u'));
  assert.deepEqual(careTeamClientWhereForRole('u', 'PEER_SUPPORT'), peerCareTeamClientWhere('u'));
  // Behavioral roles do not get the MedicalVisit link
  assert.ok(!noDates(careTeamClientWhereForRole('u', 'THERAPIST')).includes('medicalVisits'));
});

test('previous primary loses access after reassignment unless still on the team or seeing the client', () => {
  const w = careTeamClientWhereForRole('old', 'THERAPIST', NOW) as Record<string, unknown>;
  assert.equal(matches(client({ assignedToId: 'new' }), w), false);
  assert.equal(matches(client({ assignedToId: 'new', team: ['old'] }), w), true);
  assert.equal(matches(client({ assignedToId: 'new', appointments: [{ clinicianId: 'old', startsAt: new Date(NOW.getTime() - 10 * DAY) }] }), w), true);
  const n = careTeamClientWhereForRole('new', 'THERAPIST', NOW) as Record<string, unknown>;
  assert.equal(matches(client({ assignedToId: 'new' }), n), true, 'new primary sees it at once');
});

// ─── Assignment takes effect ────────────────────────────────────────────────

test('warm handoff slot changes add the new holder to the treatment team and drop the replaced one', () => {
  assert.deepEqual(teamSlotChanges({ prescriberId: 'p1' }, { prescriberId: 'p2' }), {
    add: [{ providerId: 'p2', role: 'Prescriber' }],
    remove: [{ providerId: 'p1', role: 'Prescriber' }],
  });
  assert.deepEqual(teamSlotChanges(null, { caseManagerId: 'cm', primaryTherapistId: 't' }), { add: [{ providerId: 'cm', role: 'Case Manager' }], remove: [] });
  // Slots not in the update are untouched; unchanged slots are no-ops
  assert.deepEqual(teamSlotChanges({ peerSupportId: 'ps' }, { prescriberId: 'p' }), { add: [{ providerId: 'p', role: 'Prescriber' }], remove: [] });
  assert.deepEqual(teamSlotChanges({ prescriberId: 'p' }, { prescriberId: 'p' }), { add: [], remove: [] });
  assert.deepEqual(teamSlotChanges([] as never, [] as never), { add: [], remove: [] });
});

test('caseload-scoped caches drop per organization on an assignment write', () => {
  const cache = registerCaseloadScopedCache(new TtlCache<number>(60_000));
  const a = scopedKey({ organizationId: 'org-a', userId: 'u', role: 'THERAPIST' }, 'x');
  const b = scopedKey({ organizationId: 'org-b', userId: 'u', role: 'THERAPIST' }, 'x');
  cache.set(a, 1);
  cache.set(b, 2);
  invalidateCaseloadScopedCaches('org-a');
  assert.equal(cache.get(a), undefined);
  assert.equal(cache.get(b), 2);
  for (const f of ['src/app/api/dashboard/home/route.ts', 'src/lib/inbox/cacheStore.ts', 'src/lib/clinical/sessionFrequencyData.ts']) {
    assert.match(read(f), /registerCaseloadScopedCache\(/, f);
  }
  for (const f of [
    'src/app/api/clients/[id]/route.ts',
    'src/app/api/clients/[id]/care-team/route.ts',
    'src/app/api/clients/[id]/treatment-team/route.ts',
    'src/app/api/clients/[id]/treatment-team/[providerId]/route.ts',
    'src/app/api/clients/bulk-transfer/route.ts',
    'src/lib/clients/manage.ts',
  ]) {
    assert.match(read(f), /invalidateCaseloadScopedCaches\(/, f);
  }
  assert.match(read('src/app/api/clients/[id]/route.ts'), /syncTeamSlotsToMembers\(/);
});

test('group rosters show members on the viewer care team', () => {
  const group = { facilitatorId: 'fac', coFacilitatorId: null };
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 't2', group, assignedToId: 'other', onCareTeam: true }), true);
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 't2', group, assignedToId: 'other', onCareTeam: false }), false);
});

// ─── Source-level: no gate is the bare primary-assignee comparison any more ──

const GATES = [
  'src/app/api/clients/[id]/route.ts',
  'src/app/api/scheduling/appointment-labels/suggest/route.ts',
  'src/lib/appointments/manage.ts',
  'src/lib/clients/avatar.ts',
  'src/lib/clients/checkIns.ts',
  'src/lib/clients/notes.ts',
  'src/lib/scheduling/series.ts',
  'src/lib/telehealth/manage.ts',
  'src/lib/clients/chartBanner.ts',
];

test('per-client gates use the care-team helper, not `assignedToId !==` alone', () => {
  const bare = /isCaseloadScoped\([^)]*\)\s*&&\s*[\w.]+\.assignedToId\s*!==/;
  for (const f of GATES) assert.ok(!bare.test(read(f)), `${f} still gates on the primary assignee only`);
  for (const f of GATES.filter((g) => !g.endsWith('chartBanner.ts'))) {
    assert.match(read(f), /caseloadAllows\(|hasCareTeamLink\(/, f);
  }
  // Chart gate: care-team link consulted for every caseload role, not only medical / peer
  const banner = read('src/lib/clients/chartBanner.ts');
  assert.ok(!/isMedicalRole\(input\.role\)/.test(banner));
  assert.match(read('src/lib/clients/chartAccess.ts'), /careTeamClientWhereForRole\(viewer\.userId, viewer\.role\)/);
  // The helper is the list rule plus the id
  const helper = read('src/lib/clients/caseloadAccess.ts');
  assert.match(helper, /clientAccessWhere\(/);
  assert.match(helper, /\{ id: clientId \}/);
  // Feeds: progress-notes feed and today's schedule follow the care team too
  assert.ok(!/\{ assignedToId: input\.actorUserId \}/.test(read('src/lib/clients/notes.ts')));
  assert.ok(!/and\.push\(\{ client: \{ assignedToId: v\.userId \} \}\)/.test(read('src/lib/dashboard/homeData.ts')));
  assert.ok(!/'Active, assigned to you'/.test(read('src/lib/dashboard/homeData.ts')));
  // Reassigning the primary clinician stays with the assign roles
  assert.match(read('src/app/api/clients/[id]/route.ts'), /canAssignPatientToClinician\(gate\.role\)/);
});

// ─── Care-team changes: primary clinician or leadership only ────────────────

test('canManageCareTeam: leadership, assign roles, Medical Director, the primary; not other team members', () => {
  const c = { assignedToId: 'primary' };
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK']) {
    assert.equal(canManageCareTeam({ role, userId: 'x', organizationId: 'org-a' }, c), true, role);
  }
  assert.equal(canManageCareTeam({ role: 'THERAPIST', userId: 'primary', organizationId: 'org-a' }, c), true, 'primary');
  for (const role of BH_ROLES) {
    assert.equal(canManageCareTeam({ role, userId: 'team-member', organizationId: 'org-a' }, c), false, role);
  }
  assert.equal(canManageCareTeam({ role: 'THERAPIST', userId: 'x', organizationId: 'org-a' }, { assignedToId: null }), false, 'unassigned client');
  for (const role of ['HR', 'BILLING', '']) assert.equal(canManageCareTeam({ role, userId: 'x' }, c), false, role || 'none');
  recordVerifiedCapabilities('md2', { organizationId: 'org-a', medicalDirector: true }, 10_000);
  assert.equal(canManageCareTeam({ role: 'PSYCHIATRIST', userId: 'md2', organizationId: 'org-a' }, c), true, 'medical director');
  assert.equal(canManageCareTeam({ role: 'PSYCHIATRIST', userId: 'md2', organizationId: 'org-b' }, c), false, 'never across orgs');
  forgetVerifiedCapabilities('md2');
  assert.match(CARE_TEAM_CHANGE_DENIED, /Ask the primary clinician or leadership to change the care team/);
});

test('care-team / treatment-team add and remove routes enforce canManageCareTeam and audit the denial', () => {
  const routes: [string, number][] = [
    ['src/app/api/clients/[id]/care-team/route.ts', 2],
    ['src/app/api/clients/[id]/treatment-team/route.ts', 2],
    ['src/app/api/clients/[id]/treatment-team/[providerId]/route.ts', 1],
  ];
  for (const [f, n] of routes) {
    const src = read(f);
    assert.equal(src.match(/if \(!canManageCareTeam\(\{ role: gate\.role, userId: gate\.userId, organizationId: gate\.organizationId \}, \w+\)\)/g)?.length, n, f);
    assert.equal(src.match(/reason: 'not_primary_or_leadership'/g)?.length, n, f);
    assert.equal(src.match(/error: CARE_TEAM_CHANGE_DENIED \}, \{ status: 403 \}/g)?.length, n, f);
    // Successful adds / removes are audited too
    const audits = src.split('auditPhiAccess(').slice(1).map((a) => a.slice(0, a.indexOf(');')));
    assert.ok(audits.some((a) => /action: 'DELETE'/.test(a) && !/DENIED/.test(a)), `${f}: successful remove audited`);
    if (n === 2) assert.ok(audits.some((a) => /action: 'CREATE'/.test(a) && !/DENIED/.test(a)), `${f}: successful add audited`);
  }
  assert.match(read('src/lib/clients/teamAccess.ts'), /select: \{ id: true, assignedToId: true \}/);
  // Chart UI shows add / remove only to the same people
  const page = read('src/app/dashboard/clients/[id]/page.tsx');
  assert.match(page, /const canManageTeam =\s*canEditClientProfile\(role\) &&\s*\(canManageCareTeam\(/);
});

test('telehealth list scopes TelehealthSession rows like appointment rows for caseload roles', () => {
  const src = read('src/lib/telehealth/manage.ts');
  const fn = src.slice(src.indexOf('export async function listTelehealthSessions'), src.indexOf('export async function listTelehealthSessions') + 4000);
  assert.match(fn, /where = \{\s*AND: \[where, \{ OR: \[\{ clinicianId: input\.actorUserId \}, \{ client: careTeam \}\] \}\],\s*\}/);
  assert.match(fn, /apptWhere = \{\s*AND: \[apptWhere, \{ OR: \[\{ clinicianId: input\.actorUserId \}, \{ client: careTeam \}\] \}\],\s*\}/);
  // Both inside the caseload-scoped branch (org-wide roles unchanged)
  const branch = fn.slice(fn.indexOf('if (input.actorUserId && isCaseloadScoped('));
  assert.ok(branch.indexOf('where = {') < branch.indexOf("if (scope === 'today')"));
});
