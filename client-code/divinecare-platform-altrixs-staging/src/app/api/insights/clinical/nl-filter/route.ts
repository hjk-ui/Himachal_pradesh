import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { NL_QUERY_MAX, translateNlFilter } from '@/lib/insights/clinical/ai';
import { filterOptions } from '@/lib/insights/clinical/population';
import { loadInsightRows } from '@/lib/insights/clinical/snapshot';
import { INSIGHTS_PATH, insightsScopeFor, viewerClientWhere, viewerLockedIds } from '@/lib/insights/clinical/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ query: z.string().min(1).max(NL_QUERY_MAX) });

/**
 * POST /api/insights/clinical/nl-filter — translate a typed request ("worsening clients at Bowie
 * with no appointment") into the page's structured filters. The model sees the request and the
 * closed option lists (tiers, locations, clinicians, programs, payers, diagnosis groups, signal
 * keys) — no client data. Its answer is validated against those lists (never SQL). The request
 * text is not logged; the audit row carries counts only.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, INSIGHTS_PATH, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: `Type a request of up to ${NL_QUERY_MAX} characters` }, { status: 400 });
  try {
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
    const read = await loadInsightRows({ organizationId: gate.organizationId, clientWhere: viewerClientWhere(viewer), lockedIds: viewerLockedIds(viewer) });
    const result = await translateNlFilter(
      {
        bedrockConfigured: () => isBedrockConfigured(),
        invokeModel: ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 400, temperature: 0, jsonMode: true }),
        modelId: BEDROCK_MODELS.HAIKU,
        audit: (e) => auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'clinicalInsightsFilter', outcome: e.outcome, metadata: e.metadata }),
      },
      { query: parsed.data.query, options: filterOptions(read.rows), viewerIsCaseload: insightsScopeFor(gate.role, gate) === 'caseload' }
    );
    return NextResponse.json({ success: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[insights/clinical/nl-filter] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'AI unavailable — use the filters below' }, { status: 500 });
  }
}
