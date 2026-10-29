export type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  CreateAppointmentInput,
  NoteStatus,
} from './types';
export { APPOINTMENT_TYPES, VISIT_TRANSITIONS } from './types';
export {
  fetchAppointments,
  createAppointment,
  updateAppointment,
  generateAppointmentAiDraft,
  confirmAppointment,
  declineAppointment,
} from './api/appointmentsApi';
export { useAppointments } from './hooks/useAppointments';

/** Local calendar date YYYY-MM-DD for "today" filters */
/** Practice clock. Today's visits follow America/New_York, not the browser zone. */
export function todayLabel() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** @deprecated use todayLabel() */
export const TODAY_LABEL = todayLabel();
