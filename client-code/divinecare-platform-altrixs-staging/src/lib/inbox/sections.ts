import { canAccessPath } from '@/lib/auth/roleAccess';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import {
  canAccessClientMessages,
  canAccessClientRoster,
  canWriteClientChartNotes,
} from '@/lib/clients/orgScope';
import { canUseSudRadar } from '@/lib/clinical/sudRadar/access';
import { canPrescribe } from '@/types/roles';
import { canReviewLabResults, canViewLabs } from '@/lib/labs/access';
import type { InboxSectionKey } from './types';
import { CARELON_INBOX_ROLES } from '@/lib/consents/carelon/workflow';
import { canSeeConsentInbox } from '@/lib/consents/library/access';

/**
 * Who sees each inbox section. Each rule reuses the gate of the API the section reads from,
 * narrowed where a section is not relevant to a role (noted inline). Pure: no server imports.
 */
export type InboxSectionDef = {
  key: InboxSectionKey;
  label: string;
  description: string;
  /** Title shown instead of the row's own when the client is a protected record the viewer cannot open */
  protectedTitle: string;
  /** Part 2 handling: 'mask' keeps the row with no details; 'drop' hides it, as the source page does */
  part2: 'mask' | 'drop';
  allowed: (role: string) => boolean;
};

const AUTH_DESK_ROLES = ['FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
/** Front desk and leadership: they book visits and check identity at intake */
const SCHEDULING_DESK_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

export const INBOX_SECTIONS: InboxSectionDef[] = [
  {
    key: 'alerts',
    label: 'Risk & MBC alerts',
    description: 'Unreviewed risk alerts and unacknowledged measurement-based care escalations',
    protectedTitle: 'Alert on a protected record',
    part2: 'mask',
    // Same gates as GET /api/risk-alerts and GET /api/clinical/mbc/alerts; each source is checked again in the loader
    allowed: (role) => canAccessPath(role, '/dashboard/alerts') || canAccessPath(role, '/dashboard/mbc'),
  },
  {
    key: 'rx_requests',
    label: 'Refill & RxChange',
    description: 'Pending DrFirst refill and RxChange requests',
    protectedTitle: 'Prescription request on a protected record',
    part2: 'mask',
    allowed: (role) => canPrescribe(role),
  },
  {
    key: 'lab_results',
    label: 'Lab results to review',
    description: 'Resulted labs you ordered that still need your sign-off (critical results are urgent)',
    protectedTitle: 'Lab result on a protected record',
    part2: 'mask',
    // Same gates as POST /api/labs/orders/[id]/review: prescribers who can open the lab pages
    allowed: (role) => canViewLabs(role) && canReviewLabResults(role),
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'Threads with unread messages or waiting for a reply',
    protectedTitle: 'Message on a protected record',
    part2: 'mask',
    allowed: (role) => canAccessClientMessages(role),
  },
  {
    key: 'unsigned_notes',
    label: 'My unsigned notes',
    description: 'Notes you wrote that are still unsigned after 24 hours',
    protectedTitle: 'Unsigned note on a protected record',
    part2: 'mask',
    allowed: (role) => canWriteClientChartNotes(role),
  },
  {
    key: 'group_notes',
    label: 'Group notes to finish',
    description: 'Group sessions you facilitate that have ended with attendance not taken or attendee notes not signed',
    protectedTitle: 'Group note',
    part2: 'mask',
    // Group Therapy or SUD Group Counseling page access (the loader only returns the actor's own sessions)
    allowed: (role) => canAccessPath(role, '/dashboard/ehr/group-sessions') || canAccessPath(role, '/dashboard/ehr/sud-groups'),
  },
  {
    key: 'plans_needed',
    label: 'Treatment plans needed',
    description: 'Clients whose progress notes you signed with the treatment plan pending (go-live transition), until the plan is signed, and your plans whose review is due within the reminder window (7 days by default)',
    protectedTitle: 'Treatment plan needed on a protected record',
    part2: 'mask',
    // Authors of progress notes (same gate as unsigned notes)
    allowed: (role) => canWriteClientChartNotes(role),
  },
  {
    key: 'cosign',
    label: 'Co-sign queue',
    description: 'Signed notes waiting for your co-signature',
    protectedTitle: 'Co-signature needed on a protected record',
    part2: 'mask',
    allowed: (role) => canAccessPath(role, '/dashboard/ehr/supervisor-review'),
  },
  {
    key: 'session_frequency',
    label: 'Sessions overdue',
    description: 'Active clients past their recommended therapy frequency. Clients with no appointment or note in 180 days and nothing booked are in a collapsed "likely inactive" group (not counted) with a discharge review action',
    protectedTitle: 'Session overdue on a protected record',
    part2: 'mask',
    // GET /api/clinical/session-frequency gate; Billing and Medical Assistants are left out (not their work)
    allowed: (role) => {
      const r = normalizeStaffRole(role);
      return canAccessClientRoster(r) && r !== 'BILLING' && r !== 'MEDICAL_ASSISTANT';
    },
  },
  {
    key: 'measures',
    label: 'Measures completed',
    description: 'Questionnaires your patients completed from a link (not yet reviewed), and "Worsening" when a score rose by a clinically meaningful amount (PHQ-9 +5, GAD-7 +4, PCL-5 +10). Clears with Mark reviewed on the chart Measures card or when inserted into a note',
    protectedTitle: 'Measure results on a protected record',
    part2: 'mask',
    // Note authors who can open assessments (GET /api/clinical/measure-requests gate)
    allowed: (role) => canWriteClientChartNotes(role) && (canAccessPath(role, '/dashboard/ehr/assessments') || canAccessPath(role, '/dashboard/mbc')),
  },
  {
    key: 'sud_radar',
    label: 'SUD Referral Radar',
    description: 'New substance-use signals for your clients',
    protectedTitle: 'SUD signal on a protected record',
    // The radar page hides protected clients entirely; a masked row would still disclose an SUD signal
    part2: 'drop',
    allowed: (role) => canUseSudRadar(role),
  },
  {
    key: 'documents',
    label: 'Documents to file',
    description: 'Smart Document Intake items waiting for filing: documents for your patients or that you uploaded. Roles that file for everyone also get "All documents"; the Valant import review pile is a separate collapsed group',
    protectedTitle: 'Document for a protected record',
    part2: 'mask',
    allowed: (role) => canAccessPath(role, '/dashboard/ehr/doc-intake'),
  },
  {
    key: 'authorizations',
    label: 'Authorizations expiring',
    description: 'Approved authorizations ending within 14 days, with 3 or fewer visits left, or projected to run out before the end date',
    protectedTitle: 'Authorization on a protected record',
    part2: 'mask',
    // Prior-auth page gate, limited to the front desk, billing and leadership roles that renew them
    allowed: (role) =>
      canAccessPath(role, '/dashboard/ehr/prior-auths') && AUTH_DESK_ROLES.includes(normalizeStaffRole(role)),
  },
  {
    key: 'timely_filing',
    label: 'Claims nearing timely filing',
    description: "Unsent or denied claims within 30 days of (or past) the payer's timely filing limit",
    protectedTitle: 'Claim on a protected record',
    part2: 'mask',
    // Claims page gate, limited to billing and leadership (they file and correct claims)
    allowed: (role) =>
      canAccessPath(role, '/dashboard/billing/claims') &&
      ['BILLING', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(normalizeStaffRole(role)),
  },
  {
    key: 'waitlist_offer',
    label: 'Waitlist can fill a cancellation',
    description: 'Cancelled or late-cancelled future visits in the last 7 days that waitlist entries could take (suggestion only)',
    protectedTitle: 'Waitlist match',
    part2: 'mask',
    // Waitlist page gate, limited to the desk / leadership roles that book from the waitlist
    allowed: (role) =>
      canAccessPath(role, '/dashboard/clients/waitlist') && SCHEDULING_DESK_ROLES.includes(normalizeStaffRole(role)),
  },
  {
    key: 'identity_verify',
    label: 'Verify identity (online booking)',
    description: 'Online bookings that did not match a chart by name and date of birth, or whose contact details differ: verify identity, merge by hand if needed',
    protectedTitle: 'Identity check on a protected record',
    part2: 'mask',
    allowed: (role) => canAccessClientRoster(role) && SCHEDULING_DESK_ROLES.includes(normalizeStaffRole(role)),
  },
  {
    key: 'medicaid_attestations',
    label: 'Medicaid attestations to complete',
    description: 'Maryland Medicaid clients without a current Carelon non-overlap attestation, a new one requested (new PRP / IOP / residential service), or one waiting for a signature. Clients with a visit in the next 7 days come first',
    protectedTitle: 'Attestation on a protected record',
    part2: 'mask',
    // Consent forms page gate, limited to the front desk, office manager and leadership who run the form
    allowed: (role) =>
      canAccessPath(role, '/dashboard/ehr/consents') && (CARELON_INBOX_ROLES as readonly string[]).includes(normalizeStaffRole(role)),
  },
  {
    key: 'consents_needed',
    label: 'Consents to complete',
    description: 'Clients missing a required consent (or with one expired, revoked, declined or needing re-signing on a new version), from the consent library and intake packet rules. Clients with a visit in the next 7 days come first',
    protectedTitle: 'Consents on a protected record',
    part2: 'mask',
    // Consent forms page gate, limited to the front desk, office manager and leadership who run intake
    allowed: (role) => canAccessPath(role, '/dashboard/ehr/consents') && canSeeConsentInbox(role),
  },
  {
    key: 'tasks',
    label: 'My To-Do',
    description: 'Your To-Do list (clinical roles: your own patients and tasks assigned to you)',
    protectedTitle: 'Task on a protected record',
    part2: 'mask',
    allowed: (role) => canAccessPath(role, '/dashboard/tasks'),
  },
];

export const INBOX_SECTION_KEYS = INBOX_SECTIONS.map((s) => s.key);

export function sectionDef(key: InboxSectionKey): InboxSectionDef {
  const def = INBOX_SECTIONS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown inbox section: ${key}`);
  return def;
}

export function isInboxSectionKey(value: string | null | undefined): value is InboxSectionKey {
  return Boolean(value) && (INBOX_SECTION_KEYS as string[]).includes(value as string);
}

/** Sections this role may see, in display order */
export function sectionsForRole(role: string | null | undefined): InboxSectionDef[] {
  if (!role) return [];
  return INBOX_SECTIONS.filter((s) => s.allowed(role));
}
