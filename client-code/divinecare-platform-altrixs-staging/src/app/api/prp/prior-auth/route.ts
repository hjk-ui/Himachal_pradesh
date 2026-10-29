import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prpGate } from '@/lib/prp/http';
import { PRP_STATUS_ROLES } from '@/lib/prp/program';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';

export const runtime = 'nodejs';

/** POST /api/prp/prior-auth: PRP enrollment roles draft a Carelon authorization for a client in their caseload. */
export async function POST(req: Request) {
  const g = await prpGate(PRP_STATUS_ROLES);
  if (!g.ok) return g.res;
  const gate = g.gate;

  const body = await req.json().catch(() => ({}));
  const client = await prisma.client.findFirst({
    where: { id: String(body.clientId ?? ''), AND: [clientOrgFilter(gate.organizationId), clientAccessWhere(g.actor)] },
    select: { id: true, name: true, insurancePayer: true, insuranceMemberId: true },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  const locked = await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: [client.id] });
  if (locked.has(client.id)) return NextResponse.json({ error: 'Protected record: break-glass access is required' }, { status: 403 });

  // Nothing is defaulted: the payer comes from the chart, the code and requested units from the
  // request, and a draft has 0 units approved until the ASO approves it.
  const cpt = typeof body.cpt === 'string' ? body.cpt.trim().toUpperCase() : '';
  if (!/^[A-Z]\d{4}$|^\d{5}$/.test(cpt)) {
    return NextResponse.json({ error: 'A procedure code is required' }, { status: 400 });
  }
  if (!client.insurancePayer) {
    return NextResponse.json({ error: 'The client has no payer on file' }, { status: 400 });
  }
  const requested = Number(body.units);
  const pa = await prisma.priorAuth.create({
    data: {
      organizationId: gate.organizationId,
      clientId: client.id,
      payer: client.insurancePayer,
      cptCodes: [cpt],
      requestedUnits: Number.isInteger(requested) && requested > 0 ? requested : null,
      unitsApproved: 0,
      unitsUsed: 0,
      status: 'DRAFT',
      notes: 'PRP enrollment prior authorization draft',
      createdById: gate.userId,
    },
  });

  await auditPhiAccess({
    gate,
    req,
    action: 'CREATE',
    resourceType: 'priorAuth',
    resourceId: pa.id,
    patientId: client.id,
    metadata: { source: 'prp_enroll', status: 'DRAFT', fields: Object.keys(body ?? {}).slice(0, 50) },
  });

  return NextResponse.json({ success: true, priorAuthId: pa.id }, { status: 201 });
}
