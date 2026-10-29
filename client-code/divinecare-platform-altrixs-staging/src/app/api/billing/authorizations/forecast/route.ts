import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessPriorAuths } from '@/lib/ehr/priorAuths';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadAuthForecasts } from '@/lib/ai/authForecast/data';

export const runtime = 'nodejs';

/**
 * GET /api/billing/authorizations/forecast[?clientId=][&atRisk=1]
 * Deterministic run-out forecast for approved prior auths (no AI). Same gate as /api/ehr/prior-auths.
 * Returns ids, dates and counts only (the page already has the names).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPriorAuths(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/prior-auths')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const clientId = (sp.get('clientId') ?? '').trim().slice(0, 128) || undefined;
  const atRiskOnly = sp.get('atRisk') === '1';
  try {
    const { forecasts, summary } = await loadAuthForecasts(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      { clientId }
    );
    const list = atRiskOnly ? forecasts.filter((f) => f.atRisk) : forecasts;
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'priorAuthForecast',
      patientId: clientId ?? null,
      metadata: { count: list.length, atRisk: summary.atRisk, clientScoped: Boolean(clientId) },
    });
    return NextResponse.json({ success: true, forecasts: list, summary });
  } catch (err) {
    console.error('[auth forecast GET]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load the authorization forecast' }, { status: 500 });
  }
}
