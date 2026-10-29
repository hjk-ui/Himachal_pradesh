/** Visit Guide role rules (pure). Chart access (org, caseload / care team, Part 2) is checked separately. */
import { canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { isLeadershipRole } from '@/lib/auth/roleAccess';
import { isMedicalRole } from '@/types/roles';
import type { VisitKind } from './types';

/**
 * Who may open a Visit Guide: staff who write clinical notes for clients (licensed BH, PRP,
 * case management, crisis, leadership) and the primary care team. Not Office Manager, Front Desk,
 * Peer Support, Billing or HR.
 */
export function canViewVisitGuide(role: string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return canWriteClientChartNotes(r) || isMedicalRole(r) || (isLeadershipRole(r) && r !== 'SUPER_ADMIN');
}

/** Mark checklist steps: roles that write notes for clients; the primary care team only on primary care visits. */
export function canMarkVisitStep(role: string | null | undefined, kind: VisitKind): boolean {
  const r = String(role ?? '').toUpperCase();
  if (canWriteClientChartNotes(r)) return true;
  return kind === 'primary_care' && isMedicalRole(r);
}
