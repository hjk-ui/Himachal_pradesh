import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CARE_TEAM_CAP,
  SEEN_BY_WINDOW_MONTHS,
  buildCareTeams,
  buildClientCareTeam,
  careTeamPersonLabel,
  isSeenByEligible,
  seenByWindowStart,
} from '../src/lib/clients/careTeam';
import { canChangePcp, decidePcp, pcpReviewDisplay, type PcpStaff, type ProviderTally } from '../src/lib/medical/pcpAssignment';

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const NOW = new Date('2026-10-25T15:00:00Z');
const np = { id: 'u-np', name: 'Kumutha Daniel', role: 'NP', roles: ['NP'] };
const staff = [
  { id: 'u-np', name: 'Kumutha Daniel', role: 'NP', roles: ['NP'], status: 'ACTIVE' },
  { id: 'u-t', name: 'Stephanie Walker', role: 'THERAPIST', roles: [], status: 'ACTIVE' },
  { id: 'u-rs', name: 'Rajan Sood', role: 'PSYCHIATRIST', roles: [], status: 'ACTIVE' },
  { id: 'u-dk', name: 'Daniel Safo Kantanka', role: 'PHYSICIAN', roles: [], status: 'ACTIVE' },
  { id: 'u-old', name: 'Gone Provider', role: 'THERAPIST', roles: [], status: 'DEACTIVATED' },
  { id: 'u-fd', name: 'Front Desk', role: 'FRONT_DESK', roles: [], status: 'ACTIVE' },
  { id: 'u-ma', name: 'Medical Assistant', role: 'MEDICAL_ASSISTANT', roles: [], status: 'ACTIVE' },
  { id: 'u-adm', name: 'Andy Admin', role: 'ADMIN', roles: ['ADMIN', 'THERAPIST'], status: 'ACTIVE' },
];

test('seen by: merged after the team, deduped against primary / team / each other, most recent first', () => {
  const teams = buildCareTeams(
    [{ id: 'c1', assignedToId: np.id, assignedTo: np }],
    [{ clientId: 'c1', providerId: 'u-t', name: 'Stephanie Walker', role: 'Therapist' }],
    {
      staff,
      now: NOW,
      seen: [
        { clientId: 'c1', providerId: 'u-np', lastSeen: new Date('2026-10-01T14:00:00Z') }, // the primary
        { clientId: 'c1', providerId: 'u-t', lastSeen: new Date('2026-10-02T14:00:00Z') }, // already on the team
        { clientId: 'c1', providerId: 'u-dk', lastSeen: new Date('2026-03-10T14:00:00Z') }, // medical visit
        { clientId: 'c1', providerId: 'u-rs', lastSeen: new Date('2026-09-15T14:00:00Z') }, // appointment
        { clientId: 'c1', providerId: 'u-rs', lastSeen: new Date('2026-06-15T14:00:00Z') }, // same provider, other source
      ],
    }
  );
  const t = teams.get('c1')!;
  assert.equal(t.primary?.name, 'Kumutha Daniel');
  assert.deepEqual(
    t.allMembers.map((m) => `${careTeamPersonLabel(m)}: ${m.name}${m.lastSeen ? ` @${m.lastSeen}` : ''}`),
    ['Therapist: Stephanie Walker', 'Prescriber · seen: Rajan Sood @2026-09-15', 'Primary care · seen: Daniel Safo Kantanka @2026-03-10']
  );
  assert.equal(t.memberCount, 3);
  assert.match(t.summary, /Prescriber · seen: Rajan Sood \(last seen Sep 15, 2026\)/);
});

test('seen by: 18-month window, future dates, deactivated / non-clinical / MA / admin excluded', () => {
  assert.equal(SEEN_BY_WINDOW_MONTHS, 18);
  assert.equal(seenByWindowStart(NOW).toISOString().slice(0, 10), '2025-04-25');
  const t = buildClientCareTeam(
    { id: 'c1', assignedToId: null, assignedTo: null },
    [],
    new Map(staff.map((s) => [s.id, s])),
    [
      { clientId: 'c1', providerId: 'u-rs', lastSeen: '2025-04-24' }, // one day outside
      { clientId: 'c1', providerId: 'u-dk', lastSeen: '2025-04-25' }, // first day inside
      { clientId: 'c1', providerId: 'u-t', lastSeen: '2026-11-01' }, // future
      { clientId: 'c1', providerId: 'u-old', lastSeen: '2026-10-01' },
      { clientId: 'c1', providerId: 'u-fd', lastSeen: '2026-10-01' },
      { clientId: 'c1', providerId: 'u-ma', lastSeen: '2026-10-01' },
      { clientId: 'c1', providerId: 'u-adm', lastSeen: '2026-10-01' },
      { clientId: 'c1', providerId: 'u-unknown', lastSeen: '2026-10-01' }, // other org / not in staff lookup
      { clientId: 'c2', providerId: 'u-np', lastSeen: '2026-10-01' }, // other client
    ],
    NOW
  );
  assert.deepEqual(t.allMembers.map((m) => m.name), ['Daniel Safo Kantanka']);
  assert.equal(isSeenByEligible({ id: 'x', name: 'x', role: 'THERAPIST', status: 'DEACTIVATED' }), false);
  assert.equal(isSeenByEligible({ id: 'x', name: 'x', role: 'PRACTICE_DIRECTOR', roles: ['PSYCHIATRIST'], status: 'ACTIVE' }), true);
});

test('cap: cards keep primary + chips, but allMembers lists everyone for the tooltip / +N more', () => {
  const seen = ['u-rs', 'u-dk', 'u-t'].map((id, i) => ({ clientId: 'c1', providerId: id, lastSeen: `2026-0${i + 5}-01` }));
  const t = buildClientCareTeam(
    { id: 'c1', assignedToId: np.id, assignedTo: np },
    [
      { clientId: 'c1', providerId: null, name: 'Peer Person', role: 'Peer Support' },
      { clientId: 'c1', providerId: null, name: 'Case Person', role: 'Case Manager' },
    ],
    new Map(staff.map((s) => [s.id, s])),
    seen,
    NOW
  );
  assert.equal(t.memberCount, 5);
  assert.equal(t.members.length, CARE_TEAM_CAP);
  assert.equal(t.allMembers.length, 5);
  for (const m of t.allMembers) assert.ok(t.summary.includes(m.name), m.name);
});

test('locked rows: no care team at all (seen by included)', () => {
  const teams = buildCareTeams([{ id: 'locked', assignedToId: null, assignedTo: null }], [], {
    lockedIds: new Set(['locked']),
    staff,
    seen: [{ clientId: 'locked', providerId: 'u-rs', lastSeen: '2026-10-01' }],
    now: NOW,
  });
  assert.equal(teams.has('locked'), false);
  const manage = read('src/lib/clients/manage.ts');
  assert.match(manage, /careTeam: locked \? null : careTeams\.get\(c\.id\) \?\? null/);
  assert.match(manage, /rows\.filter\(\(r\) => !lockedIds\.has\(r\.id\)\)/);
});

test('batched: one grouped query per source for the page ids, then one org-scoped staff lookup', () => {
  const db = read('src/lib/clients/careTeamDb.ts');
  assert.match(db, /appointment\.groupBy\(\{\s*by: \['clientId', 'clinicianId'\]/);
  assert.match(db, /status: 'COMPLETED', clinicianId: \{ not: null \}, startsAt: \{ gte: since, lte: now \}/);
  assert.match(db, /medicalVisit\.groupBy\(\{\s*by: \['clientId', 'providerId'\]/);
  assert.match(db, /where: \{ organizationId, id: \{ in: ids \} \}/);
  assert.doesNotMatch(db, /for \([^)]*\)\s*\{?\s*await prisma/);
  const manage = read('src/lib/clients/manage.ts');
  assert.match(manage, /loadSeenByRows\(rows\.map\(\(r\) => r\.id\), now\)/);
  assert.match(manage, /loadCareTeamStaff\(organizationId, \[\.\.\.members\.map/);
  assert.match(read('src/lib/clients/chartAccess.ts'), /loadSeenByRows\(\[c\.id\], now\)/);
});

const pcpStaff = new Map<string, PcpStaff>([
  ['u-dk', { id: 'u-dk', name: 'Daniel Safo Kantanka', role: 'PHYSICIAN', status: 'ACTIVE' }],
  ['u-rs', { id: 'u-rs', name: 'Rajan Sood', credentials: 'MD', role: 'PHYSICIAN', status: 'ACTIVE' }],
]);
const tally = (userId: string | null, inWindow: number, lastDate: string, code: string | null = null): ProviderTally => ({
  key: userId ? `u:${userId}` : `c:${code}`,
  userId,
  code,
  inWindow,
  total: inWindow,
  lastDate,
});

test('PCP display: AMBIGUOUS -> "PCP: to confirm" with every contender; NO_EVIDENCE -> not assigned', () => {
  const amb = decidePcp({ current: null, tallies: [tally('u-dk', 3, '2026-09-01'), tally('u-rs', 2, '2026-10-01'), tally(null, 2, '2026-08-01', 'XY')] });
  assert.equal(amb.status, 'AMBIGUOUS');
  const r = pcpReviewDisplay(amb, pcpStaff)!;
  assert.equal(r.state, 'to_confirm');
  assert.equal(r.label, 'PCP: to confirm');
  assert.equal(r.seenBy, 'seen by Daniel Safo Kantanka, Rajan Sood, MD, Valant code XY (not mapped)');
  assert.deepEqual(r.contenders.map((c) => c.canSet), [true, true, false]);

  const none = decidePcp({ current: null, tallies: [] });
  assert.equal(none.status, 'NO_EVIDENCE');
  assert.deepEqual(pcpReviewDisplay(none, pcpStaff), { state: 'not_assigned', label: 'PCP: not assigned', contenders: [], seenBy: '' });

  // A staff PCP of record: nothing to confirm
  const set = decidePcp({ current: { userId: 'u-dk', displayName: 'Daniel Safo Kantanka', source: 'care_team', memberId: 'm1' }, tallies: [] });
  assert.equal(pcpReviewDisplay(set, pcpStaff), null);
});

test('PCP review wiring: banner + roster show it, masked rows get none', () => {
  const banner = read('src/lib/clients/chartBanner.ts');
  assert.match(banner, /pcpReview: pcp\?\.id \? null : pcpReview/);
  assert.match(banner, /canSetPcp: medical && canChangePcp\(viewer\.role\)/);
  assert.match(read('src/lib/clients/chartAccess.ts'), /async pcpReview\(organizationId, clientId\)/);
  const roster = read('src/lib/medical/primaryCareRoster.ts');
  assert.match(roster, /pcp: null, pcpStatus: null, pcpReview: null/);
  assert.match(roster, /locked === null \? \[\] : ids\.filter\(\(id\) => !locked\.has\(id\)/);
  assert.match(read('src/app/dashboard/medical/patients/page.tsx'), /<PcpReviewCell review=\{row\.pcpReview\} \/>/);
  assert.match(read('src/components/chart/PatientBanner.tsx'), /<PcpReviewInline clientId=\{b\.id\} review=\{b\.pcpReview\} canSet=\{b\.canSetPcp\}/);
});

test('Set as PCP: uses the gated, audited PUT /pcp path', () => {
  const picker = read('src/components/chart/PcpPicker.tsx');
  assert.match(picker, /\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/pcp`, \{ method: 'PUT'/);
  assert.match(picker, /Set as PCP/);
  assert.match(picker, /canSet && c\.canSet && c\.userId/);
  const route = read('src/app/api/clients/[id]/pcp/route.ts');
  assert.match(route, /if \(!canChangePcp\(gate\.role\)\)/);
  assert.match(route, /resolveChartAccess\(/);
  assert.match(route, /setPrimaryCareProvider\(\{/);
  assert.match(route, /outcome: 'DENIED'/);
  assert.equal(canChangePcp('FRONT_DESK'), true);
  assert.equal(canChangePcp('OFFICE_MANAGER'), true);
  assert.equal(canChangePcp('PEER_SUPPORT'), false);
});

test('UI: chips label seen-by, +N more expands the full list inline, banner lists everyone', () => {
  const summary = read('src/features/clients/components/CareTeamSummary.tsx');
  assert.match(summary, /careTeamPersonLabel\(m\)/);
  assert.match(summary, /export function CareTeamFullList/);
  assert.match(summary, /team\.allMembers\.map/);
  assert.match(summary, /last seen \{formatSeenDate\(m\.lastSeen\)\}/);
  assert.match(summary, /data-row-actions/);
});
