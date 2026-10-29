/** ClinicModuleState `doc-productivity` — clinician documentation productivity. */

export type LateNote = {
  noteId: string;
  patientName: string;
  sessionDate: string;
  sessionType: string;
  daysOverdue: number;
};

export type ClinicianMetrics = {
  clinicianId: string;
  clinicianName: string;
  role: string;
  sessionsThisWeek: number;
  notesSignedSameDay: number;
  notesSigned24h: number;
  notesSigned48h: number;
  notesOverdue: number;
  avgHoursToSign: number;
  complianceRate: number;
  weeklyTrend: number[];
  lateNotes: LateNote[];
};

export type DocProductivityPayload = {
  version: 1;
  updatedAt: string;
  /** Legacy: metrics are computed live by /api/analytics/productivity/metrics and no longer stored. */
  clinicians: ClinicianMetrics[];
  remindersSent: string[];
  /** clinicianId → practice date (YYYY-MM-DD) someone marked a reminder as given */
  remindedAt?: Record<string, string>;
};

export type BarTone = 'red' | 'orange' | 'mixed' | 'green';

export function barToneFromHours(avgHours: number): BarTone {
  if (avgHours >= 15) return 'red';
  if (avgHours >= 10) return 'orange';
  if (avgHours >= 5) return 'mixed';
  return 'green';
}

/** Empty seed — real clinician productivity metrics come from the persisted module state. */
export const DOC_PRODUCTIVITY_SEED: DocProductivityPayload = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  remindersSent: [],
  clinicians: [],
};

export function isDocProductivityPayload(value: unknown): value is DocProductivityPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as DocProductivityPayload;
  return v.version === 1 && Array.isArray(v.clinicians);
}
