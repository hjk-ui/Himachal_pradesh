/**
 * Front-office readiness contract (front desk huddle + office manager operations view).
 *
 * The same idea as the clinician Visit Guide (src/lib/visits), for front-office work: every
 * appointment gets a short list of checks (before the day, at check-in, at check-out, end of day).
 * Each check is computed from data already in Altrixs; when the data cannot prove it (e.g. "photo ID
 * and insurance card verified"), staff mark it done or not applicable with a reason. Marks live in
 * visit_checklist_items with visit_kind 'front_office' and step_id 'fo_<item id>'.
 *
 * Minimum necessary: nothing here carries clinical content (no notes, diagnoses, medications,
 * assessments or risk detail). Note status is a documentation flag (signed / not signed) only.
 */

export type FoPhase = 'prep' | 'check_in' | 'check_out' | 'end_of_day';

export type FoItemId =
  | 'confirm'
  | 'eligibility'
  | 'authorization'
  | 'demographics'
  | 'consents'
  | 'intake'
  | 'carelon'
  | 'balance'
  | 'telehealth'
  | 'portal'
  | 'no_show_call'
  | 'identity'
  | 'id_card'
  | 'copay'
  | 'check_in'
  | 'next_appt'
  | 'documents'
  | 'visit_closed'
  | 'reschedule'
  | 'outreach';

/** done / needs action / not applicable. 'info' = shown, never counted as work. */
export type FoStatus = 'done' | 'needs_action' | 'not_applicable' | 'info';

/** required = counts toward readiness; recommended = shown and counted separately; optional = never counted */
export type FoLevel = 'required' | 'recommended' | 'optional';

/** Status stored for a staff mark (same values the visit checklist table allows) */
export type FoMarkStatus = 'done' | 'not_applicable' | 'deferred';

export type FoMark = { status: FoMarkStatus; reason: string | null; byName: string | null; at: string };

export type FoAction =
  | { kind: 'run_eligibility' }
  | { kind: 'check_in' }
  | { kind: 'call'; phone: string | null }
  | { kind: 'link'; href: string; label: string };

export interface FoItem {
  id: FoItemId;
  phase: FoPhase;
  label: string;
  level: FoLevel;
  status: FoStatus;
  /** Why, from data ("Verified 2026-10-18 (Waystar): active") or the staff reason for a mark */
  reason: string;
  /** Done but worth a look (e.g. 2 authorization units left, consent expiring) */
  warning?: boolean;
  /**
   * Suggested hard stop at check-in (owner decides whether to enforce). Display only: nothing in
   * Altrixs blocks on it except the existing consent soft stop.
   */
  stop?: boolean;
  action?: FoAction;
  /** Staff may mark it done / not applicable (the data cannot prove it, or to override with a reason) */
  markable: boolean;
  /** Marking done needs a note (e.g. outreach: what was done) */
  noteRequired?: boolean;
  mark?: FoMark | null;
}

/** DB appointment status */
export type FoApptStatus = 'SCHEDULED' | 'CHECKED_IN' | 'IN_SESSION' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'LATE_CANCEL';

export type FoReadiness = 'ready' | 'attention' | 'stop' | 'closed';

export interface FoRow {
  appointmentId: string;
  clientId: string;
  clientName: string;
  /** Client chart is a locked sensitive record for this viewer (name masked) */
  locked: boolean;
  clinicianName: string | null;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  status: FoApptStatus;
  isVirtual: boolean;
  isNewClient: boolean;
  payer: string | null;
  locationId: string | null;
  locationName: string | null;
  phone: string | null;
  items: FoItem[];
  readiness: FoReadiness;
  /** required items needing action, by phase */
  open: Record<FoPhase, number>;
  /** Copay expected for this visit (cents) and what was posted today for the client */
  copay: { expectedCents: number | null; collectedCents: number; markedCollected: boolean } | null;
  /** Documentation flag only (no content): true = a linked note is signed */
  noteSigned: boolean | null;
}

export interface FoReconciliation {
  /** kept visits (checked in / in session / completed) with an expected copay */
  expectedCount: number;
  expectedCents: number;
  /** visits whose copay is covered by a posted payment that day */
  collectedCount: number;
  /** posted patient payments that day for the clients seen (deduplicated by client) */
  collectedCents: number;
  /** expected but nothing posted */
  missingCount: number;
  missingCents: number;
  /** staff marked "collected" but no payment is posted (needs posting by billing / office manager) */
  markedNotPostedCount: number;
}

export interface FoDaySummary {
  date: string;
  total: number;
  kept: number;
  ready: number;
  attention: number;
  stop: number;
  /** needs-action counts per item id (required + recommended) */
  byItem: Partial<Record<FoItemId, number>>;
  noShows: number;
  lateCancels: number;
  cancelled: number;
  /** still Scheduled after the end time (never marked arrived / no-show) */
  notClosed: number;
  /** kept visits whose note is not signed (count only) */
  unsignedNotes: number;
  reconciliation: FoReconciliation | null;
}

export interface FrontOfficeDay {
  timeZone: string;
  today: string;
  dates: string[];
  locationId: string | null;
  rows: FoRow[];
  summaries: FoDaySummary[];
  /** settings the rules used (shown so staff know the window) */
  rules: { eligibilityWindowDays: number; medicaidSameMonth: boolean };
  /** parts the viewer's role does not include (so the UI can say why an item is missing) */
  hidden: string[];
}
