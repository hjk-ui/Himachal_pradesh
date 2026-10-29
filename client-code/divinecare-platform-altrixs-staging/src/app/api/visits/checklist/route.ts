import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canMarkVisitStep } from '@/lib/visits/access';
import { PROTOCOLS, isVisitKind } from '@/lib/visits/protocols';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import type { VisitKind } from '@/lib/visits/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOURCE = 'visitChecklistItem';
const PATH = '/api/visits/checklist';
const DAY_MS = 86_400_000;

const keySchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  appointmentId: z.string().trim().min(1).max(64).nullish(),
  noteId: z.string().trim().min(1).max(64).nullish(),
  kind: z.string().trim().min(1).max(40),
  stepId: z.string().trim().min(1).max(60),
});
const markSchema = keySchema.extend({
  status: z.enum(['done', 'not_applicable', 'deferred']),
  reason: z.string().trim().max(500).nullish(),
});

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;
type Key = z.infer<typeof keySchema>;

async function authorize(req: Request, gate: Gate, key: Key, action: string) {
  const deny = async (status: number, error: string, reason: string) => {
    await auditPhiAccess({ req, gate, action, resourceType: RESOURCE, resourceId: key.appointmentId ?? key.clientId, patientId: key.clientId, outcome: 'DENIED', metadata: { reason } }).catch(() => {});
    return { ok: false as const, res: NextResponse.json({ success: false, error, reason }, { status }) };
  };
  if (!isVisitKind(key.kind)) return { ok: false as const, res: NextResponse.json({ success: false, error: 'Unknown visit kind' }, { status: 400 }) };
  const kind = key.kind;
  if (!PROTOCOLS[kind].steps.some((s) => s.step.id === key.stepId)) {
    return { ok: false as const, res: NextResponse.json({ success: false, error: 'Unknown step for this visit kind' }, { status: 400 }) };
  }
  const role = String(gate.role);
  if (!canMarkVisitStep(role, kind)) return deny(403, 'Your role cannot update the visit checklist', 'role_not_permitted');
  const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role }, key.clientId, PATH);
  if (access.ok === false) return deny(access.status, access.status === 404 ? 'Client not found' : 'Forbidden', access.reason);
  if (key.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: key.appointmentId, clientId: key.clientId, OR: [{ organizationId: gate.organizationId }, { organizationId: null, client: { organizationId: gate.organizationId } }] },
      select: { id: true },
    });
    if (!appt) return deny(404, 'Appointment not found', 'appointment_not_found');
  }
  if (key.noteId) {
    const note = await prisma.progressNote.findFirst({ where: { id: key.noteId, clientId: key.clientId }, select: { id: true } });
    if (!note) return deny(404, 'Note not found', 'note_not_found');
  }
  return { ok: true as const, kind };
}

/** Same-day row for a visit without an appointment (client + note + kind + step, marked today) */
async function findUnscheduled(organizationId: string, key: Key, kind: VisitKind, now: Date) {
  const tz = await getPracticeTimeZone(organizationId);
  const today = toPracticeWallTime(now, tz).date;
  const rows = await prisma.visitChecklistItem.findMany({
    where: { organizationId, clientId: key.clientId, appointmentId: null, noteId: key.noteId ?? null, visitKind: kind, stepId: key.stepId, markedAt: { gte: new Date(now.getTime() - DAY_MS) } },
    select: { id: true, markedAt: true },
  });
  return rows.filter((r) => toPracticeWallTime(r.markedAt, tz).date === today);
}

/** POST — mark a step done / not applicable / deferred (reason required for the last two). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;
  const reason = body.reason?.trim() || null;
  if (body.status !== 'done' && !reason) {
    return NextResponse.json({ success: false, error: 'A reason is required for not applicable or deferred' }, { status: 400 });
  }
  const auth = await authorize(req, gate, body, 'UPDATE');
  if (!auth.ok) return auth.res;

  const now = new Date();
  const data = {
    organizationId: gate.organizationId,
    clientId: body.clientId,
    noteId: body.noteId ?? null,
    visitKind: auth.kind,
    status: body.status,
    reason,
    markedById: gate.userId,
    markedAt: now,
  };
  let id: string;
  if (body.appointmentId) {
    const row = await prisma.visitChecklistItem.upsert({
      where: { appointmentId_stepId: { appointmentId: body.appointmentId, stepId: body.stepId } },
      create: { ...data, appointmentId: body.appointmentId, stepId: body.stepId },
      update: data,
      select: { id: true },
    });
    id = row.id;
  } else {
    const existing = await findUnscheduled(gate.organizationId, body, auth.kind, now);
    if (existing.length) {
      await prisma.visitChecklistItem.update({ where: { id: existing[0].id }, data });
      id = existing[0].id;
    } else {
      id = (await prisma.visitChecklistItem.create({ data: { ...data, appointmentId: null, stepId: body.stepId }, select: { id: true } })).id;
    }
  }
  await auditPhiAccess({
    req,
    gate,
    action: 'UPDATE',
    resourceType: RESOURCE,
    resourceId: id,
    patientId: body.clientId,
    outcome: 'SUCCESS',
    metadata: { kind: auth.kind, stepId: body.stepId, status: body.status, appointment: body.appointmentId ? 1 : 0, reasonGiven: reason ? 1 : 0 },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { id, stepId: body.stepId, status: body.status, reason, markedAt: now.toISOString() } });
}

/** DELETE — un-mark a step (body or query: clientId, appointmentId?, noteId?, kind, stepId). */
export async function DELETE(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const url = new URL(req.url);
  const fromQuery = Object.fromEntries(['clientId', 'appointmentId', 'noteId', 'kind', 'stepId'].map((k) => [k, url.searchParams.get(k) ?? undefined]).filter(([, v]) => v));
  const raw = Object.keys(fromQuery).length ? fromQuery : await req.json().catch(() => null);
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const key = parsed.data;
  const auth = await authorize(req, gate, key, 'DELETE');
  if (!auth.ok) return auth.res;

  let removed = 0;
  if (key.appointmentId) {
    removed = (await prisma.visitChecklistItem.deleteMany({ where: { organizationId: gate.organizationId, clientId: key.clientId, appointmentId: key.appointmentId, stepId: key.stepId } })).count;
  } else {
    const rows = await findUnscheduled(gate.organizationId, key, auth.kind, new Date());
    if (rows.length) removed = (await prisma.visitChecklistItem.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, organizationId: gate.organizationId } })).count;
  }
  await auditPhiAccess({
    req,
    gate,
    action: 'DELETE',
    resourceType: RESOURCE,
    resourceId: key.appointmentId ?? key.clientId,
    patientId: key.clientId,
    outcome: 'SUCCESS',
    metadata: { kind: auth.kind, stepId: key.stepId, removed },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { removed } });
}
