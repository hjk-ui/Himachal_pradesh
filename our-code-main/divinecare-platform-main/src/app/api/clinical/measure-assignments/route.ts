import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { prisma } from '@/lib/db/prisma';
import { isKnownSelfReportInstrument, itemContentPendingFor, listInstrumentOptions } from '@/lib/measures/instruments';
import {
  ASSIGNMENT_STATUSES,
  authorizeMeasureClient,
  instrumentName,
  MEASURE_FREQUENCIES,
} from '@/lib/measures/staff';

export const runtime = 'nodejs';

const GATE_PATH = '/dashboard/ehr/assessments';

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  instrumentKey: z.string().min(1).max(64),
  frequency: z.enum(MEASURE_FREQUENCIES),
  nextDueAt: z.string().datetime().optional().nullable(),
});

const patchSchema = z
  .object({
    id: z.string().min(1).max(128),
    status: z.enum(ASSIGNMENT_STATUSES).optional(),
    frequency: z.enum(MEASURE_FREQUENCIES).optional(),
    nextDueAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.frequency !== undefined || v.nextDueAt !== undefined, {
    message: 'Nothing to update',
  });

function serialize(a: {
  id: string;
  clientId: string;
  instrumentKey: string;
  frequency: string;
  status: string;
  nextDueAt: Date | null;
  itemContentPending: boolean;
  createdAt: Date;
}) {
  return {
    id: a.id,
    clientId: a.clientId,
    instrumentKey: a.instrumentKey,
    instrumentName: instrumentName(a.instrumentKey),
    frequency: a.frequency,
    status: a.status,
    nextDueAt: a.nextDueAt?.toISOString() ?? null,
    itemContentPending: a.itemContentPending,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });

  const auth = await authorizeMeasureClient(gate, clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rows = await prisma.measureAssignment.findMany({
    where: { organizationId: gate.organizationId, clientId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json(
    { success: true, assignments: rows.map(serialize), instruments: listInstrumentOptions() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Choose a measure and how often to give it.' }, { status: 400 });
  }
  const body = parsed.data;
  if (!isKnownSelfReportInstrument(body.instrumentKey)) {
    return NextResponse.json({ success: false, error: 'Unknown measure' }, { status: 400 });
  }
  const auth = await authorizeMeasureClient(gate, body.clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const created = await prisma.measureAssignment.create({
    data: {
      organizationId: gate.organizationId,
      clientId: body.clientId,
      instrumentKey: body.instrumentKey,
      frequency: body.frequency,
      status: 'active',
      nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null,
      itemContentPending: itemContentPendingFor(body.instrumentKey),
    },
  });
  return NextResponse.json({ success: true, assignment: serialize(created) }, { status: 201 });
}

export async function PATCH(req: Request) {
  const gate = await requireClinicalContext(GATE_PATH);
  if (gate.ok === false) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid update' }, { status: 400 });
  const body = parsed.data;

  const existing = await prisma.measureAssignment.findFirst({
    where: { id: body.id, organizationId: gate.organizationId },
    select: { id: true, clientId: true },
  });
  if (!existing) return NextResponse.json({ success: false, error: 'Measure not found' }, { status: 404 });

  const auth = await authorizeMeasureClient(gate, existing.clientId, GATE_PATH);
  if (auth.ok === false) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const updated = await prisma.measureAssignment.update({
    where: { id: existing.id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
      ...(body.nextDueAt !== undefined ? { nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null } : {}),
    },
  });
  return NextResponse.json({ success: true, assignment: serialize(updated) });
}
