import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateDiagnosisRoute } from '@/lib/diagnoses/routeGate';
import { createSuggestion, decideSuggestion } from '@/lib/diagnoses/store';

export const runtime = 'nodejs';

const createSchema = z.object({
  code: z.string().trim().min(1).max(12),
  description: z.string().trim().max(500).nullish(),
  origin: z.enum(['ai_scribe', 'coding_agent', 'comprehend']),
  originRef: z.string().max(100).nullish(),
  rationale: z.string().trim().max(1000).nullish(),
});
const decideSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(['ACCEPTED', 'DISMISSED']),
  makePrimary: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PROVISIONAL']).optional(),
});

/**
 * POST /api/clients/[id]/diagnoses/suggestions — an AI scribe / coding suggestion is queued for
 * the clinician to review on the chart. It is never added to the list here.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const g = await gateDiagnosisRoute(req, id, { write: true, resourceType: 'clientDiagnosisSuggestion' });
  if (g.ok === false) return g.response;
  const { gate, actor, clientId } = g.ctx;
  const res = await createSuggestion(actor, clientId, parsed.data);
  await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'clientDiagnosisSuggestion', resourceId: res.ok ? res.id : clientId, patientId: clientId, outcome: res.ok ? 'SUCCESS' : 'FAILURE', metadata: { origin: parsed.data.origin, code: parsed.data.code } });
  if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, id: res.id, duplicate: res.duplicate });
}

/** PATCH — the clinician accepts (adds to the list, source "AI suggestion (accepted)") or dismisses. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const g = await gateDiagnosisRoute(req, id, { write: true, resourceType: 'clientDiagnosisSuggestion' });
  if (g.ok === false) return g.response;
  const { gate, actor, clientId } = g.ctx;
  try {
    const res = await decideSuggestion(actor, clientId, parsed.data.id, parsed.data.decision, { makePrimary: parsed.data.makePrimary, status: parsed.data.status, sex: g.ctx.sex });
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'clientDiagnosisSuggestion', resourceId: parsed.data.id, patientId: clientId, outcome: res.ok ? 'SUCCESS' : 'FAILURE', metadata: { decision: parsed.data.decision } });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, added: res.added });
  } catch (err) {
    console.error('[clients/[id]/diagnoses/suggestions PATCH]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not save the decision' }, { status: 500 });
  }
}
