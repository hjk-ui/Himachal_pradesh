import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientRoster, clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** How identity was verified (e.g. "Photo ID at check-in; DOB matches"). Required. */
  note: z.string().trim().min(8).max(500),
});

/**
 * POST /api/clients/[id]/identity-verified — front desk confirms an online-booking chart's
 * identity (Client.identityVerifyRequired -> false). Merging duplicates stays a manual chart task.
 * The note is kept in the audit log (staff text about the verification method).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientRoster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Describe how identity was verified (at least 8 characters).' }, { status: 400 });
  }
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(id, gate.organizationId),
    select: { id: true, identityVerifyRequired: true, identityVerifyReason: true },
  });
  if (!client) {
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'client_identity', resourceId: id, outcome: 'DENIED', metadata: { status: 404 } });
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }
  if (client.identityVerifyRequired) {
    await prisma.client.update({ where: { id: client.id }, data: { identityVerifyRequired: false } });
  }
  await auditPhiAccess({
    gate,
    req,
    action: 'IDENTITY_VERIFIED',
    resourceType: 'client_identity',
    resourceId: client.id,
    patientId: client.id,
    metadata: { reasonFlagged: client.identityVerifyReason, method: body.note, fields: ['identityVerifyRequired'] },
  });
  return NextResponse.json({ success: true });
}
