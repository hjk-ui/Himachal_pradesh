import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { MARKETING_HUB_TABS, LEAD_STAGES, LEAD_SOURCES, MARKETING_HUB_DESCRIPTION, MARKETING_HIPAA_BADGE } from '../src/lib/marketing/constants';
import { HR_HUB_TABS, HR_DASHBOARD_TITLE, HR_DASHBOARD_DESCRIPTION } from '../src/lib/hr/constants';
import { resolvePayerHintDisplay, INSURANCE_NOT_MATCHED_LABEL, PAYER_MISMATCH_LABEL } from '../src/lib/appointments/payerHint';
import { CLICK_HINT_DAY, CLICK_HINT_WEEK } from '../src/lib/appointments/calendarSlots';

const root = process.cwd();

test('Marketing hub has exact 10 tabs', () => {
  assert.equal(MARKETING_HUB_TABS.length, 10);
  assert.deepEqual(
    MARKETING_HUB_TABS.map((t) => t.label),
    [
      'Overview',
      'Leads & inbox',
      'Web forms',
      'Automations',
      'Reputation',
      'Campaigns',
      'Social & content',
      'Partners & events',
      'Analytics',
      'Settings',
    ]
  );
  assert.match(MARKETING_HUB_DESCRIPTION, /HIPAA, TCPA and CAN-SPAM/);
  assert.equal(MARKETING_HIPAA_BADGE, 'HIPAA-safe marketing');
  assert.ok(fs.existsSync(path.join(root, 'src/app/dashboard/marketing/page.tsx')));
  assert.ok(fs.existsSync(path.join(root, 'src/app/dashboard/marketing/leads/page.tsx')));
});

test('Lead stages and sources exact', () => {
  assert.deepEqual([...LEAD_STAGES], [
    'New',
    'Contacted',
    'Screening',
    'Insurance verified',
    'Scheduled',
    'Converted to client',
    'Not a fit',
    'Lost',
  ]);
  assert.ok(LEAD_SOURCES.includes('Website form'));
  assert.ok(LEAD_SOURCES.includes('Therapist listing site'));
});

test('HR hub has exact Oct 22 tab set', () => {
  assert.deepEqual(
    HR_HUB_TABS.map((t) => t.label),
    [
      'Dashboard',
      'People',
      'Credentialing',
      'Onboarding',
      'Offboarding',
      'Training',
      'Time off',
      'Performance',
      'Supervision',
      'Org chart',
      'Homebase',
      'Settings',
      'My HR',
    ]
  );
  assert.equal(HR_DASHBOARD_TITLE, 'HR dashboard');
  assert.match(HR_DASHBOARD_DESCRIPTION, /Reminders appear in Altrixs only; no email is sent/);
  const hrLabels = new Set<string>(HR_HUB_TABS.map((t) => t.label));
  assert.equal(hrLabels.has('Payroll'), false);
  assert.equal(hrLabels.has('Benefits'), false);
});

test('Design tokens: blue-600 remap and Button variants', () => {
  const tw = fs.readFileSync(path.join(root, 'tailwind.config.js'), 'utf8');
  assert.match(tw, /600:\s*'#5C2D91'/);
  assert.match(tw, /700:\s*'#4A2475'/);
  assert.match(tw, /50:\s*'#F5F3FF'/);
  assert.match(tw, /900:\s*'#141C34'/);
  const btn = fs.readFileSync(path.join(root, 'src/components/ui/Button.tsx'), 'utf8');
  assert.match(btn, /bg-blue-600/);
  assert.match(btn, /border border-slate-300/);
  assert.match(btn, /hover:bg-slate-100/);
  assert.match(btn, /bg-rose-700/);
  const shell = fs.readFileSync(path.join(root, 'src/components/layout/DashboardShell.tsx'), 'utf8');
  assert.match(shell, /bg-blue-900/);
});

test('Edit sign-in email modal CTAs + POST /api/staff/:id/email', () => {
  const admin = fs.readFileSync(path.join(root, 'src/app/dashboard/admin/page.tsx'), 'utf8');
  assert.match(admin, /Edit sign-in email/);
  assert.match(admin, /Save and resend invite/);
  assert.match(admin, /Save email/);
  assert.match(admin, /hasn't accepted their invite yet/);
  assert.match(admin, /Deactivate \$\{s\.name \|\| s\.email\}\? They will not be able to log in\./);
  assert.ok(fs.existsSync(path.join(root, 'src/app/api/staff/[id]/email/route.ts')));
});

test('Calendar exact strings', () => {
  const page = fs.readFileSync(path.join(root, 'src/app/dashboard/appointments/page.tsx'), 'utf8');
  assert.equal(CLICK_HINT_DAY, 'Click an empty time to book');
  assert.equal(CLICK_HINT_WEEK, 'Click an empty spot to book on this day');
  assert.match(page, /CLICK_HINT_DAY/);
  assert.match(page, /CLICK_HINT_WEEK/);
  assert.equal(/Double-click to book on this day/.test(page), false);
  assert.equal(/Double-click an empty time to book/.test(page), false);
  assert.match(page, /Search name, MRN, phone or Valant code/);
  assert.match(page, /No active client matches\. New patient\? Use Clients › New intake\./);
  assert.match(page, /Client, online booking page/);
});

test('Payer hint neutral vs red', () => {
  assert.equal(resolvePayerHintDisplay('Maryland Medicaid').label, INSURANCE_NOT_MATCHED_LABEL);
  assert.equal(resolvePayerHintDisplay('Maryland Medicaid').tone, 'neutral');
  // Known payer id label exact match
  const known = resolvePayerHintDisplay('Medicare Part B (Traditional)');
  assert.equal(known.tone, 'ok');
  const mismatch = resolvePayerHintDisplay('Medicare Part B (Traditional)', ['Aetna']);
  assert.equal(mismatch.label, PAYER_MISMATCH_LABEL);
  assert.equal(mismatch.tone, 'danger');
});

test('Valant rematch button + confirm copy', () => {
  const ui = fs.readFileSync(path.join(root, 'src/components/ehr/DocumentIntakeUpload.tsx'), 'utf8');
  assert.match(ui, /Re-run with updated matching/);
  assert.match(
    ui,
    /Documents in the review queue whose client folder now matches exactly are filed to that chart/
  );
  assert.match(ui, /Re-running with updated matching/);
  assert.match(ui, /Read with 7-Zip \(Deflate64\)/);
});

test('OM patient-side billing ACL', () => {
  const access = fs.readFileSync(path.join(root, 'src/lib/auth/roleAccess.ts'), 'utf8');
  assert.match(access, /prefix: '\/dashboard\/billing\/valant-balances',\s*roles: BILLING_AR_ROLES/);
  assert.match(access, /PATIENT_BILLING_OFFICE_ROLES/);
  assert.match(access, /'\/dashboard\/billing\/payments'/);
  assert.match(access, /'\/dashboard\/billing\/autopay'/);
});

test('Nav: Growth & Marketing group links', () => {
  const shell = fs.readFileSync(path.join(root, 'src/components/layout/DashboardShell.tsx'), 'utf8');
  assert.match(shell, /label: 'Marketing hub'/);
  assert.match(shell, /label: 'Lead inbox'/);
  assert.match(shell, /label: 'PR & Marketing'/);
  assert.match(shell, /href: '\/dashboard\/marketing'/);
});
