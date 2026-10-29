import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { GuideStep } from '../src/lib/visits/types';
import {
  addDaysYmd,
  assessmentHref,
  bookFollowUpHref,
  canStartVisit,
  checklistMarkBody,
  checklistUnmarkBody,
  firstAllowedCpt,
  followUpLabel,
  guideActionTarget,
  guideProgress,
  guideUrl,
  normalizeVisitStatus,
  outstandingRequired,
  sectionHasText,
  startVisitHref,
  startVisitLabel,
  visitDos,
  withLiveNoteSteps,
} from '../src/components/visits/visitGuideHelpers';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function step(over: Partial<GuideStep> & { id: string }): GuideStep {
  return { label: over.id, level: 'required', source: 'manual', phase: 'during', status: 'not_done', ...over };
}

test('startVisitHref: note editor with appointment, date of service, guide and telehealth', () => {
  const href = startVisitHref({ id: 'appt 1', clientId: 'c1', date: '2026-10-20', isVirtual: true });
  const u = new URL(href, 'https://x.test');
  assert.equal(u.pathname, '/dashboard/ehr/notes');
  assert.equal(u.searchParams.get('clientId'), 'c1');
  assert.equal(u.searchParams.get('appointmentId'), 'appt 1');
  assert.equal(u.searchParams.get('dos'), '2026-10-20');
  assert.equal(u.searchParams.get('guide'), '1');
  assert.equal(u.searchParams.get('telehealth'), '1');
  const inPerson = new URL(startVisitHref({ id: 'a2', clientId: 'c1', date: '2026-10-20' }), 'https://x.test');
  assert.equal(inPerson.searchParams.get('telehealth'), null);
});

test('startVisitHref: group occurrence and primary care targets', () => {
  assert.equal(
    startVisitHref({ id: 'a', clientId: 'c', groupSessionId: 'g1' }),
    '/dashboard/ehr/group-sessions/sessions/g1'
  );
  const med = new URL(startVisitHref({ id: 'a', clientId: 'c' }, { target: 'medical' }), 'https://x.test');
  assert.equal(med.pathname, '/dashboard/medical/visits');
  assert.equal(med.searchParams.get('patient'), 'c');
  assert.equal(med.searchParams.get('appointmentId'), 'a');
});

test('visitDos: wall date wins; otherwise the practice-clock date of startsAt', () => {
  assert.equal(visitDos({ date: '2026-10-20', startsAt: '2026-10-21T02:00:00Z' }), '2026-10-20');
  // 02:00Z on Oct 21 is still Oct 20 in New York
  assert.equal(visitDos({ startsAt: '2026-10-21T02:00:00Z', timeZone: 'America/New_York' }), '2026-10-20');
  assert.equal(visitDos({}), '');
});

test('canStartVisit / startVisitLabel by visit and note status', () => {
  assert.equal(normalizeVisitStatus('IN_SESSION'), 'in-session');
  for (const s of ['scheduled', 'checked-in', 'in-session', 'CHECKED_IN', 'confirmed']) assert.equal(canStartVisit(s), true, s);
  assert.equal(canStartVisit('completed', 'not-started'), true);
  assert.equal(canStartVisit('completed', 'signed'), false);
  assert.equal(canStartVisit('cancelled'), false);
  // Missed visits open the No-Show note until it is signed
  for (const s of ['no-show', 'late-cancel', 'NO_SHOW']) assert.equal(canStartVisit(s), true, s);
  assert.equal(canStartVisit('no-show', 'signed'), false);
  assert.equal(startVisitLabel('no-show'), 'Document no-show');
  assert.equal(startVisitLabel('scheduled'), 'Start visit');
  assert.equal(startVisitLabel('completed', 'not-started'), 'Write note');
  assert.equal(startVisitLabel('completed', 'ai-draft'), 'Continue note');
  assert.equal(startVisitLabel('in-session', 'in-progress'), 'Continue note');
});

test('note steps tick live from section text; N/A and deferred are kept', () => {
  const steps = [
    step({ id: 'plan', source: 'note', noteSection: 'Plan' }),
    step({ id: 'mse', source: 'note', noteSection: 'Mental Status Exam' }),
    step({ id: 'risk', source: 'note', noteSection: 'Risk', status: 'not_applicable', detail: 'phone check-in' }),
    step({ id: 'pdmp', source: 'auto', status: 'done' }),
  ];
  const live = withLiveNoteSteps(steps, { plan: 'Return in 2 weeks', 'Mental Status Exam': '  [___]  ', Risk: '' });
  assert.equal(live[0].status, 'done', 'case-insensitive section match');
  assert.equal(live[1].status, 'not_done', 'unfilled blanks do not count');
  assert.equal(live[2].status, 'not_applicable');
  assert.equal(live[3].status, 'done');
  assert.equal(withLiveNoteSteps(steps, undefined), steps, 'no sections: unchanged');
  // A note step the server reported done but whose section is now empty goes back to not done
  assert.equal(withLiveNoteSteps([step({ id: 'p', source: 'note', noteSection: 'Plan', status: 'done' })], { Plan: '' })[0].status, 'not_done');
  assert.equal(sectionHasText({ Assessment: 'stable' }, 'assessment'), true);
});

test('progress counts done / N/A / deferred required steps; warnings list only open required steps', () => {
  const steps = [
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'deferred', detail: 'patient declined today' }),
    step({ id: 'c' }),
    step({ id: 'd', level: 'recommended' }),
  ];
  assert.deepEqual(guideProgress(steps), { required: 3, requiredResolved: 2, remaining: 1, total: 4, resolved: 2 });
  assert.deepEqual(outstandingRequired(steps).map((s) => s.id), ['c']);
});

test('checklist bodies: reason required for N/A and deferred', () => {
  const id = { clientId: 'c1', appointmentId: 'a1', noteId: null, kind: 'med_management' as const };
  assert.equal(checklistMarkBody(id, 's1', 'not_applicable', '  '), null);
  assert.equal(checklistMarkBody(id, 's1', 'deferred'), null);
  assert.deepEqual(checklistMarkBody(id, 's1', 'done'), { clientId: 'c1', kind: 'med_management', stepId: 's1', status: 'done', appointmentId: 'a1' });
  assert.deepEqual(checklistMarkBody(id, 's1', 'deferred', ' labs next visit '), {
    clientId: 'c1',
    kind: 'med_management',
    stepId: 's1',
    status: 'deferred',
    appointmentId: 'a1',
    reason: 'labs next visit',
  });
  assert.deepEqual(checklistUnmarkBody({ ...id, noteId: 'n1' }, 's1'), { clientId: 'c1', stepId: 's1', appointmentId: 'a1', noteId: 'n1' });
  assert.equal(guideUrl({ clientId: 'c1', appointmentId: 'a1' }), '/api/visits/guide?clientId=c1&appointmentId=a1');
});

test('follow-up date math and booking link', () => {
  assert.equal(addDaysYmd('2026-10-20', 14), '2026-11-03');
  assert.equal(addDaysYmd('2026-12-25', 7), '2027-01-01');
  assert.equal(addDaysYmd('2026-03-01', 28), '2026-03-29', 'no DST drift');
  assert.equal(addDaysYmd('bad', 7), '');
  assert.equal(followUpLabel(14), '2 weeks');
  assert.equal(followUpLabel(7), '1 week');
  assert.equal(followUpLabel(3), '3 days');
  assert.equal(followUpLabel(30), '4 weeks');
  const u = new URL(bookFollowUpHref({ clientId: 'c1', days: 28, from: '2026-10-20', type: 'Medication Management' }), 'https://x.test');
  assert.equal(u.pathname, '/dashboard/appointments');
  assert.equal(u.searchParams.get('new'), '1');
  assert.equal(u.searchParams.get('client'), 'c1');
  assert.equal(u.searchParams.get('after'), '2026-11-17');
  assert.equal(u.searchParams.get('type'), 'Medication Management');
  assert.equal(new URL(bookFollowUpHref({ clientId: 'c1', days: null, from: '2026-10-20' }), 'https://x.test').searchParams.get('after'), null);
});

test('guide actions map to existing routes', () => {
  const ctx = { clientId: 'c1', appointmentId: 'a1', today: '2026-10-20', followUpDays: 14 };
  assert.equal(assessmentHref('C-SSRS', 'c1'), '/dashboard/ehr/assessments/cssrs?clientId=c1');
  assert.equal(assessmentHref('PHQ-9', 'c1'), '/dashboard/ehr/assessments?clientId=c1&instrument=PHQ-9');
  assert.equal(assessmentHref('AUDIT-C', 'c1'), '/dashboard/ehr/assessments/sud?clientId=c1');
  assert.deepEqual(guideActionTarget({ kind: 'drfirst', screen: 'manage_medications' }, ctx), {
    kind: 'drfirst',
    screen: 'manage_medications',
    label: 'Medications in DrFirst',
  });
  const book = guideActionTarget({ kind: 'book_follow_up' }, ctx);
  assert.equal(book?.kind, 'href');
  assert.match((book as { href: string }).href, /after=2026-11-03/);
  // The guide's suggestion (shortened for risk / med change) wins over the protocol's default weeks
  assert.equal((guideActionTarget({ kind: 'book_follow_up', weeks: 4 }, ctx) as { label: string }).label, 'Book in 2 weeks');
  assert.equal((guideActionTarget({ kind: 'book_follow_up', weeks: 4 }, { ...ctx, followUpDays: null }) as { label: string }).label, 'Book in 4 weeks');
  assert.equal(guideActionTarget({ kind: 'scribe' }, ctx)?.kind, 'href');
  assert.deepEqual(guideActionTarget({ kind: 'note_section', section: 'Plan' }, ctx), { kind: 'section', section: 'Plan', label: 'Go to Plan' });
  assert.equal(guideActionTarget({ kind: 'link', href: 'https://evil.example', label: 'x' }, ctx), null, 'external links are not rendered');
  assert.equal(guideActionTarget(undefined, ctx), null);

  // Every in-app route an action can produce exists as a page
  const hrefs = [
    assessmentHref('C-SSRS', 'c'),
    assessmentHref('PHQ-9', 'c'),
    assessmentHref('AUDIT-C', 'c'),
    assessmentHref('LOCUS', 'c'),
    assessmentHref('SDOH', 'c'),
    ...(['labs', 'safety_plan', 'treatment_plan', 'sdoh', 'scribe', 'book_follow_up'] as const).map(
      (kind) => (guideActionTarget({ kind } as never, ctx) as { href: string }).href
    ),
    (guideActionTarget({ kind: 'consents' }, ctx) as { href: string }).href.replace(/\/c1$/, '/[clientId]'),
    startVisitHref({ id: 'a', clientId: 'c' }),
    startVisitHref({ id: 'a', clientId: 'c' }, { target: 'medical' }),
    startVisitHref({ id: 'a', clientId: 'c', groupSessionId: 'g' }).replace(/\/g$/, '/[sessionId]'),
  ];
  for (const href of hrefs) {
    const route = href.split('?')[0];
    assert.ok(fs.existsSync(path.join(ROOT, 'src/app', route, 'page.tsx')), `${route} has a page`);
  }
});

test('firstAllowedCpt picks the first suggested code the note type offers', () => {
  assert.equal(firstAllowedCpt(['99214', '90833'], ['99213', '99214']), '99214');
  assert.equal(firstAllowedCpt(['H2017'], ['90837']), '');
  assert.equal(firstAllowedCpt([], ['90837']), '');
});

test('entry points use Start visit and the notes page opens the guide-resolved note', () => {
  for (const file of [
    'src/features/dashboard/components/TherapistHome.tsx',
    'src/features/dashboard/components/RoleHomes.tsx',
    'src/app/dashboard/appointments/page.tsx',
    'src/app/dashboard/telehealth/page.tsx',
    'src/app/dashboard/medical/page.tsx',
  ]) {
    assert.match(read(file), /<StartVisitButton/, file);
  }
  const telehealth = read('src/app/dashboard/telehealth/page.tsx');
  assert.doesNotMatch(telehealth, /href=\{`\/dashboard\/ehr\/notes\?clientId=\$\{s\.clientId\}`\}/, 'telehealth note links carry the appointment');
  const notes = read('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(notes, /loadVisitGuide\(/);
  assert.match(notes, /<VisitGuidePanel/);
  assert.match(notes, /<VisitGuideSignWarnings/);
  assert.match(notes, /n\.appointmentId === presetAppointmentId/, 'existing appointment note is reopened');
  assert.match(read('src/app/dashboard/scribe/page.tsx'), /<VisitGuidePanel compact/);
  // Pre-visit brief buttons stay where they were
  assert.match(read('src/features/dashboard/components/TherapistHome.tsx'), /<PreVisitBriefButton /);
  assert.match(read('src/app/dashboard/appointments/page.tsx'), /<PreVisitBriefButton /);
});
