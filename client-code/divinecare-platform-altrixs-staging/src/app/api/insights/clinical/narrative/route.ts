import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { dayOf } from '@/lib/clinical/sessionFrequency';
import { scopedKey, TtlCache } from '@/lib/perf/cache';
import { AI_TTL_MS, getNarrative, NARRATIVE_FEATURE, NARRATIVE_LABEL, type NarrativeResult } from '@/lib/insights/clinical/ai';
import { weekStart } from '@/lib/insights/clinical/load';
import { buildPopulationView, EMPTY_FILTERS, tileCounts } from '@/lib/insights/clinical/population';
import { loadInsightRows } from '@/lib/insights/clinical/snapshot';
import { INSIGHTS_PATH, viewerClientWhere, viewerLockedIds } from '@/lib/insights/clinical/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const g = globalThis as unknown as { __altrixsInsightNarrative?: TtlCache<NarrativeResult> };
const cache = g.__altrixsInsightNarrative ?? (g.__altrixsInsightNarrative = new TtlCache<NarrativeResult>(AI_TTL_MS, 200));

const bodySchema = z.object({ refresh: z.boolean().optional() });

/**
 * POST /api/insights/clinical/narrative — "what changed" summary of the viewer's scope (leadership:
 * org; clinicians: their caseload). Only aggregated statistics with n ≥ 10 go to the model (no
 * client-level data, no clinician names). Each sentence must cite statistics and every number must
 * appear in the statistics it cites; otherwise the summary is withheld. Audited (counts only).
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, INSIGHTS_PATH, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  try {
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
    const read = await loadInsightRows({ organizationId: gate.organizationId, clientWhere: viewerClientWhere(viewer), lockedIds: viewerLockedIds(viewer) });
    const today = dayOf(new Date(), await getPracticeTimeZone(gate.organizationId));
    const view = buildPopulationView(read.rows, read.histories, weekStart(today), today.slice(0, 7));
    const tiles = tileCounts(read.rows, EMPTY_FILTERS, gate.userId);
    const result = await getNarrative(
      {
        bedrockConfigured: () => isBedrockConfigured(),
        invokeModel: ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 800, temperature: 0.1, jsonMode: true }),
        modelId: BEDROCK_MODELS.HAIKU,
        audit: (e) => auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'clinicalInsightsNarrative', outcome: e.outcome, metadata: e.metadata }),
        cache: { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) },
      },
      { scopeKey: scopedKey({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }, 'insights-narrative'), view, tiles, asOf: today, refresh: parsed.data.refresh }
    );
    if (result.status === 'unavailable') {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clinicalInsightsNarrative', metadata: { feature: NARRATIVE_FEATURE, status: result.status, reason: result.reason } });
    }
    return NextResponse.json({ success: true, label: NARRATIVE_LABEL, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[insights/clinical/narrative] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'AI unavailable — could not build the summary' }, { status: 500 });
  }
}
