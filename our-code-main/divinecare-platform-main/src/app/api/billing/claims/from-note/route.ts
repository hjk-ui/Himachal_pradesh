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
    const result = body.noteId
      ? await generateClaimFromNote(actorFrom(gate), body.noteId, {
          cptCode: body.cptCode,
          markReady: body.markReady,
        })
      : await generateClaimFromAppointment(actorFrom(gate), body.appointmentId!);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { success: true, claim: result.claim, alreadyExisted: result.alreadyExisted },
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
