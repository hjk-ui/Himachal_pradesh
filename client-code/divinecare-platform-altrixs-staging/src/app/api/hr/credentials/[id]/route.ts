import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  STAFF_CREDENTIAL_STATUSES,
  STAFF_CREDENTIAL_TYPES,
  canMutateCredentials,
  updateStaffCredential,
} from '@/lib/hr/credentials';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const patchSchema = z.object({
  credentialType: z.enum(STAFF_CREDENTIAL_TYPES).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  licenseNumber: z.string().trim().min(1).max(80).optional(),
  issuer: z.string().trim().min(1).max(160).optional(),
  issuedAt: z.string().trim().max(40).optional().nullable(),
  expiresAt: z.string().trim().min(8).max(40).optional(),
  ceuRequired: z.number().int().min(0).max(999).optional(),
  ceuCompleted: z.number().int().min(0).max(999).optional(),
  documentUrl: z.string().trim().max(500).optional().nullable(),
  documentName: z.string().trim().max(200).optional().nullable(),
  status: z.enum(STAFF_CREDENTIAL_STATUSES).optional(),
  licenseType: z.string().trim().max(20).optional().nullable(),
  credentialState: z.string().trim().max(2).optional().nullable(),
  details: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
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
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const result = await updateStaffCredential(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id,
      body
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'staffCredential',
      resourceId: id,
      ...auditRequestMeta(req),
      metadata: { area: 'hr', staffUserId: result.credential.userId, fields: Object.keys(body) },
    });
    return NextResponse.json({ success: true, credential: result.credential });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid credential update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update credential' },
      { status: 400 }
    );
  }
}
