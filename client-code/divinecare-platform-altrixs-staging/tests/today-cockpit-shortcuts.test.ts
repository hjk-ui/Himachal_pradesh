import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveDocLight,
  EMPTY_NOTE_SUMMARY,
  summarizeVisitNotes,
  visitPaymentStatus,
  type VisitNoteSummary,
} from '../src/lib/appointments/docLight';
import {
  allCaughtUp,
  celebrationKey,
  claimCelebration,
  nextTodayVisitId,
  todayNotesProgress,
  todayPrimaryAction,
} from '../src/lib/dashboard/today';
import { todayAppointmentWhere } from '../src/lib/dashboard/todayScope';
import { clientAccessWhere } from '../src/lib/clients/orgScope';
import {
  clientIdInContext,
  isTypingTarget,
  matchesAllWords,
  resolveShortcut,
  shortcutEligible,
} from '../src/components/layout/shortcuts';

/** Clinician day cockpit: scheduler lights, Today panel, command palette actions and shortcuts. */
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const TZ = 'America/New_York';
// Visit Oct 20 2026 10:00-10:50 ET (14:00-14:50 UTC)
const visit = { date: '2026-10-20', endTime: '10:50', endsAt: '2026-10-20T14:50:00.000Z', timeZone: TZ };
const at = (iso: string) => new Date(iso);
const draft: VisitNoteSummary = { hasNote: true, signed: false, cosignPending: false, cosigned: false };

// ─── Status light derivation ─────────────────────────────────────────────────

test('light: grey before the visit, blue in session / draft in progress before it ends', () => {
  const before = at('2026-10-20T13:00:00Z');
  assert.equal(deriveDocLight({ ...visit, status: 'scheduled', notes: EMPTY_NOTE_SUMMARY, now: before }).tone, 'upcoming');
  assert.equal(deriveDocLight({ ...visit, status: 'checked-in', notes: EMPTY_NOTE_SUMMARY, now: before }).label, 'Upcoming');
  assert.equal(deriveDocLight({ ...visit, status: 'in-session', notes: EMPTY_NOTE_SUMMARY, now: at('2026-10-20T14:10:00Z') }).tone, 'active');
  assert.equal(deriveDocLight({ ...visit, status: 'scheduled', notes: draft, now: before }).label, 'Note in progress');
});

test('light: amber for a completed visit with a draft, or 24 h with no note; blue just after the visit', () => {
  const soon = at('2026-10-20T16:00:00Z');
  assert.equal(deriveDocLight({ ...visit, status: 'completed', notes: EMPTY_NOTE_SUMMARY, now: soon }).tone, 'active');
  const d = deriveDocLight({ ...visit, status: 'completed', notes: draft, now: soon });
  assert.equal(d.tone, 'attention');
  assert.equal(d.label, 'Note unsigned');
  const late = deriveDocLight({ ...visit, status: 'completed', notes: EMPTY_NOTE_SUMMARY, now: at('2026-10-21T16:00:00Z') });
  assert.equal(late.tone, 'attention');
  assert.equal(late.label, 'No note yet');
  // A past visit still marked scheduled counts as ended (status never updated)
  assert.equal(deriveDocLight({ ...visit, status: 'scheduled', notes: EMPTY_NOTE_SUMMARY, now: at('2026-10-21T16:00:00Z') }).tone, 'attention');
});

test('light: red past the practice deadline (72 h default; the practice setting wins), from standard.ts', () => {
  // 72 h after 10:50 ET Oct 20 = 10:50 ET Oct 23 = 14:50 UTC
  const justBefore = deriveDocLight({ ...visit, status: 'completed', notes: draft, now: at('2026-10-23T14:49:00Z') });
  assert.equal(justBefore.tone, 'attention');
  assert.equal(justBefore.dueAt, '2026-10-23T14:50:00.000Z');
  const after = deriveDocLight({ ...visit, status: 'completed', notes: draft, now: at('2026-10-23T14:51:00Z') });
  assert.equal(after.tone, 'overdue');
  assert.match(after.detail ?? '', /72-hour deadline/);
  const policy24 = deriveDocLight({ ...visit, status: 'completed', notes: EMPTY_NOTE_SUMMARY, now: at('2026-10-21T15:00:00Z'), deadlineHours: 24 });
  assert.equal(policy24.tone, 'overdue');
  assert.equal(deriveDocLight({ ...visit, status: 'no-show', notes: EMPTY_NOTE_SUMMARY, now: at('2026-10-25T00:00:00Z') }).tone, 'overdue');
});

test('light: green when signed (and co-signed when required); amber while the co-signature is pending', () => {
  const now = at('2026-10-25T00:00:00Z');
  const signed = summarizeVisitNotes([{ status: 'Signed' }]);
  assert.equal(deriveDocLight({ ...visit, status: 'completed', notes: signed, now }).tone, 'signed');
  const pending = summarizeVisitNotes([{ status: 'Signed', cosignRequired: true, cosignedAt: null }]);
  assert.equal(pending.cosignPending, true);
  const p = deriveDocLight({ ...visit, status: 'completed', notes: pending, now });
  assert.equal(p.tone, 'attention');
  assert.match(p.label, /co-signature/);
  const cos = summarizeVisitNotes([{ status: 'Locked', cosignRequired: true, cosignedAt: '2026-10-21T10:00:00Z' }]);
  assert.equal(deriveDocLight({ ...visit, status: 'completed', notes: cos, now }).label, 'Note signed and co-signed');
  // Cancelled visits need no note
  assert.equal(deriveDocLight({ ...visit, status: 'cancelled', notes: EMPTY_NOTE_SUMMARY, now }).tone, 'upcoming');
});

test('dismissed notes never light a visit: the summary loader excludes dismissedAt, one read per list', () => {
  const src = read('src/lib/analytics/visitDocumentationServer.ts');
  assert.match(src, /export async function loadAppointmentNoteSummaries/);
  assert.match(src, /appointmentId: \{ in: appointmentIds \}, dismissedAt: null/);
  // With the dismissed note gone, a visit is "no note" again, never signed
  assert.equal(summarizeVisitNotes([]).hasNote, false);
  const manage = read('src/lib/appointments/manage.ts');
  assert.match(manage, /loadAppointmentNoteSummaries\(ids\)/);
  assert.match(manage, /docLight, payment: payments\.get\(r\.id\) \?\? null/);
  assert.match(manage, /serializeWithLabels\(actor\.organizationId, rows, \{ role: actor\.role \}\)/);
  assert.match(manage, /if \(!ids\.length \|\| !canReadLedger\(role\)\) return out;/, 'copay status only for ledger roles');
});

test('copay icon: collected (charge or front-desk mark), failed, processing, none', () => {
  assert.equal(visitPaymentStatus({ chargeStatuses: [], markedCollected: true }), 'collected');
  assert.equal(visitPaymentStatus({ chargeStatuses: ['succeeded'], markedCollected: false }), 'collected');
  assert.equal(visitPaymentStatus({ chargeStatuses: ['failed'], markedCollected: false }), 'failed');
  assert.equal(visitPaymentStatus({ chargeStatuses: ['processing'], markedCollected: false }), 'pending');
  assert.equal(visitPaymentStatus({ chargeStatuses: ['skipped'], markedCollected: false }), null);
});

test('scheduler: every view shows the dot with screen-reader text; no fetch per appointment', () => {
  const page = read('src/app/dashboard/appointments/page.tsx');
  assert.ok((page.match(/<DocLightDot light=\{appt\.docLight\}/g) ?? []).length >= 6, 'month, day, week, board table, board cards, list');
  assert.match(page, /\$\{docA11y\(appt\)\}/);
  assert.match(page, /<DocLightLegend/);
  assert.doesNotMatch(page, /api\/notes\/\$\{[^}]*\}\/sign-readiness/);
  const dot = read('src/components/scheduling/DocLightDot.tsx');
  assert.match(dot, /className="sr-only"/);
  assert.match(dot, /title=\{text\}/);
});

// ─── Today panel ─────────────────────────────────────────────────────────────

test('today API: own visits, caseload scope via clientAccessWhere, today window, no cancelled visits', () => {
  const viewer = { organizationId: 'org1', userId: 'u1', role: 'THERAPIST' as const };
  const win = { start: new Date('2026-10-23T04:00:00Z'), end: new Date('2026-10-24T04:00:00Z') };
  const where = todayAppointmentWhere(viewer, win) as { AND: Record<string, unknown>[] };
  assert.deepEqual(where.AND[1], { clinicianId: 'u1' });
  // Same caseload rule as the rest of the chart (care-team look-back dates differ by milliseconds)
  const noDates = (v: unknown) => JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATE');
  assert.equal(noDates(where.AND[2]), noDates({ client: clientAccessWhere({ organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST' }) }));
  assert.match(JSON.stringify(where.AND[2]), /"assignedToId":"u1"/);
  assert.deepEqual(where.AND[3], { startsAt: { gte: win.start, lt: win.end } });
  assert.deepEqual(where.AND[4], { status: { not: 'CANCELLED' } });
  const route = read('src/app/api/dashboard/today/route.ts');
  assert.match(route, /canAccessClientAppointments\(gate\.role\)/);
  assert.match(route, /resourceType: 'dashboardToday'/);
  const server = read('src/lib/dashboard/todayServer.ts');
  assert.match(server, /lockedSensitiveClientIds/);
  assert.match(server, /clientId: isLocked \? null : a\.clientId/);
});

const light = (tone: 'upcoming' | 'active' | 'attention' | 'overdue' | 'signed', label = 'x', dueAt: string | null = null) => ({ tone, label, detail: null, dueAt });
const base = { status: 'scheduled', docLight: light('upcoming'), draftNoteId: null, draftReady: false, hasFollowUp: false, protected: false, clientId: 'c1' };

test('today: one primary action that follows the visit state', () => {
  assert.equal(todayPrimaryAction(base).label, 'Start session');
  assert.equal(todayPrimaryAction({ ...base, status: 'completed', docLight: light('active', 'Note to write', '2026-10-23T14:50:00Z') }).label, 'Finish note');
  assert.equal(todayPrimaryAction({ ...base, status: 'completed', docLight: light('attention', 'Note unsigned', 'x'), draftNoteId: 'n1' }).label, 'Finish note');
  assert.equal(todayPrimaryAction({ ...base, status: 'completed', docLight: light('attention', 'Note unsigned', 'x'), draftNoteId: 'n1', draftReady: true }).label, 'Sign');
  assert.equal(todayPrimaryAction({ ...base, status: 'completed', docLight: light('signed', 'Note signed') }).label, 'Book follow-up');
  assert.equal(todayPrimaryAction({ ...base, status: 'completed', docLight: light('signed', 'Note signed'), hasFollowUp: true }).kind, 'none');
  assert.equal(todayPrimaryAction({ ...base, protected: true, clientId: null }).kind, 'none');
});

test('today: notes progress, next visit, all caught up', () => {
  const visits = [
    { id: 'a', status: 'completed', startsAt: '2026-10-23T13:00:00Z', endsAt: '2026-10-23T13:50:00Z', docLight: light('signed') },
    { id: 'b', status: 'completed', startsAt: '2026-10-23T14:00:00Z', endsAt: '2026-10-23T14:50:00Z', docLight: light('attention') },
    { id: 'c', status: 'scheduled', startsAt: '2026-10-23T16:00:00Z', endsAt: '2026-10-23T16:50:00Z', docLight: light('upcoming') },
    { id: 'd', status: 'late-cancel', startsAt: '2026-10-23T17:00:00Z', endsAt: '2026-10-23T17:50:00Z', docLight: light('upcoming') },
  ];
  assert.deepEqual(todayNotesProgress(visits), { done: 1, total: 3 });
  assert.equal(nextTodayVisitId(visits, at('2026-10-23T15:00:00Z')), 'c');
  assert.equal(nextTodayVisitId([...visits, { ...visits[2], id: 'e', status: 'in-session' }], at('2026-10-23T15:00:00Z')), 'e');
  assert.equal(allCaughtUp({ done: 1, total: 3 }), false);
  assert.equal(allCaughtUp({ done: 3, total: 3 }), true);
  assert.equal(allCaughtUp({ done: 0, total: 0 }), false, 'an empty day is not a celebration');
});

test('celebration: once per practice day per user, storage failures never throw', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(claimCelebration(store, 'u1', '2026-10-23'), true);
  assert.equal(claimCelebration(store, 'u1', '2026-10-23'), false, 'second load the same day');
  assert.equal(claimCelebration(store, 'u2', '2026-10-23'), true, 'per user');
  assert.equal(claimCelebration(store, 'u1', '2026-10-24'), true, 'next day');
  assert.equal(mem.get(celebrationKey('u1')), '2026-10-24');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
  assert.equal(claimCelebration(broken, 'u1', '2026-10-23'), false);
  assert.equal(claimCelebration(null, 'u1', '2026-10-23'), false);
  const panel = read('src/features/dashboard/components/TodayPanel.tsx');
  assert.match(panel, /All caught up for today/);
  assert.match(panel, /motion-safe:/, 'animation only without prefers-reduced-motion');
  assert.match(panel, /Notes done today: /);
  assert.match(panel, /Inbox: \{data\.inbox\.toDo\} to do/);
});

test('homes: Today panel on the therapist and prescriber homes', () => {
  assert.match(read('src/features/dashboard/components/TherapistHome.tsx'), /<TodayPanel \/>/);
  const roleHomes = read('src/features/dashboard/components/RoleHomes.tsx');
  const psych = roleHomes.slice(roleHomes.indexOf('function PsychDashboard'), roleHomes.indexOf('function OfficeDashboard'));
  assert.match(psych, /<TodayPanel \/>/);
});

// ─── Shortcuts and palette ───────────────────────────────────────────────────

test('shortcut guard: never while typing in inputs, selects, text areas or editors', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: '' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'textbox' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'SPAN', closest: (sel: string) => (sel.includes('contenteditable') ? {} : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(shortcutEligible({ key: 'g', target: { tagName: 'TEXTAREA' } }), false);
  assert.equal(shortcutEligible({ key: 'k', ctrlKey: true, target: { tagName: 'BODY' } }), false);
  assert.equal(shortcutEligible({ key: 'g', target: { tagName: 'BODY' } }), true);
});

test('shortcuts: g i / g s / g t, n, /, ?', () => {
  let r = resolveShortcut(false, 'g');
  assert.deepEqual(r, { command: null, pendingG: true });
  assert.deepEqual(resolveShortcut(true, 'i').command, { kind: 'go', href: '/dashboard/inbox' });
  assert.deepEqual(resolveShortcut(true, 's').command, { kind: 'go', href: '/dashboard/appointments' });
  assert.deepEqual(resolveShortcut(true, 't').command, { kind: 'go', href: '/dashboard/tasks' });
  r = resolveShortcut(true, 'x');
  assert.deepEqual(r, { command: null, pendingG: false });
  assert.deepEqual(resolveShortcut(false, 'n').command, { kind: 'new_note' });
  assert.deepEqual(resolveShortcut(false, '/').command, { kind: 'search' });
  assert.deepEqual(resolveShortcut(false, '?').command, { kind: 'help' });
  assert.equal(resolveShortcut(false, 'i').command, null, '"i" alone does nothing');
  assert.equal(clientIdInContext('/dashboard/clients/abc123/notes'), 'abc123');
  assert.equal(clientIdInContext('/dashboard/clients/intake'), null);
  assert.equal(clientIdInContext('/dashboard/ehr/notes', '?clientId=c9'), 'c9');
  assert.equal(matchesAllWords('New note for Jane Doe progress', 'note jane'), true);
  assert.equal(matchesAllWords('Give PHQ-9 to Jane Doe', 'note jane'), false);
});

test('palette: actions run with the keyboard; DrFirst only for prescribers; help dialog lists shortcuts', () => {
  const src = read('src/components/layout/DashboardCommandSearch.tsx');
  for (const label of ['Start session (next visit)', 'Book appointment', 'Open inbox', 'My To-Do', 'Open DrFirst']) assert.ok(src.includes(label), label);
  assert.match(src, /New note for \$\{t\.name\}/);
  assert.match(src, /Write treatment plan for \$\{t\.name\}/);
  assert.match(src, /Give PHQ-9 to \$\{t\.name\}/);
  assert.match(src, /if \(canPrescribe\(role\)\)/);
  assert.match(src, /e\.key === 'ArrowDown'/);
  assert.match(src, /aria-activedescendant/);
  assert.match(src, /if \(!shortcutEligible\(event\)\) return;/);
  assert.match(src, /<KeyboardShortcutsDialog/);
});

// ─── Fewer clicks ────────────────────────────────────────────────────────────

test('inline actions: sign only when nothing blocks it, dismiss, acknowledge a lab, complete a follow-up', () => {
  const loaders = read('src/lib/inbox/loaders.ts');
  assert.match(loaders, /kind: 'unsigned_note' as const, noteId: n\.id/);
  assert.match(loaders, /kind: 'ack_lab_result' as const/);
  assert.match(loaders, /kind: 'complete_follow_up' as const/);
  const inbox = read('src/app/dashboard/inbox/page.tsx');
  assert.match(inbox, /<InlineSignNote noteId=\{action\.noteId\}/);
  assert.match(inbox, /<DismissNoteDialog/);
  assert.match(inbox, /\/api\/labs\/orders\/\$\{encodeURIComponent\(action\.labOrderId\)\}\/review/);
  const sign = read('src/components/notes/InlineSignNote.tsx');
  assert.match(sign, /sign-readiness/);
  assert.match(sign, /Open to finish/);
  assert.match(sign, /attested: true/);
  const worklist = read('src/lib/notes/worklist.ts');
  assert.match(worklist, /export function noteSignNextStep/);
  assert.match(worklist, /readyToSign:/);
  assert.match(read('src/components/notes/NotesWorklist.tsx'), /row\.readyToSign && row\.noteId/);
  for (const p of ['src/app/api/notes/[id]/route.ts', 'src/app/api/notes/[id]/dismiss/route.ts', 'src/app/api/labs/orders/[id]/review/route.ts']) {
    assert.match(read(p), /invalidateInboxForOrg\(/, p);
  }
});
