import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateClaims, createManualClaim } from '@/lib/billing/claims';

export const runtime = 'nodejs';

const modelSchema = z.object({
  clientId: z.string().min(1),
  diagnosisCode: z.string().trim().min(3),
  code: z.enum(['H2017', 'H2017HK']).default('H2017'),
  createClaim: z.boolean().optional(),
});

function moduleKey(clientId: string) {
  return `prp-billing-model:${clientId}`;
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/prp/enroll') && !canMutateClaims(gate.role as Role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clientId = new URL(req.url).searchParams.get('clientId') || '';
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: gate.organizationId, module: moduleKey(clientId) } },
  });
  return NextResponse.json({ success: true, model: row?.data ?? null });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const parsed = modelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'A client and a diagnosis code are required.' }, { status: 400 });
  }

  if (parsed.data.createClaim) {
    if (!canMutateClaims(gate.role as Role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const row = await prisma.clinicModuleState.findUnique({
      where: { organizationId_module: { organizationId: gate.organizationId, module: moduleKey(parsed.data.clientId) } },
    });
    const model = row?.data as { confirmed?: boolean; code?: string; diagnosisCode?: string } | null;
    if (!model?.confirmed || !model.diagnosisCode) {
      return NextResponse.json({ success: false, error: 'The PRP billing model is not confirmed for this client.' }, { status: 400 });
    }
    const claim = await createManualClaim(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role },
      {
        clientId: parsed.data.clientId,
        cptCode: model.code === 'H2017HK' ? 'H2017HK' : 'H2017',
        diagnosisCodes: [model.diagnosisCode],
        units: 1,
        markReady: false,
        clinicianLabel: 'PRP',
      },
    );
    if (!claim.ok) return NextResponse.json({ success: false, error: claim.error }, { status: claim.status });
    return NextResponse.json({ success: true, claim: claim.claim, mode: 'test' });
  }

  if (!canAccessPath(gate.role, '/dashboard/prp/enroll')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const data = {
    clientId: parsed.data.clientId,
    diagnosisCode: parsed.data.diagnosisCode.toUpperCase(),
    code: parsed.data.code,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  };
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: gate.organizationId, module: moduleKey(parsed.data.clientId) } },
    create: { organizationId: gate.organizationId, module: moduleKey(parsed.data.clientId), data },
    update: { data },
  });
  return NextResponse.json({ success: true, model: data });
}
