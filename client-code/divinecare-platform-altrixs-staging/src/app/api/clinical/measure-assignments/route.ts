import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { withoutLockedClients } from '@/lib/privacy/lockedRows';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { measureError, measureGate } from '@/lib/measures/http';
import { createAssignment, listAssignmentRows, setAssignmentStatus } from '@/lib/measures/staffViews';
import { sendableInstruments } from '@/lib/measures/instruments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MBC schedule (measure_assignments): GET ?clientId= list with latest scores and the status of the
 * last send (Sent / Opened / Started / Completed / Expired); POST create; PATCH { id, status }.
 */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  const g = await measureGate(clientId);
  if (g.ok === false) return g.response;
  try {
    const rows = await withoutLockedClients(g.scope, await listAssignmentRows(g.scope, { clientId }));
    await auditPhiAccess({ gate: g.scope, req, action: 'LIST', resourceType: 'measureAssignment', patientId: clientId, metadata: { count: rows.length } });
    return NextResponse.json({
      success: true,
      data: rows,
      sendable: sendableInstruments().map((i) => ({ id: i.id, name: i.name, fullName: i.fullName, maxScore: i.maxScore ?? null, category: i.category })),
    });
  } catch (err) {
    return measureError(err, 'Could not load outcome schedules');
  }
}

const postSchema = z.object({
  clientId: z.string().min(1).max(60),
  instrumentId: z.string().min(1).max(60),
  schedule: z.enum(['once', 'interval', 'before_visit']),
  everyDays: z.number().int().min(1).max(365).nullable().optional(),
  startDate: z.string().max(10).nullable().optional(),
  endDate: z.string().max(10).nullable().optional(),
});

export async function POST(req: Request) {
  const body = postSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: 'Choose a client, a measure and a schedule' }, { status: 400 });
  const g = await measureGate(body.data.clientId);
  if (g.ok === false) return g.response;
  try {
    const row = await createAssignment(g.scope, body.data);
    invalidateInboxForOrg(g.scope.organizationId);
    return NextResponse.json({ success: true, id: row.id }, { status: 201 });
  } catch (err) {
    return measureError(err, 'Could not save the schedule');
  }
}

const patchSchema = z.object({ id: z.string().min(1).max(60), status: z.enum(['active', 'paused', 'ended']) });

export async function PATCH(req: Request) {
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const g = await measureGate();
  if (g.ok === false) return g.response;
  try {
    await setAssignmentStatus(g.scope, body.data.id, body.data.status);
    return NextResponse.json({ success: true });
  } catch (err) {
    return measureError(err, 'Could not update the schedule');
  }
}
