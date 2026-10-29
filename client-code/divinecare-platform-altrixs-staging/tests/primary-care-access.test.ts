import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { decideChartAccess, loadChartBanner, type BannerClientRow, type ChartBannerSource } from '../src/lib/clients/chartBanner';
import { canAccessClientChartNotes, canSeeClientCheckIns, canSeeClientDiagnoses, canWriteClientChartNotes, clientAccessWhere, medicalCareTeamClientWhere } from '../src/lib/clients/orgScope';
import { sectionAllowed } from '../src/lib/clients/chartSectionAccess';
import { problemNeedsCoding, medicalHistoryView } from '../src/lib/medical/chartMedical';
import { MEDICAL_ROLE_CHART_SECTIONS, PRIMARY_CARE_LOCATION_NAMES, primaryCarePatientWhere } from '../src/lib/medical/medicalProgram';

/**
 * Primary care inside the one client record: who is a primary-care patient, care-team access for
 * physicians / medical NPs / medical assistants, minimum-necessary content rules, the chart access
 * check on every /api/medical/patients/[id]/* route, and uncoded ("needs coding") intake problems.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// ─── Primary-care patient rule ───────────────────────────────────────────────

test('primary care locations are Silver Spring and Bowie; the patient rule never uses location', () => {
  assert.deepEqual([...PRIMARY_CARE_LOCATION_NAMES], ['Silver Spring', 'Bowie']);
  const where = JSON.stringify(primaryCarePatientWhere());
  assert.ok(!where.includes('location'), 'location alone never makes a primary-care patient');
  assert.ok(where.includes('"primaryCare":true'));
  assert.ok(!where.includes('medicalProblems') && !where.includes('medicalAllergies'));
  // No location constant is duplicated in another file
  for (const rel of ['src/app/api/medical/patients/intake/route.ts', 'src/app/dashboard/clients/page.tsx']) {
    assert.ok(!/'Silver Spring'|'Bowie'|MEDICAL_LOCATION_NAMES/.test(read(rel)), rel);
  }
});

test('migration: primaryCare marker + nullable icd10Code, idempotent, no data writes', () => {
  const sql = read('prisma/migrations/20261018_client_primary_care.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "primaryCare" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ALTER COLUMN "icd10Code" DROP NOT NULL/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/i.test(sql.replace(/^--.*$/gm, '')), 'schema only');
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /primaryCare\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /icd10Code\s+String\?/);
});

// ─── Care-team access ───────────────────────────────────

test('physician / medical NP / MA: assigned, treatment team, MedicalVisit or appointment opens the chart', async () => {
  const notMine = { assignedToId: 'someone-else' };
  for (const role of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    const ok = await decideChartAccess({ role, userId: 'u', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: async () => true });
    assert.deepEqual(ok, { ok: true, sensitive: 'none' }, role);
    const no = await decideChartAccess({ role, userId: 'u', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: async () => false });
    assert.deepEqual(no, { ok: false, status: 403, reason: 'not_on_caseload' }, role);
    // Part 2 lock is checked before the care team
    const locked = await decideChartAccess({ role, userId: 'u', client: notMine, sensitive: 'locked', hasForwardedThread: () => true, hasCareTeamLink: () => true });
    assert.deepEqual(locked, { ok: false, status: 403, reason: 'sensitive_record' }, role);
  }
  // Therapists too: a care-team link (treatment team / own appointment) opens the chart, same as the client list
  const therapist = await decideChartAccess({ role: 'THERAPIST', userId: 'u', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => true });
  assert.deepEqual(therapist, { ok: true, sensitive: 'none' });
  const therapistNo = await decideChartAccess({ role: 'THERAPIST', userId: 'u', client: notMine, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => false });
  assert.deepEqual(therapistNo, { ok: false, status: 403, reason: 'not_on_caseload' });
  // Care team is only consulted when needed (assigned: no query)
  let asked = false;
  await decideChartAccess({ role: 'PHYSICIAN', userId: 'u', client: { assignedToId: 'u' }, sensitive: 'none', hasForwardedThread: () => false, hasCareTeamLink: () => ((asked = true), true) });
  assert.equal(asked, false);
});

test('lists / inbox use the same care-team where-clause for medical roles; BH caseload = assigned, treatment team or own appointments', () => {
  const physician = JSON.stringify(clientAccessWhere({ organizationId: 'o', actorUserId: 'u', actorRole: 'PHYSICIAN' as never }));
  const team = JSON.stringify(medicalCareTeamClientWhere('u'));
  assert.ok(physician.includes(team));
  for (const rel of ['"assignedToId":"u"', '"treatmentTeamMembers":{"some":{"providerId":"u"}}', '"medicalVisits":{"some":{"providerId":"u"}}', '"appointments":{"some":{"clinicianId":"u"}}']) {
    assert.ok(team.includes(rel), rel);
  }
  const therapist = JSON.stringify(clientAccessWhere({ organizationId: 'o', actorUserId: 'u', actorRole: 'THERAPIST' as never }));
  assert.ok(therapist.includes('"assignedToId":"u"') && therapist.includes('"treatmentTeamMembers":{"some":{"providerId":"u"}}'));
  assert.ok(therapist.includes('"clinicianId":"u"') && !therapist.includes('medicalVisits'));
});

const row: BannerClientRow = {
  id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Doe', mrn: 'ALT-1',
  dateOfBirth: null, status: 'ACTIVE', riskLevel: 'LOW', assignedToId: 'therapist-1', assignedToName: 'T',
  locationName: 'Bowie', insurancePayer: null, insuranceMemberId: null,
  primaryDiagnosis: null, primaryDiagnosisCode: null, secondaryDiagnoses: null,
};
const source = (careTeam: boolean, primaryCare: boolean): ChartBannerSource => ({
  findClient: async (org, id) => (org === 'org-a' && id === 'c1' ? row : null),
  sensitiveState: async () => 'none',
  sensitiveAlias: async () => null,
  hasForwardedThread: async () => false,
  hasCareTeamLink: async () => careTeam,
  allergies: async () => [],
  priorAuths: async () => [],
  riskAlerts: async () => [],
  latestCssrs: async () => null,
  nextAppointment: async () => null,
  balanceCents: async () => null,
  sessionFrequency: async () => null,
  isPrimaryCarePatient: async () => primaryCare,
});

test('banner agrees with the chart: care-team physician opens it; Bowie BH client is not a primary-care patient', async () => {
  const viewer = { organizationId: 'org-a', userId: 'doc', role: 'PHYSICIAN', billingVisible: false };
  const ok = await loadChartBanner(source(true, false), viewer, 'c1');
  assert.ok(ok.ok && ok.banner.locked === false && ok.banner.primaryCarePatient === false);
  assert.deepEqual(await loadChartBanner(source(false, true), viewer, 'c1'), { ok: false, status: 403, reason: 'not_on_caseload' });
  // chartAccess wires the same care-team check into the chart, sections and banner
  const access = read('src/lib/clients/chartAccess.ts');
  assert.match(access, /hasCareTeamLink: \(\) => hasCareTeamLink\(viewer, client\.id\)/);
  assert.match(access, /careTeamClientWhereForRole\(viewer\.userId, viewer\.role\)/);
  assert.match(read('src/app/api/clients/[id]/route.ts'), /hasCareTeamLink\(/);
});

// ─── Minimum necessary ───────────────────────────────────────────────────────

test('medical assistants never get behavioral-health notes, BH sections or check-ins (server-enforced)', () => {
  for (const role of ['MEDICAL_ASSISTANT', 'medical_assistant', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(canAccessClientChartNotes(role), false, role);
    assert.equal(canWriteClientChartNotes(role), false, role);
  }
  for (const s of ['safety', 'messages', 'programs', 'discharge', 'care-team', 'authorizations', 'access-log'] as const) {
    assert.equal(sectionAllowed(s, 'MEDICAL_ASSISTANT'), false, s);
  }
  assert.equal(sectionAllowed('diagnoses', 'MEDICAL_ASSISTANT'), false);
  assert.ok(!MEDICAL_ROLE_CHART_SECTIONS.includes('safety'));
  // Notes APIs gate on the helpers above
  assert.match(read('src/app/api/clients/[id]/notes/route.ts'), /canAccessClientChartNotes\(gate\.role\)/);
  assert.match(read('src/lib/clients/notes.ts'), /canAccessClientChartNotes\(input\.actorRole\)/);
  assert.match(read('src/app/api/notes/[id]/addenda/route.ts'), /canAccessClientChartNotes\(gate\.role\)/);
  assert.equal(canAccessPath('MEDICAL_ASSISTANT', '/dashboard/ehr/notes'), false, '/api/notes + note-context gate');
  // Check-ins and the client detail payload strip BH content for primary care roles
  assert.match(read('src/lib/clients/checkIns.ts'), /if \(isMedicalRole\(input\.actorRole\)\) \{\s*return \{ ok: false as const, status: 403/);
  const detail = read('src/app/api/clients/[id]/route.ts');
  // BH diagnoses and check-ins follow orgScope helpers that exclude every primary care role
  assert.match(detail, /const dxHidden = !canSeeClientDiagnoses\(gate\.role\)/);
  assert.match(detail, /const checkInsHidden = !canSeeClientCheckIns\(gate\.role\)/);
  assert.match(detail, /primaryDiagnosis: dxHidden \? null : client\.primaryDiagnosis/);
  assert.match(detail, /checkIns: \(checkInsHidden \? \[\] : client\.checkIns\)/);
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    assert.equal(canSeeClientDiagnoses(r), false, r);
    assert.equal(canSeeClientCheckIns(r), false, r);
  }
});

const CONTENT = ['/dashboard/medical/visits', '/dashboard/medical/vitals', '/dashboard/medical/history', '/dashboard/medical/ai'];

test('visits & SOAP, vitals, history: licensed clinicians + primary care team + leadership only', () => {
  for (const role of ['PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) {
    for (const p of CONTENT) assert.equal(canAccessPath(role, p), true, `${role} ${p}`);
  }
  for (const role of ['THERAPIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'PRP_SPECIALIST', 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', 'HR', 'CRISIS_RESPONDER']) {
    for (const p of CONTENT) assert.equal(canAccessPath(role, p), false, `${role} ${p}`);
  }
  // Problem list / preventive care: providers (incl. psychiatry), no MA, no therapist / front desk / billing
  for (const role of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'PRACTICE_DIRECTOR']) {
    assert.equal(canAccessPath(role, '/dashboard/medical/problem-list'), true, role);
  }
  for (const role of ['MEDICAL_ASSISTANT', 'THERAPIST', 'FRONT_DESK', 'BILLING', 'CASE_MANAGER', 'OFFICE_MANAGER']) {
    assert.equal(canAccessPath(role, '/dashboard/medical/problem-list'), false, role);
    assert.equal(canAccessPath(role, '/dashboard/medical/preventive-care'), false, role);
  }
  // Billing: medical billing (charges) and payer settings only
  assert.equal(canAccessPath('BILLING', '/dashboard/medical/billing'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/medical/payer-settings'), true);
  for (const p of ['/dashboard/medical', '/dashboard/medical/patients', '/dashboard/medical/patients/intake', '/dashboard/medical/labs', '/dashboard/medical/referrals']) {
    assert.equal(canAccessPath('BILLING', p), false, p);
  }
});

// ─── /api/medical/patients/[id]/* : full chart access check, denials audited ──

type Row = Record<string, unknown>;

function loadPatientContext(opts: {
  role: string;
  link: { medicalPatient: Row | null; clientId: string | null };
  access: Row;
}) {
  const audits: Row[] = [];
  const chartCalls: unknown[][] = [];
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/auth/tenant') {
      return { requireOrgContext: async () => ({ ok: true, userId: 'u1', role: opts.role, organizationId: 'org-a', session: { user: { name: 'Dr U' } } }) };
    }
    if (id === '@/lib/medical/patientLink') return { resolveMedicalPatientLink: async () => opts.link };
    if (id === '@/lib/clients/chartAccess') return { resolveChartAccess: async (...a: unknown[]) => (chartCalls.push(a), opts.access) };
    if (id === '@/lib/audit/requestMeta') return { auditPhiAccess: async (e: Row) => { audits.push(e); } };
    return original.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (/medical[\\/]_lib[\\/]patientContext/.test(k)) delete require.cache[k];
  try {
    const mod = require('../src/app/api/medical/_lib/patientContext');
    return { mod, audits, chartCalls };
  } finally {
    loader._load = original;
  }
}

const req = new Request('https://staging.altrixs.com/api/medical/patients/c1/visits', { method: 'POST' });

test('medical patient routes: role, caseload / care team and Part 2 denials are 403 + audited DENIED', async () => {
  const linked = { medicalPatient: null, clientId: 'c1' };
  // Role rule of the content page (billing cannot sign a visit / read SOAP)
  {
    const h = loadPatientContext({ role: 'BILLING', link: linked, access: { ok: true } });
    const r = await h.mod.requireMedicalPatient('c1', { req, action: 'CREATE', resourceType: 'medicalVisit', rule: h.mod.MEDICAL_RULE.visits });
    assert.equal(r.ok, false);
    assert.equal(r.response.status, 403);
    assert.equal(h.audits[0].outcome, 'DENIED');
    assert.deepEqual(h.audits[0].metadata, { reason: 'role_not_permitted' });
    assert.equal(h.chartCalls.length, 0);
  }
  // Not on caseload / care team
  {
    const h = loadPatientContext({ role: 'PHYSICIAN', link: linked, access: { ok: false, status: 403, reason: 'not_on_caseload' } });
    const r = await h.mod.requireMedicalPatient('c1', { req, action: 'READ', resourceType: 'medicalChart', rule: h.mod.MEDICAL_RULE.visits });
    assert.equal(r.response.status, 403);
    assert.equal(h.audits[0].patientId, 'c1');
    assert.deepEqual(h.audits[0].metadata, { reason: 'not_on_caseload' });
    assert.deepEqual(h.chartCalls[0], [{ organizationId: 'org-a', userId: 'u1', role: 'PHYSICIAN' }, 'c1', '/api/medical/patients/c1/visits']);
  }
  // 42 CFR Part 2 protected record: break-glass response, like the chart route
  {
    const h = loadPatientContext({ role: 'MEDICAL_NP', link: linked, access: { ok: false, status: 403, reason: 'sensitive_record' } });
    const r = await h.mod.requireMedicalPatient('c1', { req, action: 'CREATE', resourceType: 'vitals', rule: h.mod.MEDICAL_RULE.vitals });
    assert.equal(r.response.status, 403);
    assert.deepEqual(await r.response.json(), { error: 'SENSITIVE_RECORD', canRequestBreakGlass: true });
    assert.equal(h.audits[0].outcome, 'DENIED');
  }
  // Unlinked MedicalPatient row: caseload roles refused (nothing to check a care team against)
  {
    const h = loadPatientContext({ role: 'PHYSICIAN', link: { medicalPatient: { id: 'mp1' }, clientId: null }, access: { ok: true } });
    const r = await h.mod.requireMedicalPatient('mp1', { req, action: 'CREATE', resourceType: 'medicalAllergy', rule: h.mod.MEDICAL_RULE.history });
    assert.equal(r.response.status, 403);
    assert.deepEqual(h.audits[0].metadata, { reason: 'not_on_caseload' });
  }
  // Not found in this org
  {
    const h = loadPatientContext({ role: 'PRACTICE_DIRECTOR', link: { medicalPatient: null, clientId: null }, access: { ok: true } });
    const r = await h.mod.requireMedicalPatient('x', { req, action: 'READ', resourceType: 'medicalPatient' });
    assert.equal(r.response.status, 404);
    assert.equal(h.audits[0].outcome, 'DENIED');
  }
  // Allowed: no audit from the gate (the route audits the success)
  {
    const h = loadPatientContext({ role: 'PHYSICIAN', link: linked, access: { ok: true, sensitive: 'none' } });
    const r = await h.mod.requireMedicalPatient('c1', { req, action: 'CREATE', resourceType: 'medicalVisit', rule: h.mod.MEDICAL_RULE.visits });
    assert.equal(r.ok, true);
    assert.equal(r.clientId, 'c1');
    assert.equal(h.audits.length, 0);
  }
});

test('every /api/medical route that touches one client runs the chart access check', () => {
  const gated: Record<string, RegExp> = {
    'src/app/api/medical/patients/[id]/route.ts': /requireMedicalPatient\(id, \{ req, action: 'READ'[^)]*MEDICAL_RULE\.vitals[\s\S]*requireMedicalPatient\(id, \{ req, action: 'WRITE'/,
    'src/app/api/medical/patients/[id]/chart/route.ts': /requireMedicalPatient\(decodeURIComponent\(id\), \{ req, action: 'READ', resourceType: 'medicalChart', rule: MEDICAL_RULE\.visits \}\)/,
    'src/app/api/medical/patients/[id]/visits/route.ts': /rule: MEDICAL_RULE\.visits/,
    'src/app/api/medical/patients/[id]/vitals/route.ts': /rule: MEDICAL_RULE\.vitals/,
    'src/app/api/medical/patients/[id]/allergies/route.ts': /rule: MEDICAL_RULE\.history/,
    'src/app/api/medical/patients/[id]/problems/route.ts': /rule: MEDICAL_RULE\.problems/,
    'src/app/api/medical/patients/[id]/problems/[problemId]/route.ts': /rule: MEDICAL_RULE\.problems/,
    'src/app/api/medical/patients/[id]/medications/route.ts': /requireMedicalPatient\(id, \{ req,/,
    'src/app/api/medical/patients/[id]/medications/[medId]/route.ts': /requireMedicalPatient\(id, \{ req,/,
  };
  for (const [rel, re] of Object.entries(gated)) assert.match(read(rel), re, rel);
  const ctx = read('src/app/api/medical/_lib/patientContext.ts');
  assert.match(ctx, /resolveChartAccess\(/);
  assert.match(ctx, /outcome: 'DENIED'/);
  // Charges: per-client check on create / status change; the list is caseload / care-team scoped
  const charges = read('src/app/api/medical/billing/charges/route.ts');
  assert.equal((charges.match(/await denyChargeClient\(/g) || []).length, 2);
  assert.match(charges, /client: clientAccessWhere\(/);
  assert.match(read('src/app/api/medical/patients/route.ts'), /accessWhere,\s*medicalProgramClientWhere\(\)/);
});

// ─── Intake problems: uncoded, "needs coding" ────────────────────────────────

test('intake stores history problems uncoded (no guessed ICD-10) and marks the client primary care', () => {
  const intake = read('src/app/api/medical/patients/intake/route.ts');
  assert.ok(!/Z87\.898|'I10'|'E11\.9'/.test(intake), 'no guessed codes');
  assert.match(intake, /icd10Code: null,/);
  assert.match(intake, /primaryCare: true,/);
  assert.match(intake, /canAccessPath\(gate\.role, INTAKE_PATH\)/);
  assert.ok(!/'Standard'|'Once daily'|'Intake baseline'/.test(intake), 'no filled-in medication values');
  assert.match(intake, /choices\.some\(\(l\) => l\.id === body\.locationId\)/, 'location must be a primary-care location');
  const page = read('src/app/dashboard/medical/patients/intake/page.tsx');
  assert.ok(!/Lisinopril|Appendectomy|CareFirst BlueCross BlueShield'\)/.test(page), 'no pre-filled clinical values');

  assert.equal(problemNeedsCoding(null), true);
  assert.equal(problemNeedsCoding(''), true);
  assert.equal(problemNeedsCoding(' I10 '), false);
  const view = medicalHistoryView({
    allergies: [],
    problems: [{ id: 'p', icd10Code: null, name: 'Hypertension', status: 'Resolved', isChronic: false, onsetDate: null, resolvedDate: null, source: null }],
  });
  assert.equal(view.pastProblems[0].needsCoding, true);
  // Provider sets the code through the existing problem PATCH (validated, never crosswalked)
  const patch = read('src/app/api/medical/patients/[id]/problems/[problemId]/route.ts');
  assert.match(patch, /const code = normalizeIcd10\(body\.icd10\)/);
  assert.match(patch, /is not a valid ICD-10-CM code/);
  assert.match(read('src/components/chart/ClinicalTabs.tsx'), /Needs coding/);
  assert.match(read('src/app/dashboard/medical/problem-list/page.tsx'), /Needs coding/);
});
