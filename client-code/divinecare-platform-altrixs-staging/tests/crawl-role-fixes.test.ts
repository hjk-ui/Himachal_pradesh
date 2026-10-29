import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';
import { canReadClinicModule, canUseClinicModule } from '../src/lib/modules/access';
import { canAccessSupervision, canSeeAllSupervisionLogs } from '../src/lib/hr/supervision';
import { computeCarfScorecard } from '../src/lib/compliance/carfScorecard';
import { buildNavForRole, navHomeHrefForRole, profileHrefForRole } from '../src/components/layout/navConfig';
import { CLINIC_ROLES } from '../src/types/roles';

// Fixes for the Oct 19 per-role crawl of staging: a page the role may open must not answer 403
// from one of its own API calls (align the handler, or skip the fetch for the role).

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('supervision: Practice Director sees all logs; Office Manager opens the page with own logs only', () => {
  assert.equal(canAccessPath('PRACTICE_DIRECTOR', '/dashboard/hr/supervision'), true);
  assert.equal(canAccessSupervision('PRACTICE_DIRECTOR'), true);
  assert.equal(canSeeAllSupervisionLogs('PRACTICE_DIRECTOR'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/hr/supervision'), true);
  assert.equal(canAccessSupervision('OFFICE_MANAGER'), true);
  assert.equal(canSeeAllSupervisionLogs('OFFICE_MANAGER'), false);
  // Every role the page admits passes the API's own role list
  for (const role of CLINIC_ROLES) {
    if (canAccessPath(role, '/dashboard/hr/supervision')) {
      assert.equal(canAccessSupervision(role as never), true, role);
    }
  }
});

test('productivity: note timing metadata endpoint, no note bodies, no /api/ehr/notes', () => {
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/analytics/productivity'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/ehr/notes'), false);
  const page = read('src/app/dashboard/analytics/productivity/page.tsx');
  assert.doesNotMatch(page, /fetchEhrProgressNotes|note\.body/);
  // Metrics are computed server-side (appointments + note signature timing only).
  assert.match(page, /\/api\/analytics\/productivity\/metrics/);
  assert.match(read('src/app/api/analytics/productivity/metrics/route.ts'), /canAccessPath\(gate\.role, '\/dashboard\/analytics\/productivity'\)/);
  assert.doesNotMatch(read('src/lib/analytics/visitDocumentationServer.ts'), /body: true/);
  const lib = read('src/lib/analytics/noteProductivity.ts');
  assert.doesNotMatch(lib, /body: true/);
  assert.match(lib, /take: PRODUCTIVITY_MAX_ROWS/);
  assert.match(read('src/app/api/analytics/productivity/notes/route.ts'), /canAccessPath\(gate\.role, '\/dashboard\/analytics\/productivity'\)/);
});

test('compliance: HR and Office Manager get scorecard percentages, never the clinical module lists', () => {
  for (const role of ['HR', 'OFFICE_MANAGER', 'PRACTICE_DIRECTOR'] as const) {
    assert.equal(canAccessPath(role, '/dashboard/compliance'), true, role);
  }
  // Minimum necessary: still no direct read of safety plans / discharge cases for HR or OM
  for (const role of ['HR', 'OFFICE_MANAGER'] as const) {
    assert.equal(canReadClinicModule(role, 'ehr-safety-plans'), false, role);
    assert.equal(canReadClinicModule(role, 'ehr-discharge-cases'), false, role);
  }
  assert.equal(canReadClinicModule('HR', 'incidents'), false);
  const page = read('src/app/dashboard/compliance/page.tsx');
  for (const mod of ['ehr-safety-plans', 'ehr-discharge-cases', 'qi-meetings', "'incidents'", "'grievances'"]) {
    assert.ok(!page.includes(mod), `compliance page still reads ${mod}`);
  }
  assert.match(page, /\/api\/compliance\/scorecard/);
  assert.match(read('src/app/api/compliance/scorecard/route.ts'), /canAccessPath\(gate\.role, '\/dashboard\/compliance'\)/);
  const card = computeCarfScorecard({
    safetyPlans: [{ withoutPlan: false, reviewDue: false, clientName: 'Jane Doe' }],
    trainingStaff: [],
    qiMeetings: [],
    incidents: [],
    grievances: [],
    dischargeCases: [],
  });
  assert.equal(card.factors.length, 6);
  assert.ok(!JSON.stringify(card).includes('Jane Doe'), 'scorecard carries no record data');
});

test('payments: batch reconciliation is billing back-office; Front Desk skips the fetch', () => {
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing'), false);
  const page = read('src/app/dashboard/billing/payments/page.tsx');
  assert.match(page, /const canSeeBatches = canAccessPath\(user\?\.role, '\/dashboard\/billing'\)/);
  assert.match(page, /if \(!canSeeBatches\) return;\s*void loadBatches\(\);/);
});

test('billing: coding skips note bodies; superbills read the billing identity; medical billing has a picker', () => {
  assert.equal(canAccessPath('BILLING', '/dashboard/coding'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/ehr/notes'), false);
  assert.match(read('src/app/dashboard/coding/page.tsx'), /if \(!canReviewNotes\) \{/);

  assert.equal(canAccessPath('BILLING', '/dashboard/billing/superbills'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/practice-setup'), false);
  assert.match(read('src/app/dashboard/billing/superbills/page.tsx'), /\/api\/practice-setup\/billing-identity/);
  const identity = read('src/app/api/practice-setup/billing-identity/route.ts');
  assert.match(identity, /canAccessPath\(gate\.role, '\/dashboard\/billing\/superbills'\)/);
  const payload = identity.slice(identity.indexOf('practice: {'));
  assert.doesNotMatch(payload, /licenseNumber|availability|caqhId|services/);

  assert.equal(canAccessPath('BILLING', '/dashboard/medical/billing'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/medical/patients'), false);
  assert.equal(canAccessApiPath('BILLING', '/api/medical/billing/patients'), true);
  assert.equal(canAccessApiPath('HR', '/api/medical/billing/patients'), false);
  const page = read('src/app/dashboard/medical/billing/page.tsx');
  assert.match(page, /\/api\/medical\/billing\/patients/);
  assert.doesNotMatch(page, /fetchMedicalPatients/);
  const picker = read('src/app/api/medical/billing/patients/route.ts');
  assert.match(picker, /take: MAX_ROWS/);
  assert.doesNotMatch(picker, /medicalProblems|phone: true|email: true/);
});

test('goal bank templates: PRP reads them for treatment plans but cannot edit the library', () => {
  assert.equal(canAccessPath('PRP_SPECIALIST', '/dashboard/ehr/treatment-plans'), true);
  assert.equal(canReadClinicModule('PRP_SPECIALIST', 'goal-bank-templates'), true);
  assert.equal(canUseClinicModule('PRP_SPECIALIST', 'goal-bank-templates'), false);
  assert.equal(canReadClinicModule('PEER_SUPPORT', 'goal-bank-templates'), false);
  assert.equal(canReadClinicModule('BILLING', 'goal-bank-templates'), false);
  const route = read('src/app/api/modules/[module]/route.ts');
  assert.match(route, /if \(!canReadClinicModule\(gate\.role, module, gate\.capabilities\)\)/);
  assert.match(route, /if \(!canUseClinicModule\(gate\.role, module, gate\.capabilities\)\)/);
});

test('alerts: MBC escalations tab only for MBC roles (PRP / Case Manager skip it; Office Manager has no Risk Alerts)', () => {
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/alerts'), false, 'risk alert detail is clinical');
  for (const role of ['PRP_SPECIALIST', 'CASE_MANAGER'] as const) {
    assert.equal(canAccessPath(role, '/dashboard/alerts'), true, role);
    assert.equal(canAccessPath(role, '/dashboard/mbc'), false, role);
  }
  const page = read('src/app/dashboard/alerts/page.tsx');
  assert.match(page, /const canSeeMbc = canAccessPath\(user\?\.role, '\/dashboard\/mbc'\)/);
  assert.match(page, /activeTab === 'mbc' && canSeeMbc/);
});

test('crisis responder: smart phrases read and MBC assessment history', () => {
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/ehr/session-ai'), true);
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/mbc'), true);
  const phrases = read('src/app/api/smart-phrases/route.ts');
  assert.match(phrases, /canAccessPath\(gate\.role, '\/dashboard\/ehr\/session-ai'\)/);
  const assessments = read('src/app/api/clinical/assessments/route.ts');
  assert.match(assessments, /requireClinicalContext\('\/dashboard\/mbc'(, one)?\)/);
  assert.match(assessments, /take: MAX_RECORDS/);
  // Submitting an assessment stays on the assessments page roles
  assert.match(assessments, /export async function POST[\s\S]*?requireClinicalContext\('\/dashboard\/ehr\/assessments'\)/);
});

test('physician reaches the primary care APIs (proxy + route rules)', () => {
  for (const role of ['PHYSICIAN', 'MEDICAL_NP'] as const) {
    for (const api of ['/api/medical/overview', '/api/medical/patients', '/api/medical/patients/abc/chart', '/api/medical/billing/charges']) {
      assert.equal(canAccessApiPath(role, api), true, `${role} ${api}`);
    }
    for (const page of ['/dashboard/medical', '/dashboard/medical/patients', '/dashboard/medical/visits', '/dashboard/medical/billing']) {
      assert.equal(canAccessPath(role, page), true, `${role} ${page}`);
    }
  }
  // The crawl's 403 came from the preview role having reverted to Crisis Responder
  assert.equal(canAccessPath('CRISIS_RESPONDER', '/dashboard/medical'), false);
});

test('shell: logo home and My profile come from the nav model', () => {
  assert.equal(navHomeHrefForRole('HR'), '/dashboard/hr');
  assert.equal(navHomeHrefForRole('PHYSICIAN'), '/dashboard/medical');
  assert.equal(navHomeHrefForRole('THERAPIST'), '/dashboard');
  const hrNav = buildNavForRole('HR').flatMap((s) => s.items.map((i) => i.href));
  assert.ok(!hrNav.includes('/dashboard'), 'HR nav has no bare /dashboard link');
  for (const role of CLINIC_ROLES) {
    const href = profileHrefForRole(role);
    assert.equal(href, canAccessPath(role, '/dashboard/settings') ? '/dashboard/settings' : null, role);
  }
  const shell = read('src/components/layout/DashboardShell.tsx');
  assert.doesNotMatch(shell, /href="\/dashboard\/settings"/);
  assert.doesNotMatch(shell, /href="\/dashboard"/);
});

test('perf: crawl index migration is idempotent and mirrored in schema.prisma', () => {
  const sql = read('prisma/migrations/20261019_crawl_perf_indexes.sql').replace(/--.*$/gm, '');
  assert.ok(!/DROP|DELETE|UPDATE /.test(sql), 'indexes only');
  const creates = sql.match(/CREATE INDEX IF NOT EXISTS/g) || [];
  assert.equal(creates.length, 7);
  assert.equal((sql.match(/CREATE INDEX (?!IF NOT EXISTS)/g) || []).length, 0);
  const schema = read('prisma/schema.prisma');
  for (const idx of [
    '@@index([providerId, clientId])',
    '@@index([clinicianId, clientId])',
    '@@index([clientId, dateOfService])',
    '@@index([organizationId, dos])',
    '@@index([lifecycleStatus, providerNpi])',
  ]) {
    assert.ok(schema.includes(idx), idx);
  }
});
