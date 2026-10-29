import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getMbcOptions, saveMbcOptions } from '@/lib/measures/options';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** GET /api/practice-settings/mbc-options — every option is OFF until a practice turns it on. */
export async function GET() {
  const gate = await requireOrgContext();
  if (gate.ok !== true) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status, headers: NO_STORE });
  }
  if (!canAccessPath(gate.role, '/dashboard/mbc')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
  }
  const options = await getMbcOptions(gate.organizationId);
  return NextResponse.json({ success: true, options }, { headers: NO_STORE });
}

const patchSchema = z
  .object({
    mbcAutoSend: z.boolean().optional(),
    mbcVisitRule: z.boolean().optional(),
    mbcProgramRule: z.boolean().optional(),
    mbcProviderRule: z.boolean().optional(),
  })
  .strict();

/** PATCH — practice leadership only. */
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok !== true) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status, headers: NO_STORE });
  }
  if (!['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid options' }, { status: 400, headers: NO_STORE });
  }
  const options = await saveMbcOptions(gate.organizationId, parsed.data);
  return NextResponse.json({ success: true, options }, { headers: NO_STORE });
}
