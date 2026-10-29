import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  STAFF_CREDENTIAL_STATUSES,
  STAFF_CREDENTIAL_TYPES,
  canAccessCredentials,
  canMutateCredentials,
  createStaffCredential,
  listOrgStaffForCredentials,
  listStaffCredentials,
} from '@/lib/hr/credentials';

export const runtime = 'nodejs';

const createSchema = z.object({
  userId: z.string().min(1).max(128),
  credentialType: z.enum(STAFF_CREDENTIAL_TYPES),
  title: z.string().trim().min(1).max(160),
  licenseNumber: z.string().trim().min(1).max(80),
  issuer: z.string().trim().min(1).max(160),
  issuedAt: z.string().trim().max(40).optional().nullable(),
  expiresAt: z.string().trim().min(8).max(40),
  ceuRequired: z.number().int().min(0).max(999).optional(),
  ceuCompleted: z.number().int().min(0).max(999).optional(),
  documentUrl: z.string().trim().max(500).optional().nullable(),
  documentName: z.string().trim().max(200).optional().nullable(),
  status: z.enum(STAFF_CREDENTIAL_STATUSES).optional(),
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
    !canAccessCredentials(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/credentialing')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const actor = actorFrom(gate);
    const [{ credentials, schemaReady }, staff] = await Promise.all([
      listStaffCredentials(actor),
      listOrgStaffForCredentials(gate.organizationId),
    ]);
    return NextResponse.json({ success: true, credentials, staff, schemaReady });
  } catch (err) {
    console.error('[hr/credentials GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load credentials' },
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
    !canMutateCredentials(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/credentialing')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createStaffCredential(actorFrom(gate), body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, credential: result.credential }, { status: 201 });
  } catch (err: unknown) {
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    const message = missing
      ? 'Staff credentials table is not on this database yet'
      : err instanceof z.ZodError
        ? 'Invalid credential'
        : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create credential' },
      { status: 400 }
    );
  }
}
