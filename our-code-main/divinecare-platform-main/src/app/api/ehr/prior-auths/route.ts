import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  PRIOR_AUTH_STATUSES,
  canAccessPriorAuths,
  canWritePriorAuths,
  createPriorAuth,
  listPriorAuths,
} from '@/lib/ehr/priorAuths';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  payer: z.string().trim().min(1).max(120),
  authNumber: z.string().trim().max(80).optional().nullable(),
  cptCodes: z.array(z.string().trim().max(16)).min(1).max(12),
  unitsApproved: z.number().int(),
  unitsUsed: z.number().int().optional(),
  status: z.enum(PRIOR_AUTH_STATUSES).optional(),
  startDate: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPriorAuths(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/prior-auths')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const auths = await listPriorAuths({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, auths });
  } catch (err) {
    console.error('[prior-auths GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load prior auths' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canWritePriorAuths(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/prior-auths')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createPriorAuth(actorFrom(gate), body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, auth: result.auth }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid prior auth' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create prior auth' },
      { status: 400 }
    );
  }
}
