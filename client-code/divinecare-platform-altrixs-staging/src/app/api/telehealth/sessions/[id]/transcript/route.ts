import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { loadSessionTranscript } from '@/lib/ai/sessionTranscript';

export const runtime = 'nodejs';

/**
 * GET /api/telehealth/sessions/:id/transcript — the Transcribe Medical transcript
 * for a completed session, for AI note drafting. Clinical note writers only; chart gate
 * (org, caseload / care team, 42 CFR Part 2 / sensitive-record lock); audited. Returns transcript: null with an honest status otherwise.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canWriteClientChartNotes(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const session = await prisma.telehealthSession.findFirst({
    where: { id, organizationId: gate.organizationId },
    select: {
      id: true,
      clientId: true,
      transcriptionStatus: true,
      transcriptUri: true,
    },
  });
  if (!session) {
    return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
  }
  const access = await gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    clientId: session.clientId,
    path: `/api/telehealth/sessions/${session.id}/transcript`,
    roleAllowed: true,
  });
  if (access.ok === false) {
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'telehealthTranscript',
      resourceId: session.id,
      patientId: session.clientId,
      outcome: 'DENIED',
      metadata: { reason: access.reason },
    });
    // Off-caseload: 404 so session ids can't be probed; Part 2 lock: 403 so break-glass can be offered
    return NextResponse.json(
      { success: false, error: access.status === 404 ? 'Session not found' : access.error },
      { status: access.status }
    );
  }

  const result = await loadSessionTranscript(session);
  if (result.ok === false) {
    return NextResponse.json({
      success: true,
      sessionId: session.id,
      status: result.status,
      transcript: null,
      message: result.message,
    });
  }

  await auditPhiAccess({
    gate,
    req,
    action: 'READ',
    resourceType: 'telehealthTranscript',
    resourceId: session.id,
    patientId: session.clientId,
    metadata: { lines: result.lines.length, purpose: 'note-drafting' },
  });

  return NextResponse.json({
    success: true,
    sessionId: session.id,
    status: 'COMPLETED' as const,
    transcript: result.lines,
  });
}
