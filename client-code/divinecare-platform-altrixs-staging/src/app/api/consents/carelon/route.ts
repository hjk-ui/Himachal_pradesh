import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { loadClientCarelon, loadClientStatusRows, requestCarelonAttestation } from '@/lib/consents/carelon/store';
import { canManageCarelon, filterStatusRows, NON_OVERLAP_SERVICES, serviceLabel, summarizeStatuses, type StatusFilter } from '@/lib/consents/carelon/workflow';
import { MEDICAID_RULE_EXPLANATION } from '@/lib/consents/carelon/medicaid';
import { COMAR_NON_OVERLAP_NOTE } from '@/lib/consents/carelon/template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/consents/carelon';
const FILTERS = ['all', 'needs_action', 'complete', 'pending_signature', 'not_started', 'needs_new', 'not_submitted', 'submitted'] as const;

/**
 * GET /api/consents/carelon            → Medicaid clients in the viewer's scope with their Carelon
 *                                         non-overlap attestation status (worklist), ?filter=
 * GET /api/consents/carelon?clientId=  → one client: Medicaid rule result, attestations, prefill
 * Org + caseload scope (clientAccessWhere); 42 CFR Part 2 / protected clients the viewer cannot
 * open are left out of the list and refused on the single-client view.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageCarelon(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  try {
    if (clientId) {
      if (clientId.length > 128) return NextResponse.json({ success: false, error: 'Invalid client' }, { status: 400 });
      const access = await resolveChartAccess(actor, clientId, PATH);
      if (access.ok === false) {
        await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'carelonAttestation', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
        return NextResponse.json({ success: false, error: access.status === 404 ? 'Client not found' : 'Forbidden' }, { status: access.status });
      }
      const result = await loadClientCarelon(actor, clientId);
      if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'carelonAttestation', resourceId: clientId, patientId: clientId, metadata: { count: result.view.attestations.length, state: result.view.requirement.state } });
      return NextResponse.json({ success: true, ...result.view, ruleExplanation: MEDICAID_RULE_EXPLANATION, comarNote: COMAR_NON_OVERLAP_NOTE, services: NON_OVERLAP_SERVICES }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const filterRaw = url.searchParams.get('filter') || 'needs_action';
    const filter: StatusFilter = (FILTERS as readonly string[]).includes(filterRaw) ? (filterRaw as StatusFilter) : 'needs_action';
    const scope = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role });
    const all = await loadClientStatusRows(scope, gate.organizationId);
    const locked = all.length ? await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: all.map((r) => r.clientId) }) : new Set<string>();
    const visible = all.filter((r) => !locked.has(r.clientId));
    const rows = filterStatusRows(visible, filter).sort((a, b) => a.clientName.localeCompare(b.clientName));
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'carelonAttestation',
      metadata: { filter, count: rows.length, hiddenProtected: locked.size, clientIds: rows.slice(0, 50).map((r) => r.clientId) },
    });
    return NextResponse.json(
      { success: true, filter, rows, summary: summarizeStatuses(visible), hiddenProtected: locked.size, timeZone: await getPracticeTimeZone(gate.organizationId), ruleExplanation: MEDICAID_RULE_EXPLANATION, comarNote: COMAR_NON_OVERLAP_NOTE },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[consents/carelon GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load Carelon attestations' }, { status: 500 });
  }
}

const postSchema = z.object({
  clientId: z.string().min(1).max(128),
  /** Service with non-overlap rules that prompted it (null = standing Medicaid requirement) */
  service: z.enum(NON_OVERLAP_SERVICES.map((s) => s.value) as [string, ...string[]]).optional().nullable(),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** POST /api/consents/carelon — start an attestation / mark "new attestation needed" for a client. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageCarelon(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const b = parsed.data;
  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  try {
    const access = await resolveChartAccess(actor, b.clientId, PATH);
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'carelonAttestation', resourceId: b.clientId, patientId: b.clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: access.status === 404 ? 'Client not found' : 'Forbidden' }, { status: access.status });
    }
    const reason = [b.service ? `New service: ${serviceLabel(b.service)}` : null, b.reason?.trim() || null].filter(Boolean).join(' · ') || null;
    const result = await requestCarelonAttestation({ organizationId: gate.organizationId, clientId: b.clientId, actorUserId: gate.userId, actorRole: gate.role, reason, auto: false });
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    invalidateInboxForOrg(gate.organizationId);
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'carelonAttestation', resourceId: result.id, patientId: b.clientId, metadata: { outcome: result.outcome, service: b.service ?? null, trigger: 'staff' } });
    return NextResponse.json({ success: true, outcome: result.outcome, id: result.id }, { status: result.outcome === 'created' ? 201 : 200 });
  } catch (err) {
    console.error('[consents/carelon POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not start the attestation' }, { status: 500 });
  }
}
