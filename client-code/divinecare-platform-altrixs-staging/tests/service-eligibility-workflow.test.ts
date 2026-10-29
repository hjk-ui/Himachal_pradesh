import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { billedProgram, doseMg, extractIcdCodes, isMdd, normalizeIcd } from '../src/lib/clinical/serviceEligibility/codes';
import {
  ageAt,
  antidepressantTrials,
  evaluateClient,
  evaluateIop,
  evaluatePrp,
  evaluateResidential,
  evaluateSpravato,
  evaluateTms,
  type ChartDx,
  type ChartMed,
  type ClientChart,
} from '../src/lib/clinical/serviceEligibility/rules';
import { latestPhq9 } from '../src/lib/clinical/serviceEligibility/load';
import { clientPriority } from '../src/lib/clinical/serviceEligibility/priority';
import { classifyPayer, payerFit } from '../src/lib/clinical/serviceEligibility/payerFit';
import { revenueEstimate, type FeeRow } from '../src/lib/clinical/serviceEligibility/revenue';
import { buildScannerRows } from '../src/lib/clinical/serviceEligibility/snapshot';
import {
  DEFAULT_FILTERS,
  conversion,
  csvCell,
  listRows,
  pageOf,
  tileCounts,
  type ScannerRow,
  type ViewFilters,
} from '../src/lib/clinical/serviceEligibility/view';
import { guardRationale, getRationale, rationaleFacts, type RationaleDeps } from '../src/lib/clinical/serviceEligibility/ai';
import { PROGRAMS, type EligibilityStatus, type ProgramKey } from '../src/lib/clinical/serviceEligibility/types';
import { acuteEventKind, prpDiagnosis as prpDx } from '../src/lib/clinical/serviceEligibility/codes';
import { evaluateAot, aotAcuteEvents } from '../src/lib/clinical/serviceEligibility/rules';
import { tierCounts, tierOf, inTier, TIERS } from '../src/lib/clinical/serviceEligibility/view';

// Synthetic ids and values only; no real patient data.

const NOW = new Date('2026-10-17T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const dx = (code: string, source: ChartDx['source'] = 'primary', label: string | null = null): ChartDx => ({ code, label, source, date: null });
const med = (name: string, startDaysAgo: number, endDaysAgo: number | null, extra: Partial<ChartMed> = {}): ChartMed => ({
  name, genericName: null, brandName: null, startDate: daysAgo(startDaysAgo),
  endDate: endDaysAgo === null ? null : daysAgo(endDaysAgo), active: endDaysAgo === null,
  status: endDaysAgo === null ? 'active' : 'discontinued', stopReason: null, ...extra,
});
function chart(over: Partial<ClientChart> = {}): ClientChart {
  return {
    id: 'c1', dateOfBirth: new Date('1985-03-01T00:00:00Z'), insurancePayer: 'Maryland Medicaid', insuranceType: 'Medicaid',
    diagnoses: [], problemCount: 1, meds: [], allergies: [], phq9: null, cssrs: null, locus: null, sudIntake: null,
    sudSignals: [], crisisEpisodes: [], prpEnrollment: null, prpReferral: null, spravatoEnrollment: null, tmsCourse: null,
    aotParticipant: null, residentialResident: null, ...over,
  };
}
const intake = (levelOfCare: string | null, ratings: Record<number, number> = { 1: 1, 2: 0, 3: 2, 4: 2, 5: 2, 6: 2 }) => ({
  asam: { ratings, levelOfCare }, date: daysAgo(20), noteId: 'n1',
});

// ─── Codes and data pipeline ─────────────────────────────────────────────────

test('ICD normalization: dots and case; F32.A is not MDD; program billing codes', () => {
  assert.equal(normalizeIcd('f332'), 'F33.2');
  assert.equal(normalizeIcd(' F33.2 '), 'F33.2');
  assert.equal(normalizeIcd('33.2'), null);
  assert.equal(normalizeIcd('F3'), null);
  assert.deepEqual(extractIcdCodes('F332;f20.0'), ['F33.2', 'F20.0']);
  assert.equal(isMdd('F32.A'), false, 'Depression, unspecified is not an MDD diagnosis');
  assert.equal(isMdd('F32.9'), true);
  assert.equal(isMdd('F32.81'), false);
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F32.A')] }), NOW).status, 'not_indicated');
  assert.equal(billedProgram('H2017'), 'prp');
  assert.equal(billedProgram('H2017HK'), 'prp');
  assert.equal(billedProgram('99215', '-SPRAVATO'), 'spravato');
  assert.equal(billedProgram('90868'), 'tms');
  assert.equal(billedProgram('H0015'), 'iop');
  assert.equal(billedProgram('90837'), null);
  assert.equal(doseMg('50 mg at bedtime'), 50);
  assert.equal(doseMg('take 1 tab', null), null);
});

test('age is computed on the practice calendar, not the UTC date', () => {
  const dob = new Date('2008-10-18T00:00:00Z');
  // 2026-10-18 01:30 UTC = 2026-10-17 21:30 Eastern: the 18th birthday has not happened yet
  assert.equal(ageAt(dob, new Date('2026-10-18T01:30:00Z'), 'America/New_York'), 17);
  assert.equal(ageAt(dob, new Date('2026-10-18T14:00:00Z'), 'America/New_York'), 18);
  assert.equal(ageAt(null, NOW), null);
});

test('missing medication history is reported, never a silent pass or fail', () => {
  const c = chart({ diagnoses: [dx('F33.2')] });
  const tms = evaluateTms(c, NOW);
  const spr = evaluateSpravato(c, NOW);
  for (const r of [tms, spr]) {
    assert.equal(r.status, 'screen', 'diagnosis only — needs med history (hidden by default)');
    assert.ok(r.missing.some((m) => /Medication history not available/.test(m)), r.program);
    assert.ok(r.gaps.includes('med_history'), r.program);
  }
  const withOther = evaluateTms(chart({ diagnoses: [dx('F33.2')], meds: [med('Lisinopril', 300, null)] }), NOW);
  assert.ok(withOther.gaps.includes('med_trials') && !withOther.gaps.includes('med_history'));
});

test('antidepressant trials: future end date never adds days; trazodone counts only at an antidepressant dose', () => {
  const future = antidepressantTrials([med('Sertraline', 10, null, { endDate: new Date(NOW.getTime() + 90 * 86_400_000) })], NOW);
  assert.equal(future[0].days, 10);
  assert.equal(future[0].adequateDuration, false);
  const low = antidepressantTrials([med('Trazodone', 200, 100, { dose: '50 mg' })], NOW)[0];
  assert.equal(low.countable, false);
  assert.match(low.notCountedReason!, /150 mg/);
  const full = antidepressantTrials([med('Trazodone', 200, 100, { dose: '200 mg' })], NOW)[0];
  assert.equal(full.countable, true);
  const two = evaluateSpravato(chart({ diagnoses: [dx('F33.2')], meds: [med('Sertraline', 200, 120), med('Trazodone', 200, 100, { dose: '50 mg' })] }), NOW);
  assert.equal(two.status, 'potential', 'low-dose trazodone is not the second trial');
});

test('already enrolled from billing history, PRP workflow stage; billing window', () => {
  const smi = { diagnoses: [dx('F20.0')], locus: { composite: 20, level: 'Level 4', date: daysAgo(10) } };
  const billed = evaluatePrp(chart({ ...smi, billing: [{ code: 'H2017', program: 'prp', date: daysAgo(30), source: 'valant' }] }), NOW);
  assert.equal(billed.status, 'enrolled');
  assert.ok(billed.evidence.some((e) => e.kind === 'billing' && /H2017/.test(e.text)));
  assert.equal(evaluatePrp(chart({ ...smi, billing: [{ code: 'H2017', program: 'prp', date: daysAgo(120), source: 'valant' }] }), NOW).status, 'candidate');
  assert.equal(evaluatePrp(chart({ ...smi, prpWorkflow: { stage: 'irp', date: daysAgo(5) } }), NOW).status, 'enrolled');
  assert.equal(evaluatePrp(chart({ ...smi, prpWorkflow: { stage: 'referral', date: daysAgo(5) } }), NOW).status, 'candidate');
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F33.2')], billing: [{ code: '90868', program: 'tms', date: daysAgo(7), source: 'claim' }] }), NOW).status, 'enrolled');
  const iopConflict = evaluatePrp(chart({ ...smi, billing: [{ code: 'H0015', program: 'iop', date: daysAgo(7), source: 'valant' }] }), NOW);
  assert.ok(iopConflict.flags.some((f) => /IOP \/ PHP/.test(f)));
});

test('diagnosis recency: undated Valant diagnoses cite the last billed date or say the date is not recorded', () => {
  const r = evaluatePrp(chart({ diagnoses: [dx('F20.0')], billedDx: { 'F20.0': daysAgo(12) } }), NOW);
  assert.ok(r.evidence.some((e) => e.kind === 'diagnosis' && /last billed/.test(e.text) && e.date));
  const u = evaluatePrp(chart({ diagnoses: [dx('F20.0')] }), NOW);
  assert.ok(u.evidence.some((e) => /diagnosis date not recorded/.test(e.text)));
});

test('IOP (ASAM 2.1 / 2.5): routed by the recommended level; residential says see IOP; withdrawal flagged, not excluded', () => {
  const c = chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 2.1 Intensive outpatient') });
  assert.equal(evaluateIop(c, NOW).status, 'candidate');
  const res = evaluateResidential(c, NOW);
  assert.equal(res.status, 'not_indicated');
  assert.match(res.summary, /see IOP/);
  assert.equal(evaluateIop(chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 3.5 High-intensity residential') }), NOW).status, 'not_indicated');
  assert.equal(evaluateIop(chart({ diagnoses: [dx('F10.20')], sudIntake: intake('ASAM 1 Outpatient') }), NOW).status, 'not_indicated');
  const noIntake = evaluateIop(chart({ diagnoses: [dx('F11.20')] }), NOW);
  assert.equal(noIntake.status, 'potential');
  assert.ok(noIntake.gaps.includes('asam_intake'));
  const sedative = evaluateIop(chart({ diagnoses: [dx('F13.239')] }), NOW);
  assert.equal(sedative.status, 'potential');
  assert.ok(sedative.flags.some((f) => /Withdrawal coded/.test(f)));
  assert.equal(evaluateIop(chart({ diagnoses: [dx('F10.20')], billing: [{ code: 'H0015', program: 'iop', date: daysAgo(3), source: 'valant' }] }), NOW).status, 'enrolled');
  assert.equal(evaluateIop(chart({ diagnoses: [dx('F10.20')], residentialResident: { program: '3.5', date: daysAgo(3) } }), NOW).status, 'not_indicated');
  assert.equal(evaluateIop(chart({ diagnoses: [dx('F17.210')] }), NOW).status, 'not_indicated');
  assert.deepEqual(Object.keys(evaluateClient(chart(), NOW)).sort(), [...PROGRAMS].sort());
});

test('PHQ-9: newest of assessment / imported measurement / TMS course wins; out-of-range ignored', () => {
  const p = latestPhq9([
    { score: 12, date: daysAgo(40), source: 'assessment' },
    { score: 23, date: daysAgo(5), source: 'measurement' },
    { score: 99, date: daysAgo(1), source: 'measurement' },
    null,
  ]);
  assert.deepEqual(p, { score: 23, date: daysAgo(5), source: 'measurement' });
  const t = evaluateTms(chart({ diagnoses: [dx('F32.9')], phq9: p, meds: [med('Sertraline', 200, 100), med('Bupropion', 100, null)] }), NOW);
  assert.equal(t.status, 'candidate');
  assert.ok(t.evidence.some((e) => /imported measurement/.test(e.text)));
});

test('priority: every point cites a dated chart fact', () => {
  const c = chart({ diagnoses: [dx('F33.2')], crisisEpisodes: [{ date: daysAgo(10) }], phq9: { score: 21, date: daysAgo(3) }, utilization: { noShows90: 3, completed90: 1 } });
  const p = clientPriority(c, evaluateClient(c, NOW), NOW);
  assert.equal(p.level, 'high');
  assert.ok(p.reasons.some((r) => r.includes(daysAgo(10).toISOString().slice(0, 10))));
  assert.ok(p.reasons.some((r) => /PHQ-9 21/.test(r)));
  assert.ok(p.reasons.some((r) => /3 missed/.test(r)));
  assert.equal(clientPriority(chart(), evaluateClient(chart(), NOW), NOW).reasons.length, 0);
});

// ─── Payer fit and revenue ───────────────────────────────────────────────────

test('payer fit and fee-schedule revenue are labelled estimates', () => {
  assert.equal(classifyPayer('Priority Partners MCO'), 'medicaid');
  assert.equal(classifyPayer('Medicare Part B'), 'medicare');
  assert.equal(classifyPayer('CareFirst BlueChoice'), 'commercial');
  assert.equal(classifyPayer(null), 'unknown');
  assert.deepEqual([payerFit('prp', 'Maryland Medicaid').coverage, payerFit('prp', 'Maryland Medicaid').priorAuth], ['typical', true]);
  assert.equal(payerFit('prp', 'Medicare').coverage, 'not_typical');
  assert.equal(payerFit('tms', null).coverage, 'unknown');
  assert.equal(payerFit('aot', 'Medicaid').coverage, 'n/a');
  const fees: FeeRow[] = [
    { code: '90868', baseCpt: '90868', feeCents: 25_000, selfPay: false, child: false, telehealth: false, insuranceBillable: true, active: true },
    { code: 'H2017', baseCpt: 'H2017', feeCents: 2_400, selfPay: false, child: false, telehealth: false, insuranceBillable: true, active: true },
  ];
  assert.equal(revenueEstimate('tms', fees).estimateCents, 36 * 25_000);
  const prp = revenueEstimate('prp', fees);
  assert.equal(prp.estimateCents, null, 'PRP unit rule pending: no episode total');
  assert.equal(prp.feeCents, 2_400);
  assert.match(revenueEstimate('spravato', fees).basis, /No fee schedule entry/);
});

// ─── View model: tiles always equal their drill-down ─────────────────────────

function row(id: string, statuses: Partial<Record<ProgramKey, EligibilityStatus>>, extra: Partial<ScannerRow> = {}): ScannerRow {
  const full = Object.fromEntries(PROGRAMS.map((p) => [p, statuses[p] ?? 'not_indicated'])) as Record<ProgramKey, EligibilityStatus>;
  return {
    id, name: `Synthetic ${id}`, mrn: `M-${id}`, age: 40, primaryDx: 'F33.2', clinician: { id: 'u1', name: 'Clin' }, location: { id: 'l1', name: 'Bowie' },
    payer: 'Maryland Medicaid', priority: { score: 0, level: 'low', reasons: [] }, statuses: full, gaps: {}, decisions: {}, scannedAt: NOW.toISOString(), ...extra,
  };
}

test('tile counts equal the list rows a tile click shows, for every program × status and filter', () => {
  const later = new Date(NOW.getTime() + 10 * 86_400_000).toISOString();
  const expired = new Date(NOW.getTime() - 86_400_000).toISOString();
  const rows: ScannerRow[] = [
    row('a', { prp: 'candidate', tms: 'potential' }),
    row('b', { prp: 'potential' }, { clinician: { id: 'u2', name: 'Other' }, payer: 'Medicare' }),
    row('c', { prp: 'candidate' }, { decisions: { prp: { action: 'dismissed', reason: 'client_declined', reasonNote: null, snoozeUntil: null, outcome: null, decidedAt: NOW.toISOString(), decidedBy: 'u1' } } }),
    row('d', { prp: 'candidate', aot: 'review' }, { decisions: { prp: { action: 'snoozed', reason: null, reasonNote: null, snoozeUntil: later, outcome: null, decidedAt: NOW.toISOString(), decidedBy: 'u1' } } }),
    row('e', { tms: 'candidate' }, { decisions: { tms: { action: 'snoozed', reason: null, reasonNote: null, snoozeUntil: expired, outcome: null, decidedAt: NOW.toISOString(), decidedBy: 'u1' } } }),
    row('f', { prp: 'enrolled', iop: 'potential' }, { location: null }),
  ];
  const variants: ViewFilters[] = [
    DEFAULT_FILTERS,
    { ...DEFAULT_FILTERS, workflow: 'all' },
    { ...DEFAULT_FILTERS, workflow: 'dismissed' },
    { ...DEFAULT_FILTERS, clinician: 'u1' },
    { ...DEFAULT_FILTERS, payer: 'medicare' },
    { ...DEFAULT_FILTERS, location: 'none' },
    { ...DEFAULT_FILTERS, caseload: 'mine', viewerId: 'u2' },
    { ...DEFAULT_FILTERS, search: 'M-a' },
  ];
  for (const f of variants) {
    const tiles = tileCounts(rows, f, NOW);
    for (const p of PROGRAMS) {
      for (const s of ['candidate', 'potential', 'review', 'enrolled'] as const) {
        assert.equal(listRows(rows, { ...f, program: p, status: s }, NOW).length, tiles[p][s], `${JSON.stringify(f)} ${p}/${s}`);
      }
      const sum = tiles[p].candidate + tiles[p].potential + tiles[p].review + tiles[p].screen + (f.tier === 'all' ? tiles[p].enrolled : 0);
      assert.equal(listRows(rows, { ...f, program: p, status: 'all' }, NOW).length, sum, `card ${p}`);
    }
  }
  const open = tileCounts(rows, DEFAULT_FILTERS, NOW);
  assert.equal(open.prp.candidate, 1, 'dismissed (c) and snoozed (d) hidden from the open worklist');
  assert.equal(open.tms.candidate, 1, 'an expired snooze is back on the worklist');
  assert.equal(open.aot.review, 1, 'a snooze on PRP does not hide the AOT suggestion');
  assert.equal(tileCounts(rows, { ...DEFAULT_FILTERS, workflow: 'dismissed' }, NOW).prp.candidate, 1);
});

test('list sorted by urgency then revenue; paging; conversion; CSV formula guard', () => {
  const rows = [
    row('low', { tms: 'candidate' }, { revenue: { tms: { code: '90868', feeCents: 1, units: 36, estimateCents: 36, basis: '' } } }),
    row('high', { tms: 'candidate' }, { priority: { score: 40, level: 'high', reasons: ['x'] } }),
    row('rich', { tms: 'candidate' }, { revenue: { tms: { code: '90868', feeCents: 100, units: 36, estimateCents: 3600, basis: '' } } }),
  ];
  assert.deepEqual(listRows(rows, { ...DEFAULT_FILTERS, program: 'tms' }, NOW).map((r) => r.id), ['high', 'rich', 'low']);
  const p = pageOf(Array.from({ length: 120 }, (_, i) => i), 3, 50);
  assert.deepEqual([p.rows.length, p.page, p.pages], [20, 3, 3]);
  const conv = conversion([
    row('x', { prp: 'enrolled' }, { decisions: { prp: { action: 'accepted', reason: null, reasonNote: null, snoozeUntil: null, outcome: 'referred', decidedAt: NOW.toISOString(), decidedBy: 'u1' } } }),
    row('y', { prp: 'candidate' }, { decisions: { prp: { action: 'accepted', reason: null, reasonNote: null, snoozeUntil: null, outcome: 'declined', decidedAt: NOW.toISOString(), decidedBy: 'u1' } } }),
  ]);
  assert.deepEqual(conv.prp, { accepted: 2, enrolled: 1, declined: 1 });
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('F33.2, F41.1'), '"F33.2, F41.1"');
});

test('snapshot rows: live headers + stored statuses; not scanned and not-indicated-only are counted, not listed', () => {
  const clients = [
    { id: 'a', name: 'A', mrn: '1', assignedTo: null, location: null },
    { id: 'b', name: 'B', mrn: '2', assignedTo: null, location: null },
    { id: 'new', name: 'N', mrn: '3', assignedTo: null, location: null },
  ];
  const snaps = [
    { clientId: 'a', statuses: { prp: 'candidate' }, anyIndicated: true, summary: { age: 30, payer: 'Medicaid', priority: { score: 5, level: 'low', reasons: [] }, gaps: { prp: ['locus'] } }, scannedAt: NOW },
    { clientId: 'b', statuses: {}, anyIndicated: false, summary: {}, scannedAt: NOW },
    { clientId: 'gone', statuses: { prp: 'candidate' }, anyIndicated: true, summary: {}, scannedAt: NOW },
  ];
  const built = buildScannerRows(clients, snaps, []);
  assert.deepEqual(built.rows.map((r) => r.id), ['a'], 'a snapshot row for a client out of scope never appears');
  assert.equal(built.rows[0].statuses.tms, 'not_indicated', 'programs missing from an older snapshot default to not indicated');
  assert.deepEqual([built.scanned, built.notScanned, built.notIndicatedOnly], [2, 1, 1]);
});

// ─── AI rationale guardrail ──────────────────────────────────────────────────

test('AI rationale: grounded output passes; any ungrounded fact rejects the whole output', () => {
  const r = evaluatePrp(chart({ diagnoses: [dx('F20.0')], locus: { composite: 18, level: 'Level 3', date: daysAgo(30) } }), NOW);
  const facts = rationaleFacts(r);
  const id = (re: RegExp) => facts.find((f) => re.test(f.text))!.id;
  const good = [{ text: 'The chart lists F20.0, a Category A-type diagnosis.', cites: [id(/Category A/)] }, { text: 'LOCUS composite 18 meets the clinic threshold; the clinician should confirm Category C or D.', cites: [id(/LOCUS composite 18/)] }];
  assert.equal(guardRationale(good, facts, ['Jane Synthetic']).ok, true);
  const bad = (text: string, cites = [facts[0].id]) => guardRationale([...good, { text, cites }], facts, ['Jane Synthetic']);
  assert.equal(bad('PHQ-9 was 24 last month.').ok, false, 'ungrounded instrument / number / relative date');
  assert.equal(bad('Diagnosed 2025-01-02.').ok, false, 'ungrounded date');
  assert.equal(bad('Also F31.2 bipolar disorder.').ok, false, 'ungrounded code');
  assert.equal(bad('Failed sertraline.').ok, false, 'ungrounded medication');
  assert.equal(bad('Jane qualifies.').ok, false, 'names the client');
  assert.equal(bad('Qualifies.', []).ok, false, 'uncited');
  assert.equal(bad('Qualifies.', ['fact999']).ok, false, 'unknown citation');
});

function deps(over: Partial<RationaleDeps> = {}): RationaleDeps & { calls: number; audits: unknown[] } {
  const store = new Map<string, any>();
  const d: any = {
    calls: 0,
    audits: [],
    bedrockConfigured: () => true,
    aiConsent: async () => 'signed',
    isProtected: async () => false,
    modelId: 'test-model',
    async invokeModel() {
      d.calls += 1;
      return JSON.stringify({ sentences: [{ text: 'The chart lists F20.0 as a Category A-type diagnosis; the clinician should confirm.', cites: ['fact2'] }] });
    },
    async audit(e: unknown) {
      d.audits.push(e);
    },
    cache: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v) },
    ...over,
  };
  return d;
}

test('AI rationale: unavailable without Bedrock / consent / on protected records (no model call); cached when grounded', async () => {
  const result = evaluatePrp(chart({ diagnoses: [dx('F20.0')] }), NOW);
  const input = { organizationId: 'org', clientId: 'c1', program: 'prp' as const, result, names: ['Synthetic'] };
  const off = deps({ bedrockConfigured: () => false });
  const r1 = await getRationale(off, input);
  assert.equal(r1.status, 'unavailable');
  assert.match((r1 as { message: string }).message, /AI unavailable/);
  assert.equal(off.calls, 0);
  const declined = deps({ aiConsent: async () => 'declined' });
  assert.equal((await getRationale(declined, input)).status, 'unavailable');
  assert.equal(declined.calls, 0);
  const prot = deps({ isProtected: async () => true });
  assert.equal(((await getRationale(prot, input)) as { reason: string }).reason, 'protected_record');
  const ok = deps();
  const a = await getRationale(ok, input);
  assert.equal(a.status, 'ok');
  const b = await getRationale(ok, input);
  assert.equal(b.status === 'ok' && b.cached, true);
  assert.equal(ok.calls, 1);
  const liar = deps({ invokeModel: async () => JSON.stringify({ sentences: [{ text: 'PHQ-9 of 27 on 2026-01-01.', cites: ['fact1'] }] }) });
  const rej = await getRationale(liar, input);
  assert.equal(rej.status, 'rejected');
  assert.equal(liar.audits.length, 1);
  assert.ok(!JSON.stringify(liar.audits).includes('PHQ-9 of 27'), 'audit carries counts / reasons only');
});

// ─── Decision route ──────────────────────────────────────────────────────────

test('POST decision: accept routes a referral to the program lead; dismiss needs a reason; snooze; Part 2 lock denied', async (t) => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  t.after(() => {
    loader._load = originalLoad;
  });
  const audits: any[] = [];
  const alerts: any[] = [];
  const decisions = new Map<string, any>();
  let locked = false;
  const key = (w: any) => `${w.organizationId_clientId_program.clientId}:${w.organizationId_clientId_program.program}`;
  const db: any = {
    client: { findFirst: async () => ({ id: 'c1', name: 'Synthetic One', assignedToId: 'u1' }) },
    serviceEligibilityDecision: {
      findUnique: async (a: any) => decisions.get(key(a.where)) ?? null,
      upsert: async (a: any) => {
        const v = { ...(decisions.get(key(a.where)) ?? a.create), ...a.update };
        decisions.set(key(a.where), v);
        return v;
      },
      delete: async (a: any) => decisions.delete(key(a.where)),
      update: async (a: any) => ({ ...decisions.get(key(a.where)), ...a.data }),
    },
    riskAlert: { create: async (a: any) => (alerts.push(a.data), { id: `alert-${alerts.length}` }), findFirst: async () => null },
    serviceEligibilityProgramLead: { findUnique: async () => ({ leadUserId: 'lead-1' }) },
    user: { findFirst: async () => ({ id: 'lead-1', name: 'PRP Lead' }) },
  };
  loader._load = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => ({ ok: true, userId: 'u1', organizationId: 'org', role: 'THERAPIST' }) };
    if (id === '@/lib/audit/requestMeta') return { auditPhiAccess: async (a: any) => { audits.push(a); } };
    if (id === '@/lib/privacy/sensitiveAccess') return { lockedSensitiveClientIds: async (i: any) => new Set<string>(locked ? i.clientIds : []) };
    if (id === '@/lib/inbox/cacheStore') return { invalidateInboxForOrg: () => {} };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  const route = require('../src/app/api/ehr/scanner/service-eligibility/decision/route');
  const post = (body: unknown) => route.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }));

  const acc = await post({ clientId: 'c1', program: 'prp', action: 'accept', statusAtDecision: 'candidate' });
  assert.equal(acc.status, 200);
  assert.equal(alerts[0].type, 'SERVICE_REFERRAL');
  assert.equal(alerts[0].clinicianId, 'lead-1', 'routed to the configured program lead');
  assert.equal(decisions.get('c1:prp').outcome, 'referred');

  assert.equal((await post({ clientId: 'c1', program: 'tms', action: 'dismiss' })).status, 400, 'reason required');
  assert.equal((await post({ clientId: 'c1', program: 'tms', action: 'dismiss', reason: 'other' })).status, 400, '"other" needs a note');
  assert.equal((await post({ clientId: 'c1', program: 'tms', action: 'dismiss', reason: 'client_declined' })).status, 200);
  assert.equal(decisions.get('c1:tms').action, 'dismissed');
  assert.ok(audits.some((a) => a.metadata?.operation === 'dismiss' && a.metadata.reason === 'client_declined'));

  assert.equal((await post({ clientId: 'c1', program: 'aot', action: 'snooze', days: 45 })).status, 400, 'only 30 / 60 / 90');
  assert.equal((await post({ clientId: 'c1', program: 'aot', action: 'snooze', days: 60 })).status, 200);
  assert.ok(decisions.get('c1:aot').snoozeUntil > new Date());

  locked = true;
  const denied = await post({ clientId: 'c1', program: 'iop', action: 'snooze', days: 30 });
  assert.equal(denied.status, 403);
  assert.ok(audits.some((a) => a.outcome === 'DENIED' && a.metadata.reason === 'sensitive_record'));
  assert.ok(!JSON.stringify(audits).includes('Synthetic One'), 'audit rows carry ids and enums only');
});

// ─── Precision fixes (staging review, Oct 19) ────────────────────────────────


test('AOT: a diagnosis alone never puts a client on the list; review needs adult + SMI + 2 acute events in 36 months', () => {
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F33.2')] }), NOW).status, 'not_indicated');
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F31.2')] }), NOW).status, 'not_indicated');
  const one = evaluateAot(chart({ diagnoses: [dx('F20.0')], crisisEpisodes: [{ date: daysAgo(30) }] }), NOW);
  assert.equal(one.status, 'not_indicated');
  assert.ok(one.unmet.some((u) => /1 of 2/.test(u)));
  const billed = evaluateAot(chart({ diagnoses: [dx('F20.0')], acuteEvents: [{ date: daysAgo(40), kind: 'ed', code: '99284' }, { date: daysAgo(400), kind: 'inpatient', code: '99223' }] }), NOW);
  assert.equal(billed.status, 'review');
  assert.ok(billed.evidence.some((e) => e.kind === 'acute-care' && /99284/.test(e.text) && e.date));
  // Same-day ED visit + crisis episode = one event; events older than 36 months do not count
  const sameDay = chart({ diagnoses: [dx('F20.0')], crisisEpisodes: [{ date: daysAgo(10) }], acuteEvents: [{ date: daysAgo(10), kind: 'ed', code: '99285' }, { date: daysAgo(1200), kind: 'inpatient', code: '99223' }] });
  assert.equal(aotAcuteEvents(sameDay, NOW).length, 1);
  assert.equal(evaluateAot(sameDay, NOW).status, 'not_indicated');
  const twoEvents = { crisisEpisodes: [{ date: daysAgo(10) }, { date: daysAgo(200) }] };
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F20.0')], dateOfBirth: null, ...twoEvents }), NOW).status, 'not_indicated', 'adult status must be confirmed');
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F20.0')], dateOfBirth: new Date('2012-01-01'), ...twoEvents }), NOW).status, 'not_indicated');
  assert.equal(evaluateAot(chart({ diagnoses: [dx('F41.1')], ...twoEvents }), NOW).status, 'not_indicated');
  assert.equal(acuteEventKind('90837', '21'), 'inpatient');
  assert.equal(acuteEventKind('90837', '23'), 'ed');
  assert.equal(acuteEventKind('H2011', '11'), 'crisis');
  assert.equal(acuteEventKind('90837', '11'), null);
});

test('PRP: F41.9 never alone, Category B needs impairment, SMI without impairment is diagnosis-only; signed referral documents impairment', () => {
  assert.equal(prpDx('F30.11')?.category, 'A');
  assert.equal(prpDx('F30.4'), null, 'manic episode in remission');
  const f419 = evaluatePrp(chart({ diagnoses: [dx('F41.9')], locus: { composite: 22, level: 'Level 4', date: daysAgo(5) } }), NOW);
  assert.equal(f419.status, 'not_indicated');
  assert.match(f419.unmet[0], /F41\.9/);
  assert.equal(evaluatePrp(chart({ diagnoses: [dx('F41.9'), dx('F20.0')] }), NOW).status, 'screen', 'the SMI code still counts');
  const gad = evaluatePrp(chart({ diagnoses: [dx('F41.1')] }), NOW);
  assert.equal(gad.status, 'not_indicated');
  assert.ok(gad.unmet.some((u) => /does not qualify on the diagnosis alone/.test(u)));
  const ref = evaluatePrp(chart({ diagnoses: [dx('F33.2')], prpReferral: { date: daysAgo(10) } }), NOW);
  assert.equal(ref.status, 'candidate');
  assert.ok(ref.met.some((m) => /signed PRP referral/.test(m)));
  const oldRef = evaluatePrp(chart({ diagnoses: [dx('F33.2')], prpReferral: { date: daysAgo(90) } }), NOW);
  assert.equal(oldRef.status, 'screen');
  const low = evaluatePrp(chart({ diagnoses: [dx('F20.0')], locus: { composite: 12, level: 'Level 1', date: daysAgo(5) } }), NOW);
  assert.equal(low.status, 'potential', 'impairment evidence below threshold stays for clinician judgment');
});

test('TMS / Spravato: no medication history → diagnosis only; acute SI pathway still actionable', () => {
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F33.2')], phq9: { score: 25, date: daysAgo(3) } }), NOW).status, 'screen');
  assert.equal(evaluateSpravato(chart({ diagnoses: [dx('F33.2')], cssrs: { severity: 'High', safetyFlagged: true, date: daysAgo(2) } }), NOW).status, 'candidate');
  assert.equal(evaluateTms(chart({ diagnoses: [dx('F33.2'), dx('Z95.0', 'problem-list')] }), NOW).status, 'not_indicated', 'contraindication still wins');
});

test('worklist tiers: tiles = lists in every tier; hidden tiers counted on the selector; default hides dx-only and 2+ gap rows', () => {
  const rows: ScannerRow[] = [
    row('act', { prp: 'candidate', tms: 'potential' }, { gaps: { tms: ['phq9'] } }),
    row('needs', { tms: 'potential' }, { gaps: { tms: ['phq9', 'problem_list'] } }),
    row('dx', { prp: 'screen', tms: 'screen' }, { gaps: { prp: ['functional_impairment', 'locus'], tms: ['med_history'] } }),
    row('rev', { aot: 'review' }),
    row('enr', { prp: 'enrolled', iop: 'potential' }, { gaps: { iop: ['asam_intake'] } }),
  ];
  for (const tier of TIERS) {
    const f = { ...DEFAULT_FILTERS, tier };
    const tiles = tileCounts(rows, f, NOW);
    const tc = tierCounts(rows, f, NOW);
    for (const p of PROGRAMS) {
      for (const s of ['candidate', 'potential', 'review', 'screen', 'enrolled'] as const) {
        assert.equal(listRows(rows, { ...f, program: p, status: s }, NOW).length, tiles[p][s], `${tier} ${p}/${s}`);
      }
      const sum = tiles[p].candidate + tiles[p].potential + tiles[p].review + tiles[p].screen + (tier === 'all' ? tiles[p].enrolled : 0);
      assert.equal(listRows(rows, { ...f, program: p, status: 'all' }, NOW).length, sum, `${tier} card ${p}`);
      if (tier !== 'all') assert.equal(tc[p][tier], sum, `${tier} selector ${p}`);
    }
    if (tier !== 'all') assert.equal(tc.all[tier], listRows(rows, { ...f, program: 'all', status: 'all' }, NOW).length, `${tier} selector all`);
  }
  assert.deepEqual(listRows(rows, DEFAULT_FILTERS, NOW).map((r) => r.id).sort(), ['act', 'enr', 'rev'], 'default worklist: actionable only');
  assert.deepEqual(tierCounts(rows, DEFAULT_FILTERS, NOW).all, { actionable: 3, needs_data: 1, dx_only: 1 });
  assert.equal(tierOf('potential', 1), 'actionable');
  assert.equal(tierOf('potential', 2), 'needs_data');
  assert.equal(tierOf('screen', 0), 'dx_only');
  assert.equal(inTier('enrolled', 0, 'actionable'), true);
  assert.equal(inTier('not_indicated', 0, 'all'), false);
});
