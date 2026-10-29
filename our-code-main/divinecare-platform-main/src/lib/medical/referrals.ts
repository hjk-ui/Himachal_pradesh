import { prisma } from '@/lib/db/prisma';

export type ReferralStatus =
  | 'sent'
  | 'scheduled'
  | 'seen'
  | 'report_received'
  | 'cancelled';

export type MedicalReferral = {
  id: string;
  clientId: string;
  clientName: string;
  specialty: string;
  reason: string;
  status: ReferralStatus;
  internalBhWarmHandoff: boolean;
  expectedReportDays: number;
  expectedReportBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
};

export function warmHandoffIndicated(phq9: number | null, gad7: number | null): boolean {
  return (typeof phq9 === 'number' && phq9 >= 10) || (typeof gad7 === 'number' && gad7 >= 10);
}

function toDto(row: {
  id: string;
  clientId: string;
  clientName: string;
  specialty: string;
  reason: string;
  status: string;
  internalBhWarmHandoff: boolean;
  expectedReportDays: number;
  expectedReportBy: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}): MedicalReferral {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    specialty: row.specialty,
    reason: row.reason,
    status: row.status as ReferralStatus,
    internalBhWarmHandoff: row.internalBhWarmHandoff,
    expectedReportDays: row.expectedReportDays,
    expectedReportBy: row.expectedReportBy?.toISOString().slice(0, 10) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
  };
}

export async function listReferrals(
  organizationId: string,
  clientId?: string
): Promise<MedicalReferral[]> {
  const rows = await prisma.medicalReferral.findMany({
    where: {
      organizationId,
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toDto);
}

export async function createReferral(
  organizationId: string,
  input: {
    clientId: string;
    clientName: string;
    specialty: string;
    reason: string;
    internalBhWarmHandoff?: boolean;
    actorUserId: string;
  }
): Promise<MedicalReferral> {
  const now = new Date();
  const expectedReportDays = 30;
  const expected = new Date(now);
  expected.setDate(expected.getDate() + expectedReportDays);
  const warm = Boolean(input.internalBhWarmHandoff);
  const row = await prisma.medicalReferral.create({
    data: {
      organizationId,
      clientId: input.clientId,
      clientName: input.clientName,
      specialty: input.specialty.trim(),
      reason: input.reason.trim(),
      status: 'sent',
      internalBhWarmHandoff: warm,
      expectedReportDays,
      expectedReportBy: warm ? null : expected, // internal BH: no consult-report step
      createdById: input.actorUserId,
    },
  });
  return toDto(row);
}

const NEXT: Record<ReferralStatus, ReferralStatus[]> = {
  sent: ['scheduled', 'cancelled'],
  scheduled: ['seen', 'cancelled'],
  seen: ['report_received', 'cancelled'],
  report_received: [],
  cancelled: [],
};

export async function patchReferralStatus(
  organizationId: string,
  id: string,
  status: ReferralStatus
): Promise<{ ok: true; referral: MedicalReferral } | { ok: false; error: string; status: number }> {
  const current = await prisma.medicalReferral.findFirst({
    where: { id, organizationId },
  });
  if (!current) return { ok: false, error: 'Referral not found', status: 404 };
  if (current.internalBhWarmHandoff && status === 'report_received') {
    return {
      ok: false,
      error: 'Internal BH warm handoff has no consult-report step',
      status: 400,
    };
  }
  const cur = current.status as ReferralStatus;
  if (!NEXT[cur].includes(status) && status !== cur) {
    return {
      ok: false,
      error: `Cannot move from ${cur} to ${status}`,
      status: 409,
    };
  }
  const row = await prisma.medicalReferral.update({
    where: { id },
    data: { status },
  });
  return { ok: true, referral: toDto(row) };
}
