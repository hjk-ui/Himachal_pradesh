import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDiagnosisAccess } from '@/lib/diagnoses/route-gate';
import { addDiagnosis, logSuggestionEvent } from '@/lib/diagnoses/list';
import { listPendingSuggestions, resolveSuggestion } from '@/lib/diagnoses/suggestions';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const patchSchema = z.object({
  suggestionId: z.string().min(1).max(128),
  action: z.enum(['accept', 'dismiss']),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'read');
  if (gate.ok === false) return gate.response;
  return NextResponse.json({
    success: true,
    suggestions: await listPendingSuggestions(gate.actor.organizationId, id),
  });
}

/** Accept (adds as Provisional) or dismiss a suggested diagnosis. Nothing is added without a clinician's action. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'write');
  if (gate.ok === false) return gate.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid suggestion update' }, { status: 400 });
  }
  const { actor } = gate;
  const pending = (await listPendingSuggestions(actor.organizationId, id)).find(
    (s) => s.id === parsed.data.suggestionId
  );
  if (!pending) {
    return NextResponse.json({ success: false, error: 'Suggestion not found' }, { status: 404 });
  }

  if (parsed.data.action === 'dismiss') {
    await resolveSuggestion(actor.organizationId, id, pending.id, 'DISMISSED');
    await logSuggestionEvent(actor, id, 'SUGGESTION_DISMISSED', pending.code);
    return NextResponse.json({ success: true });
  }

  const added = await addDiagnosis(actor, id, {
    code: pending.code,
    description: pending.description,
    status: 'PROVISIONAL',
    eventAction: 'SUGGESTION_ACCEPTED',
  });
  if (added.ok === false) return NextResponse.json({ success: false, error: added.error }, { status: added.status });
  await resolveSuggestion(actor.organizationId, id, pending.id, 'ACCEPTED');
  return NextResponse.json({ success: true, diagnosis: added.value });
}
