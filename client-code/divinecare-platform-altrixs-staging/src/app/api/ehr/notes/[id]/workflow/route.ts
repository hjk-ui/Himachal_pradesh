import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';
import { generateClaimFromNote } from '@/lib/billing/claims';
import { summarizeClaimResult, type ClaimSummary } from '@/lib/notes/afterSign';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const bodySchema = z.object({
  status: z.enum(['Signed', 'Locked']),
  /** Signer confirmed the attestation; required when a new signature is applied */
  attested: z.boolean().optional(),
  /** Late entry (signed after the practice deadline): the clinician's reason, min 10 characters */
  lateEntryReason: z.string().trim().max(500).optional(),
  /** AI Scribe transcript risk: why no further risk assessment is indicated (min 15 characters) */
  riskAttestation: z.string().trim().max(1000).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const { id } = params.data;
  const body = parsed.data;

  const result = await updateProgressNoteWorkflow({
    noteId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    status: body.status,
    attested: body.attested === true,
    lateEntryReason: body.lateEntryReason ?? null,
    riskAttestation: body.riskAttestation ?? null,
  });

  if (!result.ok) {
    const errorResult = result as { ok: false; status: number; error: string };
    return NextResponse.json(
      { success: false, error: errorResult.error },
      { status: errorResult.status }
    );
  }

  // A new signature drafts the claim from the note (same as PATCH /api/notes/[id]): nothing is
  // re-entered in billing. Never fails the signature; the clinician sees why no claim was drafted.
  let claim: ClaimSummary | null = null;
  if (result.signed) {
    try {
      claim = summarizeClaimResult(
        await generateClaimFromNote({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, id)
      );
    } catch (err) {
      console.error('[note workflow sign] claim draft failed', err instanceof Error ? err.name : 'unknown');
      claim = summarizeClaimResult(null);
    }
  }

  await auditPhiAccess({
    gate,
    req,
    action: body.status === 'Locked' ? 'NOTE_LOCK' : 'NOTE_SIGN',
    resourceType: 'progressNote',
    resourceId: id,
    patientId: result.clientId,
    metadata: {
      status: result.status,
      newSignature: result.signed,
      attested: result.signed ? true : null,
      signerUserId: result.signed ? gate.userId : null,
      cosignRequired: result.cosignRequired,
      // Signed without an active plan under the go-live transition (also its own override audit row)
      planGateOverride: result.planTransition ? result.planTransition.reason : null,
    },
  });

  return NextResponse.json({
    success: true,
    status: result.status,
    snapshot: result.snapshot,
    signedByName: result.signedByName,
    cosignRequired: result.cosignRequired,
    planTransition: result.planTransition ?? null,
    claim,
    riskWatch: result.signed ? await watchProgressNote({ noteId: id, organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) : null,
  });
}
