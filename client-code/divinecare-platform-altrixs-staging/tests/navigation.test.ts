import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLINIC_ROLES } from '../src/types/roles';
import { canAccessPath, CLINIC_NAV_HREFS, shouldBlockDashboardPath } from '../src/lib/auth/roleAccess';
import {
  allNavPaths,
  breadcrumbsFor,
  buildNavForRole,
  chartClientId,
  hrefPath,
  isMedicalNavHref,
  NAV_SECTIONS,
  navSearchItems,
  pageTitleFor,
  SEARCH_ONLY_ITEMS,
  searchOnlyItemsForRole,
} from '../src/components/layout/navConfig';
import { AUTHORIZATIONS_PATH, LEGACY_ROUTE_REDIRECTS, legacyRedirectUrl } from '../src/components/layout/navRedirects';
import { mergeRecentClient, RECENT_CLIENTS_MAX } from '../src/components/layout/navStorage';
import { MEDICAL_CLIENTS_HREF } from '../src/lib/medical/medicalProgram';

const ALL_ROLES = [...CLINIC_ROLES, 'SUPER_ADMIN'] as const;

function hrefsFor(role: string) {
  return buildNavForRole(role).flatMap((s) => s.items.map((i) => i.href));
}

test('every visible nav link passes the page gate for every role (no bounces)', () => {
  for (const role of ALL_ROLES) {
    for (const href of hrefsFor(role)) {
      const path = hrefPath(href);
      assert.equal(canAccessPath(role, path), true, `${role} sees ${href} but canAccessPath denies it`);
      assert.equal(shouldBlockDashboardPath(role, path), false, `${role} sees ${href} but the layout would bounce it`);
    }
    for (const item of searchOnlyItemsForRole(role)) {
      assert.equal(canAccessPath(role, hrefPath(item.href)), true, `${role} search-only ${item.href}`);
    }
  }
});

test('known ADMIN bounces are hidden from the ADMIN sidebar', () => {
  const admin = hrefsFor('ADMIN');
  for (const href of ['/dashboard/ehr/scanner', '/dashboard/protected-records', '/clinician', '/platform']) {
    assert.ok(!admin.includes(href), `ADMIN should not see ${href}`);
  }
  assert.ok(hrefsFor('PRACTICE_DIRECTOR').includes('/dashboard/protected-records'));
  assert.ok(hrefsFor('THERAPIST').includes('/dashboard/ehr/scanner'));
  assert.deepEqual(hrefsFor('SUPER_ADMIN'), []);
});

test('areas render in the approved order', () => {
  assert.deepEqual(
    NAV_SECTIONS.map((s) => s.label),
    ['Home', 'Inbox', 'Schedule', 'Clients', 'Programs', 'Billing', 'Reports', 'Admin'],
  );
  const order = NAV_SECTIONS.map((s) => s.label);
  for (const role of ALL_ROLES) {
    const labels = buildNavForRole(role).map((s) => s.label);
    const idx = labels.map((l) => order.indexOf(l));
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${role} area order`);
  }
});

test('no duplicate links or labels in the sidebar', () => {
  const hrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate href');
  const labels = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.label));
  assert.equal(new Set(labels).size, labels.length, 'duplicate label');
  // One Labs / Mobile Crisis / Referrals / Eligibility link in the behavioral nav
  const behavioral = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => !isMedicalNavHref(i.href));
  assert.equal(behavioral.filter((i) => /lab/i.test(i.label)).length, 1);
  assert.equal(behavioral.filter((i) => i.href === '/dashboard/crisis').length, 1);
  assert.equal(behavioral.filter((i) => i.label === 'Referrals').length, 1);
  const eligibility = behavioral.find((i) => i.href === '/dashboard/ehr/eligibility');
  assert.equal(NAV_SECTIONS.find((s) => s.items.includes(eligibility!))?.label, 'Billing');
  // Merged prior-auth pages are not linked directly any more
  for (const old of Object.keys(LEGACY_ROUTE_REDIRECTS)) assert.ok(!hrefs.includes(old), old);
});

test('CLINIC_NAV_HREFS stays in sync with the nav config', () => {
  const expected = new Set([...allNavPaths(), ...SEARCH_ONLY_ITEMS.map((i) => hrefPath(i.href))]);
  assert.deepEqual(new Set(CLINIC_NAV_HREFS), expected);
});

test('every staff role gets the Inbox link', () => {
  for (const role of CLINIC_ROLES) {
    assert.equal(canAccessPath(role, '/dashboard/inbox'), true, role);
    assert.ok(hrefsFor(role).includes('/dashboard/inbox'), `${role} missing Inbox`);
  }
  assert.equal(canAccessPath('SUPER_ADMIN', '/dashboard/inbox'), false);
});

test('role-specific sidebars: HR home, medical providers, front desk', () => {
  const hr = buildNavForRole('HR');
  assert.equal(hr[0].items[0].href, '/dashboard/hr');
  assert.equal(hrefsFor('HR').filter((h) => h === '/dashboard/hr').length, 1);

  const physician = hrefsFor('PHYSICIAN');
  // One patient record (the shared chart), but the primary care sidebar lists primary care
  // patients only: no behavioral health client directory, no front-office payments / AutoPay
  assert.ok(!physician.includes('/dashboard/clients'));
  assert.ok(!physician.includes('/dashboard/billing/payments'));
  assert.ok(!physician.includes('/dashboard/billing/autopay'));
  assert.ok(!hrefsFor('MEDICAL_ASSISTANT').includes('/dashboard/clients'));
  assert.ok(physician.includes('/dashboard/medical/patients'), 'Primary care patients list');
  assert.ok(!physician.includes(MEDICAL_CLIENTS_HREF), 'primary care area no longer links to the client list filter');
  assert.ok(!physician.includes('/dashboard/alerts'));
  assert.ok(!physician.includes('/dashboard/ehr/notes'));
  assert.ok(physician.includes('/dashboard/medical'), 'Home links to the primary care overview');
  assert.ok(physician.includes('/dashboard/medical/visits'));
  assert.ok(!physician.includes('/dashboard/billing/superbills'), 'superbills are billing-staff work');
  assert.equal(buildNavForRole('MEDICAL_ASSISTANT')[0].items[0].href, '/dashboard/medical');

  assert.ok(!hrefsFor('THERAPIST').some((h) => h.startsWith('/dashboard/medical')));
  assert.ok(!hrefsFor('THERAPIST').includes(MEDICAL_CLIENTS_HREF));
  assert.ok(!hrefsFor('THERAPIST').includes('/dashboard/medical/patients'));

  const fd = hrefsFor('FRONT_DESK');
  assert.ok(fd.includes('/dashboard/billing/authorizations'));
  assert.ok(fd.includes('/dashboard/ehr/eligibility'));
  assert.ok(!fd.includes('/dashboard/billing/claims'));

  const billing = hrefsFor('BILLING');
  for (const href of ['/dashboard/billing/claims', '/dashboard/billing/clearinghouse', '/dashboard/billing/authorizations']) {
    assert.ok(billing.includes(href), `BILLING missing ${href}`);
  }
  assert.ok(!billing.includes('/dashboard/ehr/notes'));
});

test('merged prior-auth routes redirect to Authorizations and keep query params', () => {
  assert.equal(legacyRedirectUrl('/dashboard/billing/prior-auth'), `${AUTHORIZATIONS_PATH}?tab=electronic`);
  assert.equal(legacyRedirectUrl('/dashboard/prior-auth'), `${AUTHORIZATIONS_PATH}?tab=electronic`);
  assert.equal(legacyRedirectUrl('/dashboard/ehr/prior-auths'), `${AUTHORIZATIONS_PATH}?tab=tracking`);
  assert.equal(
    legacyRedirectUrl('/dashboard/ehr/prior-auths', { client: 'abc', status: ['pending', 'denied'], tab: 'x' }),
    `${AUTHORIZATIONS_PATH}?client=abc&status=pending&status=denied&tab=tracking`,
  );
  assert.equal(
    legacyRedirectUrl('/dashboard/billing/prior-auth', new URLSearchParams('payer=carelon')),
    `${AUTHORIZATIONS_PATH}?payer=carelon&tab=electronic`,
  );
  assert.throws(() => legacyRedirectUrl('/dashboard/nope'));

  for (const from of Object.keys(LEGACY_ROUTE_REDIRECTS)) {
    const file = readFileSync(join(__dirname, '..', 'src', 'app', ...from.split('/').filter(Boolean), 'page.tsx'), 'utf8');
    assert.ok(file.includes(`legacyRedirectUrl('${from}'`), `${from} page must be a redirect page`);
    assert.ok(file.includes("from 'next/navigation'") && file.includes('redirect('), from);
  }
});

test('Authorizations page is open to every role of both merged pages', () => {
  for (const role of CLINIC_ROLES) {
    const either =
      canAccessPath(role, '/dashboard/ehr/prior-auths') || canAccessPath(role, '/dashboard/billing/prior-auth');
    assert.equal(canAccessPath(role, AUTHORIZATIONS_PATH), either, role);
  }
});

test('breadcrumbs derive Area › Group › Page from the nav', () => {
  assert.deepEqual(breadcrumbsFor('/dashboard/ehr/notes').map((c) => c.label), ['Clients', 'Clinical worklists', 'Progress Notes']);
  assert.deepEqual(breadcrumbsFor('/dashboard/ehr/notes/new').map((c) => c.label), ['Clients', 'Clinical worklists', 'Progress Notes']);
  assert.deepEqual(breadcrumbsFor('/dashboard/billing/authorizations').map((c) => c.label), ['Billing', 'Clearinghouse', 'Authorizations']);
  assert.deepEqual(breadcrumbsFor('/dashboard/appointments').map((c) => c.label), ['Schedule', 'Calendar']);
  assert.deepEqual(breadcrumbsFor('/dashboard/inbox').map((c) => c.label), ['Inbox']);
  assert.deepEqual(breadcrumbsFor('/dashboard').map((c) => c.label), ['Home', 'Dashboard']);
  assert.deepEqual(breadcrumbsFor('/dashboard/settings').map((c) => c.label), ['Account', 'My profile']);
  assert.deepEqual(breadcrumbsFor('/dashboard/ehr').map((c) => c.label), ['Clients', 'EHR Overview']);
  assert.deepEqual(breadcrumbsFor('/somewhere/else'), []);
  assert.equal(pageTitleFor('/dashboard/ehr/healthlake'), 'Data exchange');
  assert.equal(pageTitleFor('/nope'), 'Altrixs');

  const chart = breadcrumbsFor('/dashboard/clients/c_123', { clientName: 'Jane Doe' });
  assert.deepEqual(chart.map((c) => c.label), ['Clients', 'Client list', 'Jane Doe']);
  assert.equal(chart[1].href, '/dashboard/clients');
  assert.deepEqual(breadcrumbsFor('/dashboard/clients/c_123/notes').map((c) => c.label), ['Clients', 'Client list', 'Client chart']);
  // Opened from the Primary care patients list (?from=medical): link back to that list
  const fromMedical = breadcrumbsFor('/dashboard/clients/c_123', { clientName: 'Jane Doe', from: 'medical' });
  assert.deepEqual(fromMedical.map((c) => c.label), ['Clients', 'Primary care patients', 'Jane Doe']);
  assert.equal(fromMedical[1].href, '/dashboard/medical/patients');
  assert.deepEqual(breadcrumbsFor('/dashboard/clients/c_123', { from: 'other' }).map((c) => c.label), ['Clients', 'Client list', 'Client chart']);
  assert.deepEqual(breadcrumbsFor('/dashboard/clients/waitlist').map((c) => c.label), ['Schedule', 'Waitlist']);

  assert.equal(chartClientId('/dashboard/clients/abc'), 'abc');
  assert.equal(chartClientId('/dashboard/clients/intake'), null);
  assert.equal(chartClientId('/dashboard/clients'), null);
});

test('renamed pages stay findable by their old names in command search', () => {
  const items = navSearchItems(NAV_SECTIONS);
  const find = (q: string) =>
    items.filter((i) => `${i.label} ${i.section} ${i.href} ${i.keywords ?? ''}`.toLowerCase().includes(q)).map((i) => i.label);
  assert.ok(find('healthlake').includes('Data exchange'));
  assert.ok(find('waystar').includes('Clearinghouse'));
  assert.ok(find('ehr migration').includes('Data import'));
  assert.ok(find('mbc').includes('Outcome measures'));
  assert.ok(find('outcome').includes('Outcome schedules'));
  assert.ok(find('service eligibility scanner').includes('Service Eligibility Scanner'));
  assert.ok(find('sud radar').includes('SUD Referral Radar'));
  assert.ok(find('valant balances').includes('Legacy balances (Valant)'));
  assert.ok(find('prior auth').includes('Authorizations'));
  assert.ok(!items.some((i) => i.label === 'Profile settings'));
});

test('recent clients keep only id/name/mrn, newest first, max 5', () => {
  let list: ReturnType<typeof mergeRecentClient> = [];
  for (let i = 0; i < 7; i += 1) list = mergeRecentClient(list, { id: `c${i}`, name: `Client ${i}`, mrn: `M${i}` });
  assert.equal(list.length, RECENT_CLIENTS_MAX);
  assert.equal(list[0].id, 'c6');
  list = mergeRecentClient(list, { id: 'c3', name: 'Client 3', mrn: 'M3' });
  assert.equal(list[0].id, 'c3');
  assert.equal(list.filter((c) => c.id === 'c3').length, 1);
  const withExtra = mergeRecentClient([], { id: 'x', name: ' Ann ', mrn: null, dob: '1990-01-01' } as never);
  assert.deepEqual(withExtra, [{ id: 'x', name: 'Ann', mrn: null }]);
  assert.deepEqual(mergeRecentClient([], { id: 'y', name: '' }), []);
});

test('Medical EHR area is folded into Clients / Billing / Admin', () => {
  assert.ok(!NAV_SECTIONS.some((s) => s.label === 'Medical EHR'));
  const where = (href: string) => {
    const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.href === href));
    const item = section?.items.find((i) => i.href === href);
    return section ? `${section.label}${item?.group ? `/${item.group}` : ''}` : null;
  };
  assert.equal(where('/dashboard/medical/patients'), 'Clients');
  assert.equal(NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === '/dashboard/medical/patients')?.label, 'Primary care patients');
  assert.equal(where(MEDICAL_CLIENTS_HREF), null, 'no sidebar link to /dashboard/clients?program=medical');
  assert.equal(where('/dashboard/medical/patients/intake'), 'Clients');
  for (const href of ['/dashboard/medical/visits', '/dashboard/medical/vitals', '/dashboard/medical/preventive-care', '/dashboard/medical/ai']) {
    assert.equal(where(href), 'Clients/Primary care', href);
  }
  assert.equal(where('/dashboard/medical/billing'), 'Billing');
  assert.equal(where('/dashboard/medical/payer-settings'), 'Admin/Payers & panels');
  // Billing staff now see medical billing; behavioral non-prescribers still do not see primary care links
  assert.ok(hrefsFor('BILLING').includes('/dashboard/medical/billing'));
  for (const role of ['FRONT_DESK', 'CASE_MANAGER', 'PEER_SUPPORT']) {
    assert.ok(!hrefsFor(role).some(isMedicalNavHref), role);
  }
  // Every linked medical worklist still has a page gate (no 404 / bounce for roles that see it)
  for (const role of ALL_ROLES) {
    for (const href of hrefsFor(role).filter(isMedicalNavHref)) assert.ok(canAccessPath(role, hrefPath(href)), `${role} ${href}`);
  }
});
