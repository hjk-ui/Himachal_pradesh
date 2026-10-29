import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  HEALTHLAKE_RESOURCE_TYPES,
  isValidResourceType,
  searchFhirResources,
} from '@/lib/aws/healthlake';
import { createHealthLakeTransport } from '@/lib/healthlake/client';
import { healthLakeConfig } from '@/lib/healthlake/config';
import { healthLakeGate, notConfiguredResponse } from '../../_lib/gate';

export const runtime = 'nodejs';

/**
 * GET /api/healthlake/fhir/:resourceType?<FHIR search params> — org-scoped HealthLake search.
 * Returns the FHIR Bundle (application/fhir+json) restricted to the caller's organization tag.
 */
export async function GET(req: Request, ctx: { params: Promise<{ resourceType: string }> }) {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;

  const { resourceType } = await ctx.params;
  if (!isValidResourceType(resourceType)) {
    return NextResponse.json(
      { success: false, error: `Invalid resourceType. Allowed: ${HEALTHLAKE_RESOURCE_TYPES.join(' ')}` },
      { status: 400 }
    );
  }
  const cfg = healthLakeConfig();
  const nc = notConfiguredResponse(cfg);
  if (nc) return nc;

  const url = new URL(req.url);
  const result = await searchFhirResources({
    organizationId: g.gate.organizationId,
    resourceType,
    query: url.searchParams,
    transport: createHealthLakeTransport(cfg)!,
    routePath: `/api/healthlake/fhir/${resourceType}`,
  });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'HEALTHLAKE_FHIR_SEARCH',
    resourceType,
    outcome: result.ok ? 'SUCCESS' : 'FAILURE',
    metadata: result.ok === false ? { status: result.status, code: result.code } : { count: result.count, dropped: result.dropped },
  });
  if (result.ok === false) {
    return NextResponse.json({ success: false, code: result.code, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.bundle, {
    headers: { 'Content-Type': 'application/fhir+json', 'Cache-Control': 'no-store' },
  });
}
