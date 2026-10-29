import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import type { ClientDecision, RecomputeReason } from '@/lib/locations/recompute';
import {
  applyClientLocationPlan,
  computeClientLocationPlan,
  decorateDecisions,
  PlanChangedError,
  requireLeadership,
} from '@/lib/locations/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SAMPLE: Partial<Record<RecomputeReason, number>> = { move: 200, protected: 50, conflict: 50, weak: 50 };

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Dry run of "Recompute client locations": nothing is written. */
export async function GET(req: Request) {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  try {
    const plan = await computeClientLocationPlan(gate.organizationId);
    const picked: ClientDecision[] = [];
    for (const [reason, max] of Object.entries(SAMPLE)) {
      picked.push(...plan.decisions.filter((d) => d.reason === reason).slice(0, max));
    }
    const sample = await decorateDecisions(gate.organizationId, picked);
    await auditPhiAccess({
      gate,
      req,
      action: 'CLIENT_LOCATIONS_RECOMPUTE_PREVIEW',
      resourceType: 'Client',
      resourceId: gate.organizationId,
      metadata: { clients: plan.summary.clients, byReason: plan.summary.byReason, sampleRows: sample.length },
    });
    return NextResponse.json({
      success: true,
      summary: plan.summary,
      fingerprint: plan.fingerprint,
      defaultLocationId: plan.defaultLocationId,
      evidenceAvailable: plan.evidenceAvailable,
      locations: plan.locations.map((l) => ({ id: l.id, name: l.name, isPrimary: l.isPrimary, active: l.active })),
      sample,
    });
  } catch (err) {
    console.error('[api/locations/client-locations] preview failed', err instanceof Error ? err.message : err);
    return fail('Could not compute the preview', 500);
  }
}

/** Apply the previewed plan. Requires the preview fingerprint; refuses if the data changed. */
export async function POST(req: Request) {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  const parsed = z.object({ fingerprint: z.string().min(3).max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Run the preview first', 400);
  try {
    const result = await applyClientLocationPlan(gate.organizationId, gate.userId, parsed.data.fingerprint);
    await auditPhiAccess({
      gate,
      req,
      action: 'CLIENT_LOCATIONS_RECOMPUTE_APPLY',
      resourceType: 'Client',
      resourceId: result.runId,
      metadata: { runId: result.runId, moved: result.moved, byReason: result.summary.byReason, moves: result.summary.moves },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof PlanChangedError) return fail(err.message, 409);
    console.error('[api/locations/client-locations] apply failed', err instanceof Error ? err.message : err);
    await auditPhiAccess({ gate, req, action: 'CLIENT_LOCATIONS_RECOMPUTE_APPLY', resourceType: 'Client', outcome: 'FAILURE' });
    return fail('Could not apply the client locations', 500);
  }
}
