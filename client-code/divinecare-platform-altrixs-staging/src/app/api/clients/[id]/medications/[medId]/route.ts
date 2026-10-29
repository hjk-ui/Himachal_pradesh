import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canWriteClientMedications } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { medicationCodeFields } from '@/lib/drugs/types';

export const runtime = 'nodejs';

const codeSchema = z.object({ action: z.literal('code'), rxcui: rxcuiSchema });

/**
 * PATCH /api/clients/[id]/medications/[medId] { action: 'code', rxcui }
 * "Not coded — code it": attach an RxNorm drug (specific strength + form) to a free-text medication
 * on the client's medication list. Name, form, strength and NDCs are resolved here from RxNav (MUM2-MUM4);
 * the next DrFirst sync resends the medication coded. Medications downloaded from DrFirst are coded there.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; medId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id: clientId, medId } = await ctx.params;

  const access = await gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    clientId,
    path: `/api/clients/${clientId}/medications`,
    roleAllowed: canWriteClientMedications(gate.role),
  });
  if (access.ok === false) {
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'clientMedication', resourceId: medId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason, operation: 'code' } });
    return NextResponse.json({ success: false, error: access.status === 403 ? 'Your role cannot change medications for this client' : access.error }, { status: access.status });
  }

  const parsed = codeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });

  const existing = await prisma.clientMedication.findFirst({ where: { id: medId, clientId }, select: { id: true, rcopiaMedId: true } });
  if (!existing) return NextResponse.json({ success: false, error: 'Medication not found' }, { status: 404 });
  if (existing.rcopiaMedId) {
    return NextResponse.json({ success: false, error: 'This medication comes from DrFirst Rcopia and is coded there.' }, { status: 409 });
  }

  const resolved = await resolveDrugCode(parsed.data.rxcui, 'medication');
  if (resolved.ok === false) {
    return NextResponse.json({ success: false, unavailable: resolved.unavailable, error: resolved.error }, { status: resolved.unavailable ? 503 : 400 });
  }

  const updated = await prisma.clientMedication.update({
    where: { id: existing.id },
    data: medicationCodeFields(resolved.code),
  });
  await auditPhiAccess({
    gate, req, action: 'WRITE', resourceType: 'clientMedication', resourceId: updated.id, patientId: clientId,
    // Code metadata only (no drug name)
    metadata: { operation: 'code', rxnormTty: resolved.code.tty, ndcCount: resolved.code.ndcs.length },
  });
  return NextResponse.json({ success: true, medication: updated });
}
