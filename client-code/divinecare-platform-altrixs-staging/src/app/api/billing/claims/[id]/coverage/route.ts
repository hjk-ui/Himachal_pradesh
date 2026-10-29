import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { listClientCoverages, saveClientCoverage } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { claimsGate, errorJson, resultJson } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function clientIdOf(organizationId: string, claimId: string) {
  const claim = await prisma.claim.findFirst({ where: { id: claimId, organizationId }, select: { clientId: true } });
  return claim?.clientId ?? null;
}

/** GET: insurance coverages of the claim's client (policyholder, secondary, tertiary). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    const clientId = await clientIdOf(g.actor.organizationId, id);
    if (!clientId) return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    const result = await listClientCoverages(g.actor, clientId);
    if (result.ok) {
      await auditPhiAccess({ gate: g.gate, req: request, action: 'client_insurance_coverage_viewed', resourceType: 'Client', resourceId: clientId, patientId: clientId });
    }
    return resultJson(result);
  } catch (error) {
    return errorJson(error, 'Could not load insurance coverages');
  }
}

/** PUT { rank, payerName?, memberId?, subscriberRelationship, subscriber fields }: upsert one coverage. Audited in saveClientCoverage. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    const clientId = await clientIdOf(g.actor.organizationId, id);
    if (!clientId) return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    return resultJson(await saveClientCoverage(g.actor, clientId, await request.json().catch(() => ({}))));
  } catch (error) {
    return errorJson(error, 'Could not save insurance coverage');
  }
}
