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
  status: AppointmentStatus;
  noteStatus: NoteStatus;
  isVirtual: boolean;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  /** Staff host/start URL (Zoom start_url). Never send this to the client. */
  hostJoinUrl?: string | null;
  clientJoinUrl?: string | null;
  notes?: string;
  patientBooked?: boolean;
  /** Patient (online) vs Clinic staff */
  bookedByLabel?: string;
  createdVia?: string | null;
  createdByName?: string | null;
  lastChangedByLabel?: string | null;
  lastChangedAt?: string | null;
  insurancePayer?: string | null;
  payerHint?: string | null;
  declineReason?: string | null;
}

export interface CreateAppointmentInput {
  clientId: string;
  type: AppointmentType | string;
  date: string;
  startTime: string;
  endTime?: string;
  isVirtual?: boolean;
  notes?: string;
  clinicianId?: string | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
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
