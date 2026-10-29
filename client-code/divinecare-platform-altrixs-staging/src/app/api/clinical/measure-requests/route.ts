import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { measureError, measureGate } from '@/lib/measures/http';
import { clientMeasures, markRequestsReviewed } from '@/lib/measures/staffViews';
import { sendMeasureRequest } from '@/lib/measures/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chart Measures card: GET ?clientId= (latest score, change, trend, sends and their status).
 * POST "Send now" { clientId, instrumentIds, channels? }: consent, DOB on chart and Part 2 checked.
 * PATCH "Mark reviewed" { clientId, requestIds? }: clears the inbox "Measures completed" items.
 */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const g = await measureGate(clientId);
  if (g.ok === false) return g.response;
  try {
    const data = await clientMeasures(g.scope, clientId);
    await auditPhiAccess({ gate: g.scope, req, action: 'READ', resourceType: 'measureRequest', patientId: clientId, metadata: { measures: data.summaries.length, requests: data.requests.length } });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return measureError(err, 'Could not load measures');
  }
}

const postSchema = z.object({
  clientId: z.string().min(1).max(60),
  instrumentIds: z.array(z.string().min(1).max(60)).min(1).max(10),
  channels: z.array(z.enum(['email', 'sms', 'portal'])).min(1).max(3).optional(),
  assignmentIds: z.array(z.string().min(1).max(60)).max(10).optional(),
});

export async function POST(req: Request) {
  const body = postSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: 'Choose at least one measure' }, { status: 400 });
  const g = await measureGate(body.data.clientId);
  if (g.ok === false) return g.response;
  try {
    // Caseload scope (measureGate checked the Part 2 / VIP lock)
    const inScope = await prisma.client.findFirst({ where: { AND: [{ id: body.data.clientId, organizationId: g.scope.organizationId }, g.scope.clientWhere] }, select: { id: true } });
    if (!inScope) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    const r = await sendMeasureRequest({
      organizationId: g.scope.organizationId,
      clientId: body.data.clientId,
      instrumentIds: body.data.instrumentIds,
      assignmentIds: body.data.assignmentIds,
      channels: body.data.channels,
      trigger: 'manual',
      clinicianId: g.scope.userId,
      actor: { userId: g.scope.userId, role: g.scope.role },
    });
    if (r.ok === false && r.status === 'not_found') return NextResponse.json({ success: false, error: r.message }, { status: 404 });
    const sent = r.ok && r.status === 'sent';
    return NextResponse.json({ ...r, success: sent }, { status: sent ? 201 : 200 });
  } catch (err) {
    return measureError(err, 'Could not send the questionnaire');
  }
}

const patchSchema = z.object({ clientId: z.string().min(1).max(60), requestIds: z.array(z.string().min(1).max(60)).max(100).optional() });

export async function PATCH(req: Request) {
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const g = await measureGate(body.data.clientId);
  if (g.ok === false) return g.response;
  try {
    const count = await markRequestsReviewed(g.scope, body.data);
    return NextResponse.json({ success: true, count });
  } catch (err) {
    return measureError(err, 'Could not mark reviewed');
  }
}
