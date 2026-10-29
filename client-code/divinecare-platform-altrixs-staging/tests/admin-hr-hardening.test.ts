/**
 * HR / admin least-privilege hardening (Oct 20): credentialing org scope + role gate, no staff-run
 * cross-tenant cron, practice setup details for leadership only, verified base role on the
 * locations gate, Availity test-auth for leadership, user-activity report for audit reviewers.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { canManageCredentialing } from '../src/lib/hr/credentialingAccess';
import { canReadPracticeSetupDetails } from '../src/lib/practice/access';
import { locationsRoleAllowed } from '../src/lib/locations/roleGate';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { getReport, REPORTS } from '../src/lib/reports/library/registry';
import { reportsForRole } from '../src/lib/reports/library/access';

const read = (p: string) => readFileSync(p, 'utf8');

test('1. credentialing intake grid: org scoped and gated to credentialing roles', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER']) assert.equal(canManageCredentialing(r), true, r);
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'FRONT_DESK', 'BILLING', 'CASE_MANAGER', 'PEER_SUPPORT', null, undefined, '']) {
    assert.equal(canManageCredentialing(r), false, String(r));
  }
  const src = read('src/app/api/hr/credentialing/intake-grid/route.ts');
  assert.match(src, /canManageCredentialing\(gate\.role\)/);
  assert.match(src, /where: \{ organizationId: gate\.organizationId \}/);
  assert.match(src, /where: \{ providerUserId: \{ in: ids \} \}/);
  assert.ok(!/providerPayerEnrollment\.findMany\(\{\s*orderBy/.test(src), 'no unscoped findMany');
});

test('2. credentialing toggle-doc: role gate, then provider must be in the caller org before any write', () => {
  const src = read('src/app/api/hr/credentialing/toggle-doc/route.ts');
  assert.match(src, /canManageCredentialing\(gate\.role\)/);
  const orgCheck = src.search(/user\.findFirst\(\{\s*where: \{ id: String\(providerUserId\), organizationId: gate\.organizationId \}/);
  assert.ok(orgCheck > 0, 'provider org check');
  assert.ok(orgCheck < src.indexOf('providerPayerEnrollment.update'), 'org check before update');
  assert.match(src, /Provider not found' \}, \{ status: 404 \}/);
});

test('3. admin notifications: staff can no longer run the all-org reminder schedulers', () => {
  const src = read('src/app/api/admin/notifications/route.ts');
  assert.ok(!/checkMedicationReminders|checkAppointmentReminders|checkDailyCheckIns/.test(src), 'schedulers not called');
  assert.match(src, /body\.action === 'run_cron'[\s\S]{0,400}outcome: 'DENIED'[\s\S]{0,400}status: 410/);
  const page = read('src/app/dashboard/notifications/page.tsx');
  assert.ok(!/run_cron|handleTriggerCron/.test(page), 'UI button removed');
  // The CRON_SECRET route still runs them.
  assert.match(read('src/app/api/cron/notifications/route.ts'), /CRON_SECRET/);
});

test('4. onboarding GET: full practice setup for leadership or a solo founder only', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.equal(canReadPracticeSetupDetails(r, false), true, r);
  for (const r of ['THERAPIST', 'HR', 'OFFICE_MANAGER', 'BILLING', 'FRONT_DESK']) {
    assert.equal(canReadPracticeSetupDetails(r, false), false, r);
    assert.equal(canReadPracticeSetupDetails(r, true), true, `${r} solo`);
  }
  const src = read('src/app/api/onboarding/route.ts');
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'));
  assert.match(get, /isSoleActiveStaff\(sessionGate\.session\.user\.id, sessionGate\.organizationId\)/);
  assert.match(get, /if \(!fullAccess\) \{\s*return NextResponse\.json\(\{\s*success: true,\s*authenticated: true,\s*completed: practice\.completed,\s*\}\)/);
});

test('5. locations gate: base role comes from the DB (verifiedAdminBaseRole), never the JWT', () => {
  const leadership = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
  assert.equal(locationsRoleAllowed(leadership, 'DIRECTOR', null), true);
  assert.equal(locationsRoleAllowed(leadership, 'THERAPIST', null), false, 'demoted / plain staff');
  assert.equal(locationsRoleAllowed(leadership, 'THERAPIST', 'ADMIN'), true, 'verified admin previewing');
  assert.equal(locationsRoleAllowed(leadership, 'THERAPIST', undefined), false);
  const src = read('src/lib/locations/server.ts');
  assert.match(src, /await verifiedAdminBaseRole\(gate\.userId\)/);
  assert.ok(!/baseRole\?: string|\.baseRole\b/.test(src), 'no JWT baseRole claim');
});

test('6. Availity test-auth: leadership only (admin page roles)', () => {
  const src = read('src/app/api/integrations/availity/test-auth/route.ts');
  assert.match(src, /canAccessPath\(gate\.role, ADMIN_PATH\)/);
  assert.match(src, /ADMIN_PATH = '\/dashboard\/admin'/);
  assert.ok(!src.includes('/dashboard/ehr/eligibility'));
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.equal(canAccessPath(r, '/dashboard/admin'), true, r);
  for (const r of ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST']) assert.equal(canAccessPath(r, '/dashboard/admin'), false, r);
});

test('7. user-activity report: ADMIN + PRACTICE_DIRECTOR only', () => {
  assert.deepEqual([...(getReport('user-activity')?.access.roles ?? [])].sort(), ['ADMIN', 'PRACTICE_DIRECTOR']);
  const has = (role: string) => reportsForRole(REPORTS, role).some((r) => r.id === 'user-activity');
  assert.equal(has('ADMIN'), true);
  assert.equal(has('PRACTICE_DIRECTOR'), true);
  for (const r of ['DIRECTOR', 'OFFICE_MANAGER', 'HR', 'BILLING']) assert.equal(has(r), false, r);
});
