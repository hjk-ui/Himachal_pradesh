import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { prisma } from '@/lib/db/prisma';
import { MEASURE_CHANNELS, sendMeasure } from '@/lib/measures/send';
import { authorizeMeasureClient, serializeRequest } from '@/lib/measures/staff';

export const runtime = 'nodejs';

const GATE_PATH = '/dashboard/ehr/assessments';

const sendSchema = z.object({
  clientId: z.string().min(1).max(128),
  instrumentKey: z.string().min(1).max(64),
  channel: z.enum(MEASURE_CHANNELS as unknown as [string, ...string[]]),
  assignmentId: z.string().min(1).max(128).optional().nullable(),
});

const reviewSchema = z.object({
  clientId: z.string().min(1).max(128),
  /** Omit to mark every completed, unreviewed measure for the client */
  requestIds: z.array(z.string().min(1).max(128)).max(100).optional(),
});

/** GET ?clientId= — request history for the Measures card (never exposes token hashes). */
export async function GET(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const auth = await authorizeMeasureClient(gate, clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rows = await prisma.measureRequest.findMany({
    where: { organizationId: gate.organizationId, clientId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      instrumentKey: true,
      channel: true,
      status: true,
      assignmentId: true,
      completedAt: true,
      reviewedAt: true,
      expiresAt: true,
      createdAt: true,
      answers: true,
    },
  });
  const requests = rows.map(serializeRequest);
  return NextResponse.json(
    {
      success: true,
      requests,
      unreviewed: requests.filter((r) => r.status === 'completed' && !r.reviewedAt).length,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** POST — send now (email | sms | portal) or give in session. */
export async function POST(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;

  const auth = await authorizeMeasureClient(gate, body.clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await sendMeasure({
    organizationId: gate.organizationId,
    clientId: body.clientId,
    instrumentKey: body.instrumentKey,
    channel: body.channel as (typeof MEASURE_CHANNELS)[number],
    assignmentId: body.assignmentId ?? null,
  });
  if (result.ok === false) {
    return NextResponse.json({ success: false, reason: result.reason, error: result.message }, { status: 422 });
  }
  return NextResponse.json(
    {
      success: true,
      request: { id: result.requestId, channel: result.channel, expiresAt: result.expiresAt },
      ...(result.link ? { link: result.link } : {}),
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** PATCH — mark completed measures reviewed. */
export async function PATCH(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;

  const auth = await authorizeMeasureClient(gate, body.clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await prisma.measureRequest.updateMany({
    where: {
      organizationId: gate.organizationId,
      clientId: body.clientId,
      status: 'completed',
      reviewedAt: null,
      ...(body.requestIds?.length ? { id: { in: body.requestIds } } : {}),
    },
    data: { reviewedAt: new Date(), reviewedById: gate.userId },
  });
  return NextResponse.json({ success: true, reviewed: result.count });
}
