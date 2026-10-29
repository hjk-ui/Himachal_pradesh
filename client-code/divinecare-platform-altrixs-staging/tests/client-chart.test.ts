import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeAuthSummaries,
  ageOn,
  decideChartAccess,
  loadChartBanner,
  maskMemberId,
  shortDisplayName,
  summarizeAllergies,
  summarizeAuth,
  summarizeRisk,
  type AuthRow,
  type BannerClientRow,
  type ChartBanner,
  type ChartBannerSource,
  type LockedBanner,
  type SensitiveState,
} from '../src/lib/clients/chartBanner';
import { CHART_TABS, chartDocumentTitle, chartTabFromParam, resolveChartTab, type ChartTabKey } from '../src/components/chart/chartTabs';
import { dischargeCasesForClient, diagnosisRecordsForClient, safetyPlansForClient } from '../src/lib/clients/chartSections';

const NOW = new Date('2026-10-17T15:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

// ─── Fake data source: two orgs, one protected record ────────────────────────

const baseClient: BannerClientRow = {
  id: 'c1',
  name: 'Jane Doe',
  legalFirstName: 'Jane',
  middleInitial: 'Q',
  legalLastName: 'Doe',
  mrn: 'ALT-1',
  dateOfBirth: d('1990-10-18'),
  status: 'ACTIVE',
  riskLevel: 'LOW',
  assignedToId: 'u-ther',
  assignedToName: 'Dr. Therapist',
  locationName: 'Bowie',
  insurancePayer: 'Maryland Medicaid',
  insuranceMemberId: '123456789',
  primaryDiagnosis: 'Alcohol use disorder',
  primaryDiagnosisCode: 'F10.20',
  secondaryDiagnoses: null,
};

function source(opts: {
  sensitive?: Record<string, SensitiveState>;
  forwarded?: boolean;
  onBalance?: () => void;
  auths?: AuthRow[];
} = {}): ChartBannerSource {
  const clients: Record<string, BannerClientRow & { org: string }> = {
    c1: { ...baseClient, org: 'org-a' },
    c2: { ...baseClient, id: 'c2', name: 'Bob Other', org: 'org-b' },
    c3: { ...baseClient, id: 'c3', name: 'Pat Protected', org: 'org-a' },
  };
  return {
    async findClient(org, id) {
      const c = clients[id];
      return c && c.org === org ? c : null;
    },
    async sensitiveState(_v, id) {
      return opts.sensitive?.[id] ?? 'none';
    },
    async sensitiveAlias() {
      return 'Client P';
    },
    async hasForwardedThread() {
      return Boolean(opts.forwarded);
    },
    async allergies() {
      return [{ allergen: 'Penicillin', reaction: 'Hives', severity: 'Moderate', status: 'Active', source: 'drfirst' }];
    },
    async priorAuths() {
      return opts.auths ?? [];
    },
    async riskAlerts() {
      return [];
    },
    async latestCssrs() {
      return null;
    },
    async nextAppointment() {
      return null;
    },
    async balanceCents() {
      opts.onBalance?.();
      return 4500;
    },
    async sessionFrequency() {
      return { bucket: 'on_track', recommendation: 'Weekly', statusDetail: 'ok' };
    },
  };
}

const viewer = (role: string, userId = 'u-admin', billingVisible = true) => ({ organizationId: 'org-a', userId, role, billingVisible });

test('banner: other org client is not found (org scoping)', async () => {
  const r = await loadChartBanner(source(), viewer('ADMIN'), 'c2', NOW);
  assert.deepEqual(r, { ok: false, status: 404, reason: 'client_not_found' });
});

test('banner: roles without roster access are refused', async () => {
  const r = await loadChartBanner(source(), viewer('HR'), 'c1', NOW);
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.reason, 'role_not_permitted');
});

test('banner: caseload role sees own client, not others unless a thread was forwarded', async () => {
  const own = await loadChartBanner(source(), viewer('THERAPIST', 'u-ther'), 'c1', NOW);
  assert.equal(own.ok, true);
  const other = await loadChartBanner(source(), viewer('THERAPIST', 'u-someone'), 'c1', NOW);
  assert.equal(other.ok, false);
  if (other.ok === false) assert.equal(other.reason, 'not_on_caseload');
  const forwarded = await loadChartBanner(source({ forwarded: true }), viewer('THERAPIST', 'u-someone'), 'c1', NOW);
  assert.equal(forwarded.ok, true);
});

test('banner: Part 2 / protected record locked -> lock + alias only, no PHI', async () => {
  const r = await loadChartBanner(source({ sensitive: { c3: 'locked' } }), viewer('THERAPIST', 'u-ther'), 'c3', NOW);
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  const b = r.banner as LockedBanner;
  assert.equal(b.locked, true);
  assert.deepEqual(Object.keys(b).sort(), ['canRequestBreakGlass', 'displayName', 'id', 'locked']);
  assert.equal(b.displayName, 'Client P');
  assert.ok(!JSON.stringify(b).includes('Pat Protected'));
  assert.ok(!JSON.stringify(b).includes('ALT-1'));
});

test('banner: cleared protected record shows data with the protected flag; caseload check is satisfied by the clearance', async () => {
  const r = await loadChartBanner(source({ sensitive: { c3: 'allowed' } }), viewer('THERAPIST', 'u-someone'), 'c3', NOW);
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  const b = r.banner as ChartBanner;
  assert.equal(b.locked, false);
  assert.equal(b.protection.protectedRecord, true);
  assert.equal(b.protection.sudDiagnosis, true);
});

test('banner: fields, masking and billing visibility', async () => {
  let balanceCalls = 0;
  const src = source({ onBalance: () => balanceCalls++ });
  const r = await loadChartBanner(src, viewer('ADMIN'), 'c1', NOW);
  assert.equal(r.ok, true);
  const b = (r as { banner: ChartBanner }).banner;
  assert.equal(b.legalName, 'Doe, Jane Q.');
  assert.equal(b.shortName, 'Jane D.');
  assert.equal(b.age, 35); // birthday is tomorrow
  assert.equal(b.payer?.memberIdMasked, '•••• 6789');
  assert.ok(!JSON.stringify(b).includes('123456789'));
  assert.deepEqual(b.balance, { cents: 4500 });
  assert.equal(b.allergies.status, 'list');
  assert.equal(b.sessionFrequency?.bucket, 'on_track');
  assert.equal(balanceCalls, 1);

  const hidden = await loadChartBanner(src, viewer('THERAPIST', 'u-ther', false), 'c1', NOW);
  const hb = (hidden as { banner: ChartBanner }).banner;
  assert.equal(hb.balance, null);
  assert.equal(hb.billingVisible, false);
  assert.equal(balanceCalls, 1, 'balance is not even loaded for roles without billing access');
});

test('access rule: protected locked beats caseload; missing client is 404', async () => {
  assert.deepEqual(
    await decideChartAccess({ role: 'ADMIN', userId: 'x', client: null, sensitive: 'none', hasForwardedThread: () => false }),
    { ok: false, status: 404, reason: 'client_not_found' }
  );
  const locked = await decideChartAccess({ role: 'THERAPIST', userId: 'u', client: { assignedToId: 'u' }, sensitive: 'locked', hasForwardedThread: () => true });
  assert.equal(locked.ok, false);
});

// ─── Authorization math ──────────────────────────────────────────────────────

const auth = (o: Partial<AuthRow>): AuthRow => ({
  id: 'a',
  payer: 'Medicaid',
  authNumber: 'PA1',
  cptCodes: ['90837'],
  unitsApproved: 12,
  unitsUsed: 4,
  status: 'APPROVED',
  startDate: d('2026-09-01'),
  endDate: d('2026-12-31'),
  ...o,
});

test('auth: remaining visits, days to end, and warnings', () => {
  const ok = summarizeAuth(auth({}), NOW);
  assert.equal(ok.unitsRemaining, 8);
  assert.equal(ok.daysToEnd, 75);
  assert.equal(ok.warn, false);

  const low = summarizeAuth(auth({ unitsUsed: 10 }), NOW);
  assert.equal(low.unitsRemaining, 2);
  assert.equal(low.lowVisits, true);
  assert.equal(low.warn, true);

  const three = summarizeAuth(auth({ unitsUsed: 9 }), NOW);
  assert.equal(three.unitsRemaining, 3);
  assert.equal(three.lowVisits, false, 'exactly 3 left is not "fewer than 3"');

  const ending = summarizeAuth(auth({ endDate: d('2026-10-31') }), NOW);
  assert.equal(ending.daysToEnd, 14);
  assert.equal(ending.endingSoon, true);
  const notYet = summarizeAuth(auth({ endDate: d('2026-11-01') }), NOW);
  assert.equal(notYet.endingSoon, false);

  const over = summarizeAuth(auth({ unitsUsed: 15 }), NOW);
  assert.equal(over.unitsRemaining, 0, 'never negative');

  const open = summarizeAuth(auth({ endDate: null }), NOW);
  assert.equal(open.daysToEnd, null);
  assert.equal(open.endingSoon, false);
});

test('auth: only approved auths in their window count; soonest-ending first', () => {
  const rows = [
    auth({ id: 'late', endDate: d('2027-03-01') }),
    auth({ id: 'soon', endDate: d('2026-11-15') }),
    auth({ id: 'denied', status: 'DENIED' }),
    auth({ id: 'expired', endDate: d('2026-10-16') }),
    auth({ id: 'future', startDate: d('2026-11-01') }),
    auth({ id: 'endsToday', endDate: d('2026-10-17') }),
  ];
  assert.deepEqual(activeAuthSummaries(rows, NOW).map((a) => a.id), ['endsToday', 'soon', 'late']);
});

// ─── Allergies / risk / helpers ──────────────────────────────────────────────

test('allergies: NKA only when charted, otherwise "none"', () => {
  assert.deepEqual(summarizeAllergies([]), { status: 'none' });
  assert.deepEqual(summarizeAllergies([{ allergen: 'NKDA', reaction: null, severity: null, status: 'Active', source: null }]), { status: 'nka' });
  assert.deepEqual(summarizeAllergies([{ allergen: 'Sulfa', reaction: null, severity: null, status: 'Inactive', source: null }]), { status: 'none' });
  const list = summarizeAllergies([
    { allergen: 'NKA', reaction: null, severity: null, status: 'Active', source: null },
    { allergen: 'Latex', reaction: 'Rash', severity: 'Mild', status: 'Active', source: 'drfirst' },
  ]);
  assert.equal(list.status, 'list');
});

test('risk: unreviewed alerts and safety-flagged C-SSRS raise the level', () => {
  assert.equal(summarizeRisk({ riskLevel: 'LOW', alerts: [], latestCssrs: null }).level, 'low');
  const alerts = [
    { id: '1', type: 'low_mood', severity: 'MEDIUM', reviewed: false, createdAt: d('2026-10-10') },
    { id: '2', type: 'crisis_keywords', severity: 'HIGH', reviewed: true, createdAt: d('2026-10-12') },
  ];
  const r = summarizeRisk({ riskLevel: 'LOW', alerts, latestCssrs: null });
  assert.equal(r.level, 'medium');
  assert.equal(r.openAlerts, 1);
  assert.equal(r.latestAlert?.id, '2');
  const c = summarizeRisk({ riskLevel: 'LOW', alerts: [], latestCssrs: { id: 'c', instrumentName: 'C-SSRS', totalScore: 3, severity: 'High', safetyFlagged: true, createdAt: d('2026-10-01') } });
  assert.equal(c.level, 'high');
});

test('helpers: member id masking, age, short name', () => {
  assert.equal(maskMemberId(null), null);
  assert.equal(maskMemberId('12'), '•••• 12');
  assert.equal(maskMemberId('AB 1234 5678'), '•••• 5678');
  assert.equal(ageOn(d('2000-10-17'), NOW), 26);
  assert.equal(ageOn(null, NOW), null);
  assert.equal(shortDisplayName({ name: 'mary ann smith' }), 'mary S.');
  assert.equal(chartDocumentTitle('Jane D.'), 'Jane D. · Client chart · Altrixs');
});

// ─── Tab routing ─────────────────────────────────────────────────────────────

test('tabs: ?tab= deep links, legacy names and aliases', () => {
  assert.equal(chartTabFromParam('labs'), 'labs');
  assert.equal(chartTabFromParam('Measures'), 'assessments');
  assert.equal(chartTabFromParam('Insurance'), 'billing');
  assert.equal(chartTabFromParam('Eligibility'), 'billing');
  assert.equal(chartTabFromParam('Alerts'), 'safety');
  assert.equal(chartTabFromParam('Consents'), 'documents');
  assert.equal(chartTabFromParam('Office Notes'), 'office-notes');
  assert.equal(chartTabFromParam('Medications & eRx'), 'medications');
  assert.equal(chartTabFromParam('nope'), null);
  assert.equal(chartTabFromParam(null), null);
});

test('tabs: hidden or unknown tabs fall back to Summary', () => {
  const visible: ChartTabKey[] = ['summary', 'check-ins'];
  assert.equal(resolveChartTab('check-ins', visible), 'check-ins');
  assert.equal(resolveChartTab('access-log', visible), 'summary');
  assert.equal(resolveChartTab('garbage', visible), 'summary');
  assert.equal(resolveChartTab(undefined, visible), 'summary');
});

test('tabs: keys and aliases are unique', () => {
  const all = CHART_TABS.flatMap((t) => [t.key, ...t.aliases]);
  assert.equal(new Set(all).size, all.length);
  assert.equal(CHART_TABS[0].key, 'summary');
});

// ─── Practice module lists filtered per client ───────────────────────────────

test('module lists: safety plans by clientId only; discharge and diagnoses by name (+DOB)', () => {
  const c = { id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', legalLastName: 'Doe', dateOfBirth: d('1990-10-18') };
  const plans = safetyPlansForClient(
    [{ id: 'p1', clientId: 'c1' }, { id: 'p2', clientId: 'c9' }, { id: 'p3', clientName: 'Jane Doe' }],
    c
  );
  assert.deepEqual(plans.matched.map((p) => p.id), ['p1']);
  assert.equal(plans.unlinkedCount, 1);

  const cases = dischargeCasesForClient(
    [
      { id: 'd1', clientName: 'jane  doe', dob: '1990-10-18' },
      { id: 'd2', clientName: 'Jane Doe', dob: '1985-01-01' },
      { id: 'd3', clientName: 'Doe, Jane' },
      { id: 'd4', clientName: 'John Roe' },
    ],
    c
  );
  assert.deepEqual(cases.map((x) => x.id), ['d1', 'd3']);

  assert.deepEqual(
    diagnosisRecordsForClient([{ id: 'x', client: 'Jane Doe' }, { id: 'y', client: 'Jane Do' }, null, 'junk'], c).map((x) => x.id),
    ['x']
  );
  assert.deepEqual(safetyPlansForClient(null, c), { matched: [], unlinkedCount: 0 });
});
