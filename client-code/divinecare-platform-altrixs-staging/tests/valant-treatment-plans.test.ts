import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  VALANT_PLAN_TITLE,
  buildPlanSource,
  importedPlanGoals,
  importedPlanSummary,
  latestPlanPerPatient,
  mapValantPlanStatus,
  parsePlanSource,
  parseValantDate,
  parseValantDateTime,
  parseValantTreatmentPlanRow,
  planUpsertTarget,
  type ValantTreatmentPlan,
} from '../src/lib/migration/valantTreatmentPlans';
import { resolveProvider, splitProviderList } from '../src/lib/migration/providers';

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  'Patient ID': 'ABCDEF',
  'First Name': 'Test',
  'Last Name': 'Patient',
  'Treatment Plan Type': 'Valant Treatment Plan',
  Status: 'Active',
  'Last Update': '09/01/2026, 12:40 PM',
  'Next Review': '12/1/2026',
  Owner: 'Jane Doe, LCSWC',
  Supervisor: 'Sam Super, LCPC-S',
  'Other Providers': 'Kim Prescriber, CRNP-PMH',
  'Active/Inactive Patient': 'Active',
  ...over,
});

function plan(over: Record<string, string> = {}): ValantTreatmentPlan {
  const r = parseValantTreatmentPlanRow(row(over));
  assert.equal(r.kind, 'plan');
  return (r as { kind: 'plan'; plan: ValantTreatmentPlan }).plan;
}

test('status mapping: Active -> ACTIVE, Draft (New) -> DRAFT, anything else is an error', () => {
  assert.equal(mapValantPlanStatus('Active'), 'ACTIVE');
  assert.equal(mapValantPlanStatus('Draft (New)'), 'DRAFT');
  assert.equal(mapValantPlanStatus(' draft '), 'DRAFT');
  assert.equal(mapValantPlanStatus('Completed'), null);
  assert.equal(plan({ Status: 'Draft (New)' }).status, 'DRAFT');
  const bad = parseValantTreatmentPlanRow(row({ Status: 'Signed' }));
  assert.equal(bad.kind, 'error');
  assert.match((bad as { error: string }).error, /unknown plan status "Signed"/);
});

test('Last Update is clinic wall clock (America/New_York), DST aware', () => {
  // EDT (UTC-4) in September
  assert.equal(parseValantDateTime('09/01/2026, 12:40 PM')?.toISOString(), '2026-09-01T16:40:00.000Z');
  assert.equal(parseValantDateTime('08/24/2026, 04:46 PM')?.toISOString(), '2026-08-24T20:46:00.000Z');
  // 12 AM is midnight; EST (UTC-5) in December
  assert.equal(parseValantDateTime('12/15/2026, 12:05 AM')?.toISOString(), '2026-12-15T05:05:00.000Z');
  assert.equal(parseValantDateTime('13/01/2026, 10:00 AM'), null);
  assert.equal(parseValantDateTime('09/01/2026'), null);
  assert.equal(plan().lastUpdatedAt?.toISOString(), '2026-09-01T16:40:00.000Z');
  assert.equal(parseValantTreatmentPlanRow(row({ 'Last Update': 'yesterday' })).kind, 'error');
});

test('Next Review is a date only at noon UTC; blank means no review date', () => {
  assert.equal(parseValantDate('12/1/2026')?.toISOString(), '2026-12-01T12:00:00.000Z');
  assert.equal(parseValantDate('2/30/2026'), null);
  assert.equal(plan().reviewDueAt?.toISOString(), '2026-12-01T12:00:00.000Z');
  assert.equal(plan({ 'Next Review': '' }).reviewDueAt, null);
  assert.equal(parseValantTreatmentPlanRow(row({ 'Next Review': 'soon' })).kind, 'error');
});

test('footer and blank rows are skipped; a row without a Patient ID is an error', () => {
  assert.deepEqual(parseValantTreatmentPlanRow({ 'Patient ID': 'Count: 77', 'First Name': '', Status: '' }), { kind: 'skip', reason: 'footer' });
  assert.deepEqual(parseValantTreatmentPlanRow({ 'Patient ID': '', Status: '', Owner: '' }), { kind: 'skip', reason: 'blank' });
  assert.equal(parseValantTreatmentPlanRow(row({ 'Patient ID': '' })).kind, 'error');
});

test('row fields: patient id upper-cased, raw provider names kept, no plan content invented', () => {
  const p = plan({ 'Patient ID': 'abcdef', Supervisor: '', 'Other Providers': '' });
  assert.equal(p.sourcePatientId, 'ABCDEF');
  assert.equal(p.owner, 'Jane Doe, LCSWC');
  assert.equal(p.supervisor, null);
  assert.deepEqual(p.otherProviders, []);
  assert.equal(plan({ Owner: '' }).owner, null);
  const goals = importedPlanGoals(null, buildPlanSource(p, new Date('2026-10-16T12:00:00Z')));
  assert.deepEqual(goals.items, []);
  assert.deepEqual(Object.keys(goals).sort(), ['items', 'source']);
  assert.equal(VALANT_PLAN_TITLE, 'Valant Treatment Plan (imported)');
});

test('other providers: commas before credentials stay with the name', () => {
  assert.deepEqual(splitProviderList('Kumutha Daniel, CRNP-PMH'), ['Kumutha Daniel, CRNP-PMH']);
  assert.deepEqual(splitProviderList('Lee Brown, Nurse Practitioner'), ['Lee Brown, Nurse Practitioner']);
  assert.deepEqual(splitProviderList('Dr. Gbadehan'), ['Dr. Gbadehan']);
  assert.deepEqual(splitProviderList('Kumutha Daniel, CRNP-PMH, Dr. Gbadehan'), ['Kumutha Daniel, CRNP-PMH', 'Dr. Gbadehan']);
  assert.deepEqual(splitProviderList('A One, LCPC; B Two'), ['A One, LCPC', 'B Two']);
  assert.deepEqual(splitProviderList(''), []);
});

test('owner linking reuses the client import matcher (credentials stripped)', () => {
  const staff = [
    { id: 'u1', name: 'Mackenzie Goaneh', role: 'THERAPIST' },
    { id: 'u2', name: 'Lyndsay Murphy-Sweet', role: 'THERAPIST' },
    { id: 'u3', name: 'Ade Gbadehan', role: 'PSYCHIATRIST' },
  ];
  assert.equal(resolveProvider('Mackenzie Goaneh LCPC', staff).staff?.id, 'u1');
  assert.equal(resolveProvider('Lyndsay Murphy-Sweet', staff).staff?.id, 'u2');
  assert.equal(resolveProvider('Dr. Gbadehan', staff).staff?.id, 'u3');
  assert.equal(resolveProvider('Alaina Gay, LCSWC', staff).staff, null);
  assert.equal(resolveProvider('Alaina Gay, LCSWC', staff).name, 'Alaina Gay');
});

test('upsert decision: update the earlier Valant import, never a plan written in Altrixs', () => {
  const source = buildPlanSource(plan(), new Date('2026-10-16T12:00:00Z'));
  const native = { id: 'native', goals: { items: [{ id: 'G1', text: 'Reduce anxiety' }], clientSigned: true } };
  const imported = { id: 'imported', goals: importedPlanGoals(null, source) };
  assert.deepEqual(planUpsertTarget([]), { action: 'create' });
  assert.deepEqual(planUpsertTarget([native]), { action: 'create' });
  assert.deepEqual(planUpsertTarget([native, imported]), { action: 'update', planId: 'imported' });
  assert.deepEqual(planUpsertTarget([{ id: 'x', goals: { source: { platform: 'therapynotes' } } }]), { action: 'create' });
  assert.deepEqual(planUpsertTarget([{ id: 'y', goals: null }]), { action: 'create' });
});

test('re-import replaces only the source record; goals added in Altrixs stay', () => {
  const first = buildPlanSource(plan(), new Date('2026-10-16T12:00:00Z'));
  const edited = { ...importedPlanGoals(null, first), items: [{ id: 'G1', text: 'Added in Altrixs' }], clientSigned: true };
  const second = buildPlanSource(plan({ Status: 'Draft (New)' }), new Date('2026-10-20T12:00:00Z'));
  const next = importedPlanGoals(edited, second);
  assert.deepEqual(next.items, [{ id: 'G1', text: 'Added in Altrixs' }]);
  assert.equal(next.clientSigned, true);
  assert.equal(parsePlanSource(next)?.valantStatus, 'Draft (New)');
  assert.equal(parsePlanSource(next)?.importedAt, '2026-10-20T12:00:00.000Z');
});

test('source record round-trips and the banner summary names date and owner', () => {
  const s = parsePlanSource(importedPlanGoals(null, buildPlanSource(plan(), new Date('2026-10-16T12:00:00Z'))));
  assert.ok(s);
  assert.equal(s.platform, 'valant');
  assert.equal(s.planType, 'Valant Treatment Plan');
  assert.equal(s.lastUpdatedAt, '2026-09-01T16:40:00.000Z');
  assert.equal(s.supervisor, 'Sam Super, LCPC-S');
  assert.deepEqual(s.otherProviders, ['Kim Prescriber, CRNP-PMH']);
  assert.equal(importedPlanSummary(s), 'Last updated in Valant Sep 1, 2026 by Jane Doe, LCSWC.');
  assert.equal(parsePlanSource({ items: [] }), null);
});

test('a patient listed twice keeps the most recently updated plan', () => {
  const older = plan({ 'Last Update': '01/02/2026, 09:00 AM', Status: 'Draft (New)' });
  const newer = plan({ 'Last Update': '09/01/2026, 12:40 PM' });
  const other = plan({ 'Patient ID': 'ZZZZZZ' });
  const r = latestPlanPerPatient([older, newer, other]);
  assert.equal(r.duplicates, 1);
  assert.equal(r.plans.length, 2);
  assert.equal(r.plans.find((p) => p.sourcePatientId === 'ABCDEF')?.status, 'ACTIVE');
});

test('treatment plan lib keeps the import record when a plan is edited', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ehr', 'treatmentPlans.ts'), 'utf8');
  assert.match(src, /source: currentGoals\.source/);
  assert.match(src, /source: parsePlanSource\(obj\)/);
});

test('import route is leadership-gated, audited, and records a migration job', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'migration', 'treatment-plans', 'route.ts'), 'utf8');
  assert.match(src, /LEADERSHIP\.has\(gate\.role\)/);
  assert.match(src, /auditPhiAccess/);
  assert.match(src, /type: 'treatment_plans'/);
  assert.match(src, /organizationId: gate\.organizationId,\s*sourcePlatform: 'valant'/);
  assert.match(src, /assignedBy: IMPORT_TAG/);
});
