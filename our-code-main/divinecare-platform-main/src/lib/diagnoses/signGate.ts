import { prisma } from '@/lib/db/prisma';
import {
  DIAGNOSIS_REQUIRED_TO_SIGN_MESSAGE,
  getNotesPolicy,
} from '@/lib/notes/notes-policy';
import { CURRENT_DIAGNOSIS_STATUSES } from './types';

export type DiagnosisSignGateResult = { ok: true } | { ok: false; error: string };

/**
 * Policy `requireDiagnosisToSign` (default on): the client needs at least one current diagnosis.
 * Clients charted before the list existed count if they still carry an intake primary diagnosis code.
 */
export async function evaluateDiagnosisSignGate(input: {
  organizationId: string;
  clientId: string;
}): Promise<DiagnosisSignGateResult> {
  const policy = await getNotesPolicy(input.organizationId);
  if (!policy.requireDiagnosisToSign) return { ok: true };

  const current = await prisma.clientDiagnosis.count({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: { in: [...CURRENT_DIAGNOSIS_STATUSES] },
    },
  });
  if (current > 0) return { ok: true };

  const legacy = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { primaryDiagnosisCode: true },
  });
  if (legacy?.primaryDiagnosisCode?.trim()) return { ok: true };

  return { ok: false, error: DIAGNOSIS_REQUIRED_TO_SIGN_MESSAGE };
}
