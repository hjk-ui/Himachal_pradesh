import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canRequestClientBriefing } from '@/lib/clients/orgScope';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { TtlCache } from '@/lib/perf/cache';
import { AI_TTL_MS, getClientSnapshot, snapshotFacts, SNAPSHOT_FEATURE, SNAPSHOT_LABEL, type SnapshotResult } from '@/lib/insights/clinical/ai';
import { INSIGHTS_PATH, isProtectedClient, loadClientInsight } from '@/lib/insights/clinical/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const g = globalThis as unknown as { __altrixsInsightSnapshot?: TtlCache<SnapshotResult> };
const cache = g.__altrixsInsightSnapshot ?? (g.__altrixsInsightSnapshot = new TtlCache<SnapshotResult>(AI_TTL_MS, 1000));

const bodySchema = z.object({ refresh: z.boolean().optional() });

/**
 * POST /api/insights/clinical/[clientId]/ai-snapshot — on-demand AI clinical snapshot (Bedrock,
 * server side), grounded only in the rule engine's numbered facts; output mentioning anything
 * else is withheld. Unconfigured Bedrock / declined consent / protected record → "AI unavailable".
 * Cached per org + client + facts hash (6 h). Every model call is audited (AI_ACCESS, counts only).
 */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { clientId } = await ctx.params;
  if (!canAccessPath(gate.role, INSIGHTS_PATH, gate.capabilities) || !canRequestClientBriefing(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'clinicalInsightsSnapshot', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Your role cannot request AI summaries' }, { status: 403 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  try {
    const r = await loadClientInsight({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId);
    if (r.ok === false) {
      await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'clinicalInsightsSnapshot', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: r.reason } });
      return NextResponse.json({ success: false, error: r.status === 404 ? 'Client not found' : 'Protected record', reason: r.reason }, { status: r.status });
    }
    const d = r.detail;
    const facts = snapshotFacts(d.evaluated.evaluation, d.evaluated.facts, d.today);
    const result = await getClientSnapshot(
      {
        bedrockConfigured: () => isBedrockConfigured(),
        aiConsent: async () => (await checkAiNoteConsent(gate.organizationId, clientId)).status,
        isProtected: () => isProtectedClient(gate.organizationId, clientId),
        invokeModel: ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 700, temperature: 0.1, jsonMode: true }),
        modelId: BEDROCK_MODELS.HAIKU,
        audit: (e) => auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'clinicalInsightsSnapshot', resourceId: clientId, patientId: clientId, outcome: e.outcome, metadata: e.metadata }),
        cache: { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) },
      },
      { organizationId: gate.organizationId, clientId, facts, names: d.names, refresh: parsed.data.refresh }
    );
    if (result.status === 'unavailable') {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clinicalInsightsSnapshot', resourceId: clientId, patientId: clientId, metadata: { feature: SNAPSHOT_FEATURE, status: result.status, reason: result.reason } });
    }
    return NextResponse.json({ success: true, label: SNAPSHOT_LABEL, result, suggestions: d.suggestions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[insights/clinical/ai-snapshot] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'AI unavailable — could not build the snapshot' }, { status: 500 });
  }
}
