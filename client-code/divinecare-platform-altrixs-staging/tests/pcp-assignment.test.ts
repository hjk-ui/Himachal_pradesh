import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applySetPcpPlan,
  canChangePcp,
  decidePcp,
  isPcpEligible,
  isTextOnlyMatch,
  medicalAccessBasis,
  PCP_TEAM_ROLE,
  pcpSuggestionAfterVisit,
  pcpWindowStart,
  planSetPcp,
  rankTallies,
  resolveCurrentPcp,
  runSetPcp,
  shouldFix,
  tallyEncounters,
  type CurrentPcp,
  type PcpStaff,
  type PcpTeamRow,
  type PcpWriteStore,
  type PcpWriteTx,
  type RawEncounter,
} from '../src/lib/medical/pcpAssignment';
import { medicalCareTeamClientWhere } from '../src/lib/clients/orgScope';
import {
  buildProviderCodeMap,
  collectionsProviderUserId,
  mappedUserId,
  providerCodeKey,
  providerCodeRows,
} from '../src/lib/migration/valantProviderMap';

/**
 * Primary care PCP assignment: who the PCP should be from the visits (12-month plurality, recency
 * tie-break), the statuses, explicit Valant provider-code mapping (never by name), the one canonical
 * PCP (care team member), the idempotent audited write that never touches assignedToId, and access.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const NOW = new Date('2026-10-20T15:00:00Z');
const day = (ymd: string) => new Date(`${ymd}T14:00:00Z`);

const staffList: PcpStaff[] = [
  { id: 'doc_kd', name: 'Kehinde Daniel', credentials: 'MD', role: 'PHYSICIAN', status: 'ACTIVE' },
  { id: 'doc_rs', name: 'Rina Sood', credentials: 'MD', role: 'PHYSICIAN', status: 'ACTIVE' },
  { id: 'np_rb', name: 'Rose Bangura', credentials: 'CRNP', role: 'MEDICAL_NP', status: 'ACTIVE' },
  { id: 'np_extra', name: 'Pat Dual', credentials: null, role: 'NP', roles: ['NP', 'MEDICAL_NP'], status: 'ACTIVE' },
  { id: 'doc_old', name: 'Old Doc', credentials: 'MD', role: 'PHYSICIAN', status: 'DEACTIVATED' },
  { id: 'th_1', name: 'Terry Therapist', credentials: 'LCSW', role: 'THERAPIST', status: 'ACTIVE' },
  { id: 'psy_1', name: 'Sam Psych', credentials: 'MD', role: 'PSYCHIATRIST', status: 'ACTIVE' },
];
const staff = new Map(staffList.map((s) => [s.id, s]));
// Explicit mapping: both "Daniel K" and "K.Daniel" were mapped to the same person BY A PERSON
const codeMap = buildProviderCodeMap([
  { codeKey: providerCodeKey('Daniel K'), userId: 'doc_kd' },
  { codeKey: providerCodeKey('K.Daniel'), userId: 'doc_kd' },
  { codeKey: providerCodeKey('R.Sood'), userId: 'doc_rs' },
  { codeKey: providerCodeKey('R.Bangura'), userId: 'np_rb' },
  { codeKey: providerCodeKey('S.Walker'), userId: 'th_1' },
]);

const charge = (date: string, code: string | null): RawEncounter => ({ source: 'valant_charge', date: day(date), providerCode: code });
const visit = (date: string, id: string | null): RawEncounter => ({ source: 'medical_visit', date: day(date), providerUserId: id });
const appt = (date: string, id: string | null): RawEncounter => ({ source: 'appointment', date: day(date), providerUserId: id });
const tally = (encounters: RawEncounter[]) => tallyEncounters({ encounters, codeMap, codeKey: providerCodeKey, staff, now: NOW });
const cur = (userId: string | null): CurrentPcp | null => (userId ? { userId, displayName: userId, source: 'care_team', memberId: 'm' } : null);
const decide = (current: string | null, encounters: RawEncounter[]) => decidePcp({ current: cur(current), tallies: tally(encounters).tallies });

// ─── Provider codes ──────────────────────────────────────────────────────────

test('provider codes: exact key only (case / spaces), never matched by name; collections prefer the map', () => {
  assert.equal(providerCodeKey('  K.Daniel '), 'k.daniel');
  assert.equal(providerCodeKey('Dr.  A   Gbadehan'), 'dr. a gbadehan');
  assert.equal(mappedUserId('k.daniel', codeMap), 'doc_kd');
  assert.equal(mappedUserId('Daniel  K', codeMap), 'doc_kd');
  assert.equal(mappedUserId('K Daniel', codeMap), null, 'a different spelling is a different code until a person maps it');
  assert.equal(mappedUserId('Esther Tella', codeMap), null);
  assert.equal(mappedUserId('', codeMap), null);
  // Provider Collections: the map wins; unmapped codes keep the import's stored match (long-standing behavior)
  assert.deepEqual(collectionsProviderUserId('R.Sood', 'someone_else', codeMap), { userId: 'doc_rs', basis: 'map' });
  assert.deepEqual(collectionsProviderUserId('J.Garland', 'u_imp', codeMap), { userId: 'u_imp', basis: 'import_match' });
  assert.deepEqual(collectionsProviderUserId('J.Garland', null, codeMap), { userId: null, basis: null });
});

test('provider code rows: merged by key, Family Practice counts, import match is only a suggestion', () => {
  const rows = providerCodeRows(
    [
      { providerCode: 'K.Daniel', providerUserId: 'doc_kd', rows: 10, primaryCareCharges: 4, lastServiceDate: day('2026-09-01') },
      { providerCode: 'k.daniel ', providerUserId: null, rows: 2, primaryCareCharges: 1, lastServiceDate: day('2026-10-01') },
      { providerCode: 'J.Garland', providerUserId: 'u1', rows: 3, primaryCareCharges: 0, lastServiceDate: null },
      { providerCode: 'J.Garland', providerUserId: 'u2', rows: 1, primaryCareCharges: 0, lastServiceDate: null },
      { providerCode: '  ', providerUserId: null, rows: 9, primaryCareCharges: 9, lastServiceDate: null },
    ],
    buildProviderCodeMap([])
  );
  assert.equal(rows.length, 2, 'blank code skipped; K.Daniel merged');
  const kd = rows.find((r) => r.codeKey === 'k.daniel')!;
  assert.deepEqual([kd.rows, kd.primaryCareCharges, kd.lastServiceDate, kd.mappedUserId, kd.importMatchUserId], [12, 5, '2026-10-01', null, 'doc_kd']);
  assert.equal(rows.find((r) => r.codeKey === 'j.garland')!.importMatchUserId, null, 'conflicting import matches = no suggestion');
});

test('PCP evidence ignores the import name match: an unmapped code stays unmapped', () => {
  // The DB loader passes only providerCode for Valant rows; ValantTransaction.providerUserId is never read
  const db = read('src/lib/medical/pcpAssignmentDb.ts');
  assert.match(db, /select: \{ clientId: true, providerCode: true, serviceDate: true \}/);
  assert.ok(!/providerUserId: c\.providerUserId|c\.providerUserId/.test(db));
  const d = decide(null, [charge('2026-09-01', 'Esther Tella'), charge('2026-08-01', 'Esther Tella')]);
  assert.equal(d.status, 'UNMAPPED_PROVIDER');
  assert.equal(d.evidence?.code, 'Esther Tella');
  assert.equal(d.proposedUserId, null);
});

// ─── Staff eligibility / current PCP ─────────────────────────────────────────

test('only active physicians / medical NPs (role or extra role) can be PCP', () => {
  assert.equal(isPcpEligible(staff.get('doc_kd')), true);
  assert.equal(isPcpEligible(staff.get('np_rb')), true);
  assert.equal(isPcpEligible(staff.get('np_extra')), true, 'extra MEDICAL_NP role');
  assert.equal(isPcpEligible(staff.get('doc_old')), false, 'deactivated');
  assert.equal(isPcpEligible(staff.get('th_1')), false);
  assert.equal(isPcpEligible(staff.get('psy_1')), false);
  assert.equal(isPcpEligible(undefined), false);
});

test('current PCP: care team "Primary Care Provider" member, else assignedPcp text (id or exact unique name)', () => {
  const team: PcpTeamRow[] = [
    { id: 'm1', providerId: 'th_1', name: 'Terry Therapist', role: 'Therapist', isPrimary: true },
    { id: 'm2', providerId: 'doc_rs', name: 'Rina Sood', role: 'Primary Care Physician', isPrimary: false },
  ];
  // Intake "Primary Care Physician" row is a care team fact, not the PCP
  assert.equal(resolveCurrentPcp({ team, assignedPcpTexts: [], staff }).current, null);
  const withPcp = [...team, { id: 'm3', providerId: 'doc_kd', name: 'Kehinde Daniel', role: 'primary care provider', isPrimary: false }];
  const r = resolveCurrentPcp({ team: withPcp, assignedPcpTexts: ['Rina Sood'], staff });
  assert.deepEqual(r.current, { userId: 'doc_kd', displayName: 'Kehinde Daniel, MD', source: 'care_team', memberId: 'm3' }, 'care team wins over text');
  // A PCP-role row with no staff link is not a PCP
  assert.equal(resolveCurrentPcp({ team: [{ id: 'x', providerId: null, name: 'Outside Doc', role: PCP_TEAM_ROLE, isPrimary: false }], assignedPcpTexts: [], staff }).current, null);
  // Text fallback
  assert.equal(resolveCurrentPcp({ team, assignedPcpTexts: ['', 'doc_rs'], staff }).current?.userId, 'doc_rs', 'staff id');
  assert.equal(resolveCurrentPcp({ team, assignedPcpTexts: ['  rina   SOOD '], staff }).current?.userId, 'doc_rs', 'exact name, case/space-insensitive');
  assert.equal(resolveCurrentPcp({ team, assignedPcpTexts: ['Rina Sood, MD'], staff }).current?.userId, 'doc_rs', 'mirror format');
  const fuzzy = resolveCurrentPcp({ team, assignedPcpTexts: ['Dr. Sood'], staff }).current!;
  assert.deepEqual([fuzzy.userId, fuzzy.displayName], [null, 'Dr. Sood'], 'no fuzzy match: shown, counts as no PCP');
  const twins = new Map(staff);
  twins.set('doc_rs2', { id: 'doc_rs2', name: 'Rina Sood', role: 'PHYSICIAN', status: 'ACTIVE' });
  assert.equal(resolveCurrentPcp({ team, assignedPcpTexts: ['Rina Sood'], staff: twins }).current?.userId, null, 'two staff with the name: not resolved');
});

// ─── Evidence and the 12-month window ────────────────────────────────────────

test('encounters: one per provider per day across sources; codes via the map only; non-medical and future excluded', () => {
  const s = tally([
    charge('2026-09-01', 'K.Daniel'),
    charge('2026-09-01', 'Daniel K'), // same person (both mapped), same day
    visit('2026-09-01', 'doc_kd'),
    appt('2026-09-01', 'doc_kd'),
    visit('2026-08-01', 'doc_kd'),
    charge('2026-07-01', 'S.Walker'), // mapped to a therapist: not PCP evidence
    visit('2026-06-01', null), // no provider recorded
    charge('2026-06-01', '   '),
    visit('2026-12-01', 'doc_rs'), // future
  ]);
  assert.deepEqual(s.tallies, [{ key: 'u:doc_kd', userId: 'doc_kd', code: null, inWindow: 2, total: 2, lastDate: '2026-09-01' }]);
  assert.deepEqual([...s.nonMedical], [['th_1', 1]]);
  assert.equal(s.unattributedVisits, 1);
  assert.equal(s.blankCodeCharges, 1);
});

test('12-month window: counts inside the window decide; older visits only when nothing is recent', () => {
  assert.equal(pcpWindowStart(NOW), '2025-10-20');
  // Sood had many visits long ago; Daniel twice this year (Sood's old count does not count)
  const enc = [
    visit('2024-01-01', 'doc_rs'), visit('2024-02-01', 'doc_rs'), visit('2024-03-01', 'doc_rs'), visit('2025-10-19', 'doc_rs'),
    visit('2026-03-01', 'doc_kd'), visit('2026-04-01', 'doc_kd'),
  ];
  const d = decide(null, enc);
  assert.deepEqual([d.status, d.basis, d.evidence?.userId, d.proposedUserId], ['MISSING', 'window', 'doc_kd', 'doc_kd']);
  assert.equal(d.contenders.length, 1, 'Sood has 0 in the window: not a contender');
  // Boundary: the window start day counts
  assert.equal(decide(null, [visit('2025-10-20', 'doc_rs')]).evidence?.inWindow, 1);
  // Nothing in 12 months: the most recent ever wins, even with fewer visits
  const old = decide('doc_rs', [visit('2023-01-01', 'doc_rs'), visit('2023-02-01', 'doc_rs'), visit('2024-05-01', 'doc_kd')]);
  assert.deepEqual([old.status, old.basis, old.evidence?.userId], ['MISMATCH', 'most_recent', 'doc_kd']);
});

test('ties: ranking breaks a tie by the most recent encounter; a tie (or 1 apart) is AMBIGUOUS', () => {
  const enc = [visit('2026-01-10', 'doc_rs'), visit('2026-02-10', 'doc_rs'), visit('2026-01-05', 'np_rb'), visit('2026-09-01', 'np_rb')];
  const { ranked } = rankTallies(tally(enc).tallies);
  assert.deepEqual(ranked.map((t) => t.userId), ['np_rb', 'doc_rs'], 'same count: most recent first');
  const tie = decide(null, enc);
  assert.deepEqual([tie.status, tie.proposedUserId, tie.evidence?.userId], ['AMBIGUOUS', null, 'np_rb']);
  assert.deepEqual(tie.contenders.map((t) => t.userId), ['np_rb', 'doc_rs']);
  // One apart is still ambiguous; two apart is not
  const oneApart = decide(null, [...enc, visit('2026-03-01', 'doc_rs')]);
  assert.equal(oneApart.status, 'AMBIGUOUS');
  const twoApart = decide(null, [...enc, visit('2026-03-01', 'doc_rs'), visit('2026-04-01', 'doc_rs')]);
  assert.deepEqual([twoApart.status, twoApart.proposedUserId], ['MISSING', 'doc_rs']);
  // The current PCP is one of the near-equal providers: a person already chose; keep it
  assert.equal(decide('doc_rs', enc).status, 'MATCH');
  assert.equal(decide('doc_kd', enc).status, 'AMBIGUOUS', 'current PCP not among them: review');
  // An unmapped code within 1 of a mapped provider is ambiguous too (it may be the real PCP)
  assert.equal(decide(null, [visit('2026-05-01', 'doc_kd'), charge('2026-06-01', 'I.Ayanleye')]).status, 'AMBIGUOUS');
});

test('statuses: MATCH, MISMATCH, MISSING, NO_EVIDENCE, UNMAPPED_PROVIDER; only MISSING / MISMATCH are fixable', () => {
  const enc = [charge('2026-05-01', 'R.Sood'), charge('2026-06-01', 'R.Sood'), visit('2026-07-01', 'doc_rs'), visit('2026-03-01', 'np_rb')];
  const match = decide('doc_rs', enc);
  const mismatch = decide('doc_kd', enc);
  const missing = decide(null, enc);
  const none = decide('doc_rs', []);
  const unmapped = decide('doc_rs', [charge('2026-05-01', 'Augustina A.'), charge('2026-06-01', 'Augustina A.'), charge('2026-07-01', 'Augustina A.')]);
  assert.deepEqual(
    [match.status, mismatch.status, missing.status, none.status, unmapped.status],
    ['MATCH', 'MISMATCH', 'MISSING', 'NO_EVIDENCE', 'UNMAPPED_PROVIDER']
  );
  assert.deepEqual([mismatch.proposedUserId, missing.proposedUserId], ['doc_rs', 'doc_rs']);
  // Only non-medical evidence = no PCP evidence
  assert.equal(decide(null, [charge('2026-05-01', 'S.Walker'), visit('2026-05-02', 'psy_1')]).status, 'NO_EVIDENCE');
  // A current PCP who is not a medical provider is replaced by the evidence (MISMATCH)
  assert.equal(decide('th_1', enc).status, 'MISMATCH');
  // Text-only current PCP that does not resolve to staff counts as MISSING
  const textOnly = decidePcp({ current: { userId: null, displayName: 'Dr. Sood', source: 'assigned_pcp_text', memberId: null }, tallies: tally(enc).tallies });
  assert.equal(textOnly.status, 'MISSING');

  assert.equal(shouldFix(match), false);
  assert.equal(shouldFix(mismatch), true);
  assert.equal(shouldFix(missing), true);
  assert.equal(shouldFix(missing, 'MISSING'), true);
  assert.equal(shouldFix(mismatch, 'MISSING'), false, '--only=MISSING');
  for (const d of [none, unmapped, decide(null, [visit('2026-01-10', 'doc_rs'), visit('2026-02-10', 'np_rb')])]) {
    assert.equal(shouldFix(d), false, `${d.status} is never changed`);
  }
  const textMatch = decidePcp({ current: { userId: 'doc_rs', displayName: 'Rina Sood, MD', source: 'assigned_pcp_text', memberId: null }, tallies: tally(enc).tallies });
  assert.deepEqual([textMatch.status, isTextOnlyMatch(textMatch), isTextOnlyMatch(match)], ['MATCH', true, false]);
});

// ─── Writes: idempotent, audited, never assignedToId ─────────────────────────

type FakeClient = { id: string; mrn: string | null; organizationId: string; assignedToId: string | null; team: PcpTeamRow[]; teamJsonSyncs: number };

function fakeStore(clients: FakeClient[], medicalPatients: { bhClientId: string; assignedPcp: string }[]) {
  const audits: Parameters<PcpWriteStore['audit']>[0][] = [];
  const writes: string[] = [];
  let seq = 0;
  const tx: PcpWriteTx = {
    findClient: async (org, id) => {
      const c = clients.find((x) => x.id === id && x.organizationId === org);
      return c ? { id: c.id, mrn: c.mrn } : null;
    },
    team: async (id) => clients.find((c) => c.id === id)!.team.map((m) => ({ ...m })),
    deleteMembers: async (id, ids) => {
      writes.push(`delete:${ids.join(',')}`);
      const c = clients.find((x) => x.id === id)!;
      c.team = c.team.filter((m) => !ids.includes(m.id));
    },
    setMemberRole: async (memberId, role) => {
      writes.push(`role:${memberId}`);
      for (const c of clients) for (const m of c.team) if (m.id === memberId) m.role = role;
    },
    createMember: async (id, s, role) => {
      writes.push(`create:${s.id}`);
      clients.find((x) => x.id === id)!.team.push({ id: `new${++seq}`, providerId: s.id, name: s.name ?? '', role, credentials: s.credentials, isPrimary: false });
    },
    mirrorAssignedPcp: async (_org, client, name) => {
      let n = 0;
      for (const mp of medicalPatients) {
        if (mp.bhClientId === client.id && mp.assignedPcp !== name) {
          mp.assignedPcp = name;
          n += 1;
        }
      }
      if (n) writes.push(`mirror:${n}`);
      return n;
    },
    syncTeamJson: async (id) => {
      clients.find((x) => x.id === id)!.teamJsonSyncs += 1;
    },
  };
  const store: PcpWriteStore = {
    findStaff: async (_org, id) => staff.get(id) ?? null,
    transaction: (fn) => fn(tx),
    audit: async (e) => {
      audits.push(e);
    },
  };
  return { store, audits, writes };
}

const actor = { userId: 'fd_1', role: 'FRONT_DESK', via: 'chart' as const };

test('set PCP: creates the care team member, mirrors assignedPcp, audits old -> new; repeat is a no-op (idempotent)', async () => {
  const client: FakeClient = {
    id: 'c1', mrn: 'MRN1', organizationId: 'org', assignedToId: 'th_1', teamJsonSyncs: 0,
    team: [{ id: 'm_bh', providerId: 'th_1', name: 'Terry Therapist', role: 'Therapist', isPrimary: true }],
  };
  const mps = [{ bhClientId: 'c1', assignedPcp: '' }];
  const { store, audits, writes } = fakeStore([client], mps);
  const r1 = await runSetPcp(store, { organizationId: 'org', clientId: 'c1', newUserId: 'doc_rs', actor, auditDetail: { evidenceInWindow: 3 } });
  assert.deepEqual(r1, { ok: true, changed: true, previousUserId: null, displayName: 'Rina Sood, MD' });
  assert.deepEqual(client.team.map((m) => [m.providerId, m.role]), [['th_1', 'Therapist'], ['doc_rs', PCP_TEAM_ROLE]]);
  assert.equal(mps[0].assignedPcp, 'Rina Sood, MD', 'assignedPcp mirrors the display name');
  assert.equal(client.assignedToId, 'th_1', 'behavioral health clinician untouched');
  assert.equal(audits.length, 1);
  assert.deepEqual(
    [audits[0].clientId, audits[0].metadata.previousProviderId, audits[0].metadata.newProviderId, audits[0].metadata.evidenceInWindow, audits[0].metadata.via],
    ['c1', null, 'doc_rs', 3, 'chart']
  );
  assert.ok(!JSON.stringify(audits[0].metadata).includes('Rina'), 'audit metadata: ids and counts only');

  const before = writes.length;
  const r2 = await runSetPcp(store, { organizationId: 'org', clientId: 'c1', newUserId: 'doc_rs', actor });
  assert.deepEqual(r2, { ok: true, changed: false, previousUserId: null, displayName: 'Rina Sood, MD' });
  assert.equal(writes.length, before, 'no writes on repeat');
  assert.equal(audits.length, 1, 'no audit when nothing changed');
  assert.equal(client.team.filter((m) => m.role === PCP_TEAM_ROLE).length, 1);
});

test('reassign PCP: previous PCP row removed, new provider promoted (existing row) or created; assignedToId never written', async () => {
  const client: FakeClient = {
    id: 'c2', mrn: null, organizationId: 'org', assignedToId: 'doc_kd', teamJsonSyncs: 0,
    team: [
      { id: 'm_pcp', providerId: 'doc_kd', name: 'Kehinde Daniel', role: PCP_TEAM_ROLE, isPrimary: false },
      { id: 'm_np', providerId: 'np_rb', name: 'Rose Bangura', role: 'Primary Care NP', isPrimary: false },
      { id: 'm_out', providerId: null, name: 'Outside PCP', role: PCP_TEAM_ROLE, isPrimary: false },
    ],
  };
  const { store, audits } = fakeStore([client], []);
  const r = await runSetPcp(store, { organizationId: 'org', clientId: 'c2', newUserId: 'np_rb', actor });
  assert.deepEqual(r, { ok: true, changed: true, previousUserId: 'doc_kd', displayName: 'Rose Bangura, CRNP' });
  assert.deepEqual(client.team.map((m) => [m.id, m.role]), [['m_np', PCP_TEAM_ROLE], ['m_out', PCP_TEAM_ROLE]], 'promoted in place; outside (unlinked) row kept');
  assert.equal(client.assignedToId, 'doc_kd', 'assignedToId is not part of the write interface and stays as it was');
  assert.equal(client.teamJsonSyncs, 1);
  assert.deepEqual([audits[0].metadata.previousProviderId, audits[0].metadata.newProviderId, audits[0].metadata.promotedMemberId, audits[0].metadata.createdMember], ['doc_kd', 'np_rb', 'm_np', false]);
  // Write interface has no way to touch the BH clinician; code paths never mention it
  const src = read('src/lib/medical/pcpAssignment.ts') + read('src/lib/medical/pcpAssignmentDb.ts') + read('scripts/fix-pcp-assignments.ts');
  // the only mention with a colon is the read-only access snapshot type (assignedToId: string | null)
  assert.ok(!/assignedToId\s*:(?!\s*string \| null)/.test(src), 'no assignedToId write anywhere in the PCP code');
});

test('set PCP refuses non-medical / inactive / unknown providers and other-org clients', async () => {
  const client: FakeClient = { id: 'c3', mrn: null, organizationId: 'org', assignedToId: null, team: [], teamJsonSyncs: 0 };
  const { store, audits } = fakeStore([client], []);
  for (const id of ['th_1', 'psy_1', 'doc_old', 'nobody']) {
    assert.deepEqual(await runSetPcp(store, { organizationId: 'org', clientId: 'c3', newUserId: id, actor }), { ok: false, error: 'not_medical_provider' }, id);
  }
  assert.deepEqual(await runSetPcp(store, { organizationId: 'other-org', clientId: 'c3', newUserId: 'doc_rs', actor }), { ok: false, error: 'client_not_found' });
  assert.equal(client.team.length, 0);
  assert.equal(audits.length, 0);
});

test('fix plan is idempotent: plan -> apply -> plan again is a no-op; duplicate PCP rows collapse to one', () => {
  const team: PcpTeamRow[] = [
    { id: 'a', providerId: 'doc_kd', name: 'K', role: PCP_TEAM_ROLE, isPrimary: false },
    { id: 'b', providerId: 'doc_rs', name: 'R', role: PCP_TEAM_ROLE, isPrimary: false },
    { id: 'c', providerId: 'doc_rs', name: 'R', role: PCP_TEAM_ROLE, isPrimary: false },
  ];
  const plan = planSetPcp(team, 'doc_rs');
  assert.deepEqual(plan.removeMembers.map((m) => m.id), ['a', 'c']);
  assert.equal(plan.create, false);
  const after = applySetPcpPlan(team, plan, { id: 'n', providerId: 'doc_rs', name: 'R', role: '', isPrimary: false });
  assert.deepEqual(after.map((m) => m.id), ['b']);
  assert.equal(planSetPcp(after, 'doc_rs').noop, true);
});

// ─── Access after reassignment ───────────────────────────────────────────────

test('access: a new PCP gets care-team access; the previous PCP keeps only "seen by" access', async () => {
  // The pure basis mirrors the where-clause used for lists and the chart
  const where = JSON.stringify(medicalCareTeamClientWhere('u'));
  for (const part of ['"assignedToId":"u"', '"treatmentTeamMembers":{"some":{"providerId":"u"}}', '"medicalVisits":{"some":{"providerId":"u"}}', '"appointments":{"some":{"clinicianId":"u"}}']) {
    assert.ok(where.includes(part), part);
  }
  const client: FakeClient = {
    id: 'c4', mrn: null, organizationId: 'org', assignedToId: 'th_1', teamJsonSyncs: 0,
    team: [{ id: 'm_old', providerId: 'doc_kd', name: 'Kehinde Daniel', role: PCP_TEAM_ROLE, isPrimary: false }],
  };
  const visits = ['doc_kd']; // the old PCP saw the patient
  const snapshot = () => ({ assignedToId: client.assignedToId, team: client.team, visitProviderIds: visits, appointmentClinicianIds: [] as string[] });
  assert.equal(medicalAccessBasis('doc_kd', snapshot()), 'care_team');
  assert.equal(medicalAccessBasis('doc_rs', snapshot()), null, 'new PCP has no access before the change');

  const { store } = fakeStore([client], []);
  await runSetPcp(store, { organizationId: 'org', clientId: 'c4', newUserId: 'doc_rs', actor });
  assert.equal(medicalAccessBasis('doc_rs', snapshot()), 'care_team', 'new PCP: care team access');
  assert.equal(medicalAccessBasis('doc_kd', snapshot()), 'seen_by', 'previous PCP: seen-by only');
  assert.equal(medicalAccessBasis('np_rb', snapshot()), null);
  assert.equal(medicalAccessBasis('th_1', snapshot()), 'assigned', 'BH clinician unchanged');
  // A previous PCP who never saw the patient loses access
  visits.length = 0;
  assert.equal(medicalAccessBasis('doc_kd', snapshot()), null);
});

// ─── UX rules ────────────────────────────────────────────────────────────────

test('who may change the PCP; suggestion after a signed visit only when no PCP and the signer is a medical provider', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'PRACTICE_DIRECTOR', 'ADMIN', 'PHYSICIAN', 'MEDICAL_NP']) assert.equal(canChangePcp(r), true, r);
  for (const r of ['THERAPIST', 'BILLING', 'MEDICAL_ASSISTANT', 'PEER_SUPPORT', '', null]) assert.equal(canChangePcp(r), false, String(r));

  assert.deepEqual(pcpSuggestionAfterVisit({ current: null, signer: staff.get('doc_rs')! }), { userId: 'doc_rs', displayName: 'Rina Sood, MD' });
  assert.equal(pcpSuggestionAfterVisit({ current: cur('doc_kd'), signer: staff.get('doc_rs')! }), null, 'PCP already set');
  assert.equal(pcpSuggestionAfterVisit({ current: null, signer: staff.get('psy_1')! }), null, 'psychiatrist is not a PCP');
  const textOnly: CurrentPcp = { userId: null, displayName: 'Dr. Sood', source: 'assigned_pcp_text', memberId: null };
  assert.equal(pcpSuggestionAfterVisit({ current: textOnly, signer: staff.get('doc_rs')! })?.userId, 'doc_rs', 'unlinked text counts as no PCP');
});

test('wiring: intake requires a PCP, visit signing only suggests, chart header and roster show the PCP; migration idempotent', () => {
  const intake = read('src/app/api/medical/patients/intake/route.ts');
  assert.match(intake, /Choose the primary care provider \(PCP\)/);
  assert.match(intake, /setPrimaryCareProvider\(/);
  assert.ok(intake.indexOf('pcpChoice') < intake.indexOf('prisma.medicalPatient.create'), 'PCP checked before anything is created');
  const page = read('src/app/dashboard/medical/patients/intake/page.tsx');
  assert.match(page, /pcpUserId/);
  assert.ok(!/value=\{user\.name\}/.test(page), 'no free-text PCP from the signed-in user');

  const visits = read('src/app/api/medical/patients/[id]/visits/route.ts');
  assert.match(visits, /pcpSuggestionAfterVisit/);
  assert.ok(!/setPrimaryCareProvider/.test(visits), 'never auto-assigns');

  const pcpRoute = read('src/app/api/clients/[id]/pcp/route.ts');
  assert.match(pcpRoute, /resolveChartAccess\(/);
  assert.match(pcpRoute, /canChangePcp\(gate\.role\)/);
  const banner = read('src/components/chart/PatientBanner.tsx');
  assert.match(banner, /Primary care provider/);
  assert.match(banner, /BH clinician/);
  const roster = read('src/app/dashboard/medical/patients/page.tsx');
  assert.match(roster, /PCP needs review/);
  assert.match(roster, /Sort: PCP/);

  const sql = read('prisma/migrations/20261020_valant_provider_map.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "ValantProviderMap"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "ValantProviderMap_organizationId_codeKey_key"/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/i.test(sql.replace(/^--.*$/gm, '')), 'schema only');
  assert.match(read('prisma/schema.prisma'), /model ValantProviderMap \{[\s\S]*@@unique\(\[organizationId, codeKey\]\)/);
  // Provider Collections reads the map
  assert.match(read('src/app/api/billing/provider-collections/route.ts'), /collectionsProviderUserId\(/);
  // Scripts: check is read-only, fix is dry-run by default
  const check = read('scripts/check-pcp-assignments.ts');
  assert.ok(!/setPrimaryCareProvider|\.update\(|\.create\(|\.delete/.test(check), 'check script writes nothing');
  const fix = read('scripts/fix-pcp-assignments.ts');
  assert.match(fix, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(fix, /if \(!apply\) \{/);
});
