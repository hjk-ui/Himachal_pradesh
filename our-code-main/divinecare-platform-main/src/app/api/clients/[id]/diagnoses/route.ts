import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDiagnosisAccess } from '@/lib/diagnoses/route-gate';
import {
  addDiagnosis,
  listDiagnoses,
  lastDiagnosisReviewAt,
  markDiagnosesReviewed,
  reorderDiagnoses,
} from '@/lib/diagnoses/list';
import { DIAGNOSIS_COPY } from '@/lib/diagnoses/copy';
import { diagnosisReviewDue, getNotesPolicy } from '@/lib/notes/notes-policy';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    code: z.string().trim().min(1).max(12),
    description: z.string().trim().min(1).max(300),
    dsm5Name: z.string().trim().max(200).optional().nullable(),
    status: z.enum(['ACTIVE', 'PROVISIONAL']).optional(),
    isPrimary: z.boolean().optional(),
    onsetDate: z.string().trim().max(10).optional().nullable(),
    needsCoding: z.boolean().optional(),
  }),
  z.object({ action: z.literal('reorder'), ids: z.array(z.string().min(1).max(128)).min(1).max(100) }),
  z.object({ action: z.literal('review') }),
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'read');
  if (gate.ok === false) return gate.response;

  const [diagnoses, lastReviewedAt, policy] = await Promise.all([
    listDiagnoses(gate.actor.organizationId, id),
    lastDiagnosisReviewAt(gate.actor.organizationId, id),
    getNotesPolicy(gate.actor.organizationId),
  ]);
  return NextResponse.json({
    success: true,
    diagnoses,
    lastReviewedAt: lastReviewedAt?.toISOString() ?? null,
    reviewDue: diagnosisReviewDue(lastReviewedAt, policy.diagnosisReviewDays),
    reviewDays: policy.diagnosisReviewDays,
  });
}

/** Add a diagnosis, reorder the list, or record "Reviewed — no change". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'write');
  if (gate.ok === false) return gate.response;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: DIAGNOSIS_COPY.invalidCode }, { status: 400 });
  }
  const body = parsed.data;

  if (body.action === 'review') {
    const reviewedAt = await markDiagnosesReviewed(gate.actor, id);
    return NextResponse.json({ success: true, reviewedAt: reviewedAt.toISOString() });
  }
  if (body.action === 'reorder') {
    const result = await reorderDiagnoses(gate.actor, id, body.ids);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, diagnoses: result.value });
  }
  const result = await addDiagnosis(gate.actor, id, body);
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, diagnosis: result.value }, { status: 201 });
}

/** Diagnoses are never deleted. */
export async function DELETE() {
  return NextResponse.json(
    { success: false, error: DIAGNOSIS_COPY.noDelete },
    { status: 405, headers: { Allow: 'GET, POST' } }
  );
}
