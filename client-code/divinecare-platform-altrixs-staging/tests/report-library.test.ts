/**
 * Report library: registry integrity, role filtering, parameters, CSV injection safety, small-cell
 * suppression, RCM / scheduling / documentation formulas, and the audit trail of run / export.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_LINKS, REPORTS, getReport, reportMeta, type ReportDefinition } from '../src/lib/reports/library/registry';
import { REPORT_CATEGORIES, type ReportOutput, type ResolvedParams } from '../src/lib/reports/library/types';
import { canRunReport, isClinicalViewer, reportsForRole, REPORT_EXCLUDED_PROVIDER_ROLES } from '../src/lib/reports/library/access';
import { REPORT_LIBRARY_ROLES, canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';
import { addDaysYmd, describeParams, parsePaging, practiceDayStart, presetRange, rawFromSearchParams, resolveReportParams } from '../src/lib/reports/library/params';
import { buildCsv, csvCellFor, csvSafeText, displayCell } from '../src/lib/reports/library/exportFormat';
import { applySmallCellSuppression, suppressKpis, suppressRows } from '../src/lib/reports/library/suppression';
import {
  AGING_BUCKETS,
  addAging,
  addApptStatus,
  agingBucket,
  bookedTotal,
  claimOutstandingCents,
  classifyPlan,
  cleanClaimRate,
  daysInAr,
  denialRate,
  emptyAging,
  emptyApptCounts,
  grossCollectionRate,
  keptRate,
  lateCancelRate,
  netCollectionRate,
  noShowRate,
  noteTimeliness,
  pct,
  reliableChange,
  RELIABLE_CHANGE,
  unsignedAgingBucket,
} from '../src/lib/reports/library/formulas';
import { executeReport, parseSort, sortRows, REPORT_ROW_CAP, type AuditWriter } from '../src/lib/reports/library/execute';
import { pdfSafe } from '../src/lib/reports/library/exportFiles';
import type { ReportContext } from '../src/lib/reports/library/context';
import { nextScheduledRun, savedParamsFor, savedReportPath, scheduleLabel, scheduledEmail } from '../src/lib/reports/library/schedule';

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-10-19T15:00:00.000Z'); // 11:00 ET, Monday

// ─── Registry integrity ──────────────────────────────────────────────────────

test('registry: every report is complete (category, roles, definitions, sources, params, output, run)', () => {
  const ids = new Set<string>();
  const cats = new Set(REPORT_CATEGORIES.map((c) => c.id as string));
  assert.ok(REPORTS.length >= 45, `expected a full catalog, got ${REPORTS.length}`);
  for (const r of REPORTS) {
    assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id ${r.id}`);
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(cats.has(r.category), `${r.id}: category`);
    assert.ok(r.title.trim().length > 3, `${r.id}: title`);
    assert.ok(r.description.trim().length > 20, `${r.id}: description`);
    assert.ok(r.definitions.length >= 1, `${r.id}: definitions`);
    for (const [k, v] of r.definitions) assert.ok(k.trim() && v.trim().length > 5, `${r.id}: definition ${k}`);
    assert.ok(r.dataSources.length >= 1, `${r.id}: data sources`);
    assert.ok(r.access.roles.length >= 1, `${r.id}: roles`);
    assert.ok(r.output === 'patient' || r.output === 'aggregate', `${r.id}: output`);
    assert.equal(typeof r.run, 'function', `${r.id}: run`);
    if (r.suppressSmallCells) assert.equal(r.output, 'aggregate', `${r.id}: suppression only applies to aggregate reports`);
    const keys = new Set<string>();
    for (const p of r.params) {
      assert.ok(!keys.has(p.key), `${r.id}: duplicate param ${p.key}`);
      keys.add(p.key);
      if (p.kind === 'select') assert.ok(p.options.some((o) => o.value === p.default), `${r.id}: ${p.key} default not an option`);
    }
    if (r.link) assert.match(r.link.href, /^\/dashboard\//, `${r.id}: link`);
    assert.equal(getReport(r.id), r);
    assert.ok(!('run' in reportMeta(r)), `${r.id}: run() must not leave the server`);
  }
  for (const c of REPORT_CATEGORIES) assert.ok(REPORTS.some((r) => r.category === c.id), `no report in ${c.id}`);
});

test('registry: every report role is inside the library page / API gate, and links point at real pages', () => {
  for (const r of REPORTS) {
    for (const role of r.access.roles) {
      if (REPORT_EXCLUDED_PROVIDER_ROLES.has(role)) continue; // providers never run practice reports
      assert.ok((REPORT_LIBRARY_ROLES as string[]).includes(role), `${r.id}: ${role} cannot open the library`);
      assert.equal(canAccessPath(role, '/dashboard/reports'), true, `${r.id}: ${role} page`);
      assert.equal(canAccessApiPath(role, '/api/reports/library/x/run', 'POST'), true, `${r.id}: ${role} api`);
    }
  }
  for (const l of LIBRARY_LINKS) {
    const page = path.join(ROOT, 'src', 'app', ...l.href.split('/').filter(Boolean), 'page.tsx');
    assert.ok(fs.existsSync(page), `link ${l.id}: ${l.href} has no page`);
  }
});

test('registry: every lazy runner the registry calls is exported by its runners file', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'reports', 'library', 'registry.ts'), 'utf8');
  const calls = [...src.matchAll(/(operational|clinical|billing|programs|compliance)\(\)\.then\(\(m\) => m\.(run\w+)\(/g)];
  assert.equal(calls.length, REPORTS.length, 'one runner call per report');
  for (const [, file, fn] of calls) {
    const runner = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'reports', 'library', 'runners', `${file}.ts`), 'utf8');
    assert.match(runner, new RegExp(`export async function ${fn}\\(`), `${file}.ts must export ${fn}`);
  }
});

test('runners: no string-built SQL (Prisma.sql / tagged templates only)', () => {
  const dir = path.join(ROOT, 'src', 'lib', 'reports', 'library', 'runners');
  for (const f of fs.readdirSync(dir)) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(s, /\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/, `${f} uses unsafe raw SQL`);
  }
});

// ─── Role filtering ──────────────────────────────────────────────────────────

const ids = (role: string, caps?: { medicalDirector?: boolean }) => new Set(reportsForRole(REPORTS, role, caps).map((r) => r.id));

test('role filtering: billing gets RCM reports, never clinical patient-level reports', () => {
  const b = ids('BILLING');
  for (const id of ['ar-aging', 'denials', 'unbilled-encounters', 'patient-balances', 'charges-payments-adjustments', 'net-collection-rate', 'days-in-ar', 'payer-mix']) assert.ok(b.has(id), id);
  for (const id of ['treatment-plan-status', 'cssrs-safety-plans', 'unsigned-notes', 'phi-access', 'no-future-appointment', 'measurement-based-care']) assert.ok(!b.has(id), id);
  // carelon-attestation-status: Carelon (PBHS) authorization paperwork, run by billing too (no clinical content)
  for (const r of REPORTS.filter((x) => b.has(x.id))) assert.ok(r.category === 'billing' || r.id === 'residential-census' || r.id === 'carelon-attestation-status', `${r.id} for billing`);
});

test('role filtering: Office Manager runs operational reports and prior-auth utilization, no financial / A-R / payer report (2026-10-22)', () => {
  const om = ids('OFFICE_MANAGER');
  for (const r of REPORTS.filter((x) => x.category === 'billing')) {
    assert.equal(om.has(r.id), r.id === 'prior-auth-utilization', r.id);
  }
  for (const id of ['appointment-volume', 'no-show-late-cancel', 'cancellations', 'waitlist', 'active-census', 'incidents-grievances']) assert.ok(om.has(id), id);
  for (const id of ['ar-aging', 'days-in-ar', 'net-collection-rate', 'denials', 'payer-mix', 'patient-balances', 'charges-payments-adjustments', 'era-exceptions']) assert.ok(!om.has(id), id);
  // Library links follow their page rule: no A/R, revenue or provider collections tiles for OM
  for (const l of LIBRARY_LINKS.filter((x) => x.category === 'billing')) assert.equal(canAccessPath('OFFICE_MANAGER', l.gatePath), false, l.id);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/provider-collections'), true);
});

test('role filtering: providers run no practice reports; a verified Medical Director runs the clinical ones', () => {
  for (const role of ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT']) {
    assert.equal(ids(role).size, 0, role);
  }
  const md = ids('PSYCHIATRIST', { medicalDirector: true });
  for (const id of ['treatment-plan-status', 'measurement-based-care']) assert.ok(md.has(id), id);
  for (const r of REPORTS.filter((x) => x.category === 'billing' || x.category === 'compliance')) assert.ok(!md.has(r.id), r.id);
});

test('role filtering: HIPAA access / break-the-glass / Part 2 are ADMIN + PRACTICE_DIRECTOR only', () => {
  for (const id of ['phi-access', 'break-the-glass', 'part2-disclosures']) {
    assert.ok(ids('ADMIN').has(id), id);
    assert.ok(ids('PRACTICE_DIRECTOR').has(id), id);
    for (const role of ['DIRECTOR', 'OFFICE_MANAGER', 'BILLING', 'HR', 'THERAPIST', 'PSYCHIATRIST']) assert.ok(!ids(role).has(id), `${role} ${id}`);
  }
});

test('role filtering: HR sees staff reports only; front desk gets schedule reports only; peer / medical assistant have no library', () => {
  const hr = ids('HR');
  assert.deepEqual([...hr].sort(), ['staff-accounts', 'staff-credentials', 'training-compliance']);
  const fd = ids('FRONT_DESK');
  // Front desk also runs the Carelon attestation status list (they complete the form at check-in)
  assert.deepEqual([...fd].sort(), ['appointment-volume', 'cancellations', 'carelon-attestation-status', 'no-future-appointment', 'no-show-late-cancel', 'recurring-series', 'waitlist']);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/reports'), true);
  assert.equal(canAccessApiPath('FRONT_DESK', '/api/reports/library'), true);
  for (const role of ['PEER_SUPPORT', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER']) {
    assert.equal(ids(role).size, 0, role);
    assert.equal(canAccessPath(role, '/dashboard/reports'), false, role);
    assert.equal(canAccessApiPath(role, '/api/reports/library'), false, role);
  }
});

test('role filtering: a verified Medical Director gets the oversight reports, the flag alone on a non-prescriber does nothing', () => {
  const physician = ids('PHYSICIAN');
  const md = ids('PHYSICIAN', { medicalDirector: true });
  assert.ok(!physician.has('treatment-plan-status'));
  assert.ok(md.has('treatment-plan-status') && md.has('measurement-based-care') && md.has('active-census'));
  assert.ok(!md.has('ar-aging') && !md.has('phi-access'));
  // Medical Director designation applies to psychiatrists / NPs / physicians, not therapists
  assert.equal(canRunReport(getReport('treatment-plan-status')!, 'THERAPIST', { medicalDirector: true }), false);
  assert.equal(canRunReport(getReport('treatment-plan-status')!, 'PSYCHIATRIST', { medicalDirector: true }), true);
  assert.equal(canRunReport(getReport('active-census')!, 'BILLING', { medicalDirector: true }), false);
  assert.equal(isClinicalViewer('OFFICE_MANAGER'), false);
  assert.equal(isClinicalViewer('BILLING'), false);
  assert.equal(isClinicalViewer('THERAPIST'), true);
  assert.equal(isClinicalViewer('PRACTICE_DIRECTOR'), true);
});

test('outcomes page: leadership only under the library (Office Manager removed 2026-10-22: revenue KPIs)', () => {
  for (const role of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.equal(canAccessPath(role, '/dashboard/reports/outcomes'), true, role);
  for (const role of ['OFFICE_MANAGER', 'BILLING', 'HR', 'PRP_SPECIALIST', 'CASE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP']) assert.equal(canAccessPath(role, '/dashboard/reports/outcomes'), false, role);
  assert.equal(canAccessPath('BILLING', '/dashboard/reports/run/ar-aging'), true);
});

// ─── Parameters ──────────────────────────────────────────────────────────────

const meta = (params: ReportDefinition['params']) => ({ params });
const RANGE = [{ kind: 'dateRange' as const, key: 'range' as const, label: 'Date range', defaultPreset: 'last_month' as const }];

test('params: date presets on the practice clock', () => {
  assert.deepEqual(presetRange('this_month', '2026-10-19'), { fromDate: '2026-10-01', toDate: '2026-10-19' });
  assert.deepEqual(presetRange('last_month', '2026-10-19'), { fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.deepEqual(presetRange('last_month', '2026-01-05'), { fromDate: '2025-12-01', toDate: '2025-12-31' });
  assert.deepEqual(presetRange('qtd', '2026-10-19'), { fromDate: '2026-10-01', toDate: '2026-10-19' });
  assert.deepEqual(presetRange('last_quarter', '2026-02-10'), { fromDate: '2025-10-01', toDate: '2025-12-31' });
  assert.deepEqual(presetRange('ytd', '2026-10-19'), { fromDate: '2026-01-01', toDate: '2026-10-19' });
  assert.deepEqual(presetRange('last_year', '2026-10-19'), { fromDate: '2025-01-01', toDate: '2025-12-31' });
  assert.deepEqual(presetRange('last_30', '2026-10-19'), { fromDate: '2026-09-20', toDate: '2026-10-19' });
  // 00:30 UTC on Oct 1 is still Sep 30 in Maryland: "this month" is September
  const r = resolveReportParams(meta([{ ...RANGE[0], defaultPreset: 'this_month' }]), {}, { now: new Date('2026-10-01T00:30:00Z') });
  assert.ok('params' in r && r.params.range?.fromDate === '2026-09-01');
});

test('params: range bounds are practice midnights (DST aware) plus UTC calendar-day bounds', () => {
  const r = resolveReportParams(meta(RANGE), { preset: 'custom', from: '2026-11-01', to: '2026-11-02' }, { now: NOW });
  assert.ok('params' in r);
  const range = r.params.range!;
  assert.equal(range.from.toISOString(), '2026-11-01T04:00:00.000Z'); // EDT midnight
  assert.equal(range.toExclusive.toISOString(), '2026-11-03T05:00:00.000Z'); // EST midnight
  assert.equal(range.dayFrom.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(range.dayToExclusive.toISOString(), '2026-11-03T00:00:00.000Z');
  assert.equal(practiceDayStart('2026-07-04').toISOString(), '2026-07-04T04:00:00.000Z');
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01');
});

test('params: validation rejects bad input and drops undeclared params', () => {
  const sel = { kind: 'select' as const, key: 'groupBy', label: 'Group by', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' };
  const m = meta([...RANGE, { kind: 'site', key: 'site', label: 'Site' }, { kind: 'payer', key: 'payer', label: 'Payer' }, sel]);
  const bad = (raw: Record<string, unknown>) => {
    const r = resolveReportParams(m, raw, { now: NOW });
    assert.ok('error' in r, JSON.stringify(raw));
  };
  bad({ preset: 'next_decade' });
  bad({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' });
  bad({ preset: 'custom', from: '2026-10-10', to: '2026-10-01' });
  bad({ preset: 'custom', from: '2020-01-01', to: '2026-10-01' }); // over 3 years
  bad({ site: "x' OR 1=1 --" });
  bad({ payer: 'Aetna\u0000' });
  bad({ groupBy: 'c' });
  const ok = resolveReportParams(m, { site: 'loc_1', payer: 'Maryland Medicaid', provider: 'u1', evil: 'drop table', groupBy: 'b' }, { now: NOW });
  assert.ok('params' in ok);
  assert.equal(ok.params.site, 'loc_1');
  assert.equal(ok.params.payer, 'Maryland Medicaid');
  assert.equal(ok.params.provider, null, 'provider is not declared by this report');
  assert.deepEqual(ok.params.values, { groupBy: 'b' });
  assert.equal(ok.params.range?.preset, 'last_month');
  const narrow = resolveReportParams(meta([{ ...RANGE[0], maxDays: 31 }]), { preset: 'last_90' }, { now: NOW });
  assert.ok('error' in narrow);
  assert.deepEqual(parsePaging({ page: '3', pageSize: '100' }), { page: 3, pageSize: 100 });
  assert.deepEqual(parsePaging({ page: '-1', pageSize: '7' }), { page: 1, pageSize: 50 });
  assert.deepEqual(rawFromSearchParams(new URLSearchParams('preset=ytd&site=a&site=b')), { preset: 'ytd', site: 'a' });
  if ('params' in ok) assert.match(describeParams(m, ok.params, { site: 'Bowie' }), /Site: Bowie · Payer: Maryland Medicaid · Group by: B/);
});

// ─── CSV injection ───────────────────────────────────────────────────────────

test('CSV: formula-looking text is neutralised; numbers stay numeric', () => {
  assert.equal(csvSafeText('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvSafeText('+1-800'), `"'+1-800"`);
  assert.equal(csvSafeText('-2+3'), `"'-2+3"`);
  assert.equal(csvSafeText('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvSafeText('\tcmd'), `"'\tcmd"`);
  assert.equal(csvSafeText('Smith, Jane'), '"Smith, Jane"');
  assert.equal(csvCellFor(-1250, 'money'), '-12.50');
  assert.equal(csvCellFor(42.5, 'percent'), '42.5');
  assert.equal(csvCellFor(null, 'number'), '');
  assert.equal(csvCellFor('<10', 'number'), '"<10"');
  const csv = buildCsv(fakeResult({ rows: [{ client: '=cmd|/c calc', amount: -500 }], columns: [{ key: 'client', label: 'Client', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }] }), { organization: 'MD Behavioral Health', runBy: '@admin' });
  assert.match(csv, /"'=cmd\|\/c calc",-5\.00/);
  assert.match(csv, /"Run by","'@admin"/);
  for (const line of csv.split('\r\n')) assert.doesNotMatch(line, /(^|,)[=+@]/, line);
});

test('display: cells format by type and never invent values', () => {
  assert.equal(displayCell(123456, 'money'), '$1,234.56');
  assert.equal(displayCell(null, 'percent'), '—');
  assert.equal(displayCell('<10', 'number'), '<10');
  assert.equal(displayCell('2026-10-01', 'date'), 'Oct 1, 2026');
  assert.equal(pdfSafe('PHQ-9 ≥ 10 − baseline ≤ 5 · ok'), 'PHQ-9 >= 10 - baseline <= 5 · ok');
  assert.equal(pdfSafe('雪'), '?');
});

// ─── Small-cell suppression ──────────────────────────────────────────────────

test('suppression: counts 1-9 and rates over 1-9 people hidden; zero and 10+ shown', () => {
  const columns = [
    { key: 'group', label: 'G', type: 'text' as const },
    { key: 'clients', label: 'Clients', type: 'number' as const, smallCell: 'count' as const },
    { key: 'rate', label: 'Rate', type: 'percent' as const, smallCell: { rateOf: 'clients' } },
  ];
  const { rows, changed } = suppressRows([
    { group: 'a', clients: 0, rate: null },
    { group: 'b', clients: 5, rate: 40 },
    { group: 'c', clients: 12, rate: 25 },
    { group: 'd', clients: 9, rate: 100 },
  ], columns);
  assert.ok(changed);
  assert.deepEqual(rows.map((r) => [r.clients, r.rate]), [[0, null], ['<10', '<10'], [12, 25], ['<10', '<10']]);
  const k = suppressKpis([
    { label: 'n', value: 3, type: 'number', smallCell: 'count' },
    { label: 'pct', value: 50, type: 'percent', smallCell: { denominator: 4 } },
    { label: 'pct2', value: 50, type: 'percent', smallCell: { denominator: 40 } },
    { label: 'plain', value: 3, type: 'number' },
  ]);
  assert.deepEqual(k.kpis.map((x) => x.value), ['<10', '<10', 50, 3]);
  const chart = applySmallCellSuppression({ columns, rows: [{ group: 'b', clients: 5, rate: 40 }], sources: [], chart: { type: 'bar', xKey: 'group', series: [{ key: 'clients', label: 'C' }], data: [{ group: 'b', clients: 5 }] } });
  assert.equal(chart.output.chart?.data?.[0].clients, null);
});

// ─── Formulas ────────────────────────────────────────────────────────────────

test('A/R aging buckets: 0-30 / 31-60 / 61-90 / 91-120 / 120+', () => {
  const cases: [number, string][] = [[0, 'b0_30'], [30, 'b0_30'], [31, 'b31_60'], [60, 'b31_60'], [61, 'b61_90'], [90, 'b61_90'], [91, 'b91_120'], [120, 'b91_120'], [121, 'b120p'], [900, 'b120p']];
  for (const [d, k] of cases) assert.equal(agingBucket(d), k, String(d));
  assert.deepEqual(AGING_BUCKETS.map((b) => b.label), ['0-30', '31-60', '61-90', '91-120', '120+']);
  const t = emptyAging();
  addAging(t, 10, 1000);
  addAging(t, 45, 500);
  addAging(t, 200, 250);
  assert.deepEqual(t, { b0_30: 1000, b31_60: 500, b61_90: 0, b91_120: 0, b120p: 250, total: 1750 });
  assert.equal(claimOutstandingCents({ amountCents: 15000, paidAmount: 90, patientResponsibility: null, paymentsCents: 0 }), 6000);
  assert.equal(claimOutstandingCents({ amountCents: 15000, paidAmount: 90, patientResponsibility: 25, paymentsCents: 0 }), 2500);
  assert.equal(claimOutstandingCents({ amountCents: 15000, paidAmount: null, patientResponsibility: null, paymentsCents: 20000 }), 0);
});

test('days in A/R and net collection rate', () => {
  // $90,000 ending A/R; $270,000 charges over 90 days = $3,000/day -> 30 days
  assert.equal(daysInAr(9_000_000, 27_000_000, 90), 30);
  assert.equal(daysInAr(1_000_000, 0, 90), null);
  assert.equal(daysInAr(1_000_000, 500_000, 0), null);
  // NCR = 90,000 / (150,000 - 50,000) = 90%
  assert.equal(netCollectionRate(9_000_000, 15_000_000, 5_000_000), 90);
  assert.equal(netCollectionRate(100, 1000, 1000), null);
  assert.equal(grossCollectionRate(9_000_000, 15_000_000), 60);
  assert.equal(denialRate(8, 100), 8);
  assert.equal(cleanClaimRate(0, 0), null);
  assert.equal(pct(1, 3), 33.3);
});

test('no-show rate = no-shows / (kept + no-shows); late cancels and kept rate', () => {
  const c = emptyApptCounts();
  addApptStatus(c, 'COMPLETED', 80);
  addApptStatus(c, 'CHECKED_IN', 5);
  addApptStatus(c, 'NO_SHOW', 15);
  addApptStatus(c, 'LATE_CANCEL', 10);
  addApptStatus(c, 'CANCELLED', 20);
  addApptStatus(c, 'SCHEDULED', 7);
  assert.equal(bookedTotal(c), 137);
  assert.equal(noShowRate(c), 15); // 15 / (85 + 15)
  assert.equal(lateCancelRate(c), 9.1); // 10 / 110
  assert.equal(keptRate(c), 72.6); // 85 / (137 - 20)
  assert.equal(noShowRate(emptyApptCounts()), null);
});

test('note timeliness buckets and unsigned-note aging', () => {
  const svc = new Date('2026-10-01T15:00:00Z');
  const h = (n: number) => new Date(svc.getTime() + n * 3_600_000);
  assert.equal(noteTimeliness(svc, h(2)), 'within24');
  assert.equal(noteTimeliness(svc, h(24)), 'within24');
  assert.equal(noteTimeliness(svc, h(24.5)), 'within72');
  assert.equal(noteTimeliness(svc, h(72)), 'within72');
  assert.equal(noteTimeliness(svc, h(73)), 'over72');
  assert.equal(noteTimeliness(svc, h(-1)), 'within24');
  assert.equal(noteTimeliness(svc, null), 'unsigned');
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 14, 15, 30, 31].map(unsignedAgingBucket), ['d0_1', 'd0_1', 'd2_3', 'd2_3', 'd4_7', 'd4_7', 'd8_14', 'd8_14', 'd15_30', 'd15_30', 'd30p']);
});

test('reliable change uses the Clinical Insights thresholds; plan state precedence', () => {
  assert.equal(RELIABLE_CHANGE['phq-9'], 5);
  assert.equal(RELIABLE_CHANGE['gad-7'], 4);
  assert.equal(reliableChange(18, 12, 5), 'improved');
  assert.equal(reliableChange(18, 14, 5), 'no_reliable_change');
  assert.equal(reliableChange(8, 13, 5), 'worsened');
  const now = new Date('2026-10-19T12:00:00Z');
  const signed = new Date('2026-01-01T00:00:00Z');
  assert.equal(classifyPlan(null, now), 'missing');
  assert.equal(classifyPlan({ status: 'ACTIVE', reviewDueAt: new Date('2026-09-01'), clinicianSignedAt: signed, imported: true }, now), 'valant');
  assert.equal(classifyPlan({ status: 'DRAFT', reviewDueAt: null, clinicianSignedAt: null, imported: false }, now), 'draft');
  assert.equal(classifyPlan({ status: 'ACTIVE', reviewDueAt: new Date('2026-10-01'), clinicianSignedAt: signed, imported: false }, now), 'overdue');
  assert.equal(classifyPlan({ status: 'NEEDS_REVIEW', reviewDueAt: new Date('2027-01-01'), clinicianSignedAt: signed, imported: false }, now), 'overdue');
  assert.equal(classifyPlan({ status: 'ACTIVE', reviewDueAt: new Date('2026-11-01'), clinicianSignedAt: signed, imported: false }, now), 'due');
  assert.equal(classifyPlan({ status: 'ACTIVE', reviewDueAt: new Date('2027-03-01'), clinicianSignedAt: signed, imported: false }, now), 'current');
});

test('sorting: numeric / text, empty values last, unknown keys ignored', () => {
  const rows = [{ a: 3, b: 'x' }, { a: null, b: 'b' }, { a: 10, b: 'A' }];
  assert.deepEqual(sortRows(rows, 'a', 'asc').map((r) => r.a), [3, 10, null]);
  assert.deepEqual(sortRows(rows, 'a', 'desc').map((r) => r.a), [10, 3, null]);
  assert.deepEqual(sortRows(rows, 'b', 'asc').map((r) => r.b), ['A', 'b', 'x']);
  assert.equal(parseSort({ sort: 'a; drop', dir: 'desc' }, ['a', 'b']), null);
  assert.deepEqual(parseSort({ sort: 'b', dir: 'desc' }, ['a', 'b']), { key: 'b', dir: 'desc' });
});

// ─── Executor: audit on run / export, suppression, paging, timeout ──────────

function fakeResult(over: Partial<import('../src/lib/reports/library/types').ReportRunResult>): import('../src/lib/reports/library/types').ReportRunResult {
  return {
    reportId: 'x', title: 'X', category: 'clinical', output: 'aggregate', generatedAt: NOW.toISOString(), asOf: NOW.toISOString(), timeZone: 'America/New_York',
    scope: 'organization', params: { preset: null, fromDate: null, toDate: null, site: null, provider: null, payer: null, values: {} }, paramLabel: '',
    columns: [], rows: [], totalRows: 0, page: 1, pageSize: 50, kpis: [], chart: null, sources: [], notices: [], definitions: [['A', 'Definition A']],
    suppressed: false, truncated: false, hiddenSensitiveClients: 0, durationMs: 1, ...over,
  };
}

function fakeCtx(): ReportContext {
  return {
    organizationId: 'org1', userId: 'u1', role: 'ADMIN', now: NOW, timeZone: 'America/New_York',
    scope: { organizationId: 'org1', userId: 'u1', role: 'ADMIN', locationId: null, clinicianId: null, lockedClientIds: [], facilityTerm: null },
    scopeKind: 'organization', siteLabel: null, providerLabel: null,
    clientWhere: () => ({}), clientIdFilter: async () => null, valantWhere: () => ({}), hiddenSensitiveClients: async () => 0,
  };
}

function fakeDef(over: Partial<ReportDefinition> = {}, output: (p: ResolvedParams) => ReportOutput = () => ({
  columns: [{ key: 'group', label: 'Group', type: 'text' }, { key: 'clients', label: 'Clients', type: 'number', smallCell: 'count' }],
  rows: Array.from({ length: 120 }, (_, i) => ({ group: `Client Name ${i}`, clients: i % 12 })),
  kpis: [{ label: 'Clients', value: 4, type: 'number', smallCell: 'count' }],
  sources: [{ name: 'Fake', rows: 120 }],
})): ReportDefinition {
  return {
    id: 'fake-report', title: 'Fake', category: 'clinical', description: 'A fake report for tests only.', definitions: [['A', 'Definition A']],
    dataSources: ['Fake'], params: [{ kind: 'dateRange', key: 'range', label: 'Date range', defaultPreset: 'last_month' }, { kind: 'site', key: 'site', label: 'Site' }],
    access: { roles: ['ADMIN', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'] }, output: 'aggregate', suppressSmallCells: true,
    run: async (_c, p) => output(p), ...over,
  };
}

function spy() {
  const calls: Parameters<AuditWriter>[0][] = [];
  const audit: AuditWriter = async (e) => {
    calls.push(e);
  };
  return { calls, audit };
}

const deps = (role: string, audit: AuditWriter, extra: Partial<Parameters<typeof executeReport>[3]> = {}) => ({
  viewer: { organizationId: 'org1', userId: 'u1', role },
  timeZone: 'America/New_York',
  now: NOW,
  buildContext: async () => fakeCtx(),
  audit,
  ...extra,
});

test('audit: a run writes READ with report id, parameters and row count, and no PHI values', async () => {
  const s = spy();
  const r = await executeReport(fakeDef(), { preset: 'last_month', site: 'loc1', page: 2, pageSize: 25 }, { kind: 'view' }, deps('ADMIN', s.audit));
  assert.ok('result' in r);
  assert.equal(r.result.rows.length, 25);
  assert.equal(r.result.page, 2);
  assert.equal(r.result.totalRows, 120);
  assert.equal(s.calls.length, 1);
  const e = s.calls[0];
  assert.equal(e.action, 'READ');
  assert.equal(e.outcome, 'SUCCESS');
  assert.equal(e.resourceId, 'fake-report');
  assert.equal(e.metadata.reportId, 'fake-report');
  assert.equal(e.metadata.rowCount, 120);
  assert.equal(e.metadata.fromDate, '2026-09-01');
  assert.equal(e.metadata.toDate, '2026-09-30');
  assert.equal(e.metadata.siteId, 'loc1');
  const json = JSON.stringify(e.metadata);
  assert.doesNotMatch(json, /Client Name/, 'row values never reach the audit log');
  for (const k of Object.keys(e.metadata)) assert.doesNotMatch(k.toLowerCase(), /name|email|phone|address|dob/, k);
});

test('audit: an export writes EXPORT with the format and returns every row', async () => {
  const s = spy();
  const r = await executeReport(fakeDef(), {}, { kind: 'export', format: 'csv' }, deps('ADMIN', s.audit));
  assert.ok('result' in r);
  assert.equal(r.result.rows.length, 120);
  assert.equal(s.calls[0].action, 'EXPORT');
  assert.equal(s.calls[0].metadata.format, 'csv');
});

test('audit: a role without access is refused and the denial is logged', async () => {
  const s = spy();
  const r = await executeReport(fakeDef(), {}, { kind: 'view' }, deps('BILLING', s.audit));
  assert.ok('error' in r && r.status === 403);
  assert.equal(s.calls[0].outcome, 'DENIED');
});

test('audit: a slow report times out (504) and the failure is logged', async () => {
  const s = spy();
  const slow = fakeDef({ run: () => new Promise((resolve) => setTimeout(() => resolve({ columns: [], rows: [], sources: [] }), 200)) });
  const r = await executeReport(slow, {}, { kind: 'view' }, deps('ADMIN', s.audit, { timeoutMs: 20 }));
  assert.ok('error' in r && r.status === 504);
  assert.equal(s.calls[0].outcome, 'FAILURE');
  assert.equal(s.calls[0].metadata.error, 'timeout');
});

test('executor: small cells suppressed for office manager, not for clinical leadership; bad params never reach run()', async () => {
  const om = await executeReport(fakeDef(), { pageSize: 250 }, { kind: 'view' }, deps('OFFICE_MANAGER', spy().audit));
  const th = await executeReport(fakeDef(), { pageSize: 250 }, { kind: 'view' }, deps('PRACTICE_DIRECTOR', spy().audit));
  assert.ok('result' in om && 'result' in th);
  assert.equal(om.result.suppressed, true);
  assert.equal(om.result.kpis[0].value, '<10');
  assert.ok(om.result.rows.some((r) => r.clients === '<10'));
  assert.ok(om.result.notices.some((n) => /small-cell/.test(n)));
  assert.equal(th.result.suppressed, false);
  assert.equal(th.result.kpis[0].value, 4);
  let ran = false;
  const r = await executeReport(fakeDef({ run: async () => { ran = true; return { columns: [], rows: [], sources: [] }; } }), { preset: 'custom', from: 'x' }, { kind: 'view' }, deps('ADMIN', spy().audit));
  assert.ok('error' in r && r.status === 400);
  assert.equal(ran, false);
});

test('executor: the row cap is enforced and announced', async () => {
  const big = fakeDef({ suppressSmallCells: false }, () => ({ columns: [{ key: 'n', label: 'N', type: 'number' }], rows: Array.from({ length: REPORT_ROW_CAP + 5 }, (_, i) => ({ n: i })), sources: [] }));
  const r = await executeReport(big, {}, { kind: 'export', format: 'csv' }, deps('ADMIN', spy().audit));
  assert.ok('result' in r);
  assert.equal(r.result.rows.length, REPORT_ROW_CAP);
  assert.equal(r.result.truncated, true);
});

test('routes: run and export are audited, gated and never build SQL from text', () => {
  const lib = path.join(ROOT, 'src', 'app', 'api', 'reports', 'library');
  const run = fs.readFileSync(path.join(lib, '[id]', 'run', 'route.ts'), 'utf8');
  const exp = fs.readFileSync(path.join(lib, '[id]', 'export', 'route.ts'), 'utf8');
  for (const s of [run, exp]) {
    assert.match(s, /requireOrgContext/);
    assert.match(s, /canOpenLibrary/);
    assert.match(s, /runLibraryReport/);
    assert.match(s, /auditPhiAccess/);
  }
  const server = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'reports', 'library', 'server.ts'), 'utf8');
  assert.match(server, /auditPhiAccess/);
  assert.match(server, /buildReportContext/);
  const ctx = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'reports', 'library', 'context.ts'), 'utf8');
  assert.match(ctx, /resolveReportScope/);
  assert.match(ctx, /lockedClientIds/);
});

// ─── Saved reports and scheduled delivery ────────────────────────────────────


test('schedule: next delivery on the practice clock (daily / weekly / monthly, DST aware)', () => {
  const tz = 'America/New_York';
  // Mon Oct 19 2026 11:00 ET: 7 AM today has passed -> tomorrow 7 AM EDT
  assert.equal(nextScheduledRun('daily', 7, null, NOW, tz)?.toISOString(), '2026-10-20T11:00:00.000Z');
  assert.equal(nextScheduledRun('daily', 13, null, NOW, tz)?.toISOString(), '2026-10-19T17:00:00.000Z');
  // Weekly Monday 7 AM: next Monday
  assert.equal(nextScheduledRun('weekly', 7, 1, NOW, tz)?.toISOString(), '2026-10-26T11:00:00.000Z');
  // Monthly: Nov 1 7 AM is already EST (DST ends at 2 AM that day) -> 12:00Z
  assert.equal(nextScheduledRun('monthly', 7, null, NOW, tz)?.toISOString(), '2026-11-01T12:00:00.000Z');
  assert.equal(nextScheduledRun('none', 7, null, NOW, tz), null);
  assert.equal(scheduleLabel('weekly', 7, 1), 'Mondays at 7:00 AM');
  assert.equal(scheduleLabel('daily', 13, null), 'Daily at 1:00 PM');
});

test('saved reports: only declared, validated parameters are stored; the email never carries PHI or the typed name', () => {
  const def = getReport('appointment-volume')!;
  const ok = savedParamsFor(def, { preset: 'ytd', from: '2020-01-01', site: 'loc1', groupBy: 'month', clientName: 'Jane Doe', payer: 'x' });
  assert.ok('params' in ok);
  assert.deepEqual(ok.params, { preset: 'ytd', site: 'loc1', groupBy: 'month' });
  const custom = savedParamsFor(def, { preset: 'custom', from: '2026-01-01', to: '2026-03-31' });
  assert.ok('params' in custom && custom.params.from === '2026-01-01' && custom.params.to === '2026-03-31');
  assert.ok('error' in savedParamsFor(def, { groupBy: 'patient' }));
  const href = savedReportPath('appointment-volume', 'sv1', { preset: 'ytd', site: 'loc1' });
  assert.equal(href, '/dashboard/reports/run/appointment-volume?preset=ytd&site=loc1&saved=sv1');
  const mail = scheduledEmail({ reportTitle: 'Appointment volume', url: `https://altrixs.com${href}`, scheduleText: 'Daily at 7:00 AM' });
  assert.match(mail.subject, /Appointment volume/);
  assert.match(mail.text, /sign-in required/);
  assert.match(mail.text, /contains no patient information/);
  assert.doesNotMatch(mail.html, /<script/i);
});

test('saved reports: routes are owner-scoped and audited; the cron sends report schedules', () => {
  const saved = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'reports', 'library', 'saved.ts'), 'utf8');
  assert.match(saved, /userId: owner\.userId/);
  assert.match(saved, /updateMany\(\{ where: \{ id: row\.id, nextRunAt: row\.nextRunAt \}/, 'deliveries are claimed before sending');
  assert.match(saved, /canRunReport\(def, user\.role/);
  for (const f of [['saved', 'route.ts'], ['saved', '[sid]', 'route.ts']]) {
    const s = fs.readFileSync(path.join(ROOT, 'src', 'app', 'api', 'reports', 'library', ...f), 'utf8');
    assert.match(s, /auditPhiAccess/);
    assert.match(s, /canOpenLibrary/);
  }
  const cron = fs.readFileSync(path.join(ROOT, 'src', 'app', 'api', 'cron', 'notifications', 'route.ts'), 'utf8');
  assert.match(cron, /runReportSchedules\(now\)\.catch/);
  const mig = fs.readFileSync(path.join(ROOT, 'prisma', 'migrations', '20261019_report_library.sql'), 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS "report_saved_views"/);
  assert.doesNotMatch(mig.replace(/IF NOT EXISTS/g, ''), /CREATE (TABLE|INDEX) "/, 'every CREATE is idempotent');
});
