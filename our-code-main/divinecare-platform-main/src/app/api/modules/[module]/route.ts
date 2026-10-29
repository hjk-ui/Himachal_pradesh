import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getModuleSnapshot, saveModuleSnapshot, ModuleConflictError } from '@/lib/modules/manage';
import { canUseClinicModule } from '@/lib/modules/access';
import { canUsePlanModule } from '@/lib/subscription/plans';
import { listAssessments } from '@/lib/ehr/assessments';

const paramsSchema = z.object({
  module: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ module: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid module' }, { status: 400 });
  const { module } = parsed.data;
  if (!canUseClinicModule(gate.role, module)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const snapshot = module === 'assessments'
    ? await listAssessments({ organizationId: gate.organizationId, actorRole: gate.role, actorUserId: gate.userId })
    : await getModuleSnapshot(gate.organizationId, module);
  return NextResponse.json({ success: true, ...snapshot }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ module: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { module } = paramsSchema.parse(await ctx.params);
    if (module === 'assessments') {
      return NextResponse.json({ success: false, error: 'Submit assessments through the assessment form; assessment history cannot be replaced' }, { status: 405 });
    }
    if (!canUseClinicModule(gate.role, module)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const entitlement = await canUsePlanModule(gate.organizationId, module);
    if (!entitlement.ok) {
      return NextResponse.json(
        { success: false, error: entitlement.error, upgradeRequired: true },
        { status: 402 }
      );
    }

    const body = await req.json();
    const data = body.data ?? body;
    const version = z.string().max(40).optional().parse(body.version);
    if (JSON.stringify(data).length > 2_000_000) {
      return NextResponse.json({ success: false, error: 'Record collection is too large' }, { status: 413 });
    }
    const nextVersion = await saveModuleSnapshot(gate.organizationId, module, data, version);
    return NextResponse.json({ success: true, version: nextVersion });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof ModuleConflictError ? err.message : 'Could not save records. Check your input and retry.' },
      { status: err instanceof ModuleConflictError ? 409 : err instanceof z.ZodError || err instanceof SyntaxError ? 400 : 500 }
    );
  }
}
