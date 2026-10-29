import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CARE_TEAM_CAP,
  buildCareTeams,
  buildClientCareTeam,
  careTeamIsUnassigned,
  careTeamLabel,
  isCaseloadAssignee,
  nonClinicalAssigneeUserWhere,
} from '../src/lib/clients/careTeam';
import { unassignedWhere } from '../src/lib/clients/listQuery';
import { clinicalPrimaryWhere, caseloadUpcomingWhere } from '../src/lib/clients/caseloadCounts';
import { importAssigneeId, resolveImportProvider } from '../src/lib/migration/providers';
import { buildProviderCodeMap } from '../src/lib/migration/valantProviderMap';
import { planAdminAssigned } from '../src/lib/clients/adminAssignedPlan';

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const np = { id: 'u-np', name: 'Kumutha Daniel', role: 'NP', roles: ['NP'] };
const admin = { id: 'u-admin', name: 'Andy (Admin)', role: 'ADMIN', roles: ['ADMIN', 'THERAPIST'] };

test('batched care team: primary first, others deduped, sorted by slot, primary excluded', () => {
  const teams = buildCareTeams(
    [
      { id: 'c1', assignedToId: np.id, assignedTo: np },
      { id: 'c2', assignedToId: null, assignedTo: null },
    ],
    [
      { clientId: 'c1', providerId: np.id, name: 'Kumutha Daniel', role: 'Nurse Practitioner' }, // the primary again
      { clientId: 'c1', providerId: null, name: 'Peer Person', role: 'Peer Support' },
      { clientId: 'c1', providerId: 'u-t', name: 'S Walker (import)', role: 'Therapist' },
      { clientId: 'c1', providerId: 'u-t', name: 'Stephanie Walker', role: 'Therapist' }, // dup by id
      { clientId: 'c1', providerId: 'u-cm', name: 'Casey Manager', role: 'Clinician' }, // label from staff role
      { clientId: 'c2', providerId: 'u-t', name: 'Stephanie Walker', role: 'Therapist' },
    ],
    {
      staff: [
        { id: 'u-t', name: 'Stephanie Walker', role: 'THERAPIST' },
        { id: 'u-cm', name: 'Casey Manager', role: 'CASE_MANAGER' },
      ],
    }
  );
  const t1 = teams.get('c1')!;
  assert.deepEqual(t1.primary, { id: 'u-np', name: 'Kumutha Daniel', label: 'Prescriber' });
  assert.equal(t1.primaryStatus, 'assigned');
  assert.deepEqual(
    t1.members.map((m) => `${m.label}: ${m.name}`),
    ['Therapist: Stephanie Walker', 'Case manager: Casey Manager', 'Peer: Peer Person']
  );
  assert.equal(t1.memberCount, 3);
  assert.match(t1.summary, /^Primary \(Prescriber\): Kumutha Daniel; Therapist: Stephanie Walker/);
  const t2 = teams.get('c2')!;
  assert.equal(t2.primary, null);
  assert.equal(t2.primaryStatus, 'none');
  assert.equal(t2.members[0].name, 'Stephanie Walker');
  assert.equal(careTeamIsUnassigned(t2), false);
});

test('care team is capped with the full count kept for "+N more"; legacy JSON slots merge in', () => {
  const members = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ clientId: 'c', providerId: `p${n}`, name: `Person ${n}`, role: 'Therapist' }));
  const t = buildClientCareTeam(
    { id: 'c', assignedToId: null, assignedTo: null, treatmentTeam: { prescriberId: 'px', prescriberName: 'Dr Rx', primaryTherapistId: 'pA', primaryTherapistName: 'Person A' } },
    members
  );
  assert.equal(t.members.length, CARE_TEAM_CAP);
  assert.equal(t.memberCount, 6);
  assert.equal(t.members[0].label, 'Prescriber');
});

test('team role labels', () => {
  assert.equal(careTeamLabel('Psychiatrist'), 'Prescriber');
  assert.equal(careTeamLabel('Nurse Practitioner'), 'Prescriber');
  assert.equal(careTeamLabel('PRP Specialist'), 'PRP');
  assert.equal(careTeamLabel('Case Manager'), 'Case manager');
  assert.equal(careTeamLabel('Primary Care Provider'), 'Primary care');
  assert.equal(careTeamLabel('Clinician', 'THERAPIST'), 'Therapist');
  assert.equal(careTeamLabel('Clinician'), 'Clinician');
});

test('non-clinical assignee shows as Unassigned and counts as unassigned', () => {
  assert.equal(isCaseloadAssignee(admin), false, 'ADMIN is never a primary clinician, even with clinical roles[]');
  assert.equal(isCaseloadAssignee({ role: 'OFFICE_MANAGER', roles: [] }), false);
  assert.equal(isCaseloadAssignee({ role: 'PRACTICE_DIRECTOR', roles: ['PSYCHIATRIST'] }), true, 'medical director');
  assert.equal(isCaseloadAssignee({ role: 'THERAPIST' }), true);

  const t = buildClientCareTeam({ id: 'c', assignedToId: admin.id, assignedTo: admin }, []);
  assert.equal(t.primary, null);
  assert.equal(t.primaryStatus, 'non_clinical');
  assert.ok(!t.summary.includes('Andy'), 'admin name never shown as the clinician');
  assert.equal(careTeamIsUnassigned(t), true);

  // "No clinician" filter + caseload unassigned total include non-clinical assignees
  const w = JSON.stringify(unassignedWhere());
  assert.match(w, /"assignedToId":null/);
  assert.match(w, /"assignedTo":\{"OR":\[\{"role":\{"in":\["ADMIN","SUPER_ADMIN"\]\}\}/);
  assert.match(w, /"treatmentTeamMembers":\{"none":\{\}\}/);
  // Primary caseload excludes them
  assert.deepEqual(clinicalPrimaryWhere(), { AND: [{ assignedToId: { not: null } }, { NOT: { assignedTo: nonClinicalAssigneeUserWhere() } }] });
  assert.ok(JSON.stringify(caseloadUpcomingWhere({}, new Date(0))).includes('"NOT":{"assignedTo"'));
  const route = read('src/app/api/clients/caseload-counts/route.ts');
  assert.match(route, /where: \{ AND: \[base, clinicalPrimaryWhere\(\)\] \}/);
});

test('locked rows get no care team (list keeps masking)', () => {
  const teams = buildCareTeams(
    [{ id: 'locked', assignedToId: np.id, assignedTo: np }],
    [{ clientId: 'locked', providerId: 'u-t', name: 'Stephanie Walker', role: 'Therapist' }],
    { lockedIds: new Set(['locked']) }
  );
  assert.equal(teams.has('locked'), false);
  const manage = read('src/lib/clients/manage.ts');
  assert.match(manage, /careTeam: locked \? null : careTeams\.get\(c\.id\) \?\? null/);
  // one batched member query for the page, not per client
  assert.match(manage, /clientTreatmentTeamMember\.findMany\(\{\s*where: \{ clientId: \{ in: rows\.map/);
});

test('client importer: NULL when Valant has no (linkable) provider; never the importing user', () => {
  const staff = [
    { id: 'u-adm', name: 'Andy Admin', role: 'ADMIN', roles: ['ADMIN'] },
    { id: 'u-kd', name: 'Kumutha Daniel', role: 'NP', roles: ['NP'] },
    { id: 'u-sw', name: 'Stephanie Walker', role: 'THERAPIST', roles: ['THERAPIST'] },
  ];
  assert.equal(importAssigneeId([], staff), null);
  assert.equal(importAssigneeId([{ providerId: null }], staff), null);
  assert.equal(importAssigneeId([{ providerId: 'u-adm' }], staff), null, 'a non-clinical match is not a primary');
  assert.equal(importAssigneeId([{ providerId: 'u-adm' }, { providerId: 'u-sw' }], staff), 'u-sw');

  // name match, and a person-made ValantProviderMap code wins
  assert.equal(resolveImportProvider('Kumutha Daniel, CRNP-PMH', staff).staff?.id, 'u-kd');
  const map = buildProviderCodeMap([{ codeKey: 'k.daniel', userId: 'u-sw' }]);
  assert.equal(resolveImportProvider('K.Daniel', staff, map).staff?.id, 'u-sw');
  assert.equal(resolveImportProvider('Nobody Here', staff, map).staff, null);

  const route = read('src/app/api/migration/clients/route.ts');
  assert.ok(!/assignedToId: team\?\.firstLinked \?\? gate\.userId/.test(route));
  assert.match(route, /assignedToId: team\?\.firstLinked \?\? null/);
  assert.match(route, /firstLinked: importAssigneeId\(members, staff\)/);
});

test('admin-assigned report: plan counts; script prints counts only and writes only with the flag', () => {
  const now = Date.now();
  const plan = planAdminAssigned(
    ['a', 'b', 'c', 'd'],
    [
      { clientId: 'a', clinicianId: 'u-old', startsAt: new Date(now - 9e9) },
      { clientId: 'a', clinicianId: 'u-sw', startsAt: new Date(now - 1e9) },
      { clientId: 'b', clinicianId: 'u-adm', startsAt: new Date(now - 1e9) },
      { clientId: 'c', clinicianId: 'u-gone', startsAt: new Date(now - 1e9) },
    ],
    [
      { id: 'u-sw', role: 'THERAPIST', status: 'ACTIVE' },
      { id: 'u-old', role: 'THERAPIST', status: 'ACTIVE' },
      { id: 'u-adm', role: 'ADMIN', status: 'ACTIVE' },
      { id: 'u-gone', role: 'THERAPIST', status: 'DEACTIVATED' },
    ]
  );
  assert.equal(plan.decisions.get('a'), 'u-sw');
  assert.equal(plan.decisions.get('b'), null);
  assert.equal(plan.decisions.get('c'), null);
  assert.equal(plan.decisions.get('d'), null);
  assert.deepEqual(plan.counts, {
    total: 4,
    withCompletedVisit: 3,
    withoutCompletedVisit: 1,
    suggested: 1,
    toUnassigned: 3,
    unclearLatestClinician: 2,
    distinctSuggestedClinicians: 1,
  });

  const script = read('scripts/report-admin-assigned-clients.ts');
  // no names / emails / MRNs selected or printed
  assert.ok(!/name: true|email: true|mrn: true|legalFirstName|legalLastName/.test(script));
  for (const line of script.split('\n').filter((l) => /console\.(log|error)/.test(l))) {
    assert.ok(!/\.name\b|\.email\b|\.mrn\b|c\.id\b|\bid\b\)/.test(line), `prints identifiers: ${line.trim()}`);
  }
  // writes only behind --apply-suggestions
  assert.match(script, /const APPLY = process\.argv\.includes\('--apply-suggestions'\)/);
  const writeIdx = script.indexOf('updateMany');
  assert.ok(writeIdx > script.indexOf('if (APPLY && k.total)'));
  assert.ok(!/\.(create|delete|upsert|update)\(/.test(script));
});

test('UI: cards, rows, mobile and the chart banner show the care team', () => {
  const page = read('src/app/dashboard/clients/page.tsx');
  assert.match(page, /<CareTeamSummary team=\{client\.careTeam\} variant="card" \/>/);
  assert.match(page, /<CareTeamSummary team=\{c\.careTeam\} variant="cell" \/>/);
  assert.match(page, /<CareTeamSummary team=\{c\.careTeam\} variant="mobile"/);
  const summary = read('src/features/clients/components/CareTeamSummary.tsx');
  assert.match(summary, /Imported without a provider/);
  assert.match(summary, /\+\{count\} more/);
  const banner = read('src/components/chart/PatientBanner.tsx');
  assert.match(banner, /<CareTeamInline team=\{b\.careTeam\}/);
  assert.match(read('src/lib/clients/chartAccess.ts'), /async careTeam\(organizationId, clientId\)/);
});
