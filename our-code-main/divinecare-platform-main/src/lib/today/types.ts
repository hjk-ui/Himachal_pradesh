/** Oct 24 — Today cockpit shared types (API + panel). */

export const TODAY_VISIT_CAP = 60;

export type TodayActionKind =
  | 'protected'
  | 'done'
  | 'book_followup'
  | 'waiting_cosign'
  | 'no_note'
  | 'sign'
  | 'finish_note'
  | 'start_session';

export type TodayPrimaryAction = {
  kind: TodayActionKind;
  label: string;
  /** null = informational only (no navigation) */
  href: string | null;
  ariaLabel?: string;
};

export type TodayVisitStatus =
  | 'SCHEDULED'
  | 'CHECKED_IN'
  | 'IN_SESSION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'LATE_CANCEL';

export type TodayNoteStatus = 'NOT_STARTED' | 'AI_DRAFT' | 'IN_PROGRESS' | 'SIGNED';

export type TodayVisit = {
  id: string;
  /** null when the record is Part 2 locked for this viewer */
  clientId: string | null;
  /** Protected alias (or "Protected record") when locked */
  clientName: string;
  /** null when locked — appointment type can reveal protected treatment */
  type: string | null;
  startsAt: string;
  endsAt: string;
  status: TodayVisitStatus;
  noteStatus: TodayNoteStatus;
  isVirtual: boolean;
  isGroup: boolean;
  isProtected: boolean;
  primaryAction: TodayPrimaryAction;
};

export type TodayResponse = {
  success: true;
  /** Practice-day YYYY-MM-DD */
  day: string;
  visits: TodayVisit[];
  nextVisitId: string | null;
  notes: { done: number; total: number };
  /** null when the viewer's role has no inbox */
  inbox: { unread: number } | null;
};
