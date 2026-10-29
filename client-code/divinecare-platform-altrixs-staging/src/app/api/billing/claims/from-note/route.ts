import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canGenerateDraftClaim,
  generateClaimFromAppointment,
  generateClaimFromNote,
} from '@/lib/billing/claims';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { claimFromNoteDecision } from '@/lib/billing/billingAccess';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    noteId: z.string().min(1).max(128).optional(),
    appointmentId: z.string().min(1).max(128).optional(),
    cptCode: z.string().trim().max(20).optional(),
    markReady: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.noteId || v.appointmentId), {
    message: 'noteId or appointmentId is required',
  });

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  };
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canGenerateDraftClaim(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const canBillingClaims = canAccessPath(gate.role, '/dashboard/billing/claims');
  const canCoding = canAccessPath(gate.role, '/dashboard/coding');
  const canScribe = canAccessPath(gate.role, '/dashboard/scribe');
  if (!canBillingClaims && !canCoding && !canScribe) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = bodySchema.parse(await req.json());
    if (body.appointmentId && !canBillingClaims) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    // No CPT sent: code a new claim from the note's CPT column (legacy comment
    // fallback). An existing claim keeps its code.
    let noteCpt: string | undefined;
    let cptCode = body.cptCode || undefined;
    let markReady = body.markReady === true;
    let markReadyDropped = false;
    if (body.noteId) {
      const note = await prisma.progressNote.findFirst({
        where: { id: body.noteId, client: clientOrgFilter(gate.organizationId) },
        select: { clientId: true, clinicianId: true, body: true, cptCode: true, claims: { select: { id: true, cptCode: true }, take: 1 } },
      });
      if (note) {
        // Non-billing callers (clinicians from Coding / Scribe): their own note only, never READY,
        // and no CPT change on an existing claim (billing owns the claim once it exists).
        const decision = claimFromNoteDecision({
          role: gate.role,
          actorUserId: gate.userId,
          noteClinicianId: note.clinicianId,
          existingClaimCpt: note.claims[0]?.cptCode ?? null,
          requestedCpt: body.cptCode,
          markReady: body.markReady,
        });
        if ('reason' in decision) {
          await auditPhiAccess({
            gate, req, action: 'CREATE', resourceType: 'claim', outcome: 'DENIED', patientId: note.clientId,
            metadata: { source: 'note', noteId: body.noteId, reason: decision.reason },
          });
          return NextResponse.json({ success: false, error: decision.error }, { status: decision.status });
        }
        cptCode = decision.cptCode;
        markReady = decision.markReady;
        markReadyDropped = decision.markReadyDropped;
        if (!cptCode && note.claims.length === 0) noteCpt = resolveNoteMeta(note).cptCode ?? undefined;
      }
    }
    const result = body.noteId
      ? await generateClaimFromNote(actorFrom(gate), body.noteId, {
          cptCode: cptCode || noteCpt,
          markReady,
        })
      : await generateClaimFromAppointment(actorFrom(gate), body.appointmentId!);
    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'claim', outcome: 'DENIED',
          metadata: {
            source: body.noteId ? 'note' : 'appointment',
            noteId: body.noteId ?? null,
            appointmentId: body.appointmentId ?? null,
            reason: 'not_found',
          },
        });
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    await auditPhiAccess({
      gate, req, action: result.alreadyExisted ? 'READ' : 'CREATE', resourceType: 'claim',
      resourceId: result.claim.id, patientId: result.claim.clientId,
      metadata: {
        source: body.noteId ? 'note' : 'appointment',
        noteId: body.noteId ?? null,
        appointmentId: body.appointmentId ?? null,
        alreadyExisted: result.alreadyExisted,
        markReady,
        markReadyDropped,
      },
    });
    return NextResponse.json(
      { success: true, claim: result.claim, alreadyExisted: result.alreadyExisted, ...(markReadyDropped ? { markReadyDropped: true } : {}) },
      { status: result.alreadyExisted ? 200 : 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid claim request' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not generate claim' },
      { status: 400 }
    );
  }
}
