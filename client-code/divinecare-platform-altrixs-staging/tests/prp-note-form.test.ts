/**
 * PRP progress note form (owner's paper form review, Oct 27 2026): structured contact fields,
 * IRP objectives + carry-forward, sign rules from the existing PRP encounter rule, signature
 * reasons (no "Covid 19"), print, routes, migration and editor wiring.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  EMPTY_PRP_DETAIL,
  PRP_CONTACT_TYPES,
  PRP_INTERVENTIONS,
  PRP_SIGNATURE_REASONS,
  carryForwardObjectives,
  contactTypeFromNote,
  defaultPrpLocation,
  irpObjectiveOptions,
  irpOverdue,
  irpWarnings,
  minutesBetween,
  normalizeParticipants,
  noteFieldsForContactType,
  prpDetailPrintSections,
  prpNoteIssues,
  type PrpNoteDetail,
} from '../src/lib/prp/progressNote';
import { prpContactIssues } from '../src/lib/notes/standard';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const complete: PrpNoteDetail = {
  ...EMPTY_PRP_DETAIL,
  location: 'onsite',
  objectives: [{ key: 'g1', label: 'Objective #1: Independent Living Skills — budget weekly' }],
  interventions: ['skills_independent_living'],
  progress: 'progressing',
  patientSignatureStatus: 'signed',
  patientSignatureName: 'Pat Example',
};

const base = { dateOfService: '2026-10-27', startTime: '10:00', endTime: '10:45', responseText: 'Engaged; practiced the budget worksheet.' };

test('contact types use standard wording; E-visit maps to telehealth; one source of truth on the note', () => {
  assert.deepEqual(PRP_CONTACT_TYPES.map((c) => c.value), ['in_person', 'telehealth_video', 'audio_only']);
  assert.ok(!PRP_CONTACT_TYPES.some((c) => /e-visit/i.test(c.label)));
  assert.deepEqual(noteFieldsForContactType('in_person'), { telehealth: false, telehealthModality: null });
  assert.deepEqual(noteFieldsForContactType('telehealth_video'), { telehealth: true, telehealthModality: 'audio_video' });
  assert.deepEqual(noteFieldsForContactType('audio_only'), { telehealth: true, telehealthModality: 'audio_only' });
  assert.equal(contactTypeFromNote(false, null), 'in_person');
  assert.equal(contactTypeFromNote(true, 'audio_only'), 'audio_only');
  assert.equal(contactTypeFromNote(true, null), 'telehealth_video');
});

test('participants always include the patient', () => {
  assert.deepEqual(normalizeParticipants([]), ['patient']);
  assert.deepEqual(normalizeParticipants(['family', 'bogus', 'family']), ['patient', 'family']);
});

test('intervention picklist covers the standard PRP interventions', () => {
  const v = PRP_INTERVENTIONS.map((i) => i.value);
  for (const k of ['skills_independent_living', 'skills_social', 'skills_vocational', 'skills_health_wellness', 'psychoeducation', 'symptom_management', 'crisis_safety_planning', 'community_integration', 'linkage_referral', 'medication_adherence']) {
    assert.ok(v.includes(k as (typeof v)[number]), k);
  }
});

test('signature reasons replace the outdated Covid 19 wording', () => {
  assert.deepEqual(PRP_SIGNATURE_REASONS.map((r) => r.value), ['telehealth', 'declined', 'unable_symptoms', 'other']);
  assert.ok(!PRP_SIGNATURE_REASONS.some((r) => /covid/i.test(r.label)));
  assert.doesNotMatch(read('src/components/notes/PrpNoteFields.tsx'), /covid/i);
});

test('IRP objectives come from the IRP goal rows, numbered in order', () => {
  const opts = irpObjectiveOptions({
    status: 'final',
    goals: [
      { id: 'a', need: 'Independent Living Skills', shortTermGoal: 'Budget weekly', longTermGoal: 'Live independently' },
      { id: 'b', need: '', shortTermGoal: '', longTermGoal: '' },
      { need: 'Social', longTermGoal: 'Join a club' },
    ],
  });
  assert.equal(opts.length, 2);
  assert.equal(opts[0].key, 'a');
  assert.equal(opts[0].number, 1);
  assert.match(opts[0].label, /^Objective #1: Independent Living Skills — Budget weekly/);
  assert.equal(opts[1].number, 2);
  assert.equal(opts[1].key, 'goal-3');
  assert.deepEqual(irpObjectiveOptions(null), []);
});

test('carry-forward suggests the last note objectives that are still on the IRP', () => {
  const opts = irpObjectiveOptions({ goals: [{ id: 'a', need: 'Social', shortTermGoal: 'Call a friend' }] });
  const s = carryForwardObjectives([{ key: 'a', label: 'old label' }, { key: 'gone', label: 'removed goal' }], opts);
  assert.deepEqual(s, [{ key: 'a', label: opts[0].label }]);
});

test('IRP warnings: missing, draft and overdue (warnings, never blocks)', () => {
  assert.equal(irpWarnings({ status: 'none', reviewDueDate: null, overdue: false }).length, 1);
  assert.match(irpWarnings({ status: 'draft', reviewDueDate: null, overdue: false })[0], /draft/);
  assert.match(irpWarnings({ status: 'final', reviewDueDate: '2026-09-01', overdue: true })[0], /overdue/);
  assert.equal(irpWarnings({ status: 'final', reviewDueDate: '2027-01-01', overdue: false }).length, 0);
  assert.equal(irpOverdue('2026-10-01', '2026-10-27'), true);
  assert.equal(irpOverdue('2026-11-01', '2026-10-27'), false);
  assert.equal(irpOverdue(null, '2026-10-27'), false);
});

test('location defaults on-site only for an in-person visit at a practice location', () => {
  assert.equal(defaultPrpLocation({ telehealth: false, locationId: 'bowie' }), 'onsite');
  assert.equal(defaultPrpLocation({ telehealth: true, locationId: 'bowie' }), null);
  assert.equal(defaultPrpLocation(null), null);
});

test('sign rules reuse the PRP encounter rule (date, minutes, location, IRP goal, intervention, response)', () => {
  assert.equal(minutesBetween('10:00', '10:45'), 45);
  assert.equal(minutesBetween('10:45', '10:00'), null);
  const ok = prpNoteIssues({ detail: complete, ...base });
  assert.deepEqual(ok.filter((i) => i.severity === 'block'), []);
  const empty = prpNoteIssues({ detail: null, dateOfService: null });
  const ids = empty.filter((i) => i.severity === 'block').map((i) => i.id);
  for (const id of ['prp.date', 'prp.minutes', 'prp.location', 'prp.IRP', 'prp.intervention', 'prp.participant', 'prp.signature']) assert.ok(ids.includes(id), id);
  // Duration instead of a clock; narrative intervention instead of the picklist; "Other" objective
  const alt = prpNoteIssues({ detail: { ...complete, objectives: [], objectiveOther: 'Housing crisis', interventions: [] }, dateOfService: '2026-10-27', durationMinutes: 30, interventionText: 'Coached a call to the landlord', responseText: 'Calmer' });
  assert.deepEqual(alt.filter((i) => i.severity === 'block'), []);
});

test('off-site needs a community location; "other" participants / collaboration need text', () => {
  const r = prpNoteIssues({ detail: { ...complete, location: 'offsite', participants: ['patient', 'other'], collaboration: ['other'] }, ...base });
  const ids = r.map((i) => i.id);
  assert.ok(ids.includes('prp.community'));
  assert.ok(ids.includes('prp.participants'));
  assert.ok(ids.includes('prp.collaboration'));
});

test('participant signature: signed name, or a reason (other needs text)', () => {
  const noReason = prpNoteIssues({ detail: { ...complete, patientSignatureStatus: 'not_obtained', patientSignatureName: null }, ...base });
  assert.ok(noReason.some((i) => i.id === 'prp.signature'));
  const other = prpNoteIssues({ detail: { ...complete, patientSignatureStatus: 'not_obtained', patientSignatureReason: 'other' }, ...base });
  assert.ok(other.some((i) => i.id === 'prp.signature'));
  const tele = prpNoteIssues({ detail: { ...complete, patientSignatureStatus: 'not_obtained', patientSignatureReason: 'telehealth' }, ...base });
  assert.ok(!tele.some((i) => i.id === 'prp.signature'));
});

test('no new billing rule: the unconfirmed H2017 unit rule is a warning only', () => {
  const w = prpNoteIssues({ detail: complete, ...base }).find((i) => i.id === 'prp.billing_rule');
  assert.ok(w);
  assert.equal(w!.severity, 'warn');
});

test('prpContactIssues: PRP notes only, and the format-elements date gate softens blocks to warnings', () => {
  assert.deepEqual(prpContactIssues({ noteType: 'SOAP', body: '', detail: null, dateOfService: null }), []);
  const strict = prpContactIssues({ noteType: 'PRP', body: '', detail: null, dateOfService: '2026-10-27' });
  assert.ok(strict.some((i) => i.severity === 'block'));
  const soft = prpContactIssues({ noteType: 'PRP', body: '', detail: null, dateOfService: '2026-10-27', formatElements: { enforced: false, enforceFrom: '2026-11-16' } });
  assert.ok(!soft.some((i) => i.severity === 'block'));
  const body = 'Intervention\nCoached budgeting\n\nParticipant Response\nEngaged and practiced';
  const fromBody = prpContactIssues({ noteType: 'PRP Progress Note', body, detail: { ...complete, interventions: [] }, dateOfService: '2026-10-27', startTime: '09:00', endTime: '09:30' });
  assert.deepEqual(fromBody.filter((i) => i.severity === 'block'), []);
});

test('print: structured PRP contact section with signature line', () => {
  const [sec] = prpDetailPrintSections({ ...complete, patientSignedAt: '2026-10-27T15:00:00.000Z' }, { telehealth: false, modality: null });
  assert.equal(sec.title, 'PRP Contact');
  assert.match(sec.text, /Contact type: Face-to-face \(in person\)/);
  assert.match(sec.text, /Individuals involved: PRP staff, Participant/);
  assert.match(sec.text, /Objective\(s\) addressed: Objective #1/);
  assert.match(sec.text, /Participant signature: Pat Example/);
  const [nos] = prpDetailPrintSections({ ...complete, patientSignatureStatus: 'not_obtained', patientSignatureReason: 'declined' }, { telehealth: true, modality: 'audio_only' });
  assert.match(nos.text, /Telehealth \(audio-only\)/);
  assert.match(nos.text, /not obtained: Participant declined/);
  assert.deepEqual(prpDetailPrintSections(null, { telehealth: false, modality: null }), []);
});

test('migration is idempotent and adds no column to ProgressNote', () => {
  const sql = read('prisma/migrations/20261027_prp_note_detail.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS progress_note_prp_details/);
  assert.match(sql, /REFERENCES "ProgressNote"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /ALTER TABLE "ProgressNote"/);
  assert.match(read('prisma/schema.prisma'), /model ProgressNotePrpDetail \{[\s\S]*?@@map\("progress_note_prp_details"\)/);
});

test('routes: draft-only edits by the author, audit with field names only', () => {
  const route = read('src/app/api/notes/[id]/prp-detail/route.ts');
  assert.match(route, /requireAccessibleNote/);
  assert.match(route, /isElevatedNoteActor/);
  assert.match(route, /metadata: \{ fields: Object\.keys\(parsed\.data\) \}/);
  assert.match(read('src/lib/prp/progressNoteDb.ts'), /A signed note is immutable/);
  const ctx = read('src/app/api/notes/prp-context/route.ts');
  assert.match(ctx, /requireNotesGate/);
  assert.match(read('src/lib/prp/progressNoteDb.ts'), /clientAccessWhere/);
});

test('sign path and standard panel apply the PRP rules; print includes the contact section', () => {
  assert.match(read('src/lib/notes/workflow-store.ts'), /prpContactIssues\(/);
  assert.match(read('src/app/api/notes/[id]/standard/route.ts'), /prpContactIssues\(/);
  assert.match(read('src/app/api/notes/[id]/standard/route.ts'), /irpWarnings/);
  assert.match(read('src/lib/notes/print.ts'), /prpDetailPrintSections/);
});

test('editor: PRP fields render for PRP notes, prefill from the visit, save with the note', () => {
  const page = read('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(page, /<PrpNoteFields/);
  assert.match(page, /\/api\/notes\/prp-context/);
  assert.match(page, /defaultPrpLocation\(ctx\.appointment\)/);
  assert.match(page, /persistPrpDetail\(existingId\)/);
  assert.match(page, /persistPrpDetail\(created\.id\)/);
  const ui = read('src/components/notes/PrpNoteFields.tsx');
  assert.match(ui, /Use objectives from last note/);
  assert.match(ui, /Book follow-up/);
  assert.match(ui, /Unable to obtain/);
  // No emoji in the new UI
  assert.doesNotMatch(ui, /\p{Extended_Pictographic}/u);
});
