import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { chartDigestCitationLinks } from '@/lib/ai/chartDigest/citationLinks';
import { prismaChartDigestDeps } from '@/lib/ai/chartDigest/store';
import { generateForViewer, viewChartDigest } from '@/lib/ai/chartDigest/service';
import { canViewAnyChartDigest, canViewChartDigest, defaultDigestKind, digestKindsFor, parseDigestKind, type DigestKind } from '@/lib/ai/chartDigest/access';
import { generateMedicalForViewer, viewMedicalDigest } from '@/lib/ai/chartDigest/medical/service';
import { isPrimaryCareClient, prismaMedicalDigestDeps } from '@/lib/ai/chartDigest/medical/store';
import { UPCOMING_VISIT_DAYS, isNightlyPrepEnabled } from '@/lib/ai/chartDigest/emptyState';
import { CHART_DIGEST_LABEL, CHART_DIGEST_RESOURCE, PART2_REDISCLOSURE_NOTICE } from '@/lib/ai/chartDigest/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chart history digest for one client (AI-generated from chart documents; every fact cited).
 * ?kind=bh (behavioral health history, default for BH readers) | medical (primary-care history,
 * default for primary-care roles; primary-care patients only). The response lists the kinds this
 * viewer may open for this client ("kinds") so the UI shows one tab per kind.
 * GET  — latest digest + staleness + citation links the viewer may open;
 * POST — regenerate (BH: licensed BH clinicians; medical: primary-care providers; on the client's
 * care team; incremental per kind). Access rules: src/lib/ai/chartDigest/access.ts.
 * Gates (role, chart access incl. caseload / care team and Part 2 / VIP lock, AI consent) and the
 * audit rows (READ / AI_ACCESS, ids and counts only) live in src/lib/ai/chartDigest/service.ts.
 * Nothing leaves AWS (Bedrock / Textract under the BAA).
 */
type Ctx = { params: Promise<{ id: string }> };

const REASON_TEXT: Record<string, string> = {
  role_not_permitted: 'Your role cannot view the chart history digest.',
  not_on_care_team: 'Only clinicians on this client’s care team can regenerate the chart history.',
  not_primary_care: 'This client is not a primary care patient: there is no medical history digest.',
  ai_consent_declined: 'The client declined AI Note Drafting consent, so chart documents are not sent to AI.',
  ai_not_configured: 'AI is not configured on this server.',
  sensitive_record: 'Protected record: no chart history without access.',
  client_not_found: 'Client not found',
};

async function respondView(
  viewer: { organizationId: string; userId: string; role: string },
  clientId: string,
  view: { digest: { sources: Record<string, unknown>; hasPart2: boolean } | null },
  extra: Record<string, unknown>
) {
  // Citation targets the viewer may open (documents via chartDocumentFilter, notes, record tabs)
  const links = view.digest ? await chartDigestCitationLinks(viewer, clientId, Object.keys(view.digest.sources ?? {})) : {};
  return NextResponse.json(
    { success: true, view, links, label: CHART_DIGEST_LABEL, part2Notice: view.digest?.hasPart2 ? PART2_REDISCLOSURE_NOTICE : null, ...extra },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

/** Empty-state inputs: a scheduled visit within 7 days, and whether the nightly prep job is enabled */
async function emptyStateInputs(organizationId: string, clientId: string): Promise<{ upcomingVisitWithin7Days: boolean; nightlyPrepEnabled: boolean }> {
  const now = new Date();
  const next = await prisma.appointment
    .findFirst({
      where: { clientId, client: { organizationId }, startsAt: { gt: now, lte: new Date(now.getTime() + UPCOMING_VISIT_DAYS * 86_400_000) }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
      select: { id: true },
    })
    .catch(() => null);
  return { upcomingVisitWithin7Days: Boolean(next), nightlyPrepEnabled: isNightlyPrepEnabled() };
}

const fail = (reason: string, status: number) => NextResponse.json({ success: false, error: REASON_TEXT[reason] ?? 'Not allowed', reason }, { status });

async function handle(req: Request, ctx: Ctx, generate: boolean) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  const kind: DigestKind = parseDigestKind(new URL(req.url).searchParams.get('kind')) ?? defaultDigestKind(viewer.role);
  if (!canViewAnyChartDigest(viewer.role) || !canViewChartDigest(viewer.role, kind)) {
    await auditPhiAccess({ req, gate: viewer, action: generate ? 'AI_ACCESS' : 'READ', resourceType: CHART_DIGEST_RESOURCE, resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role', kind } }).catch(() => {});
    return NextResponse.json({ success: false, error: REASON_TEXT.role_not_permitted }, { status: 403 });
  }
  const path = `/api/clients/${id}/chart-digest`;
  try {
    // Tabs this viewer may open for this client (the chart gate still runs inside each view)
    const kinds = digestKindsFor(viewer.role, { primaryCare: await isPrimaryCareClient(viewer.organizationId, id) });
    if (kind === 'medical') {
      const deps = prismaMedicalDigestDeps({ gate: viewer, req, path });
      let generation: Record<string, unknown> | null = null;
      if (generate) {
        const r = await generateMedicalForViewer(deps, viewer, id);
        if (r.ok === false) return fail(r.reason, r.status);
        const s = r.summary;
        generation = { skipped: r.skipped, status: s.status, sources: s.sources, chunks: s.chunks, chunksReused: s.chunksReused, modelCalls: s.modelCalls, pendingSources: s.pendingSources };
      }
      const v = await viewMedicalDigest(deps, viewer, id);
      if (v.ok === false) return fail(v.reason, v.status);
      return respondView(viewer, id, v.view, { kind, kinds, ...(generation ? { generation } : {}) });
    }
    const deps = prismaChartDigestDeps({ gate: viewer, req, path });
    let generation: Record<string, unknown> | null = null;
    if (generate) {
      const r = await generateForViewer(deps, viewer, id);
      if (r.ok === false) return fail(r.reason, r.status);
      const s = r.summary;
      generation = { skipped: r.skipped, status: s.status, sources: s.sources, chunks: s.chunks, chunksReused: s.chunksReused, modelCalls: s.modelCalls, pendingSources: s.pendingSources };
    }
    const v = await viewChartDigest(deps, viewer, id);
    if (v.ok === false) return fail(v.reason, v.status);
    const view = v.view.digest ? v.view : { ...v.view, ...(await emptyStateInputs(viewer.organizationId, id)) };
    return respondView(viewer, id, view, { kind, kinds, ...(generation ? { generation } : {}) });
  } catch (err) {
    // ids and error class only - never chart content
    console.error('[clients/chart-digest] failed for client', id, kind, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the chart history. Review the chart documents directly.' }, { status: 500 });
  }
}

export function GET(req: Request, ctx: Ctx) {
  return handle(req, ctx, false);
}

export function POST(req: Request, ctx: Ctx) {
  return handle(req, ctx, true);
}
