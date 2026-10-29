import type { AppointmentLabelChipData, LabelMeaning } from '@/lib/scheduling/appointmentLabels';
import type { DocLight, VisitPayment } from '@/lib/appointments/docLight';

export type AppointmentStatus =
  | 'scheduled'
  | 'checked-in'
  | 'in-session'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'late-cancel';

export type NoteStatus = 'not-started' | 'ai-draft' | 'in-progress' | 'signed';

export const APPOINTMENT_TYPES = [
  'Individual Therapy',
  'Group Therapy',
  'Medication Review',
  'Initial Assessment',
  'Crisis Follow-up',
  'Telehealth Check-in',
  'Psychiatric Evaluation',
  'Medication Management',
  'PRP Session',
  'Telehealth',
  'Initial Evaluation',
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientImage?: string | null;
  clinicianId?: string | null;
  clinicianName?: string | null;
  organizationId?: string | null;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  startsAt?: string;
  endsAt?: string;
  /** Practice time zone that date / startTime / endTime are expressed in (e.g. America/New_York). */
  timeZone?: string;
  status: AppointmentStatus;
  noteStatus: NoteStatus;
  isVirtual: boolean;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  /** Staff host/start URL (Zoom start_url). Never send this to the client. */
  hostJoinUrl?: string | null;
  clientJoinUrl?: string | null;
  notes?: string;
  /** Who put the visit on the schedule: via = staff | online | portal | group | import */
  bookedBy?: { name: string | null; via: string | null; at: string | null };
  /** Last staff change; null when never changed */
  lastChangedBy?: { name: string | null; at: string } | null;
  /** Calendar color label (Valant-style); null when none */
  labelId?: string | null;
  label?: AppointmentLabelChipData | null;
  /** Label meaning Altrixs suggests as a one-click chip; never applied silently */
  suggestedLabelMeaning?: LabelMeaning | null;
  /** Telehealth by phone only; notes default their audio-only flag from this */
  audioOnly?: boolean;
  /** Recurring series this visit belongs to */
  seriesId?: string | null;
  /** Group occurrence this per-member visit belongs to (documented on the group session page) */
  groupSessionId?: string | null;
  /** Patient confirmed (reply C) */
  confirmedAt?: string | null;
  /** Documentation status light (src/lib/appointments/docLight.ts); computed by the API */
  docLight?: DocLight;
  /** Copay status; only for roles that read the ledger, null when nothing is recorded */
  payment?: VisitPayment | null;
  /** Planned billing codes chosen at booking, e.g. "90834-95 + 90785" (the signed note's codes bill) */
  plannedCodes?: string | null;
  /*
   * Scheduler filter facets: only with GET /api/appointments?facets=1
   * (src/lib/appointments/listFacets.ts). Absent elsewhere.
   */
  /** Client's home site (Location id) and its name; null when the client has none on file */
  siteId?: string | null;
  siteName?: string | null;
  clientMrn?: string | null;
  /** Visit payer (self-schedule) or the client's primary payer */
  payer?: string | null;
  /** First kept visit of a client created in Altrixs (same rule as the "New" label suggestion) */
  isNewClient?: boolean;
  /** Client enrolled in primary care (Client.primaryCare) */
  primaryCareClient?: boolean;
  /** Maryland Medicaid client without a current Carelon non-overlap attestation (front office roles only) */
  carelonAttestationNeeded?: boolean;
}

export interface CreateAppointmentInput {
  clientId: string;
  type: AppointmentType | string;
  /** UTC ISO instants computed from the practice wall clock (preferred). */
  startsAt?: string;
  endsAt?: string;
  /** Legacy practice wall-clock fields; the server reads them in the practice zone. */
  date?: string;
  startTime?: string;
  endTime?: string;
  isVirtual?: boolean;
  notes?: string;
  clinicianId?: string | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  labelId?: string | null;
  /** Telehealth by phone only (no video) */
  audioOnly?: boolean;
  /** Book over another appointment of the same clinician on purpose (reason required, audited) */
  allowOverbook?: boolean;
  overbookReason?: string | null;
}

export const VISIT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['checked-in', 'no-show', 'cancelled', 'late-cancel'],
  'checked-in': ['in-session', 'no-show', 'cancelled'],
  'in-session': ['completed'],
  completed: [],
  'no-show': [],
  cancelled: [],
  'late-cancel': [],
};
