import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { loadQualityContext } from '@/lib/ai/noteQuality/load';
import { checkQualityAccess } from '@/lib/ai/noteQuality/access';
import { decideAiGate, runNoteQualityCheck } from '@/lib/ai/noteQuality/engine';
import { latestQualityReview } from '@/lib/ai/noteQuality/reviewStore';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  mode: z.enum(['cosign', 'presign']).default('cosign'),
  /** Run the AI narrative checks (consent / Part 2 still apply) */
  ai: z.boolean().default(true),
});

/**
 * POST /api/notes/[id]/quality-check — documentation checklist for a note: deterministic rules,
 * then optional AI narrative checks (Bedrock Haiku, de-identified narrative text, quotes verified).
 * Suggestions only: never changes the note and never blocks signing or co-signing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const params = paramsSchema.safeParse(await ctx.params);
  const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!params.success || !parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const { id } = params.data;
  const { mode, ai } = parsed.data;

  const loaded = await loadQualityContext({ noteId: id, organizationId: gate.organizationId, mode });
  if (loaded.ok === false) return NextResponse.json({ success: false, error: loaded.error }, { status: loaded.status });
  const { facts, names, clientId, authorIds, aiGateInput } = loaded.ctx;

  const access = await checkQualityAccess({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    mode,
    clientId,
    authorIds,
    path: `/api/notes/${id}/quality-check`,
  });
  if (access.ok === false) {
    await auditPhiAccess({
      gate,
      req,
      action: 'NOTE_QUALITY_CHECK',
      resourceType: 'progressNote',
      resourceId: id,
      patientId: clientId,
      outcome: 'DENIED',
      metadata: { mode, reason: access.reason },
    });
    return NextResponse.json(access.body ?? { success: false, error: access.error }, { status: access.status });
  }

  const report = await runNoteQualityCheck(
    {
      facts,
      names,
      wantAi: ai,
      aiGate: decideAiGate(aiGateInput),
      lastReview: await latestQualityReview(gate.organizationId, id),
    },
    {
      invokeModel: isBedrockConfigured()
        ? ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 900, temperature: 0, jsonMode: true })
        : null,
      modelId: BEDROCK_MODELS.HAIKU,
      auditAi: ({ outcome, metadata }) =>
        auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'progressNote', resourceId: id, patientId: clientId, outcome, metadata }),
    }
  );

  await auditPhiAccess({
    gate,
    req,
    action: 'NOTE_QUALITY_CHECK',
    resourceType: 'progressNote',
    resourceId: id,
    patientId: clientId,
    metadata: { mode, ...report.counts, ai: report.ai.state },
  });

  return NextResponse.json({ success: true, report });
}
