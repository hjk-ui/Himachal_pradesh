import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientContext } from '@/patient/domain';
import { filterForProxy, looksPart2 } from '@/patient/application/proxy/visibility';

// Existing ConsentForm records contain status metadata, not form questions or
// versioned consent text. Keep this API read-only until that workflow exists.
const formSelect = {
  id: true, type: true, status: true, method: true, sentAt: true,
  signedAt: true, expiresAt: true, signedByName: true, formKey: true,
} satisfies Prisma.ConsentFormSelect;

type FormRow = Prisma.ConsentFormGetPayload<{ select: typeof formSelect }>;

/** Proxy filter: 42 CFR Part 2 consents and items marked confidential are hidden. */
function proxyVisibleForms(ctx: PatientContext, rows: FormRow[]) {
  return filterForProxy(ctx, 'consent_form', rows, (r) => ({ id: r.id, part2: looksPart2(r.formKey) || looksPart2(r.type), category: 'administrative' }));
}

function serialize(row: FormRow) {
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
  if (ctx.access?.isProxy) {
    // Small per-client list: filter in memory so counts and pages match what the proxy may see
    const all = await prisma.consentForm.findMany({ where, select: formSelect, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 500 });
    const visible = await proxyVisibleForms(ctx, all);
    return { forms: visible.slice(skip, skip + limit).map(serialize), pagination: { total: visible.length, page: Math.floor(skip / limit) + 1, limit } };
  }
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
  if (!row || (await proxyVisibleForms(ctx, [row])).length === 0) throw new PatientAppError('Form not found', 404, 'NOT_FOUND');
  return serialize(row);
}
