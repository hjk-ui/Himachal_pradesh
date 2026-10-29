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
  clinicians: ClinicianMetrics[];
  remindersSent: string[];
};

export type BarTone = 'red' | 'orange' | 'mixed' | 'green';

export function barToneFromHours(avgHours: number): BarTone {
  if (avgHours >= 15) return 'red';
  if (avgHours >= 10) return 'orange';
  if (avgHours >= 5) return 'mixed';
  return 'green';
}

export const DOC_PRODUCTIVITY_SEED: DocProductivityPayload = {
  version: 1,
  updatedAt: new Date().toISOString(),
  remindersSent: [],
  clinicians: [],
};

export function isDocProductivityPayload(value: unknown): value is DocProductivityPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as DocProductivityPayload;
  return v.version === 1 && Array.isArray(v.clinicians);
}
