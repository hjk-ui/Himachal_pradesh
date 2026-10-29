/**
 * A clinician's own schedule rows (pure; tested). The appointments API returns the viewer's own
 * visits plus the visits of their care-team clients (e.g. the therapist's sessions for a client the
 * psychiatrist also sees). The prescriber home lists only the visits the prescriber runs; rows with
 * no clinician recorded are kept (cannot tell, never hidden).
 */
export function ownScheduleRows<T extends { clinicianId?: string | null }>(rows: T[], userId: string | null | undefined): T[] {
  if (!userId) return rows;
  return rows.filter((r) => !r.clinicianId || r.clinicianId === userId);
}
