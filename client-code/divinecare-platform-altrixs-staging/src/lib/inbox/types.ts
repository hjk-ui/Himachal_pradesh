/** Inbox: one list a staff member starts the day from. Shared by server and client (no server imports). */

export type InboxSectionKey =
  | 'alerts'
  | 'rx_requests'
  | 'lab_results'
  | 'messages'
  | 'unsigned_notes'
  | 'group_notes'
  | 'cosign'
  | 'plans_needed'
  | 'session_frequency'
  | 'sud_radar'
  | 'measures'
  | 'documents'
  | 'authorizations'
  | 'timely_filing'
  | 'waitlist_offer'
  | 'identity_verify'
  | 'medicaid_attestations'
  | 'consents_needed'
  | 'tasks';

export type InboxPriority = 'urgent' | 'high' | 'normal' | 'low';

/**
 * Secondary groups inside a section: shown collapsed (or behind a toggle) under the section's list
 * and NOT counted in the section badge, the All list or the urgent count.
 */
export type InboxGroupKey = 'likely_inactive' | 'valant_import' | 'all_documents';

export const INBOX_GROUP_LABEL: Record<InboxGroupKey, string> = {
  likely_inactive: 'Overdue more than 180 days — likely inactive',
  valant_import: 'Valant import — needs review',
  all_documents: 'All documents',
};

/** Quick actions the inbox can take in place, each backed by an existing API */
export type InboxAction =
  /** PATCH /api/risk-alerts/:id/review — high severity needs a documented response */
  | { kind: 'review_risk_alert'; alertId: string; noteRequired: boolean }
  /** POST /api/clinical/mbc/alerts — clinician response notes are required */
  | { kind: 'ack_mbc_alert'; assessmentRecordId: string }
  /** POST /api/clients/:id/identity-verified — note on how identity was checked is required */
  | { kind: 'verify_identity'; clientId: string; noteRequired: true }
  /** Unsigned note: Sign (GET /api/notes/:id/sign-readiness, then PATCH /api/notes/:id) or Dismiss (POST /api/notes/:id/dismiss) */
  | { kind: 'unsigned_note'; noteId: string }
  /** POST /api/labs/orders/:id/review — provider sign-off of the results (note optional) */
  | { kind: 'ack_lab_result'; labOrderId: string; critical: boolean }
  /** PATCH /api/scribe/follow-ups — mark an accepted AI Scribe follow-up done */
  | { kind: 'complete_follow_up'; followUpId: string };

/** What a section loader returns, before Part 2 masking */
export type InboxDraft = {
  /** Same entity in two sections (e.g. a risk alert that is also a To-Do) shares this key */
  entityKey: string;
  title: string;
  detail: string | null;
  clientId: string | null;
  /** Client (or, for staff tasks, staff) name; null when the item is about no one */
  clientName: string | null;
  priority: InboxPriority;
  /** ISO time the item became pending; age is measured from it. Null when the source has no time */
  since: string | null;
  href: string;
  hrefLabel: string;
  action: InboxAction | null;
  /** Secondary group (collapsed, not counted); absent = the section's main list */
  group?: InboxGroupKey;
};

export type InboxItem = Omit<InboxDraft, 'clientName'> & {
  id: string;
  section: InboxSectionKey;
  /** Name, "Protected record", or null */
  clientDisplay: string | null;
  protected: boolean;
};

export type InboxGroup = { key: InboxGroupKey; label: string; items: InboxItem[] };

export type InboxSectionResult = {
  key: InboxSectionKey;
  /** The section's main list (what the badge counts) */
  items: InboxItem[];
  /** Collapsed secondary groups (not counted) */
  groups?: InboxGroup[];
  /** Plain-language limit on this section's data (e.g. DrFirst username missing) */
  notice: string | null;
  /** The source failed to load; count is unknown */
  error: string | null;
};

export type InboxSectionSummary = {
  key: InboxSectionKey;
  label: string;
  count: number | null;
  urgent: number;
  notice: string | null;
  error: string | null;
};

export type InboxSummary = {
  /** Distinct items across all sections (an entity in two sections counts once) */
  total: number;
  urgent: number;
  sections: InboxSectionSummary[];
  generatedAt: string;
};
