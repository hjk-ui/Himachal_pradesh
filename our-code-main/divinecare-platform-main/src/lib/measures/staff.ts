import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { getInstrument } from './instruments';

/** Staff-side helpers shared by the measure-assignments / measure-requests handlers. */

export { ASSIGNMENT_STATUSES, MEASURE_FREQUENCIES } from './copy';
export type { AssignmentStatus, MeasureFrequency } from './copy';

type StaffGate = {
  organizationId: string;
  userId: string;
  role: string;
  clientWhere: Prisma.ClientWhereInput;
};

export type ClientAuthResult = { ok: true } | { ok: false; status: number; error: string };

/** Caseload scope (clientAccessWhere) + Part 2 protected-record gate for one client. */
export async function authorizeMeasureClient(
  gate: StaffGate,
  clientId: string,
  path: string
): Promise<ClientAuthResult> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, AND: [gate.clientWhere] },
    select: { id: true },
  });
  if (!client) return { ok: false, status: 404, error: 'Patient not found' };
  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId,
      path,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return { ok: false, status: 403, error: 'Protected record' };
    }
    throw err;
  }
  return { ok: true };
}

export function instrumentName(key: string): string {
  return getInstrument(key)?.name ?? key;
}

/** Staff-facing request row. Never includes tokenHash. */
export function serializeRequest(r: {
  id: string;
  instrumentKey: string;
  channel: string;
  status: string;
  assignmentId: string | null;
  completedAt: Date | null;
  reviewedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  answers: Prisma.JsonValue | null;
}) {
  const a = (r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers)
    ? r.answers
    : {}) as { totalScore?: number; severity?: string; crisis?: boolean };
  const completed = r.status === 'completed';
  return {
    id: r.id,
    instrumentKey: r.instrumentKey,
    instrumentName: instrumentName(r.instrumentKey),
    channel: r.channel,
    status: r.status,
    assignmentId: r.assignmentId,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    totalScore: completed ? a.totalScore ?? null : null,
    severity: completed ? a.severity ?? null : null,
    crisis: completed ? Boolean(a.crisis) : false,
  };
}
