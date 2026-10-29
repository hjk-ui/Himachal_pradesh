import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { canAccessClientRoster } from '../src/lib/clients/orgScope';
import { decideChartAccess, loadChartBanner, type BannerClientRow, type ChartBannerSource } from '../src/lib/clients/chartBanner';
import { CHART_TABS, chartTabFromParam, chartTabGroup, resolveChartTab, type ChartTabKey } from '../src/components/chart/chartTabs';
import { canSeeBhDiagnoses, sectionAllowed } from '../src/lib/clients/chartSectionAccess';
import {
  isPrimaryCareLocation,
  legacyMedicalPatientRedirect,
  MEDICAL_CLIENTS_HREF,
  MEDICAL_ROLE_CHART_SECTIONS,
  MEDICAL_ROLE_CHART_TABS,
  MEDICAL_TAB_KEYS,
  medicalProgramClientWhere,
  medicalTabAllowed,
  shouldShowMedicalTabs,
} from '../src/lib/medical/medicalProgram';
import { medicalHistoryView, vitalRowView } from '../src/lib/medical/chartMedical';
import { daysInAr, nonDeniedClaimShare } from '../src/lib/medical/billingMetrics';
import { reconcileMedicalPatients } from '../src/lib/medical/reconciliation';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// ─── When the Medical tab group shows ────────────────────────────────────────

test('medical tabs show for a primary-care patient or a medical viewer, never for location alone', () => {
  const base = { primaryCarePatient: false, role: 'THERAPIST' };
  assert.equal(shouldShowMedicalTabs(base), false, 'a Bowie / Silver Spring BH client is not a primary-care patient');
  assert.equal(shouldShowMedicalTabs({ ...base, primaryCarePatient: true }), true);
  for (const role of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'physician']) {
    assert.equal(shouldShowMedicalTabs({ ...base, role }), true, role);
  }
  assert.equal(shouldShowMedicalTabs({ primaryCarePatient: false, role: null }), false);
  // Primary-care locations (intake choices / list filter): name or city, whole value only
  assert.equal(isPrimaryCareLocation({ name: 'Silver Spring' }), true);
  assert.equal(isPrimaryCareLocation({ name: '  silver   spring ' }), true);
  assert.equal(isPrimaryCareLocation({ name: 'Outpatient Clinic', city: 'Bowie' }), true);
  assert.equal(isPrimaryCareLocation({ name: 'Baltimore', city: 'Baltimore' }), false);
  assert.equal(isPrimaryCareLocation({ name: 'Family Practice' }), false);
  assert.equal(isPrimaryCareLocation({ name: 'Bowie Annex' }), false, 'exact value only, no guessing');
});

test('each medical tab follows the matching practice-wide page rule', () => {
  for (const key of MEDICAL_TAB_KEYS) {
    assert.equal(medicalTabAllowed(key, 'PHYSICIAN'), true, key);
    assert.equal(medicalTabAllowed(key, 'CRISIS_RESPONDER'), false, key);
    assert.equal(medicalTabAllowed(key, 'HR'), false, key);
  }
  // Medical assistants: no preventive care (provider-level), but visits / vitals / history
  assert.equal(medicalTabAllowed('medical-preventive', 'MEDICAL_ASSISTANT'), false);
  assert.equal(medicalTabAllowed('medical-vitals', 'MEDICAL_ASSISTANT'), true);
});

test('chart tab set: medical group, deep links, no duplicate problem list / labs tab', () => {
  const medical = CHART_TABS.filter((t) => chartTabGroup(t.key) === 'medical').map((t) => t.key);
  assert.deepEqual(medical, MEDICAL_TAB_KEYS);
  assert.equal(CHART_TABS.filter((t) => /lab/i.test(t.label)).length, 1, 'one Labs tab');
  assert.equal(CHART_TABS.filter((t) => /problem/i.test(t.label)).length, 1, 'problem list stays in Diagnoses & problems');
  assert.equal(chartTabFromParam('medical'), 'medical-visits');
  assert.equal(chartTabFromParam('Vitals'), 'medical-vitals');
  assert.equal(chartTabFromParam('preventive-care'), 'medical-preventive');
  // Hidden medical tab falls back to Summary; roles without Summary get their first tab
  assert.equal(resolveChartTab('medical-visits', ['summary', 'notes']), 'summary');
  const medicalRoleTabs = CHART_TABS.map((t) => t.key).filter((k) => MEDICAL_ROLE_CHART_TABS.includes(k)) as ChartTabKey[];
  assert.ok(!medicalRoleTabs.includes('summary') && !medicalRoleTabs.includes('notes') && !medicalRoleTabs.includes('safety'));
  assert.equal(resolveChartTab(null, medicalRoleTabs), medicalRoleTabs[0]);
  assert.equal(resolveChartTab('medical-visits', medicalRoleTabs), 'medical-visits');
});

// ─── Server section gates ────────────────────────────────────────────────────

test('chart section API: medical roles get medical sections + problems / labs only', () => {
  for (const role of ['PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(sectionAllowed('medical-visits', role), true);
    assert.equal(sectionAllowed('medical-vitals', role), true);
    assert.equal(sectionAllowed('medical-history', role), true);
    assert.equal(sectionAllowed('diagnoses', role), true, 'problem list');
    assert.equal(sectionAllowed('labs', role), true);
    for (const bh of ['safety', 'messages', 'programs', 'discharge', 'care-team', 'authorizations', 'access-log'] as const) {
      assert.equal(sectionAllowed(bh, role), false, `${role} ${bh}`);
    }
    assert.equal(canSeeBhDiagnoses(role), false, 'BH diagnoses never shown to primary care roles');
  }
  assert.equal(sectionAllowed('medical-history', 'MEDICAL_ASSISTANT'), true);
  assert.equal(sectionAllowed('medical-visits', 'MEDICAL_ASSISTANT'), true, 'visit intake support');
  assert.equal(sectionAllowed('medical-vitals', 'MEDICAL_ASSISTANT'), true);
  assert.equal(sectionAllowed('diagnoses', 'MEDICAL_ASSISTANT'), false, 'MA has no problem-list rule');
  assert.equal(sectionAllowed('medical-visits', 'CRISIS_RESPONDER'), false);
  assert.equal(sectionAllowed('medical-visits', 'HR'), false);
  assert.equal(sectionAllowed('diagnoses', 'THERAPIST'), true);
  assert.equal(canSeeBhDiagnoses('THERAPIST'), true);
  // Primary care SOAP / vitals / history: licensed prescribers + primary care team + leadership only
  for (const role of ['THERAPIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'PRP_SPECIALIST', 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER']) {
    for (const s of ['medical-visits', 'medical-vitals', 'medical-history'] as const) {
      assert.equal(sectionAllowed(s, role), false, `${role} ${s}`);
    }
  }
  for (const role of ['PSYCHIATRIST', 'NP', 'CLINICIAN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) {
    for (const s of ['medical-visits', 'medical-vitals', 'medical-history'] as const) {
      assert.equal(sectionAllowed(s, role), true, `${role} ${s}`);
    }
  }
  for (const s of MEDICAL_ROLE_CHART_SECTIONS) assert.ok(s !== 'safety' && s !== 'messages');
});

test('medical section loaders are scoped to the resolved client and audited', () => {
  const src = read('src/app/api/clients/[id]/chart/route.ts');
  for (const section of ['medical-visits', 'medical-vitals', 'medical-history']) {
    const start = src.indexOf(`case '${section}': {`);
    assert.ok(start > 0, section);
    const body = src.slice(start, src.indexOf('case ', start + 10));
    assert.match(body, /where: \{ clientId: client\.id \}/, `${section} must query by the access-checked client id`);
  }
  // One gate for every section: resolveChartAccess (org / roster / caseload / Part 2) then the role rule, then audit
  assert.match(src, /resolveChartAccess\(/);
  assert.match(src, /sectionAllowed\(section, gate\.role\)/);
  assert.match(src, /auditPhiAccess\(\{ gate, req, action: 'READ', resourceType, resourceId: id, patientId: id \}\)/);
});

test('medical history view: all allergies, resolved problems only, no estimates', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const view = medicalHistoryView({
    allergies: [{ id: 'a1', allergen: 'Penicillin', reaction: null, severity: 'Unspecified', status: 'Inactive', source: null, createdAt: now }],
    problems: [
      { id: 'p1', icd10Code: 'I10', name: 'HTN', status: 'Active', isChronic: true, onsetDate: null, resolvedDate: null, source: null },
      { id: 'p2', icd10Code: 'J02.9', name: 'Pharyngitis', status: 'Resolved', isChronic: false, onsetDate: now, resolvedDate: now, source: null },
    ],
  });
  assert.equal(view.allergies.length, 1);
  assert.deepEqual(view.pastProblems.map((p) => p.id), ['p2']);
  assert.equal(view.activeProblemCount, 1);
  const vital = vitalRowView({
    id: 'v', recordedAt: now, systolic: null, bpSystolic: 130, diastolic: 80, bpDiastolic: null, heartRate: null, respiratoryRate: 14,
    respRate: null, temperature: null, spO2: null, o2Sat: 97, weightLbs: null, heightInches: null, bmi: null, recordedBy: null,
  });
  assert.deepEqual([vital.systolic, vital.diastolic, vital.respRate, vital.spO2, vital.heartRate], [130, 80, 14, 97, null]);
});

// ─── Banner signal ───────────────────────────────────────────────────────────

const row: BannerClientRow = {
  id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Doe', mrn: 'ALT-1',
  dateOfBirth: null, status: 'ACTIVE', riskLevel: 'LOW', assignedToId: 'u1', assignedToName: 'Dr. A',
  locationName: 'Family Practice', insurancePayer: null, insuranceMemberId: null,
  primaryDiagnosis: null, primaryDiagnosisCode: null, secondaryDiagnoses: null,
};
function fakeSource(hasMedical?: boolean): ChartBannerSource {
  return {
    findClient: async (org, id) => (org === 'org-a' && id === 'c1' ? row : null),
    sensitiveState: async () => 'none',
    sensitiveAlias: async () => null,
    hasForwardedThread: async () => false,
    allergies: async () => [],
    priorAuths: async () => [],
    riskAlerts: async () => [],
    latestCssrs: async () => null,
    nextAppointment: async () => null,
    balanceCents: async () => null,
    sessionFrequency: async () => null,
    ...(hasMedical === undefined ? {} : { isPrimaryCarePatient: async () => hasMedical }),
  };
}

test('banner carries location + primaryCarePatient; caseload / care team still applies to medical roles', async () => {
  const viewer = { organizationId: 'org-a', userId: 'u1', role: 'PHYSICIAN', billingVisible: false };
  const r1 = await loadChartBanner(fakeSource(true), viewer, 'c1');
  assert.ok(r1.ok && r1.banner.locked === false && r1.banner.primaryCarePatient === true && r1.banner.location === 'Family Practice');
  const r2 = await loadChartBanner(fakeSource(), viewer, 'c1');
  assert.ok(r2.ok && r2.banner.locked === false && r2.banner.primaryCarePatient === false);
  // Other org: not found; another physician's patient: caseload rule
  assert.deepEqual(await loadChartBanner(fakeSource(true), { ...viewer, organizationId: 'org-b' }, 'c1'), { ok: false, status: 404, reason: 'client_not_found' });
  const other = await decideChartAccess({ role: 'PHYSICIAN', userId: 'u2', client: { assignedToId: 'u1' }, sensitive: 'none', hasForwardedThread: () => false });
  assert.deepEqual(other, { ok: false, status: 403, reason: 'not_on_caseload' });
});

// ─── Navigation access, list filter, redirects ───────────────────────────────

test('medical roles can open the client list and chart but not BH intake / notes', () => {
  for (const role of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    assert.equal(canAccessPath(role, '/dashboard/clients'), true, role);
    assert.equal(canAccessPath(role, '/dashboard/clients/abc123'), true, role);
    assert.equal(canAccessPath(role, '/dashboard/clients/intake'), false, role);
    assert.equal(canAccessPath(role, '/dashboard/ehr/notes'), false, role);
    assert.equal(canAccessClientRoster(role), true, role);
  }
});

test('?program=medical filter: primary-care patient at a Silver Spring / Bowie location (problems/allergies excluded)', () => {
  const where = JSON.stringify(medicalProgramClientWhere());
  for (const rel of ['medicalVisits', 'medicalVitals', 'medicalCharges']) assert.ok(where.includes(`"${rel}":{"some":{}}`), rel);
  assert.ok(where.includes('"primaryCare":true'), 'intake marker');
  assert.ok(where.includes('"valantTransactions":{"some":{"facility":{"equals":"Family Practice","mode":"insensitive"}}}'), 'Valant journal');
  for (const loc of ['Silver Spring', 'Bowie']) {
    assert.ok(where.includes(`"name":{"equals":"${loc}","mode":"insensitive"}`), loc);
    assert.ok(where.includes(`"city":{"equals":"${loc}","mode":"insensitive"}`), loc);
  }
  // The patient rule is ANDed with the location: location alone never qualifies a client
  const parsed = medicalProgramClientWhere() as { AND: unknown[] };
  assert.equal(parsed.AND.length, 2);
  assert.ok(!JSON.stringify(parsed.AND[0]).includes('location'), 'patient rule has no location term');
  assert.ok(!where.includes('medicalProblems') && !where.includes('medicalAllergies'), 'DrFirst problems/allergies do not make a BH client a medical patient');
  assert.match(read('src/app/api/clients/route.ts'), /searchParams\.get\('program'\) === MEDICAL_PROGRAM/);
});

test('old medical patient URLs open the client chart (back link) / the Primary care patients list', () => {
  // ?program=medical on the client list keeps working, but the primary care area no longer links there
  assert.equal(MEDICAL_CLIENTS_HREF, '/dashboard/clients?program=medical');
  assert.equal(legacyMedicalPatientRedirect('c 1'), '/dashboard/clients/c%201?tab=medical-visits&from=medical');
  assert.equal(legacyMedicalPatientRedirect(null), '/dashboard/medical/patients?unlinked=1');
  const chart = read('src/app/dashboard/medical/patients/[id]/page.tsx');
  assert.match(chart, /resolveMedicalPatientLink\(gate\.organizationId/);
  assert.match(chart, /redirect\(legacyMedicalPatientRedirect\(clientId\)\)/);
  // The roster is a real page now, not a redirect to the client list
  const roster = read('src/app/dashboard/medical/patients/page.tsx');
  assert.ok(!/redirect\(/.test(roster) && !roster.includes('MEDICAL_CLIENTS_HREF'), 'no redirect to the client list');
  assert.match(roster, /\/api\/medical\/patients\?\$\{params/);
  assert.match(roster, /PRIMARY_CARE_INTAKE_HREF/);
  // No shadow MedicalPatient rows are created from clients any more
  for (const rel of ['src/app/api/medical/patients/route.ts', 'src/app/api/medical/patients/[id]/chart/route.ts']) {
    assert.ok(!/medicalPatient\.upsert/.test(read(rel)), rel);
  }
});

// ─── Billing metrics + reconciliation ────────────────────────────────────────

test('medical billing: non-denied share and days in A/R from stored charges only', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(nonDeniedClaimShare([]), null);
  assert.equal(daysInAr([], now), null);
  const charges = [
    { status: 'Paid', billedAmount: 450, dos: '2026-09-01' },
    { status: 'Submitted', billedAmount: 300, dos: '2026-10-01' },
    { status: 'Denied', billedAmount: 150, dos: '2026-10-10' },
    { status: 'Ready', billedAmount: 900, dos: '2026-01-01' }, // outside the 90-day window, not sent
  ];
  assert.equal(nonDeniedClaimShare(charges), 0.75);
  // A/R 450 / (900 charged in 90 days / 90) = 45 days
  assert.equal(daysInAr(charges, now), 45);
  assert.equal(daysInAr([{ status: 'Paid', billedAmount: 100, dos: '2026-10-01' }], now), null, 'nothing outstanding');
  // KPI cards moved to the summary panel (Valant + Altrixs) rendered by the page
  const page = read('src/app/dashboard/medical/billing/page.tsx') + read('src/features/billing/overview/MedicalBillingSummaryPanel.tsx');
  assert.ok(!/>Clean Claim Rate</.test(page), 'the mislabeled KPI title is gone');
  assert.match(page, /Non-denied claim share/);
  assert.ok(!/const daysInAR: string = '—'/.test(page));
});

test('reconciliation report classifies without matching automatically', () => {
  const rows = reconcileMedicalPatients(
    [
      { id: 'm1', mrn: 'ALT-1', name: 'Jane Doe', dob: '1980-01-01', bhClientId: 'c1' },
      { id: 'm2', mrn: 'MED-2', name: 'Bob Roe', dob: '1970-02-02', bhClientId: null },
      { id: 'm3', mrn: 'MED-3', name: 'Ann Poe', dob: null, bhClientId: null },
      { id: 'm4', mrn: 'ALT-4', name: 'Kim Loe', dob: '1990-03-03', bhClientId: null },
    ],
    [
      { id: 'c1', mrn: 'ALT-1', name: 'Jane Doe', legalFirstName: null, legalLastName: null, dob: '1980-01-01', hasPrimaryCareRecords: false },
      { id: 'c2', mrn: 'ALT-2', name: 'Robert Roe', legalFirstName: 'Bob', legalLastName: 'Roe', dob: '1970-02-02', hasPrimaryCareRecords: false },
      { id: 'c3', mrn: 'ALT-3', name: 'Ann Poe', legalFirstName: null, legalLastName: null, dob: '1960-01-01', hasPrimaryCareRecords: false },
      { id: 'c4', mrn: 'ALT-4', name: 'Kim Loe', legalFirstName: null, legalLastName: null, dob: '1990-03-03', hasPrimaryCareRecords: true },
    ]
  );
  assert.deepEqual(
    rows.map((r) => [r.medicalPatientId, r.status, r.clientId, r.candidateClientIds]),
    [
      ['m1', 'linked_no_records', 'c1', []],
      ['m2', 'unlinked_candidates', null, ['c2']],
      ['m3', 'unlinked_no_match', null, []],
      ['m4', 'linked_primary_care', 'c4', []],
    ]
  );
});
