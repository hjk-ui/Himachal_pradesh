import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateDiagnosisRoute } from '@/lib/diagnoses/routeGate';
import { DIAGNOSIS_STATUSES, REVIEW_CONTEXTS } from '@/lib/diagnoses/model';
import { updateDiagnosis } from '@/lib/diagnoses/store';

export const runtime = 'nodejs';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullish();

const patchSchema = z
  .object({
    status: z.enum(DIAGNOSIS_STATUSES).optional(),
    statusReason: z.string().trim().max(1000).nullish(),
    resolvedDate: day,
    onsetDate: day,
    dsmName: z.string().trim().max(300).nullish(),
    description: z.string().trim().max(500).nullish(),
    diagnosingProviderName: z.string().trim().max(200).nullish(),
    comment: z.string().trim().max(1000).nullish(),
    move: z.enum(['up', 'down', 'primary']).optional(),
    context: z.enum(REVIEW_CONTEXTS).optional(),
  })
  .strict();

/**
 * PATCH /api/clients/[id]/diagnoses/[diagnosisId] — status (resolve / rule out / entered in error
 * need a reason), dates, DSM-5-TR name, rank moves (up / down / make primary). The code itself is
 * never edited: mark the row entered in error and add the correct code, so the history stays true.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; diagnosisId: string }> }) {
  const { id, diagnosisId } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const g = await gateDiagnosisRoute(req, id, { write: true, resourceType: 'clientDiagnosis' });
  if (g.ok === false) return g.response;
  const { gate, actor, clientId } = g.ctx;
  try {
    const res = await updateDiagnosis(actor, clientId, diagnosisId, parsed.data);
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'clientDiagnosis',
      resourceId: res.ok ? res.row.id : diagnosisId,
      patientId: clientId,
      outcome: res.ok ? 'SUCCESS' : 'FAILURE',
      metadata: { fields: Object.keys(parsed.data), status: parsed.data.status, move: parsed.data.move, context: parsed.data.context ?? 'manual' },
    });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, row: res.row });
  } catch (err) {
    console.error('[clients/[id]/diagnoses/[diagnosisId] PATCH]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not update the diagnosis' }, { status: 500 });
  }
}

/** Diagnoses are never deleted (medical record integrity): resolve or mark entered in error. */
export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'Diagnoses are not deleted. Resolve it, rule it out, or mark it entered in error; the history is kept.' },
    { status: 405, headers: { Allow: 'PATCH' } }
  );
}
