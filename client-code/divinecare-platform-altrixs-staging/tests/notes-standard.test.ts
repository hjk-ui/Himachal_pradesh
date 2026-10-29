/**
 * Progress notes documentation standard (src/lib/notes/standard.ts): timeliness / late-entry math,
 * required billing elements, note-type rules, cloned-note threshold, psychotherapy-notes exclusion
 * from print / export, HIPAA amendment due dates, and 42 CFR Part 2 copy-forward exclusion.
 * All data is synthetic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  DEFAULT_NOTE_DUE_HOURS,
  DUE_SOON_HOURS,
  ESCALATION_OVERDUE_DAYS,
  LATE_REASON_MIN_CHARS,
  amendmentDueOn,
  clientConsentsHref,
  daysOverdue,
  escalatesToViewer,
  isEscalatedOverdue,
  lateEntryPrintLine,
  lateEntryReasonError,
  selectEscalatedOverdue,
  billingElementIssues,
  buildPrintableNote,
  daysSinceService,
  firstSignBlocker,
  isLikelyClone,
  isStaleDraft,
  lateEntryLabel,
  noteDueAt,
  noteSimilarityPercent,
  noteTimeliness,
  noteTypeIssues,
  printableNoteText,
  type BillingElementInput,
  type PrintableNoteInput,
} from '../src/lib/notes/standard';
import { NOTE_SECTIONS, NOTE_TYPES, normalizeNoteType } from '../src/lib/ehr/noteTemplates';
import { carryMarker } from '../src/lib/ehr/structuredNotes';
import { cosignRequiredFor } from '../src/lib/notes/transitions';

const TZ = 'America/New_York';

// ─── Timeliness / late entry ─────────────────────────────────────────────────

test('due time = end of service on the practice clock + practice deadline (configurable)', () => {
  // 10:00 ET on 2026-10-20 (EDT, UTC-4) = 14:00Z; +24 h
  assert.equal(noteDueAt('2026-10-20', '10:00', 24, TZ)?.toISOString(), '2026-10-21T14:00:00.000Z');
  // 72-hour practice policy
  assert.equal(noteDueAt('2026-10-20', '10:00', 72, TZ)?.toISOString(), '2026-10-23T14:00:00.000Z');
  // No end time: end of the service day (23:59 ET = 03:59Z next day) + 24 h
  assert.equal(noteDueAt('2026-10-20', null, 24, TZ)?.toISOString(), '2026-10-22T03:59:00.000Z');
  // Invalid / missing deadline falls back to the default
  assert.equal(noteDueAt('2026-10-20', '10:00', 0, TZ)?.toISOString(), new Date(Date.parse('2026-10-20T14:00:00Z') + DEFAULT_NOTE_DUE_HOURS * 3_600_000).toISOString());
  assert.equal(noteDueAt(null, '10:00', 24, TZ), null);
  // Winter (EST, UTC-5)
  assert.equal(noteDueAt('2026-12-01', '09:00', 48, TZ)?.toISOString(), '2026-12-03T14:00:00.000Z');
});

test('timeliness states: due, overdue, signed on time, late entry', () => {
  const base = { dateOfService: '2026-10-20', endTime: '10:00', deadlineHours: 24, timeZone: TZ };
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-20T13:00:00Z') }).state, 'due');
  // Inside the last 24 hours before the deadline
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-21T13:59:00Z') }).state, 'due_soon');
  const overdue = noteTimeliness({ ...base, now: new Date('2026-10-21T17:00:00Z') });
  assert.equal(overdue.state, 'overdue');
  assert.equal(overdue.hoursLate, 3);
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-30T00:00:00Z'), signedAt: '2026-10-21T13:00:00Z' }).state, 'signed_on_time');
  const late = noteTimeliness({ ...base, now: new Date('2026-10-30T00:00:00Z'), signedAt: '2026-10-22T14:00:00Z' });
  assert.equal(late.state, 'late_entry');
  assert.equal(late.hoursLate, 24);
  assert.equal(noteTimeliness({ ...base, dateOfService: null, now: new Date() }).state, 'no_dos');
});

test('late-entry label uses the practice calendar date of the signature', () => {
  assert.equal(lateEntryLabel('2026-10-25T15:00:00Z', '2026-10-20', TZ), 'Late entry — documented on 2026-10-25 for service on 2026-10-20');
  // 02:00Z on the 26th is still the 25th in New York
  assert.equal(lateEntryLabel('2026-10-26T02:00:00Z', '2026-10-20', TZ), 'Late entry — documented on 2026-10-25 for service on 2026-10-20');
});

test('days since service and stale drafts', () => {
  assert.equal(daysSinceService('2026-10-20', new Date('2026-10-23T12:00:00Z'), TZ), 3);
  assert.equal(daysSinceService('2026-10-20', new Date('2026-10-20T23:00:00Z'), TZ), 0);
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(isStaleDraft('2026-10-10T00:00:00Z', now, 14), true);
  assert.equal(isStaleDraft('2026-10-25T00:00:00Z', now, 14), false);
});

// ─── Billing / compliance elements ───────────────────────────────────────────

const billable: BillingElementInput = {
  noteType: 'SOAP',
  body: 'Subjective\nClient reports improved sleep.',
  cptCode: '90834',
  dateOfService: '2026-10-20',
  durationMinutes: 45,
  telehealth: false,
  placeOfService: '11',
  detail: { diagnosisCodes: ['F41.1'] },
  renderingCredentials: 'LCPC',
};
const blocks = (i: BillingElementInput) => billingElementIssues(i).filter((x) => x.severity === 'block').map((x) => x.id);

test('complete in-person billable note has no blockers', () => {
  assert.deepEqual(blocks(billable), []);
});

test('timed code needs start/end time or total minutes', () => {
  assert.deepEqual(blocks({ ...billable, durationMinutes: null }), ['time']);
  assert.deepEqual(blocks({ ...billable, durationMinutes: null, detail: { diagnosisCodes: ['F41.1'], startTime: '09:00', endTime: '09:50' } }), []);
  // Structured templates record the clock in the body
  assert.deepEqual(blocks({ ...billable, durationMinutes: null, body: 'Start time: 9:00\nEnd time: 9:50' }), []);
  // Untimed code: no time rule
  assert.deepEqual(blocks({ ...billable, cptCode: '90791', durationMinutes: null }), []);
});

test('telehealth needs POS 02/10, modality, client state and consent', () => {
  const tele = { ...billable, telehealth: true, placeOfService: '11' };
  assert.deepEqual(blocks(tele).sort(), ['telehealth.consent', 'telehealth.modality', 'telehealth.pos', 'telehealth.state']);
  // The consent blocker says how to fix it and links to the client's consents page
  const consent = billingElementIssues({ ...tele, clientId: 'client-1' }).find((i) => i.id === 'telehealth.consent');
  assert.match(consent?.message ?? '', /Service details/);
  assert.match(consent?.message ?? '', /Consents page/);
  assert.deepEqual(consent?.fix, { label: 'Open client consents', href: '/dashboard/ehr/consents/client/client-1' });
  assert.equal(clientConsentsHref('a b'), '/dashboard/ehr/consents/client/a%20b');
  const ok = { ...tele, placeOfService: '10', detail: { diagnosisCodes: ['F41.1'], telehealthModality: 'audio_video', patientLocationState: 'MD', telehealthConsent: true } };
  assert.deepEqual(blocks(ok), []);
  // State from the linked appointment and audio-only flag on the note count
  assert.deepEqual(blocks({ ...tele, placeOfService: '02', audioOnly: true, appointmentPatientState: 'MD', detail: { diagnosisCodes: ['F41.1'], telehealthConsent: true } }), []);
  // In person with no POS: warning only (claim uses the practice office POS)
  const noPos = billingElementIssues({ ...billable, placeOfService: null });
  assert.equal(noPos.find((i) => i.id === 'pos')?.severity, 'warn');
});

test('linked ICD-10 diagnosis required on billable notes (policy switch; evaluations may carry it)', () => {
  assert.deepEqual(blocks({ ...billable, detail: null }), ['diagnosis']);
  assert.deepEqual(blocks({ ...billable, detail: { diagnosisCodes: ['not-a-code'] } }), ['diagnosis']);
  assert.deepEqual(blocks({ ...billable, detail: null, requireDiagnosisToSign: false }), []);
  assert.deepEqual(blocks({ ...billable, cptCode: '90791', detail: null, body: 'Assessment - Diagnoses\nF33.1 Major depressive disorder, recurrent, moderate' }), []);
  // Non-billable (no CPT): only the date of service
  assert.deepEqual(blocks({ ...billable, cptCode: null, detail: null }), []);
  assert.deepEqual(blocks({ ...billable, cptCode: null, dateOfService: null }), ['dos']);
});

test('no-show notes are not billable; missing credentials only warn', () => {
  assert.ok(blocks({ ...billable, noteType: 'No-Show' }).includes('noshow.cpt'));
  const warn = billingElementIssues({ ...billable, renderingCredentials: null });
  assert.equal(warn.find((i) => i.id === 'credentials')?.severity, 'warn');
  assert.equal(firstSignBlocker(warn), null);
});

// ─── Note-type rules ─────────────────────────────────────────────────────────

test('crisis, collateral and group notes have their own required content', () => {
  assert.ok(NOTE_TYPES.includes('Crisis' as never) && NOTE_TYPES.includes('Collateral' as never));
  assert.equal(normalizeNoteType('Crisis Note'), 'Crisis');
  assert.equal(normalizeNoteType('Collateral Contact'), 'Collateral');
  const crisis = noteTypeIssues({ noteType: 'Crisis', body: 'Presenting Crisis\nCalled after argument.\n\nRisk Assessment\n' });
  // + the Crisis format's required elements (scribe safety hardening: missing elements block signing)
  assert.deepEqual(crisis.map((i) => i.id), ['crisis.risk', 'crisis.disposition', 'format.sections', 'format.risk_screen']);

  const collateral = (roi: string, part2 = false) =>
    noteTypeIssues({
      noteType: 'Collateral',
      part2,
      body: `Collateral Contact\nParent A\n\nRelationship to Client\nParent / guardian\n\nRelease of Information\n${roi}\n\nPurpose of Contact\nSchedule`,
    }).map((i) => i.id);
  assert.deepEqual(collateral('ROI on file'), []);
  assert.deepEqual(collateral('Not on file'), ['collateral.roi']);
  assert.deepEqual(collateral('Client present and gave verbal consent (documented)', true), ['collateral.part2']);

  assert.deepEqual(noteTypeIssues({ noteType: 'Group', body: 'Group Topic / Focus\nCoping skills' }).map((i) => i.id), ['group.individual']);
});

test('copied-forward text in plain notes blocks signing until reviewed', () => {
  const body = `Subjective\n${carryMarker('2026-10-13')}\nClient reported poor sleep at home. Denies SI / HI.\n\nAssessment\nSleep is still poor.\n\nPlan\nContinue.`;
  assert.deepEqual(noteTypeIssues({ noteType: 'SOAP', body }).map((i) => i.id), ['carry_forward']);
  assert.deepEqual(noteTypeIssues({ noteType: 'SOAP', body: body.replace(carryMarker('2026-10-13'), '') }), []);
});

// ─── Cloned notes ────────────────────────────────────────────────────────────

const LONG_A =
  'Client attended the session on time and reported moderate anxiety related to work deadlines. We reviewed the thought record from last week and identified catastrophizing about performance reviews. Practiced diaphragmatic breathing for five minutes and the client rated anxiety lower afterwards. Homework is to complete two thought records and practice breathing daily.';
const LONG_B =
  'Client arrived late after a family conflict over the weekend and was tearful for much of the hour. Explored grief about a recent loss, validated feelings and built a short list of supports to call this week. Safety was reviewed and the client denied any thoughts of self harm. Plan is to schedule a family session and continue weekly therapy.';

test('clone detection: identical long notes are flagged at the threshold, different notes are not', () => {
  const headings = NOTE_SECTIONS.SOAP;
  assert.equal(noteSimilarityPercent(`Subjective\n${LONG_A}`, `Subjective\n${LONG_A}`, headings), 100);
  assert.equal(isLikelyClone(100, 85), true);
  const different = noteSimilarityPercent(LONG_A, LONG_B, headings);
  assert.ok(different < 20, `different notes scored ${different}`);
  assert.equal(isLikelyClone(different, 85), false);
  // One changed sentence keeps it high but below 100
  const edited = LONG_A.replace('Homework is to complete two thought records and practice breathing daily.', 'Homework: one exposure exercise at work before next session.');
  const p = noteSimilarityPercent(LONG_A, edited);
  assert.ok(p > 60 && p < 100, `edited note scored ${p}`);
  // Threshold boundary
  assert.equal(isLikelyClone(84, 85), false);
  assert.equal(isLikelyClone(85, 85), true);
  // Short / template-length notes are not compared
  assert.equal(noteSimilarityPercent('Subjective\nDoing ok.', 'Subjective\nDoing ok.', headings), 0);
});

// ─── Print / export never contains psychotherapy notes ───────────────────────

const PRIVATE_TEXT = 'PRIVATE PROCESS NOTE: countertransference hypothesis';
const printable: PrintableNoteInput = {
  clientName: 'Client A',
  noteType: 'SOAP',
  dateOfService: '2026-10-20',
  startTime: '09:00',
  endTime: '09:50',
  durationMinutes: 50,
  cptCode: '90834',
  placeOfService: '10',
  telehealth: true,
  telehealthModality: 'audio_only',
  diagnosisCodes: ['F41.1'],
  part2: true,
  aiDrafted: true,
  body: 'Subjective\nClient reports improved sleep.\n\nPlan\nContinue weekly.',
  status: 'Signed',
  signedByName: 'Clinician C',
  signerCredentials: 'LCPC',
  signedAt: '2026-10-22T15:00:00Z',
  cosignRequired: true,
  cosignedByName: 'Supervisor S',
  cosignerCredentials: 'LCPC-S',
  cosignedAt: '2026-10-23T15:00:00Z',
  lateEntryLabel: 'Late entry — documented on 2026-10-22 for service on 2026-10-20',
  lateEntryReason: 'Clinician out sick; documented from session notes on return.',
  addenda: [{ reason: 'Correction of error', text: 'Session was 50 minutes, not 45.', authorName: 'Clinician C', createdAt: '2026-10-24T12:00:00Z' }],
};

test('printable note: signature block, credentials, co-sign, late entry, addenda, Part 2 notice', () => {
  const doc = buildPrintableNote(printable);
  const text = printableNoteText(doc);
  assert.match(text, /Electronically signed by Clinician C, LCPC on 2026-10-22 15:00 UTC/);
  assert.match(text, /Co-signed by Supervisor S, LCPC-S/);
  assert.match(text, /Late entry — documented on 2026-10-22 for service on 2026-10-20\. Reason: Clinician out sick; documented from session notes on return\./);
  assert.match(text, /Addendum — Correction of error — Clinician C/);
  assert.match(text, /42 CFR part 2/i);
  assert.match(text, /Telehealth: Audio-only/);
  assert.match(text, /Diagnoses addressed: F41.1/);
  assert.match(text, /AI assistance/);
  assert.deepEqual(doc.sections.map((s) => s.title), ['Subjective', 'Plan']);
});

test('psychotherapy notes are never part of a print / export, even if a caller passes them', () => {
  // A careless caller spreading a record that holds psychotherapy notes must not leak them
  const leaky = { ...printable, psychotherapyNotes: PRIVATE_TEXT, privateNotes: PRIVATE_TEXT } as PrintableNoteInput;
  const text = printableNoteText(buildPrintableNote(leaky));
  assert.equal(text.includes(PRIVATE_TEXT), false);
  assert.equal(JSON.stringify(buildPrintableNote(leaky)).includes(PRIVATE_TEXT), false);
});

// ─── HIPAA 164.526 / co-sign policy ──────────────────────────────────────────

test('amendment requests are due in 60 days, 90 with the one extension', () => {
  assert.equal(amendmentDueOn('2026-10-20'), '2026-12-19');
  assert.equal(amendmentDueOn('2026-10-20', true), '2027-01-18');
});

test('co-sign roles come from Practice settings when loaded', () => {
  assert.equal(cosignRequiredFor('CASE_MANAGER', false), true);
  assert.equal(cosignRequiredFor('CASE_MANAGER', false, false, ['PEER_SUPPORT']), false);
  assert.equal(cosignRequiredFor('THERAPIST', false, false, ['THERAPIST']), true);
  assert.equal(cosignRequiredFor('THERAPIST', false, true, []), true);
});

// ─── 42 CFR Part 2: no SUD note copied into a non-Part 2 note ────────────────

function loadCopyForward() {
  const notes = [
    { id: 'n-sud', clientId: 'c1', body: 'Substance Use History\nSynthetic SUD detail.', noteType: 'SUD', part2: true, createdAt: new Date('2026-10-19T12:00:00Z'), clinician: { name: 'C' } },
    { id: 'n-soap', clientId: 'c1', body: 'Subjective\nSynthetic therapy detail.', noteType: 'SOAP', part2: false, createdAt: new Date('2026-10-12T12:00:00Z'), clinician: { name: 'C' } },
  ];
  const db = {
    client: { findFirst: async () => ({ id: 'c1' }) },
    progressNote: { findMany: async () => notes },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    return original.call(this, id, ...args);
  };
  try {
    const require = createRequire(import.meta.url);
    return require('../src/lib/ehr/copyForward') as typeof import('../src/lib/ehr/copyForward');
  } finally {
    loader._load = original;
  }
}

test('copy-forward never offers a Part 2 note to a non-Part 2 note', async () => {
  const { loadCopyForwardNote } = loadCopyForward();
  const actor = { organizationId: 'o1', actorUserId: 'u1', actorRole: 'THERAPIST' as never, clientId: 'c1' };
  const forSoap = await loadCopyForwardNote({ ...actor, noteType: 'SUD' });
  // Asked for the SUD type from a non-Part 2 note: the SUD note is skipped, the latest non-Part 2 note is used
  assert.equal(forSoap.noteId, 'n-soap');
  const forPart2 = await loadCopyForwardNote({ ...actor, noteType: 'SUD', targetPart2: true });
  assert.equal(forPart2.noteId, 'n-sud');
});

// ─── Policy decisions (2026-10-20): 72 h deadline, due soon, late reason, escalation ─────────────

test('practice policy default: notes are due 72 hours after the service; due soon in the last 24 hours', () => {
  assert.equal(DEFAULT_NOTE_DUE_HOURS, 72);
  assert.equal(DUE_SOON_HOURS, 24);
  // No practice setting (0): 72 h after 10:00 ET on 2026-10-20 = 14:00Z on 2026-10-23
  assert.equal(noteDueAt('2026-10-20', '10:00', 0, TZ)?.toISOString(), '2026-10-23T14:00:00.000Z');
  const base = { dateOfService: '2026-10-20', endTime: '10:00', deadlineHours: 72, timeZone: TZ };
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-22T13:59:00Z') }).state, 'due');
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-22T14:00:00Z') }).state, 'due_soon');
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-23T13:59:00Z') }).state, 'due_soon');
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-23T14:01:00Z') }).state, 'overdue');
  // Signed notes are never "due soon"
  assert.equal(noteTimeliness({ ...base, now: new Date('2026-10-23T13:00:00Z'), signedAt: '2026-10-23T13:00:00Z' }).state, 'signed_on_time');
});

test('late-entry reason is required only when signing after the deadline (min 10 characters)', () => {
  const due = new Date('2026-10-23T14:00:00Z');
  assert.equal(LATE_REASON_MIN_CHARS, 10);
  // On time: no reason needed
  assert.equal(lateEntryReasonError({ dueAt: due, signedAt: new Date('2026-10-23T13:59:00Z'), reason: '' }), null);
  assert.equal(lateEntryReasonError({ dueAt: due, signedAt: due, reason: null }), null);
  assert.equal(lateEntryReasonError({ dueAt: null, signedAt: new Date('2026-12-01T00:00:00Z'), reason: null }), null);
  // Late: required, trimmed, at least 10 characters
  const late = new Date('2026-10-25T09:00:00Z');
  assert.match(lateEntryReasonError({ dueAt: due, signedAt: late, reason: null }) ?? '', /late-entry reason \(at least 10 characters\)/);
  assert.ok(lateEntryReasonError({ dueAt: due, signedAt: late, reason: '   short    ' }));
  assert.equal(lateEntryReasonError({ dueAt: due, signedAt: late, reason: 'Out sick 3 days' }), null);
  // Printed under the late-entry label
  assert.equal(
    lateEntryPrintLine('Late entry — documented on 2026-10-25 for service on 2026-10-20', '  Out sick\n3 days '),
    'Late entry — documented on 2026-10-25 for service on 2026-10-20. Reason: Out sick 3 days'
  );
  assert.equal(lateEntryPrintLine('Late entry — documented on 2026-10-25 for service on 2026-10-20', null), 'Late entry — documented on 2026-10-25 for service on 2026-10-20');
  assert.equal(lateEntryPrintLine(null, 'reason without a label'), null);
});

test('overdue > 7 days escalates to the author\'s supervisor, else clinical / practice director or admin', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.equal(ESCALATION_OVERDUE_DAYS, 7);
  assert.equal(isEscalatedOverdue('2026-11-03T12:00:00Z', now), false); // exactly 7 days
  assert.equal(isEscalatedOverdue('2026-11-03T11:59:00Z', now), true);
  assert.equal(isEscalatedOverdue(null, now), false);
  assert.equal(daysOverdue('2026-11-01T12:00:00Z', now), 9);
  assert.equal(daysOverdue('2026-11-20T12:00:00Z', now), 0);

  const supervisorByAuthor = new Map([['clin-supervised', 'sup-1']]);
  const notes = [
    { id: 'n1', authorId: 'clin-supervised', dueAt: '2026-11-01T12:00:00Z' }, // 9 days: escalated to sup-1
    { id: 'n2', authorId: 'clin-supervised', dueAt: '2026-11-05T12:00:00Z' }, // 5 days: not yet
    { id: 'n3', authorId: 'clin-alone', dueAt: '2026-10-30T12:00:00Z' }, // no supervisor: leadership
    { id: 'n4', authorId: 'sup-1', dueAt: '2026-10-30T12:00:00Z' }, // the supervisor's own note: leadership
  ];
  const ids = (viewerId: string, viewerRole: string) =>
    selectEscalatedOverdue(notes, { viewerId, viewerRole, supervisorByAuthor, now }).map((n) => n.id);
  assert.deepEqual(ids('sup-1', 'THERAPIST'), ['n1']);
  assert.deepEqual(ids('dir-1', 'DIRECTOR'), ['n3', 'n4']);
  assert.deepEqual(ids('pd-1', 'PRACTICE_DIRECTOR'), ['n3', 'n4']);
  assert.deepEqual(ids('admin-1', 'ADMIN'), ['n3', 'n4']);
  assert.deepEqual(ids('other-1', 'THERAPIST'), []);
  // A note never escalates to its own author
  assert.equal(escalatesToViewer({ authorId: 'dir-1', authorSupervisorId: null, viewerId: 'dir-1', viewerRole: 'DIRECTOR' }), false);
});
