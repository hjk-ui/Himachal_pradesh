import { canAccessPath } from '@/lib/auth/roleAccess';
import { canPrescribe } from '@/types/roles';

export const PRESCRIPTIONS_PATH = '/dashboard/ehr/prescriptions';

/** Values allowed by the ehr_refill_requests.status CHECK constraint. */
export const REFILL_STATUSES = ['Pending', 'Approved', 'Denied'] as const;
export type RefillStatus = (typeof REFILL_STATUSES)[number];

export function isRefillStatus(value: unknown): value is RefillStatus {
  return typeof value === 'string' && (REFILL_STATUSES as readonly string[]).includes(value);
}

/** Read prescriptions / refill queue: prescribers plus roles allowed on the e-prescribing page. */
export function canViewPrescriptions(role: string | null | undefined): boolean {
  const r = role ? String(role) : '';
  return canPrescribe(r) || canAccessPath(r, PRESCRIPTIONS_PATH);
}

/** Issue a prescription or approve/deny a refill: licensed prescribers only. */
export function canWritePrescriptions(role: string | null | undefined): boolean {
  return canPrescribe(role ? String(role) : '');
}
