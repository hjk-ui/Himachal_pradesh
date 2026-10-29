/**
 * Least-privilege hardening of clinical routes (telehealth, DrFirst / prescribing, voicemail,
 * Connect analysis, consents, 42 CFR Part 2 disclosures). Pure helpers are unit-tested; route wiring
 * that needs a database is pinned with source assertions on the route files.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canAdministerTelehealthSession,
  canManageTelehealthSettings,
  isTelehealthAdmin,
} from '../src/lib/telehealth/staffAccess';
import { drFirstCallerNeedsUsername, drFirstSsoDecision } from '../src/lib/drfirst/ssoPolicy';
import { canManageVoicemails, voicemailRoutedTo, voicemailWhere } from '../src/lib/communications/voicemailAccess';
import { canReadDisclosures, canRecordDisclosure, isPart2ReleaseDeskRole } from '../src/lib/privacy/part2DisclosureAccess';
import { canViewClientMedications } from '../src/lib/clients/orgScope';
import { canViewPrescriptions } from '../src/lib/prescriptions/access';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
const NON_ADMIN_STAFF = ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'FRONT_DESK', 'BILLING', 'HR'];

// 1 ─ telehealth settings
test('1. telehealth settings PUT: leadership + Office Manager only', () => {
  for (const r of [...LEADERSHIP, 'OFFICE_MANAGER']) assert.equal(canManageTelehealthSettings(r), true, r);
  for (const r of NON_ADMIN_STAFF) assert.equal(canManageTelehealthSettings(r), false, r);
  assert.equal(canManageTelehealthSettings('office_manager'), true, 'case-insensitive');
  const route = src('src/app/api/telehealth/settings/route.ts');
  assert.match(route, /export async function PUT[\s\S]*canManageTelehealthSettings\(gate\.role\)/);
});

// 2 ─ telehealth admin actions
test('2. telehealth admin actions: admin/OM or the session clinician; client-scoped; no free-form email', () => {
  assert.equal(isTelehealthAdmin('OFFICE_MANAGER'), true);
  assert.equal(canAdministerTelehealthSession('ADMIN', 'u1', 'u2'), true);
  assert.equal(canAdministerTelehealthSession('THERAPIST', 'u1', 'u1'), true, 'own session');
  assert.equal(canAdministerTelehealthSession('THERAPIST', 'u1', 'u2'), false, 'someone else\'s session');
  assert.equal(canAdministerTelehealthSession('THERAPIST', 'u1', null), false, 'unassigned session');
  assert.equal(canAdministerTelehealthSession('PSYCHIATRIST', '', ''), false);

  const route = src('src/app/api/telehealth/admin/actions/route.ts');
  assert.doesNotMatch(route, /targetEmail/, 'targetEmail is gone from the schema and the send path');
  assert.match(route, /const email = session\.client\.email/, 'email goes to the charted client email');
  assert.match(route, /clientAccessWhere\(/);
  assert.equal((route.match(/client: clientScope/g) || []).length >= 3, true, 'resend, transfer and audit logs are client-scoped');
  assert.equal((route.match(/canAdministerTelehealthSession\(gate\.role, gate\.userId/g) || []).length, 2, 'resend + transfer');
  assert.match(route, /isTelehealthAdmin\(gate\.role\) \? \{\} : \{ clinicianId: gate\.userId \}/, 'audit logs: own sessions unless admin/OM');

  const page = src('src/app/dashboard/telehealth/page.tsx');
  assert.doesNotMatch(page, /targetEmail:/, 'UI no longer sends targetEmail');
});

// 3 ─ transcription status
test('3. transcription status: appointment / session looked up by id + org + client scope', () => {
  const route = src('src/app/api/telehealth/transcription/[appointmentId]/route.ts');
  assert.match(route, /prisma\.appointment\.findFirst\(\{ where: \{ id: appointmentId, organizationId: gate\.organizationId, client \}/);
  assert.match(route, /prisma\.telehealthSession\.findFirst\(\{ where: \{ id: appointmentId, organizationId: gate\.organizationId, client \}/);
  assert.match(route, /clientAccessWhere\(/);
  assert.ok(route.indexOf('if (!appointment && !session)') < route.indexOf('loadStoredChimeMeeting(appointmentId)'), 'scope check before the bare-id lookup');
});

// 4 ─ session transcript
test('4. session transcript: chart gate (Part 2 / sensitive lock)', () => {
  const route = src('src/app/api/telehealth/sessions/[id]/transcript/route.ts');
  assert.match(route, /gateClientRoute\(\{/);
  assert.match(route, /outcome: 'DENIED'/);
  assert.doesNotMatch(route, /canAccessClientForAi/);
});

// 5 ─ DrFirst chart state
test('5. drfirst patients/link GET: medication roles + chart gate', () => {
  for (const r of ['PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING', 'HR']) {
    assert.equal(canViewClientMedications(r), false, r);
  }
  assert.equal(canViewClientMedications('PSYCHIATRIST'), true);
  const route = src('src/app/api/drfirst/patients/link/route.ts');
  assert.match(route, /gateClientRoute\(\{[\s\S]*roleAllowed: canViewClientMedications\(role\)/);
  assert.doesNotMatch(route, /isClinicalStaff\(role\)/);
});

// 6 ─ PDMP check
test('6. pdmp-check GET: canViewPrescriptions + chart gate', () => {
  for (const r of ['PEER_SUPPORT', 'CASE_MANAGER', 'BILLING', 'HR', 'FRONT_DESK']) assert.equal(canViewPrescriptions(r), false, r);
  const route = src('src/app/api/prescribing/pdmp-check/route.ts');
  assert.match(route, /gateClientRoute\(/);
  assert.match(route, /pdmpGate\(gate, clientId, canViewPrescriptions\(String\(gate\.role\)\)\)/);
});

// 7 ─ prescription lists drop locked clients
test('7. prescription lists drop Part 2 / sensitive clients the caller cannot open', () => {
  for (const p of ['src/app/api/drfirst/prescriptions/route.ts', 'src/app/api/prescriptions/route.ts', 'src/app/api/prescriptions/refills/route.ts']) {
    const route = src(p);
    assert.match(route, /lockedSensitiveClientIds\(\{/, p);
    assert.match(route, /!locked\.has\(r\.clientId\)/, p);
  }
});

// 8 ─ DrFirst patient context is caseload-scoped
test('8. DrFirst SSO / upload / downloads: caseload scope + Part 2 lock, never "any client of the org"', () => {
  const access = src('src/app/api/drfirst/_lib/access.ts');
  assert.match(access, /export async function findDrFirstClient/);
  assert.match(access, /where: drFirstClientWhere\(caller, clientId\)/);
  assert.match(access, /assertClientPhiAccess\(/);
  for (const p of [
    'src/app/api/drfirst/sso/route.ts',
    'src/app/api/prescribing/sso-url/route.ts',
    'src/app/api/drfirst/review-status/route.ts',
    'src/app/api/drfirst/pdmp-events/route.ts',
    'src/app/api/drfirst/sync/route.ts',
    'src/app/api/drfirst/sync/return/route.ts',
  ]) {
    const route = src(p);
    assert.match(route, /findDrFirstClient\(/, p);
    assert.doesNotMatch(route, /any client of\s+(\*\s+)?the/, `${p}: stale comment`);
  }
  const reg = src('src/app/api/drfirst/_lib/registerPatient.ts');
  assert.match(reg, /where: drFirstClientWhere\(caller, clientId\)/);
  assert.match(reg, /assertClientPhiAccess\(/);
  assert.doesNotMatch(reg, /clientOrgFilter/);
  assert.match(src('src/app/api/drfirst/sync/route.ts'), /lockedSensitiveClientIds\(/, 'my-patients sync skips locked charts');
  assert.match(src('src/app/api/drfirst/patients/sync/route.ts'), /requireDrFirstCaller\(req, \{ requireRcopiaUser: true \}\)/, 'prescribers only');
});

// 9 ─ ADMIN in DrFirst
test('9. ADMIN SSO: own rcopiaUsername, message/report only; prescribers keep patient context', () => {
  assert.deepEqual(drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: 'adm1', screen: 'message', hasPatient: false }), { ok: true, patientContextAllowed: false });
  assert.equal(drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: 'adm1', screen: 'report', hasPatient: false }).ok, true);
  const noUser = drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: null, screen: 'message', hasPatient: false });
  assert.equal(noUser.ok === false && noUser.status, 409);
  const patient = drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: 'adm1', screen: 'patient', hasPatient: true });
  assert.equal(patient.ok === false && patient.status, 403);
  const search = drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: 'adm1', screen: 'patient', hasPatient: false });
  assert.equal(search.ok, false, 'patient search screen is patient context');
  assert.equal(drFirstSsoDecision({ role: 'ADMIN', rcopiaUsername: 'adm1', screen: 'manage_medications', hasPatient: false }).ok, false);
  assert.deepEqual(drFirstSsoDecision({ role: 'PSYCHIATRIST', rcopiaUsername: 'doc1', screen: 'patient', hasPatient: true }), { ok: true, patientContextAllowed: true });
  const doc = drFirstSsoDecision({ role: 'NP', rcopiaUsername: '  ', screen: 'patient', hasPatient: true });
  assert.equal(doc.ok === false && doc.status, 409);
  const thr = drFirstSsoDecision({ role: 'THERAPIST', rcopiaUsername: 'x', screen: 'message', hasPatient: false });
  assert.equal(thr.ok === false && thr.status, 403);

  // requireDrFirstCaller username rule: admins need their own username too, except badge counts
  assert.equal(drFirstCallerNeedsUsername({ isPrescriber: false, isAdmin: true, requireRcopiaUser: true }), true);
  assert.equal(drFirstCallerNeedsUsername({ isPrescriber: false, isAdmin: true, requireRcopiaUser: true, adminPracticeLevel: true }), false);
  assert.equal(drFirstCallerNeedsUsername({ isPrescriber: true, isAdmin: false, requireRcopiaUser: true, adminPracticeLevel: true }), true);
  assert.equal(drFirstCallerNeedsUsername({ isPrescriber: true, isAdmin: false }), false);

  const sso = src('src/app/api/drfirst/sso/route.ts');
  assert.match(sso, /drFirstSsoDecision\(/);
  assert.match(sso, /requireDrFirstCaller\(req, \{ requireRcopiaUser: true \}\)/, 'register-on-launch: prescribers only');
  assert.match(src('src/lib/drfirst/ssoPolicy.ts'), /DrFirst staff user type/);
  assert.match(src('src/app/api/drfirst/notifications/route.ts'), /adminPracticeLevel: true/);
  assert.doesNotMatch(src('src/app/dashboard/clients/[id]/page.tsx'), /isPrescriberRole\(userRoleStr\) \|\| userRoleStr === 'admin'/);
});

// 10 ─ voicemails
test('10. voicemails: full list + re-route for leadership/OM; others only routed to them (exact match)', () => {
  for (const r of [...LEADERSHIP, 'OFFICE_MANAGER']) {
    assert.equal(canManageVoicemails(r), true, r);
    assert.deepEqual(voicemailWhere(r, 'u1'), {}, r);
  }
  assert.equal(canManageVoicemails('FRONT_DESK'), false);
  assert.deepEqual(voicemailWhere('FRONT_DESK', 'u1'), {
    OR: [{ routeTo: { equals: 'u1' } }, { routeTo: { equals: 'FRONT_DESK', mode: 'insensitive' } }],
  });
  assert.equal(JSON.stringify(voicemailWhere('THERAPIST', 'u1')).includes('contains'), false, 'no substring match');
  assert.equal(voicemailRoutedTo('u1', 'THERAPIST', 'u1'), true);
  assert.equal(voicemailRoutedTo('therapist', 'THERAPIST', 'u9'), true);
  assert.equal(voicemailRoutedTo('THERAPIST_TEAM', 'THERAPIST', 'u1'), false);
  assert.equal(voicemailRoutedTo('u10', 'THERAPIST', 'u1'), false);
  assert.equal(voicemailRoutedTo('', 'THERAPIST', 'u1'), false);
  assert.equal(voicemailRoutedTo('anything', 'OFFICE_MANAGER', 'u1'), true);

  const route = src('src/app/api/communications/voicemails/route.ts');
  assert.match(route, /where: voicemailWhere\(gate\.role, gate\.userId\)/);
  assert.match(route, /if \(routeTo && !canManageVoicemails\(gate\.role\)\)/);
  assert.equal((route.match(/auditPhiAccess\(/g) || []).length >= 3, true, 'list, write and denied re-route are audited');
});

// 11 ─ Connect analysis
test('11. connect analysis: client scope', () => {
  const route = src('src/app/api/connect/analysis/[contactId]/route.ts');
  assert.match(route, /getCallAnalysis\([\s\S]*clientAccessWhere\(/);
  assert.match(src('src/lib/connect/service.ts'), /where: \{ organizationId, contactId, \.\.\.\(client \? \{ client \} : \{\}\) \}/);
});

// 12 ─ 14 consents
test('12. legacy consents list drops locked clients', () => {
  const route = src('src/app/api/consents/route.ts');
  assert.match(route, /lockedSensitiveClientIds\(/);
  assert.match(route, /all\.filter\(\(c\) => !locked\.has\(c\.clientId\)\)/);
});

test('13. consent sign: client looked up first, then the chart gate', () => {
  const route = src('src/app/api/consents/[id]/sign/route.ts');
  assert.match(route, /prisma\.consentForm\.findFirst\(\{ where: \{ id, organizationId: gate\.organizationId \}, select: \{ clientId: true \} \}\)/);
  assert.ok(route.indexOf('chartGate(gate, req, owner.clientId') < route.indexOf('signConsent('), 'gate before sign');
});

test('14. consent packet DELETE: clientOf + chartGate like GET/POST', () => {
  const route = src('src/app/api/consents/library/packets/[id]/route.ts');
  const del = route.slice(route.indexOf('export async function DELETE'));
  assert.match(del, /clientOf\(g\.gate\.organizationId, id\)/);
  assert.ok(del.indexOf('chartGate(') < del.indexOf('voidPacket('), 'gate before void');
});

// 15 ─ Part 2 disclosures
test('15. Part 2 disclosures: reads need PD/Admin or the treating caseload; release desk records only', () => {
  assert.equal(canReadDisclosures('ADMIN', false), true);
  assert.equal(canReadDisclosures('PRACTICE_DIRECTOR', false), true);
  assert.equal(canReadDisclosures('THERAPIST', true), true, 'treating clinician');
  assert.equal(canReadDisclosures('THERAPIST', false), false, 'off-caseload clinician');
  assert.equal(canReadDisclosures('PSYCHIATRIST', false), false);
  for (const r of ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER']) {
    assert.equal(isPart2ReleaseDeskRole(r), true, r);
    assert.equal(canReadDisclosures(r, true), false, `${r} cannot read`);
    assert.equal(canRecordDisclosure(r, true), true, `${r} records for visible clients`);
    assert.equal(canRecordDisclosure(r, false), false, `${r} not for invisible clients`);
  }
  assert.equal(canRecordDisclosure('THERAPIST', true), true);
  assert.equal(canRecordDisclosure('THERAPIST', false), false);
  assert.equal(canRecordDisclosure('HR', true), false);

  const lib = src('src/lib/privacy/part2Disclosures.ts');
  assert.match(lib, /input\.mode === 'record' \? canRecordDisclosure\(input\.role, inScope\) : canReadDisclosures\(input\.role, inScope\)/);
  assert.match(lib, /assertClientPhiAccess\(/, 'Part 2 lock still applies');
  assert.match(src('src/app/api/part2/disclosures/route.ts'), /mode: 'record'/);
  for (const p of ['src/app/api/part2/disclosures/accounting/route.ts', 'src/app/api/consents/library/disclosure-consents/route.ts']) {
    assert.doesNotMatch(src(p), /mode: 'record'/, `${p} uses the read rule`);
    assert.match(src(p), /checkPart2ClientAccess\(/, p);
  }
});

// 16 ─ pharmacies
test('16. pharmacies: org filter + canViewPrescriptions', () => {
  const route = src('src/app/api/prescriptions/pharmacies/route.ts');
  assert.match(route, /requireOrgContext\(\)/);
  assert.match(route, /canViewPrescriptions\(gate\.role\)/);
  assert.match(route, /prescriptions: \{ some: \{ client: clientOrgFilter\(gate\.organizationId\) \} \}/);
  assert.doesNotMatch(route, /\$queryRaw/);
});
