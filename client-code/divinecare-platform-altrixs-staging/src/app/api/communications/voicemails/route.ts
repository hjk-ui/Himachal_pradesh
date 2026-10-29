import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canManageVoicemails, voicemailRoutedTo, voicemailWhere } from '@/lib/communications/voicemailAccess';

export const dynamic = 'force-dynamic';

// NOTE: the Voicemail model has no organizationId column yet, so rows cannot be
// org-scoped without a migration. Voicemail transcripts are PHI, so rows are only
// served to the single organization named in VOICEMAIL_OWNER_ORG_ID (set it only
// on a single-tenant deployment). Every other org gets an empty list / 404.
function voicemailsVisibleTo(organizationId: string | null | undefined): boolean {
  const owner = process.env.VOICEMAIL_OWNER_ORG_ID;
  return Boolean(owner && organizationId && owner === organizationId);
}

// Transcripts and caller phones are PHI: leadership / Office Manager see the whole inbox, everyone
// else only the voicemails routed to them (exact user id or role match: voicemailAccess.ts).
export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!voicemailsVisibleTo(gate.organizationId)) {
    return NextResponse.json({
      success: true,
      data: [],
      unavailable: true,
      reason: 'Voicemail inbox is not enabled for this organization',
    });
  }
  try {
    let vms: any[] = [];
    try {
      vms = await prisma.voicemail.findMany({
        where: voicemailWhere(gate.role, gate.userId),
        orderBy: [
          { intent: 'asc' }, // 'crisis' comes first alphabetically
          { createdAt: 'desc' },
        ],
      });
    } catch {
      // Table unavailable — return an empty list (no sample voicemails)
    }

    // Always sort crisis first
    const sorted = [...vms].sort((a, b) => {
      if (a.intent === 'crisis' && b.intent !== 'crisis') return -1;
      if (b.intent === 'crisis' && a.intent !== 'crisis') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'voicemail',
      metadata: { count: sorted.length, scope: canManageVoicemails(gate.role) ? 'all' : 'routed_to_me' },
    });

    return NextResponse.json({ success: true, data: sorted });
  } catch (err: any) {
    console.error('[voicemails-get] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: true, data: [] });
  }
}

const updateVmSchema = z.object({
  id: z.string(),
  isRouted: z.boolean().optional(),
  routeTo: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  try {
    const body = await req.json().catch(() => null);
    const parsed = updateVmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, isRouted, routeTo } = parsed.data;
    if (!voicemailsVisibleTo(gate.organizationId)) {
      return NextResponse.json({ success: false, error: 'Voicemail not found' }, { status: 404 });
    }
    const existing = await prisma.voicemail.findUnique({ where: { id }, select: { id: true, routeTo: true } });
    if (!existing || !voicemailRoutedTo(existing.routeTo, gate.role, gate.userId)) {
      return NextResponse.json({ success: false, error: 'Voicemail not found' }, { status: 404 });
    }
    // Re-routing is a leadership / Office Manager action; the recipient may only mark it handled
    if (routeTo && !canManageVoicemails(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'voicemail', resourceId: id, outcome: 'DENIED', metadata: { reason: 'reroute_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Only leadership or the Office Manager can re-route voicemails' }, { status: 403 });
    }
    const voicemail = await prisma.voicemail.update({
      where: { id },
      data: {
        ...(typeof isRouted === 'boolean' ? { isRouted } : {}),
        ...(routeTo ? { routeTo } : {}),
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'voicemail',
      resourceId: id,
      metadata: { fields: [...(typeof isRouted === 'boolean' ? ['isRouted'] : []), ...(routeTo ? ['routeTo'] : [])] },
    });

    return NextResponse.json({ success: true, voicemail });
  } catch (err: unknown) {
    console.error('[voicemails-patch] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to update voicemail' },
      { status: 500 }
    );
  }
}
