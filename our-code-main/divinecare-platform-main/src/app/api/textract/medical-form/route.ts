import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { analyzeMedicalForm } from '@/lib/aws/textract';

export const runtime = 'nodejs';

const schema = z.object({
  bytesBase64: z.string().min(8).max(12_000_000),
  clientId: z.string().min(1).max(128).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/scanner') &&
    !canAccessPath(gate.role, '/dashboard/ehr/notes') &&
    !canAccessPath(gate.role, '/dashboard/clients/intake')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: 'bytesBase64 is required' },
      { status: 400 }
    );
  }

  const result = await analyzeMedicalForm({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    clientId: body.clientId,
    bytesBase64: body.bytesBase64,
  });
  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error, demoMode: false },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, ...result.result });
}
