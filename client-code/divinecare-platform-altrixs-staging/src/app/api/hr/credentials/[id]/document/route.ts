import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { attachCredentialDocument, canMutateCredentials } from '@/lib/hr/credentials';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }
    const result = await attachCredentialDocument(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id,
      file
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, credential: result.credential });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not upload document';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
