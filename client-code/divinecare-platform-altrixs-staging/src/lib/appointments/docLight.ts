/**
 * Documentation status light for one appointment (Valant-style red / amber / green dot on every
 * scheduler block, plus grey and blue). Pure (browser + server + tests): the appointments API and
 * GET /api/dashboard/today compute it from the visit and its linked notes (dismissed notes are
 * excluded upstream) with the practice sign deadline from src/lib/notes/standard.ts.
 *
 *   grey   upcoming (or cancelled: no note needed)
 *   blue   in session, note in progress before the visit ends, or a just-finished visit (< 24 h)
 *   amber  completed visit with an unsigned draft, no note 24 h after the visit, or signed and
 *          waiting for a co-signature
 *   red    unsigned past the practice note deadline (72 h default)
 *   green  signed (and co-signed when the practice requires it)
 */
import { DEFAULT_NOTE_DUE_HOURS, noteDueAt } from '@/lib/notes/standard';

const HOUR = 3_600_000;
/** A finished visit with no note turns amber after this many hours (red at the practice deadline). */
export const NO_NOTE_ATTENTION_HOURS = 24;

export type DocLightTone = 'upcoming' | 'active' | 'attention' | 'overdue' | 'signed';

export type DocLight = {
  tone: DocLightTone;
  /** Short status ("Note signed", "Overdue"), always shown in text (tooltip + screen readers) */
  label: string;
  /** One more line for the tooltip ("Draft not signed · due Oct 25 2:00 PM") */
  detail: string | null;
  /** Practice sign deadline for this visit (ISO); null when not applicable */
  dueAt: string | null;
};

/** What the linked (non-dismissed) notes say about the visit. */
export type VisitNoteSummary = {
  /** At least one linked note (any status), or an AI draft generated on the appointment */
  hasNote: boolean;
  /** A linked note is signed or locked */
  signed: boolean;
  /** Every signed note still needs the supervisor's co-signature */
  cosignPending: boolean;
  /** A signed note was co-signed */
  cosigned: boolean;
};

export const EMPTY_NOTE_SUMMARY: VisitNoteSummary = { hasNote: false, signed: false, cosignPending: false, cosigned: false };

type NoteRow = { status: 'Draft' | 'Signed' | 'Locked'; cosignRequired?: boolean | null; cosignedAt?: string | Date | null };

/** Summary of the visit's linked notes (the caller drops dismissed notes). */
export function summarizeVisitNotes(notes: NoteRow[]): VisitNoteSummary {
  const signedNotes = notes.filter((n) => n.status === 'Signed' || n.status === 'Locked');
  const complete = signedNotes.filter((n) => !n.cosignRequired || n.cosignedAt);
  return {
    hasNote: notes.length > 0,
    signed: signedNotes.length > 0,
    cosignPending: signedNotes.length > 0 && complete.length === 0,
    cosigned: signedNotes.some((n) => Boolean(n.cosignRequired && n.cosignedAt)),
  };
}

export const DOC_LIGHT_DOT: Record<DocLightTone, string> = {
  upcoming: 'bg-slate-400',
  active: 'bg-sky-500',
  attention: 'bg-amber-500',
  overdue: 'bg-rose-600',
  signed: 'bg-emerald-500',
};

/** Legend text, in the order the scheduler legend shows it. */
export const DOC_LIGHT_LEGEND: { tone: DocLightTone; label: string }[] = [
  { tone: 'upcoming', label: 'Upcoming' },
  { tone: 'active', label: 'In session / note in progress' },
  { tone: 'attention', label: 'Note needs attention' },
  { tone: 'overdue', label: 'Note overdue' },
  { tone: 'signed', label: 'Signed' },
];

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dueText(due: Date, timeZone: string): string {
  try {
    return due.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return due.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function deriveDocLight(input: {
  /** UI visit status: scheduled | checked-in | in-session | completed | no-show | cancelled | late-cancel */
  status: string;
  /** Practice wall date + end time of the visit (deadline per standard.ts) */
  date: string;
  endTime: string;
  endsAt: string | Date;
  notes: VisitNoteSummary;
  now: Date;
  deadlineHours?: number;
  timeZone: string;
}): DocLight {
  const { notes, now } = input;
  const status = String(input.status || '').toLowerCase().replace(/[_\s]+/g, '-');
  const deadlineHours = input.deadlineHours && input.deadlineHours > 0 ? input.deadlineHours : DEFAULT_NOTE_DUE_HOURS;

  if (notes.signed && !notes.cosignPending) {
    return { tone: 'signed', label: notes.cosigned ? 'Note signed and co-signed' : 'Note signed', detail: null, dueAt: null };
  }
  if (notes.signed) {
    return { tone: 'attention', label: 'Signed, waiting for co-signature', detail: 'A supervisor co-signature is required', dueAt: null };
  }
  if (status === 'cancelled' || status === 'late-cancel') {
    return { tone: 'upcoming', label: status === 'cancelled' ? 'Cancelled' : 'Late cancel', detail: 'No note needed', dueAt: null };
  }
  if (status === 'in-session') {
    return { tone: 'active', label: 'In session', detail: notes.hasNote ? 'Note in progress' : null, dueAt: null };
  }

  const end = toDate(input.endsAt);
  const ended = status === 'completed' || status === 'no-show' || (end ? now.getTime() >= end.getTime() : false);
  if (!ended) {
    if (notes.hasNote) return { tone: 'active', label: 'Note in progress', detail: null, dueAt: null };
    return { tone: 'upcoming', label: 'Upcoming', detail: status === 'checked-in' ? 'Checked in' : null, dueAt: null };
  }

  const due = noteDueAt(input.date, input.endTime, deadlineHours, input.timeZone);
  const dueAt = due ? due.toISOString() : null;
  const what = notes.hasNote ? 'Draft not signed' : status === 'no-show' ? 'No-show note not written' : 'No note yet';
  if (due && now.getTime() > due.getTime()) {
    return { tone: 'overdue', label: 'Note overdue', detail: `${what} · past the ${deadlineHours}-hour deadline`, dueAt };
  }
  const dueLine = due ? ` · due ${dueText(due, input.timeZone)}` : '';
  if (notes.hasNote) return { tone: 'attention', label: 'Note unsigned', detail: `${what}${dueLine}`, dueAt };
  const endedAt = end ?? (due ? new Date(due.getTime() - deadlineHours * HOUR) : null);
  if (endedAt && now.getTime() - endedAt.getTime() > NO_NOTE_ATTENTION_HOURS * HOUR) {
    return { tone: 'attention', label: 'No note yet', detail: `More than ${NO_NOTE_ATTENTION_HOURS} hours after the visit${dueLine}`, dueAt };
  }
  return { tone: 'active', label: 'Note to write', detail: `Visit ended${dueLine}`, dueAt };
}

/** Patient copay status for the visit (front office / billing roles only). */
export type VisitPayment = 'collected' | 'pending' | 'failed';

export const VISIT_PAYMENT_LABEL: Record<VisitPayment, string> = {
  collected: 'Copay collected',
  pending: 'Copay payment processing',
  failed: 'Copay charge failed',
};

/**
 * Copay status from the visit's card charges (PatientCharge kind copay) and the front-office
 * "copay collected" checklist mark. null = nothing recorded (no icon).
 */
export function visitPaymentStatus(input: { chargeStatuses: string[]; markedCollected: boolean }): VisitPayment | null {
  const s = input.chargeStatuses.map((x) => x.toLowerCase());
  if (input.markedCollected || s.some((x) => x === 'succeeded' || x === 'partially_refunded')) return 'collected';
  if (s.some((x) => x === 'failed' || x === 'needs_action')) return 'failed';
  if (s.some((x) => x === 'pending' || x === 'processing')) return 'pending';
  return null;
}
