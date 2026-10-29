import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status')?.toLowerCase();
  const clinicianIdParam = url.searchParams.get('clinicianId');
  const sessionDateBeforeParam = url.searchParams.get('sessionDateBefore');

  const clinicianId =
    clinicianIdParam === '{me}' || clinicianIdParam === 'me'
      ? gate.userId
      : clinicianIdParam || undefined;

  let sessionDateBefore: Date | undefined;
  if (sessionDateBeforeParam) {
    if (sessionDateBeforeParam.includes('now-2h')) {
      sessionDateBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
    } else {
      const parsed = new Date(sessionDateBeforeParam);
      if (!Number.isNaN(parsed.getTime())) {
        sessionDateBefore = parsed;
      }
    }
  }

  const notes = await prisma.progressNote.findMany({
    where: {
      client: clientAccessWhere({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      }),
      // Dismissed drafts are out of the feed (src/lib/notes/dismiss.ts)
      dismissedAt: null,
      ...(clinicianId ? { clinicianId } : {}),
      ...(sessionDateBefore ? { createdAt: { lte: sessionDateBefore } } : {}),
    },
    include: {
      client: { select: { id: true, name: true, image: true } },
      clinician: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const workflowMap = await loadWorkflowStatuses(notes.map((n) => n.id));

  const filtered = notes
    .map((n) => {
      const wf = workflowMap.get(n.id);
      const status = wf?.status?.toLowerCase() || 'draft';
      const meta = resolveNoteMeta(n);
      return {
        id: n.id,
        clientId: n.clientId,
        clientName: n.client.name,
        clientImage: n.client.image,
        clinicianId: n.clinicianId,
        clinicianName: wf?.clinicianName || n.clinician?.name || null,
        body: meta.displayBody,
        noteType: meta.noteType,
        dateOfService: meta.dateOfService,
        durationMinutes: meta.durationMinutes,
        cptCode: meta.cptCode,
        aiDrafted: meta.aiDrafted,
        status,
        signedAt: wf?.signedAt || null,
        planPendingUntil: wf?.planPendingUntil ?? null,
        createdAt: n.createdAt.toISOString(),
      };
    })
    .filter((n) => {
      if (statusParam && n.status !== statusParam) return false;
      return true;
    });

  await auditPhiAccess({
    gate, req, action: 'LIST', resourceType: 'progressNote',
    metadata: {
      count: filtered.length,
      status: statusParam ?? null,
      clinicianFilter: clinicianId ? (clinicianId === gate.userId ? 'me' : 'other') : null,
      clinicianId: clinicianId ?? null,
      sessionDateBefore: sessionDateBefore ? sessionDateBefore.toISOString() : null,
    },
  });
  return NextResponse.json({ success: true, notes: filtered });
}
