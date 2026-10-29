import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { deletePendingPrescription } from '@/lib/services/drfirstCommands';
import { requireDrFirstCaller, drFirstClientWhere } from '../../_lib/access';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ clientId: z.string().min(1), rcopiaId: z.string().regex(/^\d{1,20}$/) });

/** Lifecycle states of a downloaded script that are still unsigned in Rcopia. */
const PENDING_STATES = ['pending', 'needs_review'];

/**
 * POST /api/drfirst/prescriptions/delete-pending { clientId, rcopiaId } —
 * delete an UNSIGNED Rcopia prescription from the chart (send_prescription
 * Deleted=y, the one certified ambulatory send_prescription use). Prescribers
 * only, signed as their own Rcopia username; org + caseload scope; the script
 * must be on this chart and still pending. The local row is marked cancelled
 * only after DrFirst confirms. Audited (ids only).
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'clientId and a numeric rcopiaId are required' }, { status: 400 });
  const { clientId, rcopiaId } = parsed.data;

  const client = await prisma.client.findFirst({ where: drFirstClientWhere(c, clientId), select: { id: true, rcopiaPatientId: true } });
  if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  const rx = await prisma.rcopiaPrescription.findFirst({
    where: { rcopiaId, clientId: client.id },
    select: { id: true, lifecycleStatus: true },
  });
  if (!rx) return NextResponse.json({ error: 'Prescription not found on this chart' }, { status: 404 });
  if (!PENDING_STATES.includes(rx.lifecycleStatus)) {
    return NextResponse.json({ error: 'Only unsigned (pending) prescriptions can be deleted from Altrixs.' }, { status: 409 });
  }
  if (DEMO_MODE) return NextResponse.json({ error: 'DrFirst is not configured on this server.' }, { status: 503 });

  const patient = client.rcopiaPatientId && client.rcopiaPatientId !== client.id ? { rcopiaId: client.rcopiaPatientId } : { externalId: client.id };
  const res = await deletePendingPrescription(patient, rcopiaId, c.rcopiaUsername!);

  await writeAuditLog({
    action: 'DRFIRST_DELETE_PENDING_PRESCRIPTION',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'prescription',
    resourceId: rx.id,
    patientId: client.id,
    outcome: res.ok ? 'SUCCESS' : 'FAILURE',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: { rcopiaId, demo: res.demo, errorCode: res.error?.code ?? null },
  });

  if (res.error?.code === 'not_permitted') {
    return NextResponse.json(
      { error: "Deleting pending prescriptions isn't enabled for this DrFirst account. Delete it in DrFirst (E-Prescribe).", code: 'not_permitted' },
      { status: 403 },
    );
  }
  if (!res.ok) {
    return NextResponse.json({ error: res.error?.text || 'DrFirst did not delete the prescription', code: res.error?.code }, { status: 502 });
  }
  await prisma.rcopiaPrescription.update({ where: { id: rx.id }, data: { lifecycleStatus: 'cancelled' } });
  return NextResponse.json({ success: true });
}
