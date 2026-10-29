import { DEFAULT_PRACTICE_TIME_ZONE, fromPracticeWallTime } from '@/lib/time/practiceTime';
import type { AppointmentEditPatch } from './api/appointmentsApi';
import type { Appointment, CreateAppointmentInput } from './types';
import type { RecurrenceRule, SeriesFrequency } from '@/lib/scheduling/recurrence';

/**
 * The calendar's appointment form, shared by "New Appointment" and "Edit Details".
 * Edit mode is bound to one appointment id and saves through PATCH /api/appointments/[id]
 * (plus PUT .../label when the label changed). It never calls create: before this, Edit Details
 * reopened the create form and saving booked a second appointment.
 */
export type VideoProviderChoice = 'zoom' | 'google' | 'in_app';

export type AppointmentFormValues = {
  clientId: string;
  clinicianId: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  isVirtual: boolean;
  videoProvider: VideoProviderChoice;
  labelId: string | null;
  notes: string;
  /** Telehealth by phone only ("Audio only (phone)") */
  audioOnly: boolean;
  /** Repeat (new appointments only): none or a recurring series */
  repeat: 'none' | SeriesFrequency;
  /** 0=Sun..6=Sat; empty = the date's weekday (weekly / biweekly) */
  repeatWeekdays: number[];
  repeatEnds: 'count' | 'date';
  repeatCount: number;
  repeatUntil: string;
  /** Set after a clinician-overlap 409 when staff choose to book anyway */
  overbookReason: string;
};

export type AppointmentFormMode =
  | { kind: 'create' }
  | { kind: 'edit'; appointment: Appointment };

export function emptyAppointmentForm(date: string, clientId = ''): AppointmentFormValues {
  return {
    clientId,
    clinicianId: '',
    type: 'Individual Therapy',
    date,
    startTime: '',
    endTime: '',
    isVirtual: false,
    // Practice default: in-app video (Amazon Chime, under the BAA)
    videoProvider: 'in_app',
    labelId: null,
    notes: '',
    audioOnly: false,
    repeat: 'none',
    repeatWeekdays: [],
    repeatEnds: 'count',
    repeatCount: 6,
    repeatUntil: '',
    overbookReason: '',
  };
}

function providerChoice(p: Appointment['videoProvider'] | string | null | undefined): VideoProviderChoice {
  return p === 'zoom' || p === 'google' ? p : 'in_app';
}

/** Prefill for Edit Details. Also the baseline that decides which fields actually changed. */
export function formValuesFromAppointment(a: Appointment): AppointmentFormValues {
  return {
    clientId: a.clientId,
    clinicianId: a.clinicianId || '',
    type: a.type,
    date: a.date,
    startTime: a.startTime,
    endTime: a.endTime,
    isVirtual: Boolean(a.isVirtual),
    videoProvider: a.isVirtual ? providerChoice(a.videoProvider) : 'in_app',
    labelId: a.labelId ?? null,
    notes: a.notes || '',
    audioOnly: Boolean((a as { audioOnly?: boolean }).audioOnly),
    repeat: 'none',
    repeatWeekdays: [],
    repeatEnds: 'count',
    repeatCount: 6,
    repeatUntil: '',
    overbookReason: '',
  };
}

function minutesOf(hhmm: string) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Series rule from the form's Repeat fields (null when not repeating). */
export function formRecurrenceRule(v: AppointmentFormValues): RecurrenceRule | null {
  if (v.repeat === 'none') return null;
  const duration = v.endTime && v.endTime > v.startTime ? minutesOf(v.endTime) - minutesOf(v.startTime) : 50;
  return {
    frequency: v.repeat,
    interval: 1,
    byWeekday: v.repeat === 'monthly' || !v.repeatWeekdays.length ? null : v.repeatWeekdays,
    startDate: v.date,
    endDate: v.repeatEnds === 'date' ? v.repeatUntil || null : null,
    count: v.repeatEnds === 'count' ? v.repeatCount : null,
    startTime: v.startTime,
    durationMinutes: duration,
  };
}

export function validateAppointmentForm(v: AppointmentFormValues): string | null {
  if (!v.clientId || !v.date || !v.startTime) return 'Client, date, and start time are required';
  if (v.endTime && v.endTime <= v.startTime) return 'End time must be after start time';
  if (!formInstants(v)) return 'Invalid date/time';
  return null;
}

/**
 * Form wall-clock fields (practice time) → explicit UTC instants. Uses the PRACTICE zone, not
 * the browser's, so staff working from another zone still book 9:00 AM practice time.
 * No end time = 50 minutes (same default as the server).
 */
export function formInstants(
  v: Pick<AppointmentFormValues, 'date' | 'startTime' | 'endTime'>,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): { startsAt: string; endsAt: string } | null {
  const start = fromPracticeWallTime(v.date, v.startTime, timeZone);
  if (!start) return null;
  const end = v.endTime
    ? fromPracticeWallTime(v.date, v.endTime, timeZone)
    : new Date(start.getTime() + 50 * 60 * 1000);
  if (!end) return null;
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Only the fields the user changed, so an untouched field is never re-sent. */
export function buildAppointmentEditPatch(
  original: Appointment,
  v: AppointmentFormValues,
  timeZone: string = original.timeZone || DEFAULT_PRACTICE_TIME_ZONE
): AppointmentEditPatch {
  const base = formValuesFromAppointment(original);
  const patch: AppointmentEditPatch = {};
  if (v.type !== base.type) patch.type = v.type;
  const timeChanged =
    v.date !== base.date || v.startTime !== base.startTime || (Boolean(v.endTime) && v.endTime !== base.endTime);
  if (timeChanged) {
    const when = formInstants({ ...v, endTime: v.endTime || base.endTime }, timeZone);
    if (when) {
      patch.startsAt = when.startsAt;
      patch.endsAt = when.endsAt;
    }
  }
  if (v.clinicianId && v.clinicianId !== base.clinicianId) patch.clinicianId = v.clinicianId;
  if (v.isVirtual !== base.isVirtual) patch.isVirtual = v.isVirtual;
  if (v.isVirtual && v.videoProvider !== base.videoProvider) patch.videoProvider = v.videoProvider;
  if (v.notes.trim() !== base.notes.trim()) patch.notes = v.notes.trim() || null;
  if (v.audioOnly !== base.audioOnly) patch.audioOnly = v.isVirtual && v.audioOnly;
  if (v.overbookReason.trim() && (patch.startsAt || patch.clinicianId)) {
    patch.allowOverbook = true;
    patch.overbookReason = v.overbookReason.trim();
  }
  return patch;
}

export type AppointmentFormApi = {
  create: (input: CreateAppointmentInput) => Promise<Appointment>;
  update: (id: string, patch: AppointmentEditPatch) => Promise<Appointment>;
  setLabel: (id: string, labelId: string | null) => Promise<Appointment>;
  /** Recurring series (Repeat): books every occurrence, reports skipped conflicts */
  createSeries?: (input: SeriesCreateInput) => Promise<SeriesCreateResult>;
};

export type SeriesCreateInput = Omit<CreateAppointmentInput, 'startsAt' | 'endsAt' | 'date' | 'startTime' | 'endTime'> & {
  rule: RecurrenceRule;
};
export type SeriesCreateResult = {
  seriesId: string;
  created: { id: string; date: string; startsAt: string }[];
  skipped: { date: string; startsAt: string; reason: string; conflictIds?: string[] }[];
};

export type AppointmentFormResult =
  | { kind: 'created'; appointment: Appointment }
  | { kind: 'updated'; appointment: Appointment; changed: boolean }
  | { kind: 'series'; result: SeriesCreateResult };

export async function saveAppointmentForm(
  mode: AppointmentFormMode,
  v: AppointmentFormValues,
  api: AppointmentFormApi,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): Promise<AppointmentFormResult> {
  if (mode.kind === 'edit') {
    const original = mode.appointment;
    const patch = buildAppointmentEditPatch(original, v, original.timeZone || timeZone);
    let appointment = original;
    let changed = false;
    if (Object.keys(patch).length > 0) {
      appointment = await api.update(original.id, patch);
      changed = true;
    }
    if ((v.labelId ?? null) !== (original.labelId ?? null)) {
      appointment = { ...appointment, ...(await api.setLabel(original.id, v.labelId ?? null)) };
      changed = true;
    }
    return { kind: 'updated', appointment, changed };
  }

  const overbook = v.overbookReason.trim() ? { allowOverbook: true, overbookReason: v.overbookReason.trim() } : {};
  const rule = formRecurrenceRule(v);
  if (rule) {
    if (!api.createSeries) throw new Error('Repeating appointments are not available here');
    const result = await api.createSeries({
      clientId: v.clientId,
      type: v.type,
      isVirtual: v.isVirtual,
      audioOnly: v.isVirtual && v.audioOnly,
      videoProvider: v.isVirtual ? v.videoProvider : undefined,
      clinicianId: v.clinicianId || undefined,
      labelId: v.labelId || undefined,
      notes: v.notes.trim() || undefined,
      ...overbook,
      rule,
    });
    return { kind: 'series', result };
  }

  const when = formInstants(v, timeZone);
  if (!when) throw new Error('Invalid date/time');
  const appointment = await api.create({
    ...overbook,
    audioOnly: v.isVirtual && v.audioOnly,
    clientId: v.clientId,
    type: v.type,
    startsAt: when.startsAt,
    endsAt: when.endsAt,
    isVirtual: v.isVirtual,
    videoProvider: v.isVirtual ? v.videoProvider : undefined,
    clinicianId: v.clinicianId || undefined,
    labelId: v.labelId || undefined,
    notes: v.notes.trim() || undefined,
  });
  return { kind: 'created', appointment };
}

export type SeriesEditScope = 'this' | 'following' | 'all';

/**
 * Edit Details on a series visit with scope "this and following" / "entire series": the changes
 * applied to every occurrence in scope. Each occurrence keeps its own date; moving to another day
 * is a "This visit" edit.
 */
export function seriesChangesFromForm(
  original: Appointment,
  v: AppointmentFormValues
): { ok: true; changes: Record<string, unknown> } | { ok: false; error: string } {
  const base = formValuesFromAppointment(original);
  if (v.date !== base.date) return { ok: false, error: 'To move a visit to another day, choose "This visit".' };
  const changes: Record<string, unknown> = {};
  if (v.startTime !== base.startTime) changes.startTime = v.startTime;
  const endTime = v.endTime || base.endTime;
  if (v.startTime !== base.startTime || endTime !== base.endTime) {
    const d = minutesOf(endTime) - minutesOf(v.startTime);
    if (d <= 0) return { ok: false, error: 'End time must be after start time' };
    changes.durationMinutes = d;
  }
  if (v.clinicianId && v.clinicianId !== base.clinicianId) changes.clinicianId = v.clinicianId;
  if (v.type !== base.type) changes.type = v.type;
  if (v.isVirtual !== base.isVirtual) changes.isVirtual = v.isVirtual;
  if (v.audioOnly !== base.audioOnly) changes.audioOnly = v.isVirtual && v.audioOnly;
  if (v.overbookReason.trim()) {
    changes.allowOverbook = true;
    changes.overbookReason = v.overbookReason.trim();
  }
  if (!Object.keys(changes).length) return { ok: false, error: 'No changes to apply to the series' };
  return { ok: true, changes };
}
