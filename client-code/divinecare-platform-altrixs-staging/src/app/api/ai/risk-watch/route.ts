import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { StaffRole } from '@/types/roles';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientChartNotes, clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canUseClinicModule } from '@/lib/modules/access';
import { getModuleData } from '@/lib/modules/manage';
import { safetyPlansForClient } from '@/lib/clients/chartSections';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { scanRiskText, type RiskHit } from '@/lib/ai/riskWatch/engine';
import { RISK_WATCH_SOURCE, RISK_WATCH_TYPE, riskSourceId, threadSourcePrefix } from '@/lib/ai/riskWatch/routing';
import { buildBannerView } from '@/lib/ai/riskWatch/view';

export const runtime = 'nodejs';

const querySchema = z.union([
  z.object({ kind: z.literal('message'), threadId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('note'), noteId: z.string().min(1).max(128) }),
]);

const VIEW_PATHS = ['/dashboard/alerts', '/dashboard/ehr/notes', '/dashboard/communications', '/dashboard/messages'];

/**
 * GET /api/ai/risk-watch?kind=message&threadId=… | ?kind=note&noteId=…
 * Risk-watch banner for a portal thread or a note: alert severity, the flagged snippet(s),
 * whether a safety plan is on file, and the 988 reminder. Protected records the viewer may not
 * open return "Protected record" with the break-glass path only.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (gate.role === 'HR' || !VIEW_PATHS.some((p) => canAccessPath(gate.role, p))) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const q = parsed.data;
  const scope = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };

  // Resolve the source item inside the viewer's client scope
  let clientId: string;
  let textHits: (RiskHit & { messageId?: string | null })[] = [];
  let loadHits: () => Promise<void>;
  let alertWhere: Record<string, unknown>;
  if (q.kind === 'message') {
    const thread = await prisma.messageThread.findFirst({
      where: { id: q.threadId, organizationId: gate.organizationId, client: clientAccessWhere(scope) },
      select: { id: true, clientId: true },
    });
    if (!thread) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    clientId = thread.clientId;
    alertWhere = { source: RISK_WATCH_SOURCE.message, sourceId: { startsWith: threadSourcePrefix(thread.id) } };
    loadHits = async () => {
      const msgs = await prisma.threadMessage.findMany({
        where: { threadId: thread.id, senderType: 'PATIENT' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, content: true },
      });
      textHits = msgs.flatMap((m) => scanRiskText(m.content, 'patient_message').hits.map((h) => ({ ...h, messageId: m.id })));
    };
  } else {
    // Note banners quote the note body verbatim: chart-note readers only (not Front Desk, Office
    // Manager, Peer Support, Billing or primary care), same rule as GET /api/ehr/notes.
    if (!canAccessClientChartNotes(gate.role)) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'riskWatch', resourceId: q.noteId,
        outcome: 'DENIED', metadata: { kind: 'note', reason: 'role_not_permitted' },
      });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const note = await prisma.progressNote.findFirst({
      where: { id: q.noteId, client: clientAccessWhere(scope) },
      select: { id: true, clientId: true, body: true, part2: true },
    });
    if (!note) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    clientId = note.clientId;
    alertWhere = { source: RISK_WATCH_SOURCE.note, sourceId: riskSourceId({ kind: 'note', noteId: note.id }) };
    loadHits = async () => {
      textHits = scanRiskText(resolveNoteMeta(note).displayBody, 'note').hits;
    };
  }

  const alerts = await prisma.riskAlert.findMany({
    where: { organizationId: gate.organizationId, clientId, type: RISK_WATCH_TYPE, ...alertWhere },
    select: { id: true, severity: true, reviewed: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  if (!alerts.length) return NextResponse.json({ success: true, view: { active: false } });

  let locked = true; // fail closed
  try {
    locked = (await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: [clientId] })).has(clientId);
  } catch {
    locked = true;
  }

  let safetyPlanOnFile: boolean | null = null;
  let phone: string | null = null;
  if (!locked) {
    await loadHits();
    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true, name: true, phone: true, legalFirstName: true, legalLastName: true, dateOfBirth: true },
    });
    phone = client?.phone ?? null;
    if (client && canUseClinicModule(gate.role as StaffRole, 'ehr-safety-plans')) {
      const data = await getModuleData<unknown>(gate.organizationId, 'ehr-safety-plans').catch(() => null);
      safetyPlanOnFile = safetyPlansForClient(data, client).matched.length > 0;
    }
  }

  const view = buildBannerView({ clientId, alerts, locked, hits: textHits, safetyPlanOnFile, phone });
  await auditPhiAccess({
    gate,
    req,
    action: 'READ',
    resourceType: 'riskWatch',
    resourceId: q.kind === 'message' ? q.threadId : q.noteId,
    patientId: clientId,
    metadata: { kind: q.kind, alerts: alerts.length, masked: locked },
  });
  return NextResponse.json({ success: true, view });
}
