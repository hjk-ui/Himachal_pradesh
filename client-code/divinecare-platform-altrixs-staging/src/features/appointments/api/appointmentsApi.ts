import { apiJson } from '@/lib/api-client';
import { resolvePracticeTimeZone } from '@/lib/time/practiceTime';
import type { AppointmentLabelDto, LabelMeaning } from '@/lib/scheduling/appointmentLabels';
import type { SeriesCreateInput, SeriesCreateResult } from '../appointmentForm';
import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
  NoteStatus,
} from '../types';

type FetchAppointmentsOptions = {
  clientId?: string;
  isVirtual?: boolean;
  date?: string;
  /** Practice-calendar days YYYY-MM-DD (inclusive). Server default: 90 days back .. 365 ahead. */
  from?: string;
  to?: string;
  /** Scheduler filter facets (site, MRN, payer, new client); see src/lib/appointments/listFacets.ts */
  facets?: boolean;
};

/** Appointments plus the practice time zone their date / startTime / endTime are in. */
export async function fetchAppointmentsWithZone(
  options?: FetchAppointmentsOptions
): Promise<{ appointments: Appointment[]; timeZone: string }> {
  const params = new URLSearchParams();
  if (options?.clientId) params.set('clientId', options.clientId);
  if (options?.isVirtual) params.set('isVirtual', 'true');
  if (options?.date) params.set('date', options.date);
  if (options?.from) params.set('from', options.from);
  if (options?.to) params.set('to', options.to);
  if (options?.facets) params.set('facets', '1');
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await apiJson<{ success: true; appointments: Appointment[]; timeZone?: string }>(
    `/api/appointments${qs}`
  );
  return {
    appointments: data.appointments,
    timeZone: resolvePracticeTimeZone(data.timeZone ?? data.appointments[0]?.timeZone),
  };
}

export async function fetchAppointments(options?: FetchAppointmentsOptions): Promise<Appointment[]> {
  return (await fetchAppointmentsWithZone(options)).appointments;
}

/** POST /api/appointments answered 409: this client + clinician + start is already booked. */
export class DuplicateAppointmentError extends Error {
  readonly existingAppointmentId: string;
  constructor(message: string, existingAppointmentId: string) {
    super(message);
    this.name = 'DuplicateAppointmentError';
    this.existingAppointmentId = existingAppointmentId;
  }
}

/** 409 CLINICIAN_OVERLAP: the clinician has another visit then; staff may book anyway with a reason. */
export class ClinicianOverlapError extends Error {
  readonly conflictIds: string[];
  constructor(message: string, conflictIds: string[]) {
    super(message);
    this.name = 'ClinicianOverlapError';
    this.conflictIds = conflictIds;
  }
}

/** One consent in the check-in soft stop (409 CONSENT_REQUIRED). */
export type CheckInConsentItem = { key: string; title: string; detail: string };

/**
 * PATCH answered 409 CONSENT_REQUIRED: checking in needs the consent to treatment (and the
 * telehealth consent for a virtual visit), or an override reason (src/lib/consents/library/decisions.ts).
 */
export class ConsentRequiredError extends Error {
  readonly missing: CheckInConsentItem[];
  readonly flags: CheckInConsentItem[];
  readonly isVirtual: boolean;
  constructor(message: string, missing: CheckInConsentItem[], flags: CheckInConsentItem[], isVirtual: boolean) {
    super(message);
    this.name = 'ConsentRequiredError';
    this.missing = missing;
    this.flags = flags;
    this.isVirtual = isVirtual;
  }
}

function rethrowDuplicate(err: unknown): never {
  const e = err as { status?: number; data?: { code?: string; existingAppointmentId?: string; conflictIds?: string[]; missing?: CheckInConsentItem[]; flags?: CheckInConsentItem[]; isVirtual?: boolean } } | null;
  if (e?.status === 409 && e.data?.code === 'CONSENT_REQUIRED') {
    throw new ConsentRequiredError((err as Error).message, e.data.missing ?? [], e.data.flags ?? [], Boolean(e.data.isVirtual));
  }
  if (e?.status === 409 && e.data?.code === 'DUPLICATE_APPOINTMENT' && e.data.existingAppointmentId) {
    throw new DuplicateAppointmentError((err as Error).message, e.data.existingAppointmentId);
  }
  if (e?.status === 409 && e.data?.code === 'CLINICIAN_OVERLAP') {
    throw new ClinicianOverlapError((err as Error).message, e.data.conflictIds ?? []);
  }
  throw err;
}

/** POST /api/appointments/series: book a recurring series; conflicting dates are skipped and listed. */
export async function createAppointmentSeries(input: SeriesCreateInput): Promise<SeriesCreateResult> {
  const data = await apiJson<{ success: true } & SeriesCreateResult>('/api/appointments/series', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { seriesId: data.seriesId, created: data.created, skipped: data.skipped };
}

/** Edit / cancel "this and following" or "entire series". */
export async function updateAppointmentSeries(
  seriesId: string,
  body:
    | { action: 'edit'; appointmentId: string; scope: 'following' | 'all'; changes: Record<string, unknown> }
    | { action: 'cancel'; appointmentId: string; scope: 'this' | 'following' | 'all' }
) {
  return apiJson<{
    success: true;
    updated?: string[];
    unchanged?: { id: string; date: string; reason: string }[];
    cancelled?: string[];
    waitlistSuggestions?: unknown[];
  }>(`/api/appointments/series/${encodeURIComponent(seriesId)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function createAppointment(
  input: CreateAppointmentInput
): Promise<Appointment> {
  try {
    const data = await apiJson<{ success: true; appointment: Appointment }>(
      '/api/appointments',
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    return data.appointment;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

/** Edit Details fields. The client is fixed: a different patient is a new appointment. */
export type AppointmentEditPatch = {
  type?: string;
  /** UTC ISO instants computed from the practice wall clock. */
  startsAt?: string;
  endsAt?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  clinicianId?: string;
  isVirtual?: boolean;
  videoProvider?: 'zoom' | 'google' | 'in_app';
  notes?: string | null;
  audioOnly?: boolean;
  allowOverbook?: boolean;
  overbookReason?: string;
  /** Check in without the required consent (10+ characters; stored and audited) */
  consentOverrideReason?: string;
};

export async function updateAppointment(
  id: string,
  data: {
    status?: AppointmentStatus;
    visitStatus?: AppointmentStatus;
    noteStatus?: NoteStatus;
    notes?: string | null;
  } & AppointmentEditPatch
): Promise<Appointment> {
  const { status, visitStatus, ...rest } = data;
  try {
    const res = await apiJson<{ success: true; appointment: Appointment }>(
      `/api/appointments/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...rest,
          visitStatus: visitStatus ?? status,
          status,
        }),
      }
    );
    return res.appointment;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function generateAppointmentAiDraft(id: string): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(
    `/api/appointments/${id}/generate-ai-draft`,
    { method: 'POST' }
  );
  return res.appointment;
}

export async function setAppointmentLabel(
  id: string,
  labelId: string | null,
  viaSuggestion?: LabelMeaning
): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(`/api/appointments/${id}/label`, {
    method: 'PUT',
    body: JSON.stringify({ labelId, viaSuggestion }),
  });
  return res.appointment;
}

export type AppointmentLabelList = {
  ready: boolean;
  labels: AppointmentLabelDto[];
  autoApplySuggested: boolean;
  canManage: boolean;
};

export async function fetchAppointmentLabels(all = false): Promise<AppointmentLabelList> {
  return apiJson<AppointmentLabelList & { success: true }>(
    `/api/scheduling/appointment-labels${all ? '?all=1' : ''}`
  );
}
