import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_LAB_TESTS, findTestByName, mergeCatalog, searchCatalog } from '../src/lib/labs/catalog';
import { isLoincShape, parseValantLabTypes, planLabCatalogImport, type PlannedLabTest } from '../src/lib/labs/catalogImport';
import { computeAbnormalFlag, parseReferenceRange, resolveResultFlag } from '../src/lib/labs/results';
import { addInterval, nextDueAfterOrder, standingDueState } from '../src/lib/labs/standing';
import { canEnterLabResults, canOrderLabs, canReleaseLabResults, canReviewLabResults, canViewLabs } from '../src/lib/labs/access';
import { labOrderStage, labResultInboxDrafts, releaseCheck, reviewCheck, canMoveStatus } from '../src/lib/labs/workflow';
import { LAB_ORDER_SETS, suggestedOrderSets } from '../src/lib/labs/orderSets';
import { buildRequisitionHtml } from '../src/lib/labs/requisition';
import { loadAllSections, summarizeInbox, type InboxDeps } from '../src/lib/inbox/core';
import { INBOX_SECTIONS, sectionsForRole } from '../src/lib/inbox/sections';

// Reference data only (Valant lab request type names); no patient data. Synthetic ids below.

const VALANT_NAMES = [
  '10-Panel Urine Drug Test + EtG', '25-hydroxyvitamin D (25(OH)D)', 'Acute Hepatitis Panel', 'Buprenorphine MAT', 'Carbamazepine, Serum', 'CBC',
  'Chemistry 7', 'Clozapine', 'Comprehensive Metabolic Panel', 'Depakote', 'EKG', 'Fasting Blood Glucose', 'Fasting Lipid Panel', 'Ferritin',
  'Folic Acid (Folate)', 'Gamma Glutamyl Transferase (GGT)', 'Hemoglobin A1C', 'Hepatic Function Panel', 'HIV Antibodies, preliminary with confirmation',
  'Human Chorionic Gonadotropin (HCG)', 'Iron, Serum', 'Lithium, Serum', 'Liver Function Tests (LFTs)', 'Magnesium, Serum', 'Nortriptyline, Serum',
  'Phosphate', 'Prolactin', 'Risperidone', 'Routine Urine Drug Abuse Profile, with confirmation', 'Routine Urine Drug Abuse Profile, without confirmation',
  'T4', 'Tegretol Level', 'Testosterone, Free', 'Testosterone, Total', 'Thyroid-stimulating Hormone Level', 'Total Iron Binding Capacity', 'TSH Reflex',
  'Urine Pregnancy Test', 'Valproic Acid, Serum', 'Vitamin B12',
];
const records = [['Name', 'Is Lab Panel?', 'LOINC Code', 'Status'], ...VALANT_NAMES.map((n) => [n, 'No', '', 'Active'])];

const asRows = (planned: PlannedLabTest[]) => planned.map(({ valantNames: _v, ...r }) => { void _v; return r; });

// ─── Catalog import ───────────────────────────────────────────────────────────

test('Valant lab request types: header check and 40 rows parsed', () => {
  const parsed = parseValantLabTypes(records);
  assert.equal(parsed.headerOk, true);
  assert.equal(parsed.rows.length, 40);
  assert.equal(parseValantLabTypes([['Foo', 'Bar']]).headerOk, false);
});

test('import dedupes same-test names into one orderable with aliases', () => {
  const plan = planLabCatalogImport(parseValantLabTypes(records).rows, []);
  const keyOf = (n: string) => plan.mapping.find((m) => m.valantName === n)?.key;
  assert.equal(keyOf('Liver Function Tests (LFTs)'), keyOf('Hepatic Function Panel'));
  assert.equal(keyOf('Depakote'), 'valproic');
  assert.equal(keyOf('Valproic Acid, Serum'), 'valproic');
  assert.equal(keyOf('Tegretol Level'), 'carbamazepine');
  assert.equal(keyOf('Carbamazepine, Serum'), 'carbamazepine');
  // Different tests stay different
  assert.notEqual(keyOf('Thyroid-stimulating Hormone Level'), keyOf('TSH Reflex'));
  assert.notEqual(keyOf('Routine Urine Drug Abuse Profile, with confirmation'), keyOf('Routine Urine Drug Abuse Profile, without confirmation'));
  assert.notEqual(keyOf('Testosterone, Free'), keyOf('Testosterone, Total'));
  // 40 names, 3 merges → 37 orderables; every name matched the catalog
  assert.equal(plan.create.length, 37);
  assert.equal(plan.duplicatesMerged.length, 3);
  assert.ok(plan.mapping.every((m) => m.relation !== 'new'), plan.mapping.filter((m) => m.relation === 'new').map((m) => m.valantName).join(', '));
  const lft = plan.create.find((c) => c.key === 'lft');
  assert.ok(lft?.aliases.includes('Liver Function Tests (LFTs)'));
  assert.deepEqual([...(lft?.sourceNames ?? [])].sort(), ['Hepatic Function Panel', 'Liver Function Tests (LFTs)']);
});

test('EKG is an in-office procedure, not a lab', () => {
  const plan = planLabCatalogImport(parseValantLabTypes(records).rows, []);
  const ekg = plan.create.find((c) => c.key === 'ekg');
  assert.equal(ekg?.category, 'procedure');
  assert.equal(ekg?.orderType, 'in_office_procedure');
});

test('re-import is idempotent; inactive status is followed', () => {
  const rows = parseValantLabTypes(records).rows;
  const first = planLabCatalogImport(rows, []);
  const again = planLabCatalogImport(rows, asRows(first.create));
  assert.equal(again.create.length, 0);
  assert.equal(again.update.length, 0);
  assert.equal(again.unchanged.length, 37);
  const inactive = rows.map((r) => (r.name === 'Ferritin' ? { ...r, active: false } : r));
  const third = planLabCatalogImport(inactive, asRows(first.create));
  assert.deepEqual(third.update.map((u) => [u.key, u.changed]), [['ferritin', ['active']]]);
});

test('Valant LOINC codes are never imported on their own; panel flag differences are reported', () => {
  const rows = parseValantLabTypes([
    ['Name', 'Is Lab Panel?', 'LOINC Code', 'Status'],
    ['Lithium, Serum', 'No', '14334-7', 'Active'],
    ['Ferritin', 'No', '2498-4', 'Active'],
    ['Comprehensive Metabolic Panel', 'No', 'abc', 'Active'],
    ['Some Local Test', 'No', '', 'Active'],
  ]).rows;
  const plan = planLabCatalogImport(rows, []);
  const notes = plan.review.map((r) => `${r.valantName}: ${r.note}`).join('\n');
  assert.ok(!/Lithium/.test(notes), 'matching verified LOINC is not flagged');
  assert.match(notes, /Ferritin: Valant LOINC 2498-4 differs/);
  assert.match(notes, /Comprehensive Metabolic Panel: Valant LOINC "abc" is not a valid/);
  assert.match(notes, /Comprehensive Metabolic Panel: Valant "Is Lab Panel\?" = No/);
  const local = plan.create.find((c) => c.name === 'Some Local Test');
  assert.equal(local?.loinc, null);
  assert.equal(local?.cpt, null);
  assert.equal(plan.create.find((c) => c.key === 'ferritin')?.loinc, '2276-4');
});

test('LOINC check digit', () => {
  assert.ok(isLoincShape('14334-7'));
  assert.ok(isLoincShape('2276-4'));
  assert.ok(!isLoincShape('14334-8'));
  assert.ok(!isLoincShape('abc'));
});

test('catalog codes are only verified codes: drug screens have no CPT, every LOINC passes the check digit', () => {
  for (const t of BUILTIN_LAB_TESTS) if (t.loinc) assert.ok(isLoincShape(t.loinc), `${t.key} ${t.loinc}`);
  for (const key of ['uds', 'uds-confirm', 'uds-10-etg', 'bup-mat', 'hcg-serum', 'hiv-ab-confirm']) {
    assert.equal(BUILTIN_LAB_TESTS.find((t) => t.key === key)?.cpt, null, key);
  }
  assert.equal(BUILTIN_LAB_TESTS.find((t) => t.key === 'clozapine')?.loinc, '6896-5');
});

test('search finds tests by alias and merged org rows keep built-in codes', () => {
  assert.equal(searchCatalog('depakote', BUILTIN_LAB_TESTS)[0]?.key, 'valproic');
  assert.equal(searchCatalog('chem 7', BUILTIN_LAB_TESTS)[0]?.key, 'bmp');
  assert.equal(findTestByName('LFTs', BUILTIN_LAB_TESTS)?.key, 'lft');
  const merged = mergeCatalog(BUILTIN_LAB_TESTS, [
    { key: 'lithium', name: 'Lithium Level, Serum', aliases: ['Lithium, Serum'], isPanel: false, components: [], loinc: null, cpt: null, specimenType: null, container: null, fastingRequired: false, specialHandling: null, category: 'therapeutic_drug_monitoring', orderType: 'lab', active: true, source: 'valant', sourceNames: ['Lithium, Serum'] },
  ]);
  const li = merged.find((t) => t.key === 'lithium');
  assert.equal(li?.cpt, '80178');
  assert.equal(li?.source, 'valant');
});

// ─── Abnormal flags ───────────────────────────────────────────────────────────

test('abnormal flag computed from the entered range', () => {
  assert.equal(computeAbnormalFlag('5.6', '3.5-5.0'), 'H');
  assert.equal(computeAbnormalFlag('3.1', '3.5 – 5.0'), 'L');
  assert.equal(computeAbnormalFlag('4.0', '3.5-5.0'), 'N');
  assert.equal(computeAbnormalFlag('250', '<200'), 'H');
  assert.equal(computeAbnormalFlag('45', '>40'), 'N');
  assert.equal(computeAbnormalFlag('38', '>=40'), 'L');
  assert.equal(computeAbnormalFlag('1,250', '150-450'), 'H');
  assert.equal(computeAbnormalFlag('Positive', 'Negative'), 'A');
  assert.equal(computeAbnormalFlag('Negative', 'Negative'), 'N');
  assert.equal(computeAbnormalFlag('<0.5', '0-1.0'), 'N');
  assert.equal(computeAbnormalFlag('>100', '0-1.0'), 'H');
  // Not computable: no range, or text against a numeric range
  assert.equal(computeAbnormalFlag('4.0', ''), null);
  assert.equal(computeAbnormalFlag('Positive', '0-1'), null);
});

test('critical flags only from the critical limits entered from the lab report', () => {
  assert.equal(computeAbnormalFlag('1.6', '0.6-1.2', '0.5-1.5'), 'HH');
  assert.equal(computeAbnormalFlag('0.3', '0.6-1.2', '0.5-1.5'), 'LL');
  assert.equal(computeAbnormalFlag('1.4', '0.6-1.2', '0.5-1.5'), 'H');
  assert.equal(computeAbnormalFlag('1.6', '0.6-1.2'), 'H', 'no default critical limits');
  assert.deepEqual(resolveResultFlag({ value: '4', refRange: '3-5', labFlag: 'HH' }), { flag: 'HH', flagSource: 'lab' });
  assert.deepEqual(resolveResultFlag({ value: '6', refRange: '3-5' }), { flag: 'H', flagSource: 'computed' });
  assert.deepEqual(resolveResultFlag({ value: 'See report' }), { flag: 'N', flagSource: 'none' });
  assert.equal(parseReferenceRange('nonsense 1 2'), null);
});

// ─── Standing orders ──────────────────────────────────────────────────────────

test('standing order next due date', () => {
  assert.equal(addInterval(new Date('2026-10-17T15:00:00Z'), 'months', 3).toISOString(), '2027-01-17T15:00:00.000Z');
  assert.equal(addInterval(new Date('2027-01-31T12:00:00Z'), 'months', 1).toISOString(), '2027-02-28T12:00:00.000Z');
  assert.equal(addInterval(new Date('2026-10-17T00:00:00Z'), 'weeks', 2).toISOString(), '2026-10-31T00:00:00.000Z');
  // Late order moves the schedule from when it was placed
  assert.equal(nextDueAfterOrder(new Date('2026-12-01T00:00:00Z'), 'months', 3).toISOString(), '2027-03-01T00:00:00.000Z');
});

test('standing order due state', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(standingDueState({ active: true, nextDueAt: '2026-10-10T00:00:00Z' }, now), 'overdue');
  assert.equal(standingDueState({ active: true, nextDueAt: '2026-10-25T00:00:00Z' }, now), 'due_soon');
  assert.equal(standingDueState({ active: true, nextDueAt: '2026-12-25T00:00:00Z' }, now), 'scheduled');
  assert.equal(standingDueState({ active: false, nextDueAt: '2026-10-10T00:00:00Z' }, now), 'ended');
  assert.equal(standingDueState({ active: true, nextDueAt: '2027-02-01T00:00:00Z', endDate: '2027-01-01T00:00:00Z' }, now), 'ended');
});

// ─── Role gates ───────────────────────────────────────────────────────────────

test('physicians, medical NPs, psychiatrists and NPs order labs; others do not', () => {
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'PSYCHIATRIST', 'NP', 'physician']) assert.ok(canOrderLabs(r), r);
  for (const r of ['MEDICAL_ASSISTANT', 'THERAPIST', 'CASE_MANAGER', 'FRONT_DESK', 'ADMIN', 'BILLING']) assert.ok(!canOrderLabs(r), r);
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PSYCHIATRIST']) assert.ok(canViewLabs(r), `${r} views labs`);
  for (const r of ['FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT']) assert.ok(!canViewLabs(r), `${r} does not view labs`);
});

test('medical assistant can enter results but not sign off or release', () => {
  assert.ok(canEnterLabResults('MEDICAL_ASSISTANT'));
  assert.ok(!canReviewLabResults('MEDICAL_ASSISTANT'));
  assert.ok(!canReleaseLabResults('MEDICAL_ASSISTANT'));
  assert.ok(canReviewLabResults('PHYSICIAN'));
  assert.ok(canEnterLabResults('PHYSICIAN'));
  assert.ok(!canEnterLabResults('THERAPIST'), 'therapists view only');
  assert.ok(!canEnterLabResults('FRONT_DESK'));
});

// ─── Review → release order ───────────────────────────────────────────────────

test('workflow stages and portal release order: resulted → reviewed → released', () => {
  const base = { status: 'resulted', resultCount: 3, reviewedAt: null as string | null, releasedAt: null as string | null };
  assert.equal(labOrderStage({ status: 'ordered' }), 'ordered');
  assert.equal(labOrderStage({ status: 'pending' }), 'sent');
  assert.equal(labOrderStage({ status: 'critical' }), 'resulted');
  assert.equal(releaseCheck(base).ok, false, 'not before review');
  assert.match((releaseCheck(base) as { error: string }).error, /review/);
  assert.equal(reviewCheck(base).ok, true);
  const reviewed = { ...base, reviewedAt: '2026-10-17T12:00:00Z' };
  assert.equal(labOrderStage(reviewed), 'reviewed');
  assert.equal(reviewCheck(reviewed).ok, false, 'no double sign-off');
  assert.equal(releaseCheck(reviewed).ok, true);
  const released = { ...reviewed, releasedAt: '2026-10-17T13:00:00Z' };
  assert.equal(labOrderStage(released), 'released');
  assert.equal(releaseCheck(released).ok, false, 'released once');
  assert.equal(releaseCheck({ ...base, status: 'ordered' }).ok, false);
  assert.equal(reviewCheck({ ...base, resultCount: 0 }).ok, false);
});

test('manual status steps cannot skip to resulted', () => {
  assert.ok(canMoveStatus('ordered', 'collected'));
  assert.ok(canMoveStatus('collected', 'pending'));
  assert.ok(!canMoveStatus('ordered', 'resulted'));
  assert.ok(!canMoveStatus('resulted', 'ordered'));
});

// ─── Inbox: lab results to review ─────────────────────────────────────────────

const unreviewed = [
  { id: 'lab-1', clientId: 'client-a', clientName: 'Test Client A', panels: ['Lithium Level, Serum'], otherPanel: null, hasCritical: true, status: 'critical', resultedAt: '2026-10-17T10:00:00Z', orderedAt: '2026-10-15T10:00:00Z', abnormalCount: 1 },
  { id: 'lab-2', clientId: 'client-b', clientName: 'Test Client B', panels: ['Lipid Panel'], otherPanel: null, hasCritical: false, status: 'resulted', resultedAt: '2026-10-16T10:00:00Z', orderedAt: '2026-10-14T10:00:00Z', abnormalCount: 2 },
  { id: 'lab-3', clientId: 'client-c', clientName: 'Test Client C', panels: ['TSH (Thyroid-Stimulating Hormone)'], otherPanel: null, hasCritical: false, status: 'resulted', resultedAt: null, orderedAt: '2026-10-14T10:00:00Z', abnormalCount: 0 },
];

test('lab results inbox rows: critical urgent, abnormal high, chart link', () => {
  const drafts = labResultInboxDrafts(unreviewed);
  assert.deepEqual(drafts.map((d) => d.priority), ['urgent', 'high', 'normal']);
  assert.match(drafts[0].title, /CRITICAL/);
  assert.equal(drafts[0].href, '/dashboard/clients/client-a?tab=labs');
  assert.equal(drafts[2].since, '2026-10-14T10:00:00.000Z', 'falls back to the order time');
});

test('inbox: "Lab results to review" for prescribers only, counts match the loader', async () => {
  assert.ok(sectionsForRole('PHYSICIAN').some((s) => s.key === 'lab_results'));
  assert.ok(sectionsForRole('PSYCHIATRIST').some((s) => s.key === 'lab_results'));
  assert.ok(!sectionsForRole('MEDICAL_ASSISTANT').some((s) => s.key === 'lab_results'));
  assert.ok(!sectionsForRole('THERAPIST').some((s) => s.key === 'lab_results'));
  const loaders = Object.fromEntries(INBOX_SECTIONS.map((s) => [s.key, async () => ({ drafts: s.key === 'lab_results' ? labResultInboxDrafts(unreviewed) : [] })])) as unknown as InboxDeps['loaders'];
  const deps: InboxDeps = { loaders, lockedClientIds: async () => new Set(['client-c']) };
  const now = new Date('2026-10-17T16:00:00Z');
  const results = await loadAllSections({ organizationId: 'org', userId: 'u', role: 'PHYSICIAN' }, deps, now);
  const lab = results.find((r) => r.key === 'lab_results');
  assert.equal(lab?.items.length, 3);
  assert.equal(lab?.items.find((i) => i.clientId === 'client-c')?.protected, true, 'Part 2 masked');
  const summary = summarizeInbox(results, now);
  const s = summary.sections.find((x) => x.key === 'lab_results');
  assert.equal(s?.count, 3);
  assert.equal(s?.urgent, 1);
});

// ─── Order sets and requisition ───────────────────────────────────────────────

test('order sets reference catalog tests and match active medications', () => {
  const keys = new Set(BUILTIN_LAB_TESTS.map((t) => t.key));
  for (const set of LAB_ORDER_SETS) for (const it of set.items) assert.ok(keys.has(it.testKey), `${set.key}: ${it.testKey}`);
  assert.deepEqual(suggestedOrderSets([{ name: 'Lithium carbonate 300 mg' }, { name: 'Depakote ER' }]), ['lithium', 'valproate']);
  assert.deepEqual(suggestedOrderSets([{ name: 'Clozapine 100 mg' }]), ['clozapine', 'antipsychotic-metabolic']);
  assert.deepEqual(suggestedOrderSets([{ name: 'Med X', isAntipsychotic: true }]), ['antipsychotic-metabolic']);
});

test('requisition prints "Not on file" for missing identifiers and escapes values', () => {
  const html = buildRequisitionHtml({
    order: {
      id: 'lab-x', clientName: 'Test <Client>', clientId: 'client-x', lab: 'QUEST', priority: 'STAT', specimen: null, panels: ['Lithium Level, Serum'],
      otherPanel: null, icd10Codes: ['F31.81'], clinicalNotes: null, orderedByName: 'Dr Test', orderedAt: '2026-10-17T12:00:00Z', signerNpi: null,
      facilityName: 'Practice', facilityClia: null, signatureHash: null, fastingRequired: false, collectionSite: 'in_office', billTo: 'insurance', abnRequired: false, abnNote: null,
      testLines: [{ key: 'lithium', name: 'Lithium Level, Serum', diagnoses: [{ code: 'F31.81', description: 'Bipolar II disorder' }], loinc: '14334-7', cpt: '80178', fastingRequired: false, orderType: 'lab' }],
    },
    patient: { mrn: null, dateOfBirth: null, sex: null, phone: null, address: null, insurancePayer: null, insuranceMemberId: null, insuranceGroupNumber: null, insuranceType: null },
    practice: { name: '', organizationNpi: null, phone: null, fax: null, address: null },
    testDetails: {},
  });
  assert.match(html, /Test &lt;Client&gt;/);
  assert.match(html, /NPI: <span class="nof">Not on file<\/span>/);
  assert.match(html, /CLIA: <span class="nof">Not on file<\/span>/);
  assert.match(html, /80178/);
  assert.match(html, /A\. F31\.81/);
  assert.ok(!/HL7|CAP Accredited/.test(html), 'no claims of an electronic interface or accreditation');
});
