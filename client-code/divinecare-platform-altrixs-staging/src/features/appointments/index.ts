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
  fetchAppointmentsWithZone,
  createAppointment,
  updateAppointment,
  generateAppointmentAiDraft,
  setAppointmentLabel,
  fetchAppointmentLabels,
  DuplicateAppointmentError,
  ClinicianOverlapError,
  ConsentRequiredError,
  type CheckInConsentItem,
  createAppointmentSeries,
  updateAppointmentSeries,
  type AppointmentEditPatch,
  type AppointmentLabelList,
} from './api/appointmentsApi';
export {
  buildAppointmentEditPatch,
  emptyAppointmentForm,
  formInstants,
  formValuesFromAppointment,
  saveAppointmentForm,
  seriesChangesFromForm,
  validateAppointmentForm,
  type SeriesEditScope,
  type AppointmentFormMode,
  type AppointmentFormValues,
} from './appointmentForm';
export { useAppointments } from './hooks/useAppointments';

/** Local calendar date YYYY-MM-DD for "today" filters */
export function todayLabel() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @deprecated use todayLabel() */
export const TODAY_LABEL = todayLabel();
