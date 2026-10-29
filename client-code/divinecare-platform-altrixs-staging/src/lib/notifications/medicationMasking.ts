import { canViewClientMedications } from '@/lib/clients/orgScope';

/**
 * Medication reminders on the push console (/dashboard/notifications, /api/admin/notifications).
 * The console is open to Office Manager (device registration / delivery checks), but medication
 * names, doses and instructions are clinical detail: only roles with canViewClientMedications
 * (leadership, licensed BH clinicians / prescribers, the primary care team, crisis responders) see
 * them. Everyone else gets a generic "Medication reminder" row with `masked: true` (HIPAA minimum
 * necessary). No database access, so the page and tests can import it.
 */

export const MASKED_MEDICATION_TITLE = 'Medication reminder';
export const MASKED_MEDICATION_BODY = 'Medication details are hidden for your role.';

const MEDICATION_PAYLOAD_KEYS = ['medicationName', 'dosage', 'medicationId', 'medicationScheduleId', 'instructions'];

export function canSeeMedicationReminderDetails(role: string | null | undefined): boolean {
  return canViewClientMedications(role);
}

export interface NotificationLogLike {
  type?: string | null;
  title?: string | null;
  body?: string | null;
  payload?: unknown;
  dedupeKey?: string | null;
}

/** A log row that carries medication detail: medication_reminder, a med-* dedupe key, or a drug field in its payload. */
export function isMedicationNotification(log: NotificationLogLike): boolean {
  if (log.type === 'medication_reminder') return true;
  const key = (log.dedupeKey || '').toLowerCase();
  if (key.startsWith('med-') || key.startsWith('med:') || key.startsWith('medication')) return true;
  const p = log.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    return MEDICATION_PAYLOAD_KEYS.some(k => k in (p as Record<string, unknown>));
  }
  return false;
}

/**
 * Server-side masking of one notification log row. Roles with canViewClientMedications get the row
 * unchanged (plus masked: false). Others get medication rows with a generic title, a fixed body, no
 * payload and a dedupe key that no longer carries the schedule id; non-medication rows unchanged.
 */
export function maskNotificationLog<T extends NotificationLogLike>(log: T, role: string | null | undefined): T & { masked: boolean } {
  if (canSeeMedicationReminderDetails(role) || !isMedicationNotification(log)) return { ...log, masked: false };
  return {
    ...log,
    title: MASKED_MEDICATION_TITLE,
    body: MASKED_MEDICATION_BODY,
    payload: null,
    dedupeKey: null,
    masked: true,
  };
}

/**
 * A test push of type medication_reminder writes medication wording to the patient's phone and to
 * NotificationLog. Refused (403) for roles without canViewClientMedications, whatever the text.
 */
export function medicationPushDenied(role: string | null | undefined, type: string | null | undefined): boolean {
  return type === 'medication_reminder' && !canSeeMedicationReminderDetails(role);
}
