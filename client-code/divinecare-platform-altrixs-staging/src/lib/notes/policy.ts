/**
 * Documentation policy for progress notes: the practice sign deadline and time zone
 * (Practice settings › Clinical) plus NotePolicySettings (stale drafts, clone warning,
 * diagnosis-to-sign, the date missing note-format elements start blocking signing). Falls back to the defaults when no row exists or a table is missing.
 */
import { prisma } from '@/lib/db/prisma';
import { resolvePracticeTimeZone } from '@/lib/time/practiceTime';
import { COSIGN_REQUIRED_ROLES } from '@/lib/notes/transitions';
import { DEFAULT_NOTE_POLICY, type NotePolicy } from '@/lib/notes/standard';
import { DEFAULT_REVIEW_DAYS } from '@/lib/diagnoses/model';
import { resolveFormatElementsEnforceFrom } from '@/lib/notes/formatElements';

export type LoadedNotePolicy = NotePolicy & {
  /** YYYY-MM-DD practice date from which missing format elements block (default 2026-11-16) */
  formatElementsEnforceFrom: string;
  /** Practice settings › Clinical › roles whose notes need a supervisor co-signature */
  cosignRequiredRoles: string[];
};

export async function loadNotePolicy(organizationId: string): Promise<LoadedNotePolicy> {
  // Each read falls back on its own (missing table / migration not run yet)
  const safe = async <T,>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const [practice, own] = await Promise.all([
    safe(() =>
      prisma.practiceSettings.findUnique({
        where: { organizationId },
        select: { noteSignDeadlineHours: true, timeZone: true, cosignRequiredRoles: true },
      })
    ),
    safe(() => prisma.notePolicySettings.findUnique({ where: { organizationId } })),
  ]);
  return {
    deadlineHours:
      practice?.noteSignDeadlineHours && practice.noteSignDeadlineHours > 0
        ? practice.noteSignDeadlineHours
        : DEFAULT_NOTE_POLICY.deadlineHours,
    timeZone: resolvePracticeTimeZone(practice?.timeZone),
    staleDraftDays: own?.staleDraftDays && own.staleDraftDays > 0 ? own.staleDraftDays : DEFAULT_NOTE_POLICY.staleDraftDays,
    cloneWarnPercent:
      own?.cloneWarnPercent && own.cloneWarnPercent >= 50 && own.cloneWarnPercent <= 100
        ? own.cloneWarnPercent
        : DEFAULT_NOTE_POLICY.cloneWarnPercent,
    requireDiagnosisToSign: own?.requireDiagnosisToSign ?? DEFAULT_NOTE_POLICY.requireDiagnosisToSign,
    diagnosisReviewDays: own?.diagnosisReviewDays && own.diagnosisReviewDays >= 30 && own.diagnosisReviewDays <= 365 ? own.diagnosisReviewDays : DEFAULT_REVIEW_DAYS,
    formatElementsEnforceFrom: resolveFormatElementsEnforceFrom(own?.formatElementsEnforceFrom),
    cosignRequiredRoles:
      practice?.cosignRequiredRoles && practice.cosignRequiredRoles.length
        ? practice.cosignRequiredRoles.map((r) => r.toUpperCase())
        : [...COSIGN_REQUIRED_ROLES],
  };
}

export async function saveNotePolicy(
  organizationId: string,
  actorUserId: string,
  input: { staleDraftDays?: number; cloneWarnPercent?: number; requireDiagnosisToSign?: boolean; diagnosisReviewDays?: number; formatElementsEnforceFrom?: string }
) {
  const data = {
    ...(input.staleDraftDays !== undefined ? { staleDraftDays: input.staleDraftDays } : {}),
    ...(input.cloneWarnPercent !== undefined ? { cloneWarnPercent: input.cloneWarnPercent } : {}),
    ...(input.requireDiagnosisToSign !== undefined ? { requireDiagnosisToSign: input.requireDiagnosisToSign } : {}),
    ...(input.diagnosisReviewDays !== undefined ? { diagnosisReviewDays: input.diagnosisReviewDays } : {}),
    ...(input.formatElementsEnforceFrom !== undefined ? { formatElementsEnforceFrom: input.formatElementsEnforceFrom } : {}),
    updatedById: actorUserId,
  };
  return prisma.notePolicySettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}
