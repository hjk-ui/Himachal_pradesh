import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientContext } from '@/patient/domain';

// Existing ConsentForm records contain status metadata, not form questions or
// versioned consent text. Keep this API read-only until that workflow exists.
const formSelect = {
  id: true, type: true, status: true, method: true, sentAt: true,
  signedAt: true, expiresAt: true, signedByName: true,
} satisfies Prisma.ConsentFormSelect;

function serialize(row: Prisma.ConsentFormGetPayload<{ select: typeof formSelect }>) {
  const expired = row.expiresAt && row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id, type: row.type,
    status: (expired && row.status !== 'DECLINED' ? 'EXPIRED' : row.status).toLowerCase(),
    method: row.method,
    sentAt: row.sentAt.toISOString(), signedAt: row.signedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null, signedByName: row.signedByName,
  };
}

export async function listPatientForms(ctx: PatientContext, skip: number, limit: number) {
  const where = { clientId: ctx.clientId, organizationId: ctx.organizationId };
  const [total, rows] = await Promise.all([
    prisma.consentForm.count({ where }),
    prisma.consentForm.findMany({ where, select: formSelect, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], skip, take: limit }),
  ]);
  return { forms: rows.map(serialize), pagination: { total, page: Math.floor(skip / limit) + 1, limit } };
}

export async function getPatientForm(ctx: PatientContext, id: string) {
  const row = await prisma.consentForm.findFirst({
    where: { id, clientId: ctx.clientId, organizationId: ctx.organizationId }, select: formSelect,
  });
  if (!row) throw new PatientAppError('Form not found', 404, 'NOT_FOUND');
  return serialize(row);
}
