import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientOrgMembershipWhere } from '@/lib/clients/orgScope';
import { AvailityAuthError } from '@/lib/integrations/availity/auth';
import { runCoveragesEligibility } from '@/lib/integrations/availity/coverages';
import { AvailityEligibilityError } from '@/lib/integrations/availity/errors';
import { rateLimit } from '@/lib/security/rateLimit';

const ELIGIBILITY_PATH = '/dashboard/ehr/eligibility';

const bodySchema = z.object({
  clientId: z.string().trim().min(1),
});

function errorResponse(err: AvailityEligibilityError) {
  return NextResponse.json(
    {
      success: false,
      error: err.message,
      code: err.code,
      ...(err.details?.length ? { details: err.details } : {}),
    },
    { status: err.status }
  );
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, ELIGIBILITY_PATH)) {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to run eligibility checks' },
      { status: 403 }
    );
  }

  const limited = rateLimit(`availity-eligibility:${gate.organizationId}:${gate.userId}`, 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many eligibility requests. Try again later.' },
      { status: 429 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Request body must be { "clientId": "..." }' },
      { status: 400 }
    );
  }

  const client = await prisma.client.findFirst({
    where: {
      id: parsed.data.clientId,
      AND: [clientOrgMembershipWhere(gate.organizationId)],
    },
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      gender: true,
      state: true,
      insurancePayer: true,
      insuranceMemberId: true,
      insuranceGroupNumber: true,
    },
  });

  if (!client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  const provider = await prisma.user.findFirst({
    where: { id: gate.userId, organizationId: gate.organizationId },
    select: { npi: true, name: true },
  });

  console.error('[availity-eligibility] start', {
    organizationId: gate.organizationId,
    clientId: client.id,
    hasNpi: Boolean(provider?.npi),
  });

  try {
    const result = await runCoveragesEligibility({
      insurancePayer: client.insurancePayer ?? '',
      insuranceMemberId: client.insuranceMemberId,
      insuranceGroupNumber: client.insuranceGroupNumber,
      clientName: client.name,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      state: client.state,
      providerNpi: provider?.npi ?? null,
      providerName: provider?.name ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AvailityEligibilityError) {
      console.error('[availity-eligibility] failed', { code: err.code, status: err.status });
      return errorResponse(err);
    }
    if (err instanceof AvailityAuthError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[availity-eligibility]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Eligibility check failed' },
      { status: 500 }
    );
  }
}
