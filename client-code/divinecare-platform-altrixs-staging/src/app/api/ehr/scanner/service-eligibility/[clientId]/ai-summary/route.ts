import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canRequestClientBriefing } from '@/lib/clients/orgScope';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { TtlCache } from '@/lib/perf/cache';
import { getRationale, RATIONALE_FEATURE, RATIONALE_LABEL, RATIONALE_TTL_MS, type RationaleResult } from '@/lib/clinical/serviceEligibility/ai';
import { loadClientDetail, SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';
import { PROGRAMS } from '@/lib/clinical/serviceEligibility/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const g = globalThis as unknown as { __altrixsScannerRationale?: TtlCache<RationaleResult> };
const cache = g.__altrixsScannerRationale ?? (g.__altrixsScannerRationale = new TtlCache<RationaleResult>(RATIONALE_TTL_MS, 1000));

const bodySchema = z.object({ program: z.enum(PROGRAMS), refresh: z.boolean().optional() });

/**
 * POST /api/ehr/scanner/service-eligibility/[clientId]/ai-summary — on-demand AI rationale for one
 * program suggestion (Bedrock, server side). Grounded only in the evaluator's facts; output that
 * mentions anything else is withheld. Unconfigured Bedrock / declined consent / protected record →
 * "AI unavailable" (never a canned summary). Each model call is audited (AI_ACCESS, counts only).
 */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { clientId } = await ctx.params;
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities) || !canRequestClientBriefing(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'serviceEligibilityRationale', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Your role cannot request AI summaries' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  try {
    const r = await loadClientDetail({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId);
    if (r.ok === false) {
      await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'serviceEligibilityRationale', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: r.reason } });
      return NextResponse.json({ success: false, error: r.status === 404 ? 'Client not found' : 'Protected record', reason: r.reason }, { status: r.status });
    }
    const program = parsed.data.program;
    const result = await getRationale(
      {
        bedrockConfigured: () => isBedrockConfigured(),
        aiConsent: async () => (await checkAiNoteConsent(gate.organizationId, clientId)).status,
        // Any protected record stays out of the model, even when this viewer may open it
        isProtected: async () =>
          Boolean(await prisma.sensitiveRecord.findFirst({ where: { organizationId: gate.organizationId, clientId }, select: { id: true } })),
        invokeModel: ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 600, temperature: 0.1, jsonMode: true }),
        modelId: BEDROCK_MODELS.HAIKU,
        audit: (e) =>
          auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'serviceEligibilityRationale', resourceId: clientId, patientId: clientId, outcome: e.outcome, metadata: e.metadata }),
        cache: { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) },
      },
      { organizationId: gate.organizationId, clientId, program, result: r.detail.client.results[program], names: r.detail.names, refresh: parsed.data.refresh }
    );
    if (result.status === 'unavailable') {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'serviceEligibilityRationale', resourceId: clientId, patientId: clientId, metadata: { feature: RATIONALE_FEATURE, program, status: result.status, reason: result.reason } });
    }
    return NextResponse.json({ success: true, label: RATIONALE_LABEL, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[scanner/ai-summary] failed for client', clientId, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'AI unavailable — could not build the summary' }, { status: 500 });
  }
}
