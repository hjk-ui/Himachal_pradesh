import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getModuleSnapshot, saveModuleSnapshot, ModuleConflictError } from '@/lib/modules/manage';
import { canReadClinicModule, canUseClinicModule } from '@/lib/modules/access';
import { canUsePlanModule } from '@/lib/subscription/plans';
import { listAssessments } from '@/lib/ehr/assessments';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import {
  filterModuleItems,
  isClientScopedModule,
  mergeScopedModuleWrite,
  moduleCandidateClientIds,
} from '@/lib/modules/clientScope';
import { loadModuleClientScope } from '@/lib/modules/clientScopeServer';

function recordCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  return value && typeof value === 'object' ? 1 : null;
}

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
  if (!canReadClinicModule(gate.role, module, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const snapshot = module === 'assessments'
    ? await listAssessments({ organizationId: gate.organizationId, actorRole: gate.role, actorUserId: gate.userId })
    : await getModuleSnapshot(gate.organizationId, module);
  if (module !== 'assessments' && isClientScopedModule(module)) {
    // Per-client records: only the caller's caseload / care team, minus locked Part 2 / sensitive clients
    try {
      const scope = await loadModuleClientScope(
        { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
        moduleCandidateClientIds(module, snapshot.data),
      );
      return NextResponse.json(
        { success: true, ...snapshot, data: filterModuleItems(module, snapshot.data, scope) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (err) {
      console.error('[modules GET scope]', err);
      return NextResponse.json({ success: false, error: 'Could not check record access' }, { status: 500 });
    }
  }
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
    if (!canUseClinicModule(gate.role, module, gate.capabilities)) {
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
    const before = await getModuleSnapshot(gate.organizationId, module).catch(() => null);
    let toSave: unknown = data;
    let hiddenKept: number | undefined;
    if (isClientScopedModule(module)) {
      // Per-client records: every item sent must be one the caller may open; the items they cannot
      // see (other caseloads, locked Part 2 clients) are kept unchanged.
      if (!before) {
        return NextResponse.json({ success: false, error: 'Could not load the current records. Retry.' }, { status: 503 });
      }
      const scope = await loadModuleClientScope(
        { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
        moduleCandidateClientIds(module, before.data, data),
      );
      const merged = mergeScopedModuleWrite(module, before.data, data, scope);
      if (merged.ok === false) {
        await writeAuditLog({
          action: 'module_snapshot_write',
          actorUserId: gate.userId,
          actorRole: gate.role ?? null,
          organizationId: gate.organizationId,
          resourceType: 'ClinicModuleState',
          resourceId: module,
          outcome: 'DENIED',
          metadata: { module, reason: merged.status === 403 ? 'client_scope' : 'invalid' },
          ...auditRequestMeta(req),
        });
        return NextResponse.json({ success: false, error: merged.error }, { status: merged.status });
      }
      toSave = merged.data;
      hiddenKept = merged.hiddenKept;
    }
    const nextVersion = await saveModuleSnapshot(gate.organizationId, module, toSave, version);
    // Who replaced which module list, and how many records before/after. Never the contents (may hold PHI).
    await writeAuditLog({
      action: 'module_snapshot_write',
      actorUserId: gate.userId,
      actorRole: gate.role ?? null,
      organizationId: gate.organizationId,
      resourceType: 'ClinicModuleState',
      resourceId: module,
      metadata: {
        module,
        recordsBefore: before ? recordCount(before.data) : null,
        recordsAfter: recordCount(toSave),
        versioned: version !== undefined,
        ...(hiddenKept !== undefined ? { scoped: true, hiddenKept } : {}),
      },
      ...auditRequestMeta(req),
    });
    return NextResponse.json({ success: true, version: nextVersion });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof ModuleConflictError ? err.message : 'Could not save records. Check your input and retry.' },
      { status: err instanceof ModuleConflictError ? 409 : err instanceof z.ZodError || err instanceof SyntaxError ? 400 : 500 }
    );
  }
}
