import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { canReadClinicModule, canUseClinicModule } from '../src/lib/modules/access';
import {
  filterModuleItems,
  isClientScopedModule,
  mergeScopedModuleWrite,
  moduleCandidateClientIds,
  moduleItemClientId,
  type ModuleClientScope,
} from '../src/lib/modules/clientScope';
import { clientNameIndex, planModuleClientLinks } from '../src/lib/modules/clientLinkBackfill';
import {
  canReviewAllIncidents,
  canViewIncident,
  canWorkIncident,
  incidentVisibilityFilter,
  nextIncidentNumber,
} from '../src/lib/incidents/access';
import { planIncidentBlobMigration } from '../src/lib/incidents/blobMigration';
import { canEditClaims } from '../src/lib/billing/billingAccess';

// Role audit follow-ups (Oct 22 2026): incidents, per-client module lists, billing hub buttons.

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const scope = (over: Partial<ModuleClientScope> = {}): ModuleClientScope => ({
  caseloadScoped: true,
  known: new Set(['c-mine', 'c-other', 'c-part2']),
  accessible: new Set(['c-mine', 'c-part2']),
  locked: new Set(['c-part2']),
  ...over,
});

// ─── 1. Incidents ────────────────────────────────────────────────────────────

test('incidents: reviewers see all; line staff only what they filed, are involved in or are assigned', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']) assert.equal(canReviewAllIncidents(r), true, r);
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'FRONT_DESK', 'PHYSICIAN', 'MEDICAL_NP', 'CASE_MANAGER', 'PRP_SPECIALIST', 'CLINICIAN']) {
    assert.equal(canReviewAllIncidents(r), false, r);
  }
  // A verified Medical Director (server flag) reviews all
  assert.equal(canReviewAllIncidents('PSYCHIATRIST', true), true);
  const inc = { reporterUserId: 'u-rep', involvedStaffIds: ['u-inv'], assignedToUserId: 'u-asg' };
  assert.equal(canViewIncident(false, inc, 'u-rep'), true);
  assert.equal(canViewIncident(false, inc, 'u-inv'), true);
  assert.equal(canViewIncident(false, inc, 'u-asg'), true);
  assert.equal(canViewIncident(false, inc, 'u-x'), false);
  assert.equal(canViewIncident(true, inc, 'u-x'), true);
  // Investigation / status: reviewers or the assigned investigator; not the reporter
  assert.equal(canWorkIncident(false, inc, 'u-asg'), true);
  assert.equal(canWorkIncident(false, inc, 'u-rep'), false);
  assert.equal(canWorkIncident(false, inc, 'u-inv'), false);
  assert.equal(canWorkIncident(true, inc, 'u-x'), true);
  assert.deepEqual(incidentVisibilityFilter(true, 'u1'), {});
  assert.deepEqual(incidentVisibilityFilter(false, 'u1'), {
    OR: [{ reporterUserId: 'u1' }, { assignedToUserId: 'u1' }, { involvedStaffIds: { has: 'u1' } }],
  });
  assert.equal(nextIncidentNumber(['INC-2026-004', 'INC-2026-011', 'INC-2025-090', 'INC-2026-003-LEGACY'], 2026), 'INC-2026-012');
  assert.equal(nextIncidentNumber([], 2027), 'INC-2027-001');
});

test('incidents: relational table and routes; the org-wide module list is no longer served', () => {
  assert.equal(canUseClinicModule('ADMIN', 'incidents'), false);
  assert.equal(canReadClinicModule('THERAPIST', 'incidents'), false);
  assert.equal(canReadClinicModule('OFFICE_MANAGER', 'incidents'), false);
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model IncidentReport \{[\s\S]*involvedStaffIds\s+String\[\][\s\S]*clientId\s+String\?/);
  assert.match(read('prisma/migrations/20261022_roles_followup_incidents.sql'), /CREATE TABLE IF NOT EXISTS "IncidentReport"/);
  const list = read('src/app/api/incidents/route.ts');
  assert.match(list, /listIncidents\(/);
  assert.match(list, /createIncident\(/);
  assert.match(list, /canAccessPath\(gate\.role, '\/dashboard\/incidents', gate\.capabilities\)/);
  const patch = read('src/app/api/incidents/[id]/route.ts');
  assert.match(patch, /updateIncident\(/);
  assert.ok(!patch.includes('saveModuleData'), 'PATCH no longer rewrites the module list');
  const store = read('src/lib/incidents/store.ts');
  assert.match(store, /incidentVisibilityFilter\(reviewer, actor\.userId\)/);
  assert.match(store, /lockedSensitiveClientIds/);
  assert.match(store, /reporterUserId: actor\.userId/, 'the reporter is the caller, never a request field');
  const page = read('src/app/dashboard/incidents/page.tsx');
  assert.ok(!page.includes("useModuleList<Incident>('incidents'"));
  assert.match(page, /'\/api\/incidents'/);
  assert.match(page, /inc\.canWork/);
  // Reports and the CARF scorecard read the table
  assert.match(read('src/lib/reports/library/runners/compliance.ts'), /incidentsForOrgMetrics\(ctx\.organizationId\)/);
  assert.match(read('src/app/api/compliance/scorecard/route.ts'), /incidentsForOrgMetrics\(gate\.organizationId\)/);
  // Every incident page role can still file (page rule unchanged)
  for (const r of ['FRONT_DESK', 'THERAPIST', 'PHYSICIAN', 'OFFICE_MANAGER']) assert.equal(canAccessPath(r, '/dashboard/incidents'), true, r);
});

test('incidents blob migration: links names only on a unique match; nothing invented', () => {
  const blob = [
    { id: 'INC-2026-001', title: 'Fall', type: 'Client Fall', severity: 'minor', status: 'Open', reportedBy: 'Ann Lee', assignedTo: 'Bo Diaz', reportedAt: '2026-03-02', description: 'x' },
    { id: 'INC-2026-002', title: 'Near miss', reportedBy: 'Sam Roe', status: 'mystery', reportedAt: '2026-03-04', description: 'y' },
    { id: 'INC-2026-002', title: 'dup' },
    { title: 'no id' },
    { id: 'INC-2026-003', title: 'Already', reportedAt: '2026-03-05' },
    { id: 'INC-2026-004', title: 'Taken number', reportedAt: '2026-03-06' },
  ];
  const plan = planIncidentBlobMigration(blob, {
    staff: [{ id: 'u1', name: 'Ann Lee' }, { id: 'u2', name: 'bo diaz' }, { id: 'u3', name: 'Sam Roe' }, { id: 'u4', name: 'Sam Roe' }],
    existingLegacyIds: new Set(['INC-2026-003']),
    existingNumbers: new Set(['INC-2026-004']),
  });
  assert.equal(plan.counts.items, 6);
  assert.equal(plan.counts.toCopy, 3);
  assert.equal(plan.counts.duplicateId, 1);
  assert.equal(plan.counts.noId, 1);
  assert.equal(plan.counts.alreadyCopied, 1);
  assert.equal(plan.counts.renumbered, 1);
  const [a, b, c] = plan.rows;
  assert.equal(a.reporterUserId, 'u1');
  assert.equal(a.assignedToUserId, 'u2');
  assert.equal(a.status, 'reported', 'legacy Open maps to reported');
  assert.equal(b.reporterUserId, null, 'two users named Sam Roe: not guessed');
  assert.equal(b.reportedByName, 'Sam Roe');
  assert.equal(b.status, 'mystery', 'unknown status kept as written');
  assert.equal(b.severity, '', 'missing severity stays empty');
  assert.equal(b.reportedAtTime, null);
  assert.equal(c.incidentNumber, 'INC-2026-004-LEGACY');
  assert.equal(c.legacySourceId, 'INC-2026-004');
  for (const r of plan.rows) assert.deepEqual(r, { ...r }, 'plain rows');
  assert.match(read('scripts/migrate-incidents-blob.ts'), /const APPLY = args\.includes\('--apply'\)/);
});

// ─── 2. Per-client module lists ──────────────────────────────────────────────

test('module scope: safety plans, discharge, Part 2 roster and other per-client lists are caseload scoped', () => {
  for (const m of ['ehr-safety-plans', 'ehr-discharge-cases', 'part2-clients', 'outcome-schedules', 'outcome-responses', 'ehr-overview-revals', 'patient-surveys', 'diagnoses', 'prescriptions']) {
    assert.equal(isClientScopedModule(m), true, m);
  }
  // Org-wide by design (billing, admin, catalogs): not caseload scoped
  for (const m of ['invoices', 'superbills', 'billing-claims', 'goal-bank-templates', 'qi-meetings', 'grievances', 'hr-training-staff']) {
    assert.equal(isClientScopedModule(m), false, m);
  }
  assert.equal(moduleItemClientId('part2-clients', { id: 'c1', name: 'x' }), 'c1', 'Part 2 roster row id is the client id');
  assert.equal(moduleItemClientId('outcome-schedules', { scheduleId: 's', patientId: 'c2' }), 'c2');
  assert.equal(moduleItemClientId('ehr-safety-plans', { id: 'p', clientName: 'x' }), null);
  assert.deepEqual(moduleCandidateClientIds('ehr-safety-plans', [{ clientId: 'a' }, { clientId: 'a' }], [{ clientId: 'b' }]), ['a', 'b']);

  const stored = [
    { id: 'p1', clientId: 'c-mine' },
    { id: 'p2', clientId: 'c-other' },
    { id: 'p3', clientId: 'c-part2' },
    { id: 'p4', clientName: 'Legacy Only' },
  ];
  // Caseload role: own clients only, minus the locked Part 2 client, minus unlinked legacy rows
  assert.deepEqual(filterModuleItems('ehr-safety-plans', stored, scope()), [{ id: 'p1', clientId: 'c-mine' }]);
  // Org-wide role (leadership / operations): everything except locked Part 2; legacy rows visible
  const org = scope({ caseloadScoped: false, accessible: new Set(['c-mine', 'c-other', 'c-part2']) });
  assert.deepEqual(
    (filterModuleItems('ehr-safety-plans', stored, org) as { id: string }[]).map((i) => i.id),
    ['p1', 'p2', 'p4'],
  );
  assert.deepEqual(filterModuleItems('ehr-safety-plans', { not: 'a list' }, scope()), [], 'non-list fails closed for caseload roles');
});

test('module scope writes: hidden rows are kept; out-of-scope or colliding rows are refused', () => {
  const stored = [
    { id: 'p1', clientId: 'c-mine', v: 1 },
    { id: 'p2', clientId: 'c-other' },
    { id: 'p3', clientId: 'c-part2' },
    { id: 'p4', clientName: 'Legacy Only' },
  ];
  const ok = mergeScopedModuleWrite('ehr-safety-plans', stored, [{ id: 'p1', clientId: 'c-mine', v: 2 }, { id: 'p5', clientId: 'c-mine' }], scope());
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.data.map((i) => (i as { id: string }).id), ['p1', 'p5', 'p2', 'p3', 'p4'], 'other caseloads, Part 2 and legacy rows survive');
    assert.equal(ok.hiddenKept, 3);
  }
  // Deleting your own row works (absent from the list), hidden rows still kept
  const del = mergeScopedModuleWrite('ehr-safety-plans', stored, [], scope());
  assert.equal((del as { data?: unknown[] }).data?.length, 3);
  // A row for another clinician's client
  const other = mergeScopedModuleWrite('ehr-safety-plans', stored, [{ id: 'p9', clientId: 'c-other' }], scope());
  assert.equal(other.ok, false);
  assert.equal((other as { status?: number }).status, 403);
  // A locked Part 2 client
  assert.equal(mergeScopedModuleWrite('ehr-safety-plans', stored, [{ id: 'p9', clientId: 'c-part2' }], scope()).ok, false);
  // Overwriting a hidden row by reusing its id
  const collide = mergeScopedModuleWrite('ehr-safety-plans', stored, [{ id: 'p2', clientId: 'c-mine' }], scope());
  assert.equal(collide.ok, false);
  // Caseload role cannot add an unlinked row
  assert.equal(mergeScopedModuleWrite('ehr-safety-plans', stored, [{ id: 'p9', clientName: 'x' }], scope()).ok, false);
  // Not a list
  const bad = mergeScopedModuleWrite('ehr-safety-plans', stored, { a: 1 }, scope());
  assert.equal((bad as { status?: number }).status, 400);
});

test('module scope wiring: the generic route filters reads and merges writes; discharge cases carry clientId', () => {
  const route = read('src/app/api/modules/[module]/route.ts');
  assert.match(route, /isClientScopedModule\(module\)/);
  assert.match(route, /filterModuleItems\(module, snapshot\.data, scope\)/);
  assert.match(route, /mergeScopedModuleWrite\(module, before\.data, data, scope\)/);
  const server = read('src/lib/modules/clientScopeServer.ts');
  assert.match(server, /clientAccessWhere\(/);
  assert.match(server, /lockedSensitiveClientIds\(/);
  assert.match(server, /isCaseloadScoped\(/);
  const discharge = read('src/app/dashboard/ehr/discharge/page.tsx');
  assert.match(discharge, /clientId: client\.id/);
  assert.ok(!read('src/features/ehr/dischargeData.ts').includes("'1990-01-01'"), 'no made-up DOB on discharge cases');
});

test('module client-link backfill: unique exact name match only', () => {
  const index = clientNameIndex([
    { id: 'c1', name: 'Jane  Doe' },
    { id: 'c2', name: 'John Roe' },
    { id: 'c3', name: 'john roe' },
  ]);
  const data = [
    { id: 'a', clientName: 'jane doe' },
    { id: 'b', clientName: 'John Roe' },
    { id: 'c', clientName: 'Nobody' },
    { id: 'd', clientId: 'c9', clientName: 'Jane Doe' },
    { id: 'e' },
  ];
  const plan = planModuleClientLinks('ehr-safety-plans', data, index);
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.counts, { items: 5, alreadyLinked: 1, linked: 1, noName: 1, noMatch: 1, ambiguous: 1, notList: 0 });
  const out = plan.data as Record<string, unknown>[];
  assert.equal(out[0].clientId, 'c1');
  assert.equal(out[1].clientId, undefined, 'ambiguous name not linked');
  assert.equal(out[3].clientId, 'c9', 'existing link untouched');
  assert.equal(planModuleClientLinks('invoices', data, index).changed, false, 'only per-client modules');
  assert.match(read('scripts/backfill-module-client-ids.ts'), /const APPLY = args\.includes\('--apply'\)/);
});

// ─── 7. Billing hub buttons ──────────────────────────────────────────────────

test('billing hub: claim work buttons follow canEditClaims (Office Manager reads)', () => {
  assert.equal(canEditClaims('OFFICE_MANAGER'), false);
  assert.equal(canEditClaims('BILLING'), true);
  const page = read('src/app/dashboard/billing/page.tsx');
  assert.match(page, /const canClaimWork = canEditClaims\(user\?\.role\)/);
  assert.match(page, /canClaimWork && isSubmittable\(c\) && \(\s*<button\s*onClick=\{\(\) => void handleRowSubmit\(c\)\}/);
  assert.match(page, /canClaimWork && selectedSubmittable > 0/);
  assert.match(page, /canClaimWork && tracking/);
});

// ─── 9. Front desk and Part 2 disclosures (documented decision) ──────────────

test('Part 2 disclosures: Office Manager is the release-of-information desk; Front Desk does not open the Part 2 page', () => {
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/ehr/part2'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/ehr/part2'), true);
  assert.match(read('docs/role-access-matrix.md'), /release-of-information custodian/);
});
