/**
 * Co-sign / supervisor review scope (Oct 21): a psychiatrist (or any non-leadership reviewer)
 * without the verified Medical Director flag may co-sign only (a) their licensure-track
 * supervisees' notes (SupervisionTrack.supervisorId = me) and (b) for Psychiatrist, notes on
 * clients on their caseload (clientAccessWhere). Leadership (ADMIN / DIRECTOR / PRACTICE_DIRECTOR)
 * and a database-verified Medical Director keep org-wide co-sign. Part 2 / VIP locks apply on the
 * queue (masked rows) and on the co-sign action (assertClientPhiAccess).
 * Pure decision logic is unit tested; route wiring is checked against the source.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canCosignNote,
  COSIGN_AUTHORITY_ROLES,
  COSIGN_CASELOAD_ROLES,
  cosignQueueFilter,
  cosignQueueScope,
  decideCosignScope,
  hasCaseloadCosign,
  hasCosignAuthority,
} from '../src/lib/notes/transitions';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const none = { isDesignatedSupervisor: false, clientOnCaseload: false };

// ─── Pure rule ───────────────────────────────────────────────────────────────

test('org-wide co-sign: leadership and verified Medical Director only', () => {
  assert.deepEqual([...COSIGN_AUTHORITY_ROLES].sort(), ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) {
    assert.equal(hasCosignAuthority(r), true, r);
    assert.equal(cosignQueueScope(r), 'org', r);
    assert.deepEqual(decideCosignScope({ role: r, ...none }), { allowed: true, basis: 'leadership' }, r);
  }
  for (const r of ['PSYCHIATRIST', 'NP', 'THERAPIST', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(hasCosignAuthority(r), false, `${r} has no org-wide co-sign without the Medical Director flag`);
  }
  assert.equal(cosignQueueScope('PSYCHIATRIST', { medicalDirector: true }), 'org');
  assert.equal(cosignQueueScope('NP', { medicalDirector: true }), 'org');
  assert.deepEqual(decideCosignScope({ role: 'PSYCHIATRIST', medicalDirector: true, ...none }), { allowed: true, basis: 'medical_director' });
  // the flag is meaningless on a non-prescriber role
  assert.equal(cosignQueueScope('THERAPIST', { medicalDirector: true }), 'supervisees');
});

test('psychiatrist: supervisees + own caseload, nothing else', () => {
  assert.deepEqual([...COSIGN_CASELOAD_ROLES], ['PSYCHIATRIST']);
  assert.equal(hasCaseloadCosign('psychiatrist'), true);
  assert.equal(cosignQueueScope('PSYCHIATRIST'), 'supervisees_and_caseload');
  assert.deepEqual(decideCosignScope({ role: 'PSYCHIATRIST', ...none }), { allowed: false, basis: null }, 'other clinicians’ clients in the org');
  assert.deepEqual(decideCosignScope({ role: 'PSYCHIATRIST', isDesignatedSupervisor: true, clientOnCaseload: false }), { allowed: true, basis: 'supervisor' });
  assert.deepEqual(decideCosignScope({ role: 'PSYCHIATRIST', isDesignatedSupervisor: false, clientOnCaseload: true }), { allowed: true, basis: 'caseload' });
});

test('NP / THERAPIST / CLINICIAN: designated supervisees only (caseload does not grant co-sign)', () => {
  for (const r of ['NP', 'THERAPIST', 'CLINICIAN', 'PRP_SPECIALIST', 'CASE_MANAGER']) {
    assert.equal(cosignQueueScope(r), 'supervisees', r);
    assert.equal(decideCosignScope({ role: r, isDesignatedSupervisor: false, clientOnCaseload: true }).allowed, false, r);
    assert.equal(decideCosignScope({ role: r, isDesignatedSupervisor: true, clientOnCaseload: false }).allowed, true, r);
  }
});

test('primary care Medical Director is not the supervisor of a pre-licensed behavioral-health author', () => {
  assert.equal(decideCosignScope({ role: 'PHYSICIAN', medicalDirector: true, preLicensedAuthor: true, ...none }).allowed, false);
  assert.equal(decideCosignScope({ role: 'PHYSICIAN', medicalDirector: true, preLicensedAuthor: false, ...none }).allowed, true);
  assert.equal(decideCosignScope({ role: 'PHYSICIAN', medicalDirector: true, preLicensedAuthor: true, isDesignatedSupervisor: true, clientOnCaseload: false }).allowed, true);
});

test('canCosignNote: status, own note, scope and the 403 message', () => {
  const base = { actorUserId: 'psy1', actorRole: 'PSYCHIATRIST', authorIds: ['ther1'], status: 'SIGNED' as const, isDesignatedSupervisor: false };
  const denied = canCosignNote(base);
  assert.equal(denied.ok, false);
  if (denied.ok === false) {
    assert.equal(denied.status, 403);
    assert.match(denied.error, /supervisor|caseload|director/);
  }
  assert.deepEqual(canCosignNote({ ...base, clientOnCaseload: true }), { ok: true, basis: 'caseload' });
  assert.deepEqual(canCosignNote({ ...base, isDesignatedSupervisor: true }), { ok: true, basis: 'supervisor' });
  assert.deepEqual(canCosignNote({ ...base, medicalDirectorAuthority: true }), { ok: true, basis: 'medical_director' });
  assert.equal(canCosignNote({ ...base, status: 'DRAFT', clientOnCaseload: true }).ok, false, 'drafts are never co-signed');
  assert.equal(canCosignNote({ ...base, authorIds: ['psy1'], clientOnCaseload: true }).ok, false, 'never your own note');
  assert.equal(canCosignNote({ ...base, actorRole: 'NP', clientOnCaseload: true }).ok, false, 'NP caseload alone is not enough');
  assert.deepEqual(canCosignNote({ ...base, actorRole: 'PRACTICE_DIRECTOR' }), { ok: true, basis: 'leadership' });
});

test('cosignQueueFilter: org = no filter; scoped = supervisees OR caseload; nothing = empty queue', () => {
  const caseload = { id: 'caseload-where' } as never;
  assert.deepEqual(cosignQueueFilter('org', [], null), []);
  assert.equal(cosignQueueFilter('supervisees', [], null), null);
  assert.equal(cosignQueueFilter('supervisees', [], caseload), null, 'caseload ignored for supervisee-only roles');
  assert.deepEqual(cosignQueueFilter('supervisees', ['u1'], null), [{ OR: [{ signedById: { in: ['u1'] } }, { clinicianId: { in: ['u1'] } }] }]);
  assert.deepEqual(cosignQueueFilter('supervisees_and_caseload', [], caseload), [{ OR: [{ note: { client: caseload } }] }]);
  assert.deepEqual(cosignQueueFilter('supervisees_and_caseload', ['u1'], caseload), [
    { OR: [{ signedById: { in: ['u1'] } }, { clinicianId: { in: ['u1'] } }, { note: { client: caseload } }] },
  ]);
});

// ─── Wiring ──────────────────────────────────────────────────────────────────

test('DB loader: supervisees from SupervisionTrack, caseload via clientAccessWhere, Medical Director verified', () => {
  const src = read('src/lib/notes/cosignScope.ts');
  assert.match(src, /supervisionTrack\.findMany\(\{\s*where: \{ organizationId, supervisorId \}/);
  assert.match(src, /clientAccessWhere\(actor\)/);
  assert.match(src, /verifiedMedicalDirector\(/);
  assert.doesNotMatch(read('src/lib/notes/transitions.ts'), /@\/lib\/db\/prisma/, 'decision logic stays pure');
});

test('review queue: scoped listing + Part 2 masking', () => {
  const store = read('src/lib/notes/workflow-store.ts');
  assert.match(store, /export async function listCosignQueue\(input: \{\s*organizationId: string;\s*actorUserId: string;\s*actorRole: Role;/);
  assert.match(store, /loadCosignQueueScope\(input\)/);
  assert.match(store, /cosignQueueFilter\(scope, superviseeIds, caseloadClientWhere\)/);
  assert.doesNotMatch(store, /hasAuthorityRole/);
  const route = read('src/app/api/ehr/supervisor-review/route.ts');
  assert.match(route, /cosignQueueScope\(gate\.role, \{ medicalDirector \}\)/);
  assert.match(route, /actorRole: gate\.role/);
  assert.match(route, /maskLockedRows\(queue, locked/);
  for (const f of ['src/lib/inbox/loaders.ts', 'src/lib/notes/worklist.ts']) {
    assert.doesNotMatch(read(f), /hasAuthorityRole/, `${f} uses the shared scope`);
  }
});

test('co-sign action: scope + Part 2 lock, denials audited', () => {
  const store = read('src/lib/notes/workflow-store.ts');
  assert.match(store, /isClientOnCaseload\(/);
  assert.match(store, /clientOnCaseload,\s*\}\);/);
  assert.match(store, /assertClientPhiAccess\(\{/);
  assert.match(store, /reason: 'sensitive_record'/);
  const cosign = read('src/app/api/ehr/notes/[id]/cosign/route.ts');
  assert.match(cosign, /canAccessPath\(gate\.role, '\/dashboard\/ehr\/supervisor-review', gate\.capabilities\)/);
  assert.match(cosign, /outcome: 'DENIED'/);
  assert.match(cosign, /cosignBasis: result\.basis/);
  const review = read('src/app/api/notes/[id]/quality-check/review/route.ts');
  assert.match(review, /phiAccessChecked: true/);
  const access = read('src/lib/ai/noteQuality/access.ts');
  assert.match(access, /decideCosignScope\(/);
  assert.match(access, /assertClientPhiAccess\(/);
});

test('treatment plan co-sign follows the same rule (queue scoped + masked, action Part 2 checked)', () => {
  const plan = read('src/lib/ehr/therapy/planStore.ts');
  assert.match(plan, /decideCosignScope\(\{ role: actor\.actorRole, medicalDirector, preLicensedAuthor: true/);
  assert.match(plan, /clientPhiBlock\(/);
  assert.match(plan, /scope === 'supervisees_and_caseload'\) or\.push\(\{ client: clientAccessWhere\(actor\) \}\)/);
  const queue = read('src/app/api/ehr/treatment-plans/cosign-queue/route.ts');
  assert.match(queue, /maskLockedRows\(queue, locked/);
});

test('plan co-sign lookup uses the queue scope, not the caseload (supervisee plans do not 404)', () => {
  const plan = read('src/lib/ehr/therapy/planStore.ts');
  assert.match(plan, /action\.type === 'cosign' \? await findCosignPlan\(actor, planId\) : await findScopedPlan\(actor, planId\)/);
  const cosign = plan.slice(plan.indexOf("case 'cosign': {"), plan.indexOf("case 'send':"));
  // Real caseload check (not assumed true), authority before any plan-state answer, Part 2 kept
  assert.match(cosign, /const clientOnCaseload = await isClientOnCaseload\(actor, plan\.client\.id\)/);
  assert.match(cosign, /isDesignatedSupervisor: designated, clientOnCaseload \}\)/);
  assert.doesNotMatch(cosign, /clientOnCaseload: true/);
  assert.ok(cosign.indexOf('decision.allowed') < cosign.indexOf('clinicianSignedAt)'), 'authority checked before plan state');
  assert.ok(cosign.indexOf('clientPhiBlock(') > 0);
});
