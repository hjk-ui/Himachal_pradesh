import type { TodayNoteStatus, TodayPrimaryAction, TodayVisitStatus } from './types';

/** Exact primary-action copy (Oct 24 prompt). */
export const TODAY_ACTION_LABELS = {
  protected: 'Protected record',
  done: 'Done',
  book_followup: 'Book follow-up',
  waiting_cosign: 'Waiting for co-signature',
  no_note: 'No note needed',
  sign: 'Sign',
  finish_note: 'Finish note',
  start_session: 'Start session',
} as const;

export const START_SESSION_ARIA = 'Start session: open the note with AI Scribe ready to record';

export type PrimaryActionInput = {
  appointmentId: string;
  /** null when Part 2 locked */
  clientId: string | null;
  status: TodayVisitStatus;
  noteStatus: TodayNoteStatus;
  /** YYYY-MM-DD practice day (date of service) */
  dos: string;
  isVirtual: boolean;
  isGroup: boolean;
  protectedLocked: boolean;
  /** A later non-cancelled visit exists for this client */
  followUpBooked: boolean;
  /** Signed, but a supervisor co-signature is still outstanding */
  awaitingCosign: boolean;
};

/**
 * Cancelled-class visits never happened, so no clinical note is owed.
 * (No-show / late-cancel are treated the same as cancelled for note purposes.)
 */
export function isNoNoteVisit(status: TodayVisitStatus): boolean {
  return status === 'CANCELLED' || status === 'NO_SHOW' || status === 'LATE_CANCEL';
}

export function noteHref(input: Pick<PrimaryActionInput, 'appointmentId' | 'clientId' | 'dos' | 'isGroup'>): string | null {
  if (input.isGroup) return `/dashboard/ehr/group-sessions/sessions/${encodeURIComponent(input.appointmentId)}`;
  if (!input.clientId) return null;
  const q = new URLSearchParams({
    clientId: input.clientId,
    appointmentId: input.appointmentId,
    dos: input.dos,
  });
  return `/dashboard/ehr/notes?${q.toString()}`;
}

/**
 * Start session href.
 * Individual: /dashboard/ehr/notes?clientId=&appointmentId=&dos=&guide=1&telehealth=&scribe=1
 * Group:      /dashboard/ehr/group-sessions/sessions/{id}?scribe=1
 */
export function startSessionHref(
  input: Pick<PrimaryActionInput, 'appointmentId' | 'clientId' | 'dos' | 'isGroup' | 'isVirtual'>
): string | null {
  if (input.isGroup) {
    return `/dashboard/ehr/group-sessions/sessions/${encodeURIComponent(input.appointmentId)}?scribe=1`;
  }
  if (!input.clientId) return null;
  const q = new URLSearchParams();
  q.set('clientId', input.clientId);
  q.set('appointmentId', input.appointmentId);
  q.set('dos', input.dos);
  q.set('guide', '1');
  q.set('telehealth', input.isVirtual ? '1' : '0');
  q.set('scribe', '1');
  return `/dashboard/ehr/notes?${q.toString()}`;
}

/**
 * Primary action selection — evaluated in this order:
 *  1. Protected (Part 2 locked)        → Protected record
 *  2. Cancelled-class                  → No note needed
 *  3. Signed, awaiting co-signature    → Waiting for co-signature
 *  4. Signed + follow-up booked        → Done; signed without follow-up → Book follow-up
 *  5. Draft ready (AI draft)           → Sign
 *  6. Draft in progress / visit ended  → Finish note
 *  7. Otherwise                        → Start session
 */
export function selectPrimaryAction(input: PrimaryActionInput): TodayPrimaryAction {
  if (input.protectedLocked) {
    return { kind: 'protected', label: TODAY_ACTION_LABELS.protected, href: null };
  }
  if (isNoNoteVisit(input.status)) {
    return { kind: 'no_note', label: TODAY_ACTION_LABELS.no_note, href: null };
  }
  if (input.noteStatus === 'SIGNED') {
    if (input.awaitingCosign) {
      return { kind: 'waiting_cosign', label: TODAY_ACTION_LABELS.waiting_cosign, href: null };
    }
    if (input.followUpBooked) {
      return { kind: 'done', label: TODAY_ACTION_LABELS.done, href: null };
    }
    return {
      kind: 'book_followup',
      label: TODAY_ACTION_LABELS.book_followup,
      href: input.clientId ? `/dashboard/appointments?clientId=${encodeURIComponent(input.clientId)}` : null,
    };
  }
  if (input.noteStatus === 'AI_DRAFT') {
    return { kind: 'sign', label: TODAY_ACTION_LABELS.sign, href: noteHref(input) };
  }
  if (input.noteStatus === 'IN_PROGRESS' || input.status === 'COMPLETED') {
    return { kind: 'finish_note', label: TODAY_ACTION_LABELS.finish_note, href: noteHref(input) };
  }
  return {
    kind: 'start_session',
    label: TODAY_ACTION_LABELS.start_session,
    href: startSessionHref(input),
    ariaLabel: START_SESSION_ARIA,
  };
}

/** Visits that count toward "Notes done today". */
export function countsTowardNotes(status: TodayVisitStatus): boolean {
  return !isNoNoteVisit(status);
}
