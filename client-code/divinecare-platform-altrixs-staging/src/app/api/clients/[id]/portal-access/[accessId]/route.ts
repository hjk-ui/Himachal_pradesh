import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile, clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { ProxyAccessError, resendGuardianInvite, revokeProxyAccess, setProxyAccessLevel, verifyProxyAccess } from '@/patient';

/**
 * PATCH /api/clients/[id]/portal-access/[accessId]
 *   { action: 'verify', method, legalDocumentRef?, note? }   record verification of authority → active
 *   { action: 'revoke', reason }                              ends access on the guardian's next request
 *   { action: 'level', accessLevel, reason }                  full | limited
 *   { action: 'resend_invite' }                               new invitation (no PHI) for an unactivated login
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('verify'),
    method: z.string().min(1).max(40),
    legalDocumentRef: z.string().trim().max(200).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  }),
  z.object({ action: z.literal('revoke'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('level'), accessLevel: z.enum(['full', 'limited']), reason: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal('resend_invite') }),
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; accessId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id, accessId } = await ctx.params;
  if (!canEditClientProfile(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'portalAccess', resourceId: accessId, patientId: id, outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const client = await prisma.client.findFirst({ where: clientByIdWhere(id, gate.organizationId), select: { id: true } });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  const actor = { organizationId: gate.organizationId, userId: gate.userId };
  const action = `PORTAL_PROXY_${body.action.toUpperCase()}`;
  try {
    const result =
      body.action === 'verify'
        ? await verifyProxyAccess(actor, client.id, accessId, body)
        : body.action === 'revoke'
          ? await revokeProxyAccess(actor, client.id, accessId, body.reason)
          : body.action === 'level'
            ? await setProxyAccessLevel(actor, client.id, accessId, body.accessLevel, body.reason)
            : await resendGuardianInvite(actor, client.id, accessId);
    await auditPhiAccess({
      gate, req, action, resourceType: 'portalAccess', resourceId: accessId, patientId: client.id,
      metadata: body.action === 'verify' ? { verificationMethod: body.method } : body.action === 'level' ? { accessLevel: body.accessLevel } : {},
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ProxyAccessError) {
      await auditPhiAccess({ gate, req, action, resourceType: 'portalAccess', resourceId: accessId, patientId: client.id, outcome: 'FAILURE', metadata: { status: err.status } });
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[portal-access PATCH]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
  }
}
