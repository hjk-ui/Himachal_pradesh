import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { DENIAL_STATUSES, canUpdateDenialStatus } from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * The denials work queue uses UI workflow labels; persist only real ClaimDenialStatus values.
 * Anything not listed here (or in the enum itself) is rejected by zod.
 */
const UI_STATUS_ALIASES: Record<string, (typeof DENIAL_STATUSES)[number]> = {
  open: 'OPEN',
  corrected_resubmit: 'OPEN',
  in_appeal: 'APPEALED',
  appealed: 'APPEALED',
  appeal_won: 'WON',
  won: 'WON',
  appeal_lost: 'LOST',
  lost: 'LOST',
  written_off: 'LOST',
};

const bodySchema = z.object({
  status: z.preprocess(
    (v) => (typeof v === 'string' ? UI_STATUS_ALIASES[v.trim().toLowerCase()] ?? v.trim() : v),
    z.enum(DENIAL_STATUSES)
  ),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
});

const idSchema = z.string().min(1).max(128);

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Office Manager reads the denials queue; status changes are billing core only (audited).
  if (!canUpdateDenialStatus(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/denials')) {
    const { id: deniedId } = await ctx.params;
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'claimDenial',
      resourceId: String(deniedId ?? '').slice(0, 128),
      outcome: 'DENIED',
      metadata: { reason: 'cannot_update_denial_status' },
    });
    return NextResponse.json({ success: false, error: 'Only billing staff can change a denial status' }, { status: 403 });
  }

  try {
    const { id: rawId } = await ctx.params;
    const idParsed = idSchema.safeParse(rawId);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!idParsed.success || !parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid denial update' }, { status: 400 });
    }
    const denialId = idParsed.data;
    const { status, resolutionNote } = parsed.data;

    // Tenant + care-team scoped: a denial in another org (or outside the actor's caseload) is a 404.
    const existing = await prisma.claimDenial.findFirst({
      where: {
        OR: [{ id: denialId }, { claimId: denialId }],
        organizationId: gate.organizationId,
        claim: {
          client: clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          }),
        },
      },
      select: { id: true, status: true, claimId: true, claim: { select: { clientId: true } } },
    });

    if (!existing) {
      await auditPhiAccess({
        gate,
        req,
        action: 'UPDATE',
        resourceType: 'claimDenial',
        resourceId: denialId,
        outcome: 'DENIED',
        metadata: { reason: 'not-found-or-out-of-scope' },
      });
      return NextResponse.json({ success: false, error: 'Denial not found' }, { status: 404 });
    }

    const updated = await prisma.claimDenial.update({
      where: { id: existing.id },
      data: {
        status,
        ...(resolutionNote !== undefined ? { appealResolutionNote: resolutionNote || null } : {}),
      },
      // Minimal row: never echo appealLetterBody (clinical narrative) back to the browser.
      select: {
        id: true,
        claimId: true,
        status: true,
        reasonCode: true,
        carcCode: true,
        appealSubmittedAt: true,
        updatedAt: true,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'claimDenial',
      resourceId: existing.id,
      patientId: existing.claim?.clientId ?? null,
      metadata: {
        claimId: existing.claimId,
        fromStatus: existing.status,
        toStatus: status,
        fields: resolutionNote !== undefined ? ['status', 'appealResolutionNote'] : ['status'],
      },
    });

    return NextResponse.json({
      success: true,
      denial: {
        ...updated,
        appealSubmittedAt: updated.appealSubmittedAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    console.error('[billing denials status PUT]', err);
    return NextResponse.json({ success: false, error: 'Could not update denial status' }, { status: 500 });
  }
}
