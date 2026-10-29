/**
 * Prescriber feedback (staging): change the note type of an unsigned note during the visit
 * (src/lib/notes/typeChange.ts) and dismiss an unsigned note that is not needed
 * (src/lib/notes/dismiss.ts, dismissStore.ts). Pure logic + source-level checks. Synthetic data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  carriedOverHeading,
  cptAfterTypeChange,
  isCarriedOverHeading,
  isKnownNoteTypeValue,
  isNoteTypeChange,
  noteTypeChangeError,
  remapSectionsForTypeChange,
  splitCarriedOver,
  typeChangeConfirmText,
} from '../src/lib/notes/typeChange';
import {
  canUndoDismiss,
  composeDismissReason,
  DISMISS_REASONS,
  DISMISS_UNDO_DAYS,
  dismissBlocker,
  dismissReasonError,
  NOT_DISMISSED,
  undoDismissBlocker,
} from '../src/lib/notes/dismiss';
import { NOTE_SECTIONS } from '../src/lib/ehr/noteTemplates';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ─── Note type change ────────────────────────────────────────────────────────

test('type change keeps same-heading sections and carries the rest under a labelled section', () => {
  const r = remapSectionsForTypeChange({
    fromType: 'Intake',
    toHeadings: NOTE_SECTIONS.SOAP,
    texts: { 'Presenting Problem': 'Low mood x 3 months', Assessment: 'MDD, moderate', Plan: 'Weekly therapy', Empty: '   ' },
  });
  assert.equal(r.texts.Assessment, 'MDD, moderate');
  assert.equal(r.texts.Plan, 'Weekly therapy');
  assert.equal(r.texts.Subjective, '');
  assert.equal(r.carriedHeading, 'Carried over from Clinical Intake Assessment');
  assert.equal(r.texts[r.carriedHeading as string], 'Presenting Problem\nLow mood x 3 months');
  assert.deepEqual(r.carried, ['Presenting Problem']);
  assert.deepEqual(r.kept.sort(), ['Assessment', 'Plan']);
  // Nothing typed is lost
  const all = Object.values(r.texts).join('\n');
  for (const t of ['Low mood x 3 months', 'MDD, moderate', 'Weekly therapy']) assert.ok(all.includes(t));
});

test('type change matches headings ignoring case / punctuation; no carried section when all maps', () => {
  const r = remapSectionsForTypeChange({ fromType: 'DAP', toHeadings: ['Assessment', 'Plan'], texts: { 'assessment:': 'A', PLAN: 'P' } });
  assert.equal(r.texts.Assessment, 'A');
  assert.equal(r.texts.Plan, 'P');
  assert.equal(r.carriedHeading, null);
});

test('an earlier carried-over section is carried again, labels kept', () => {
  const first = remapSectionsForTypeChange({ fromType: 'Intake', toHeadings: ['Data', 'Assessment', 'Plan'], texts: { 'Presenting Problem': 'x' } });
  const second = remapSectionsForTypeChange({ fromType: 'DAP', toHeadings: NOTE_SECTIONS.SOAP, texts: { ...first.texts, Data: 'd' } });
  const carried = second.texts[second.carriedHeading as string];
  assert.ok(carried.includes('Carried over from Clinical Intake Assessment\nPresenting Problem\nx'));
  assert.ok(carried.includes('Data\nd'));
});

test('carried-over heading detection is strict; split finds the block at the end', () => {
  assert.ok(isCarriedOverHeading(carriedOverHeading('Adult Psych Intake')));
  assert.ok(isCarriedOverHeading('Carried over from SOAP'));
  assert.equal(isCarriedOverHeading('Carried over from last week, client reports better sleep'), false);
  const body = 'Subjective\nok\n\nPlan\nf/u\n\nCarried over from Clinical Intake Assessment\nPresenting Problem\nLow mood';
  const split = splitCarriedOver(body);
  assert.equal(split.main, 'Subjective\nok\n\nPlan\nf/u');
  assert.deepEqual(split.carried, [{ heading: 'Carried over from Clinical Intake Assessment', text: 'Presenting Problem\nLow mood' }]);
  assert.deepEqual(splitCarriedOver('Plan\nCarried over from last week').carried, []);
});

test('confirmation text and type-change detection', () => {
  assert.equal(
    typeChangeConfirmText('Adult Psych Intake', 'Psych Med Mgmt'),
    "Change Adult Psychiatry Intake to Psychiatric Med Management? Text in sections the new template doesn't have is kept under 'Carried over'."
  );
  assert.equal(isNoteTypeChange('Psych Med Mgmt', 'Psychiatric Med Management'), false);
  assert.equal(isNoteTypeChange('Adult Psych Intake', 'Psych Med Mgmt'), true);
  assert.equal(isNoteTypeChange('SOAP', undefined), false);
});

test('server rule: known type, unsigned, not dismissed', () => {
  assert.equal(noteTypeChangeError({ toType: 'Psych Med Mgmt', status: 'draft', dismissed: false }), null);
  assert.equal(noteTypeChangeError({ toType: 'Psychiatric Med Management', status: 'Draft', dismissed: false }), null);
  assert.match(noteTypeChangeError({ toType: 'Made Up Note', status: 'draft', dismissed: false }) || '', /Unknown note type/);
  for (const status of ['signed', 'locked']) assert.match(noteTypeChangeError({ toType: 'SOAP', status, dismissed: false }) || '', /unsigned/);
  assert.match(noteTypeChangeError({ toType: 'SOAP', status: 'draft', dismissed: true }) || '', /dismissed/);
  assert.equal(isKnownNoteTypeValue('Therapy Progress'), true);
});

test('service code after a type change', () => {
  const all = ['90791', '90834', '90837'];
  assert.equal(cptAfterTypeChange('90791', 'SOAP', all), '', 'evaluation code does not stay on a progress note');
  assert.equal(cptAfterTypeChange('90791', 'Intake', all), '90791');
  assert.equal(cptAfterTypeChange('90837', 'DAP', all), '90837');
  assert.equal(cptAfterTypeChange('99214', 'DAP', all), '', 'code the new type does not offer');
  assert.equal(cptAfterTypeChange('90837', 'Psych Med Mgmt', all), '', 'structured templates start without a code');
});

// ─── Dismiss ─────────────────────────────────────────────────────────────────

test('dismiss reason: picker + details, min 5 characters, Other needs details', () => {
  assert.ok(DISMISS_REASONS.includes("Visit didn't happen"));
  assert.equal(composeDismissReason('Duplicate note', ''), 'Duplicate note');
  assert.equal(composeDismissReason('Duplicate note', ' second draft '), 'Duplicate note: second draft');
  assert.equal(composeDismissReason('Other', 'test'), 'Other: test');
  assert.equal(composeDismissReason('Other', ''), '');
  assert.equal(dismissReasonError('Duplicate note'), null);
  assert.match(dismissReasonError('dup') || '', /at least 5/);
  assert.match(dismissReasonError('') || '', /at least 5/);
});

test('only unsigned, un-co-signed, not-yet-dismissed notes can be dismissed', () => {
  assert.equal(dismissBlocker({ status: null }), null);
  assert.equal(dismissBlocker({ status: 'DRAFT' }), null);
  assert.match(dismissBlocker({ status: 'SIGNED' }) || '', /unsigned/);
  assert.match(dismissBlocker({ status: 'LOCKED' }) || '', /unsigned/);
  assert.match(dismissBlocker({ status: 'DRAFT', cosignedAt: new Date() }) || '', /unsigned/);
  assert.match(dismissBlocker({ status: 'DRAFT', dismissedAt: new Date() }) || '', /already/);
});

test('undo: author (or leadership) within 30 days', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const recent = new Date('2026-10-01T12:00:00Z');
  const old = new Date(now.getTime() - (DISMISS_UNDO_DAYS + 1) * 86_400_000);
  assert.equal(canUndoDismiss({ dismissedAt: recent, now, isAuthor: true, elevated: false }), true);
  assert.equal(canUndoDismiss({ dismissedAt: recent, now, isAuthor: false, elevated: true }), true);
  assert.match(undoDismissBlocker({ dismissedAt: recent, now, isAuthor: false, elevated: false }) || '', /author/);
  assert.match(undoDismissBlocker({ dismissedAt: old, now, isAuthor: true, elevated: false }) || '', /30 days/);
  assert.match(undoDismissBlocker({ dismissedAt: null, now, isAuthor: true, elevated: false }) || '', /not dismissed/);
  assert.deepEqual(NOT_DISMISSED, { dismissedAt: null });
});

// ─── Source-level checks ─────────────────────────────────────────────────────

test('schema + idempotent migration add the dismiss columns', () => {
  const schema = read('prisma/schema.prisma');
  for (const col of ['dismissedAt     DateTime?', 'dismissedById   String?', 'dismissedByName String?', 'dismissReason   String?']) assert.ok(schema.includes(col), col);
  const sql = read('prisma/migrations/20261023_note_dismiss.sql');
  for (const col of ['dismissedAt', 'dismissedById', 'dismissedByName', 'dismissReason']) {
    assert.ok(sql.includes(`ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "${col}"`), col);
  }
  assert.doesNotMatch(sql, /DELETE FROM/i);
});

test('dismiss never deletes, is conditional on unsigned, resets the visit note status, and is audited', () => {
  const store = read('src/lib/notes/dismissStore.ts');
  assert.doesNotMatch(store, /progressNote\.delete/);
  assert.match(store, /updateMany\(\{\s*where: \{ id: note\.id, dismissedAt: null, \.\.\.UNSIGNED \}/);
  assert.match(store, /noteStatus: \{ in: \['AI_DRAFT', 'IN_PROGRESS'\] \}[\s\S]*noteStatus: 'NOT_STARTED'/);
  assert.match(store, /isElevatedNoteActor/);
  const route = read('src/app/api/notes/[id]/dismiss/route.ts');
  assert.match(route, /action: 'NOTE_DISMISS'/);
  assert.match(route, /action: 'NOTE_DISMISS_UNDO'/);
  assert.match(route, /clientAccessWhere/);
  // Audit metadata: the reason category, never the free-text details
  assert.match(route, /reasonCategory: DISMISS_REASONS\.find/);
});

test('dismissed notes drop out of queues, counts and visit status; a visit with only a dismissed note needs a note', () => {
  const wl = read('src/lib/notes/worklist.ts');
  assert.match(wl, /AND: \[scope, NOT_DISMISSED, \.\.\.filters, \.\.\.extra\]/);
  assert.match(wl, /progressNotes: \{ none: NOT_DISMISSED \}/);
  assert.match(wl, /UNSIGNED,\r?\n\s*NOT_DISMISSED,/, 'escalated overdue list');
  assert.match(wl, /includeDismissed/);
  assert.match(read('src/lib/analytics/visitDocumentationServer.ts'), /appointmentId: \{ in: appointmentIds \}, dismissedAt: null/);
  assert.match(read('src/lib/clients/notes.ts'), /noteWhere = \{ client: clientWhere, dismissedAt: null \}/);
  assert.match(read('src/lib/dashboard/homeData.ts'), /UNSIGNED: Prisma\.ProgressNoteWhereInput = \{ dismissedAt: null/);
  assert.match(read('src/lib/ehr/copyForward.ts'), /dismissedAt: null/);
});

test('dismissed notes cannot be edited or signed; type changes are validated and audited without note text', () => {
  const patch = read('src/app/api/notes/[id]/route.ts');
  assert.match(patch, /note\.dismissedAt && \(contentChanged \|\| metaSent/);
  assert.match(patch, /noteTypeChangeError\(/);
  assert.match(patch, /action: 'NOTE_TYPE_CHANGE'[^\n]*metadata: \{ fromType: typeChange\.from, toType: typeChange\.to \}/);
  assert.match(read('src/lib/notes/workflow-store.ts'), /if \(currentNote\.dismissedAt\) return \{ ok: false, status: 409/);
});

test('UI: Note type confirmation, Dismiss note in editor / note view / worklist, Include dismissed + Undo dismiss', () => {
  const page = read('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(page, /requestNoteTypeChange\(event\.target\.value\)/);
  assert.match(page, /typeChangeConfirmText\(noteType, pendingType\.type\)/);
  assert.match(page, /remapSectionsForTypeChange\(/);
  assert.ok((page.match(/<Trash2 size=\{14\} aria-hidden \/> Dismiss note/g) || []).length >= 2, 'editor + note view');
  assert.match(page, /Undo dismiss/);
  const wl = read('src/components/notes/NotesWorklist.tsx');
  assert.match(wl, /label="Dismiss note"/);
  assert.match(wl, /Include dismissed/);
  assert.match(wl, /Undo dismiss/);
  const dialog = read('src/components/notes/DismissNoteDialog.tsx');
  assert.match(dialog, /\/dismiss`, \{ method: 'POST'/);
});
