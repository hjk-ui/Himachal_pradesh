/**
 * Small, dependency-light reads of practice settings for other modules (inbox, labs).
 * Each falls back to the previous behavior when no settings row exists or the
 * 20261018_practice_settings migration has not run.
 */
import { prisma } from '@/lib/db/prisma';
import { labFacilityClia, normalizeClia } from '@/lib/labs/facility';
import { DEFAULT_NOTE_DUE_HOURS } from '@/lib/notes/standard';

/** Note signing deadline in hours (Practice settings › Clinical); 72 (practice policy default) when not set. */
export async function practiceNoteSignDeadlineHours(organizationId: string): Promise<number> {
  try {
    const row = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { noteSignDeadlineHours: true } });
    return row?.noteSignDeadlineHours && row.noteSignDeadlineHours > 0 ? row.noteSignDeadlineHours : DEFAULT_NOTE_DUE_HOURS;
  } catch {
    return DEFAULT_NOTE_DUE_HOURS;
  }
}

/** Facility CLIA: the practice's saved CLIA, else env LAB_FACILITY_CLIA, else null (never invented). */
export async function practiceFacilityClia(organizationId: string | null | undefined): Promise<string | null> {
  if (organizationId) {
    try {
      const row = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { cliaNumber: true } });
      const saved = normalizeClia(row?.cliaNumber);
      if (saved) return saved;
    } catch {
      /* table missing: fall through to env */
    }
  }
  return labFacilityClia();
}

/** Practice settings › Clinical: auto-assign substance-use measures from the SUD Referral Radar (default off). */
export async function practiceSudRadarAutoAssign(organizationId: string): Promise<boolean> {
  try {
    const row = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { sudRadarAutoAssignMeasures: true } });
    return row?.sudRadarAutoAssignMeasures === true;
  } catch {
    // Column missing before 20261023_sud_radar_auto_measures runs: off
    return false;
  }
}
