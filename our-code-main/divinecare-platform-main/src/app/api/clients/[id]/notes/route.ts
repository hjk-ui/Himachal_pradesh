import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { createClientNote, listClientNotes } from '@/lib/clients/notes';
import { canAccessClientChartNotes, canWriteClientChartNotes } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const createNoteSchema = z.object({
  body: z.string().trim().min(1, 'Note is required').max(12000, 'Note is too long'),
  /** AI scribe provenance (model, source) when the draft came from the scribe. */
  aiProvenance: z.record(z.string(), z.unknown()).optional().nullable(),
  /** Scribe flagged risk language in the transcript → TRANSCRIPT_RISK gate applies at sign. */
  transcriptRiskFlagged: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const sessionUser = (gate as { session?: { user?: { baseRole?: unknown } } }).session?.user;
  const baseRole = (sessionUser?.baseRole as typeof gate.role | undefined) ?? null;
  const canRead =
    canAccessClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canRead) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const result = await listClientNotes({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, notes: result.notes });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const sessionUser = (gate as { session?: { user?: { baseRole?: unknown } } }).session?.user;
  const baseRole = (sessionUser?.baseRole as typeof gate.role | undefined) ?? null;
  const canWrite =
    canWriteClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!canWrite) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const body = createNoteSchema.parse(await req.json());
  const result = await createClientNote({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorBaseRole: baseRole,
    body: body.body,
    aiProvenance: body.aiProvenance ?? null,
    transcriptRiskFlagged: body.transcriptRiskFlagged ?? false,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, note: result.note });
}
