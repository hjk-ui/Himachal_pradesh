import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isMbcAlert, MBC_THRESHOLDS } from '@/features/ehr/assessments/thresholds';

export type MbcAlertRow = {
  id: string;
  assessmentRecordId: string;
  clientId: string;
  clientName: string;
  instrumentName: string;
  totalScore: number;
  severity: string;
  safetyFlagged: boolean;
  safetyNotes: string | null;
  completedAt: string;
  isAcknowledged: boolean;
};

/**
 * MBC escalations (severe or safety-flagged measures) for the clients in `clientWhere`.
 * The one loader behind GET /api/clinical/mbc/alerts and the inbox, so both count the same rows.
 */
/**
 * isMbcAlert as a WHERE clause: safety-flagged, or at/over the instrument threshold. Only these
 * rows are read (indexed: ClinicalAssessmentRecord org+instrument+score and org+safetyFlagged),
 * instead of every assessment in the organization.
 */
export function mbcAlertWhere(): Prisma.ClinicalAssessmentRecordWhereInput {
  return {
    OR: [
      { safetyFlagged: true },
      ...Object.entries(MBC_THRESHOLDS).map(([instrumentId, min]) => ({ instrumentId, totalScore: { gte: min } })),
    ],
  };
}

export async function listMbcAlerts(input: {
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  /** Inbox: only alerts nobody has acknowledged yet */
  unacknowledgedOnly?: boolean;
}): Promise<{ alerts: MbcAlertRow[]; scanned: number }> {
  const flaggedRecords = await prisma.clinicalAssessmentRecord.findMany({
    where: { AND: [{ organizationId: input.organizationId, client: input.clientWhere }, mbcAlertWhere()] },
    select: {
      id: true,
      clientId: true,
      instrumentId: true,
      instrumentName: true,
      totalScore: true,
      severity: true,
      safetyFlagged: true,
      safetyNotes: true,
      createdAt: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const acknowledgments = flaggedRecords.length
    ? await prisma.mbcAlertAck.findMany({
        where: { organizationId: input.organizationId, assessmentId: { in: flaggedRecords.map((r) => r.id) } },
        select: { assessmentId: true },
      })
    : [];
  const acked = new Set(acknowledgments.map((a) => a.assessmentId));

  const alerts = flaggedRecords
    .filter(isMbcAlert)
    .filter((r) => !input.unacknowledgedOnly || !acked.has(r.id))
    .map((r) => ({
    id: r.id,
    assessmentRecordId: r.id,
    clientId: r.clientId,
    clientName: r.client?.name || 'Patient',
    instrumentName: r.instrumentName,
    totalScore: r.totalScore || 0,
    severity: r.severity || 'Normal',
    safetyFlagged: r.safetyFlagged,
    safetyNotes: r.safetyNotes,
    completedAt: r.createdAt.toISOString(),
    isAcknowledged: acked.has(r.id),
  }));
  return { alerts, scanned: flaggedRecords.length };
}
