import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

/** Label setup follows the Scheduling settings page roles (leadership + office manager). */
export const LABEL_ADMIN_PATH = '/dashboard/admin/scheduling-settings';

export function canManageAppointmentLabels(role: string | null | undefined): boolean {
  return Boolean(role) && canAccessPath(role as string, LABEL_ADMIN_PATH);
}

/** Anyone who can view appointments can read the label list (to render the calendar). */
export function canReadAppointmentLabels(role: string | null | undefined): boolean {
  return canAccessClientAppointments(role) || canManageAppointmentLabels(role);
}

/** Setting an appointment's label = editing the appointment (caseload check happens per appointment). */
export function canSetAppointmentLabel(role: string | null | undefined): boolean {
  return canAccessClientAppointments(role);
}
