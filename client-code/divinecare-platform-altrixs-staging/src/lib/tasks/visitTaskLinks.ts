/**
 * Clinical To-Do links and urgency (pure; tested in tests/bh-workflow.test.ts).
 *
 * Every clinical task lands where the work is done, filtered to that client / visit: an unsigned
 * note opens that note, a visit without a note opens the note editor for that appointment with the
 * Visit Guide, a no-show opens the No-Show note (outreach + risk review), a plan review opens the plan.
 * Urgency follows the practice sign deadline (Practice settings), not a fixed "older than a day".
 */
import { noteDueAt } from '@/lib/notes/standard';
import { toPracticeWallTime, DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';

const DAY = 86_400_000;

/** Leadership sees everyone's open notes; clinicians see their own documentation work. */
const LEADERSHIP = new Set(['ADMIN', 'SUPER_ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

/**
 * True when the role's clinical tasks (unsigned notes, visits without a note, no-show outreach)
 * are the author's / treating clinician's own, not every visit of every care-team client.
 */
export function ownClinicalWork(role: string | null | undefined): boolean {
  return !LEADERSHIP.has(String(role || '').toUpperCase());
}

export function openNoteHref(noteId: string): string {
  return `/dashboard/ehr/notes?openNote=${encodeURIComponent(noteId)}`;
}

/** Note editor for this appointment with the Visit Guide (the notes page reopens an existing note). */
export function visitNoteHref(input: { clientId: string; appointmentId: string; startsAt: Date; timeZone?: string | null; virtual?: boolean }): string {
  const qs = new URLSearchParams({
    clientId: input.clientId,
    appointmentId: input.appointmentId,
    dos: toPracticeWallTime(input.startsAt, input.timeZone || DEFAULT_PRACTICE_TIME_ZONE).date,
    guide: '1',
  });
  if (input.virtual) qs.set('telehealth', '1');
  return `/dashboard/ehr/notes?${qs.toString()}`;
}

/** Unsigned note urgency under the practice deadline (hours after the end of the service day). */
export function unsignedNoteUrgency(input: {
  dateOfService: string | null;
  deadlineHours: number;
  timeZone?: string | null;
  now: Date;
}): { priority: 'urgent' | 'normal'; daysUntil: number | null; overdue: boolean } {
  const due = noteDueAt(input.dateOfService, null, input.deadlineHours, input.timeZone || DEFAULT_PRACTICE_TIME_ZONE);
  if (!due) return { priority: 'normal', daysUntil: null, overdue: false };
  const ms = due.getTime() - input.now.getTime();
  const overdue = ms < 0;
  return { priority: overdue || ms < DAY ? 'urgent' : 'normal', daysUntil: Math.floor(ms / DAY), overdue };
}
