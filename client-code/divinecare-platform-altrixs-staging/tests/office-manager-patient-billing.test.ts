/**
 * 2026-10-22 owner decision: the Office Manager gets PATIENT-SIDE billing only. Payer A/R, claims,
 * denials, fees, payer settings, provider revenue and legacy (Valant) balances belong to Billing and
 * leadership (ADMIN, DIRECTOR, PRACTICE_DIRECTOR). Office Manager keeps patient payments / copays,
 * eStatements, AutoPay, eligibility, authorizations, the patient ledger at Front Desk's level and
 * the front-office copay figures. See docs/role-access-matrix.md.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Role } from '@prisma/client';
import { canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';
import { buildNavForRole } from '../src/components/layout/navConfig';
import {
  canReadBillingQueue,
  canReadDenials,
  isPatientPaymentOnlyRole,
  medicalChargeReadScope,
  paymentMethodsFor,
  paymentPostDecision,
} from '../src/lib/billing/billingAccess';
import { canPostValantLedger } from '../src/lib/billing/patientLedgerMath';
import { canReadLedger } from '../src/lib/billing/ledger';
import { canViewCopayRules, canViewValantBalances } from '../src/lib/billing/valantBalances';
import { canViewBillingOverview } from '../src/lib/billing/overviewValant';
import { canViewBillingArchive } from '../src/lib/migration/valantDocuments';
import { canReadCharges } from '../src/lib/intensive/access';
import { canUseClinicModule } from '../src/lib/modules/access';
import { REPORTS } from '../src/lib/reports/library/registry';
import { reportsForRole } from '../src/lib/reports/library/access';

const OM = 'OFFICE_MANAGER';
const LEADERSHIP_AND_BILLING = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'] as const;
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const KEEPS_PAGES = [
  '/dashboard/billing/payments',
  '/dashboard/billing/statements',
  '/dashboard/billing/autopay',
  '/dashboard/billing/authorizations',
  '/dashboard/billing/prior-auth',
  '/dashboard/prior-auth',
  '/dashboard/ehr/eligibility',
];

const LOSES_PAGES = [
  '/dashboard/billing',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/billing/claims',
  '/dashboard/billing/clearinghouse',
  '/dashboard/billing/denials',
  '/dashboard/billing/provider-collections',
  '/dashboard/billing/valant-balances',
  '/dashboard/billing/fee-schedule',
  '/dashboard/billing/payer-settings',
  '/dashboard/billing/insurance-companies',
  '/dashboard/billing/panels',
  '/dashboard/billing/superbills',
  '/dashboard/billing/residential-crisis',
  '/dashboard/programs/intensive/billing',
  '/dashboard/medical/billing',
  '/dashboard/medical/payer-settings',
  '/dashboard/reports/outcomes',
];

test('pages: Office Manager keeps patient-side billing, loses payer / revenue billing', () => {
  for (const p of KEEPS_PAGES) assert.equal(canAccessPath(OM, p), true, `OM keeps ${p}`);
  for (const p of LOSES_PAGES) assert.equal(canAccessPath(OM, p), false, `OM loses ${p}`);
  // Nobody else lost anything: leadership + billing still open every payer page
  for (const r of LEADERSHIP_AND_BILLING) {
    for (const p of LOSES_PAGES.filter((x) => x !== '/dashboard/reports/outcomes' && !x.startsWith('/dashboard/medical'))) {
      assert.equal(canAccessPath(r, p), true, `${r} ${p}`);
    }
  }
  // Front Desk unchanged: payments + AutoPay, no statements
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/autopay'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/statements'), false);
});

test('proxy API gates: payer / revenue billing APIs refuse Office Manager; patient-side APIs pass', () => {
  const denied: [string, string][] = [
    ['GET', '/api/billing/overview'],
    ['GET', '/api/billing/ar'],
    ['POST', '/api/billing/ar/action'],
    ['GET', '/api/billing/ar/valant'],
    ['GET', '/api/billing/claim-scrub'],
    ['GET', '/api/billing/denials'],
    ['POST', '/api/billing/appeals/draft'],
    ['GET', '/api/billing/provider-collections'],
    ['GET', '/api/billing/valant-archive'],
    ['GET', '/api/billing/residential-crisis'],
    ['GET', '/api/billing/specialized'],
    ['GET', '/api/billing/insurance-companies'],
    ['GET', '/api/intensive/charges'],
    ['GET', '/api/medical/billing/charges'],
    ['GET', '/api/medical/payer-settings'],
  ];
  for (const [m, p] of denied) {
    assert.equal(canAccessApiPath(OM, p, m), false, `OM ${m} ${p}`);
    for (const r of LEADERSHIP_AND_BILLING) assert.equal(canAccessApiPath(r, p, m), true, `${r} ${m} ${p}`);
  }
  const allowed: [string, string][] = [
    ['GET', '/api/billing/payments'],
    ['POST', '/api/billing/payments'],
    ['GET', '/api/billing/statements'],
    ['POST', '/api/billing/statements/x/send'],
    ['GET', '/api/billing/autopay'],
    ['GET', '/api/billing/prior-auth'],
    ['GET', '/api/billing/patient-balance/c1'],
    ['GET', '/api/billing/valant-balances/copay-for'],
    ['GET', '/api/eligibility'],
  ];
  for (const [m, p] of allowed) assert.equal(canAccessApiPath(OM, p, m), true, `OM ${m} ${p}`);
});

test('route helpers: no queues, A/R, scrubber, Valant posting, archive, overview or IOP charges for OM', () => {
  assert.equal(canReadBillingQueue(OM), false);
  assert.equal(canReadDenials(OM), false);
  // arControl.ts / claimScrubber.ts / statements.ts are server-only modules: check their role lists in source
  assert.match(src('src/lib/billing/arControl.ts'), /const AR_ROLES: Role\[\] = \['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'\];/);
  assert.match(src('src/lib/billing/claimScrubber.ts'), /const SCRUB_ROLES: Role\[\] = \['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'\];/);
  assert.equal(canPostValantLedger(OM), false);
  assert.equal(canViewValantBalances(OM), false);
  assert.equal(canViewBillingArchive(OM), false);
  assert.equal(canViewBillingOverview(OM), false);
  assert.equal(canReadCharges(OM), false);
  assert.equal(medicalChargeReadScope(OM), null);
  for (const r of LEADERSHIP_AND_BILLING) {
    assert.equal(canReadBillingQueue(r), true, r);
    assert.equal(canPostValantLedger(r), true, r);
    assert.equal(canViewBillingArchive(r), true, r);
  }
  // requireBillingSession (Waystar batch claims): billing + leadership only
  assert.doesNotMatch(src('src/lib/billing/requireBillingSession.ts'), /OFFICE_MANAGER/);
  assert.doesNotMatch(src('src/app/api/waystar/inbound/route.ts'), /OFFICE_MANAGER/);
  assert.doesNotMatch(src('src/app/api/waystar/remits/review/route.ts'), /OFFICE_MANAGER/);
  assert.doesNotMatch(src('src/app/api/medical/payer-settings/route.ts'), /OFFICE_MANAGER/);
});

test('patient-side helpers: OM matches Front Desk for patient payments, ledger and copays; keeps statements', () => {
  for (const r of [OM, 'FRONT_DESK'] as const) {
    assert.equal(isPatientPaymentOnlyRole(r), true, r);
    assert.deepEqual(paymentMethodsFor(r), ['CARD', 'ACH', 'CASH', 'CHECK'], r);
    assert.deepEqual(paymentPostDecision(r, { method: 'CASH' }), { ok: true, scope: 'patient' }, r);
    assert.equal(paymentPostDecision(r, { method: 'INSURANCE' }).ok, false, r);
    assert.equal(paymentPostDecision(r, { method: 'CARD', claimId: 'c1' }).ok, false, r);
    assert.equal(canReadLedger(r as Role), true, r);
    assert.equal(canViewCopayRules(r), true, r);
  }
  assert.match(src('src/lib/billing/statements.ts'), /const STATEMENT_ROLES: Role\[\] = \[[^\]]*'OFFICE_MANAGER'/);
});

test('clinic modules: OM keeps invoices / AutoPay, loses claims, denials, EOBs, superbills, panels', () => {
  for (const m of ['invoices', 'autopay-clients', 'autopay-charges', 'prior-auth']) assert.equal(canUseClinicModule(OM, m), true, m);
  for (const m of ['billing-claims', 'denials', 'billing-eobs', 'superbills', 'payer-panels']) assert.equal(canUseClinicModule(OM, m), false, m);
  // Front Desk and Billing unchanged
  assert.equal(canUseClinicModule('FRONT_DESK', 'superbills'), true);
  assert.equal(canUseClinicModule('BILLING', 'payer-panels'), true);
  assert.equal(canUseClinicModule('BILLING', 'billing-claims'), true);
});

test('sidebar: OM billing links are payments, statements, AutoPay and authorizations only', () => {
  const hrefs = new Set(buildNavForRole(OM).flatMap((s) => s.items.map((i) => i.href.split(/[?#]/)[0])));
  for (const h of ['/dashboard/billing/payments', '/dashboard/billing/statements', '/dashboard/billing/autopay', '/dashboard/billing/authorizations', '/dashboard/ehr/eligibility']) {
    assert.ok(hrefs.has(h), h);
  }
  for (const h of LOSES_PAGES) assert.ok(!hrefs.has(h), h);
});

test('report library: OM runs no financial / A-R / payer report; keeps operational ones', () => {
  const om = new Set(reportsForRole(REPORTS, OM).map((r) => r.id));
  for (const r of REPORTS.filter((x) => x.category === 'billing' && x.id !== 'prior-auth-utilization')) {
    assert.ok(!om.has(r.id), r.id);
  }
  assert.ok(om.has('prior-auth-utilization'));
  for (const id of ['appointment-volume', 'no-show-late-cancel', 'waitlist']) assert.ok(om.has(id), id);
});

test('docs: role access matrix records the owner decision', () => {
  assert.match(src('docs/role-access-matrix.md'), /2026-10-22 owner: Office Manager patient-side billing only/);
});
