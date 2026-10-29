import { z } from 'zod';
import { patientFail, patientGet, patientOk, patientOptions, readPatientJson } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { openPatientResource, ResourceError } from '@/lib/resources/store';
import { proxyMayOpenResource } from '@/patient/application/proxy/visibility';

export function OPTIONS() { return patientOptions(); }

async function handle(req: Request, id: string, action: 'viewed' | 'completed') {
  return patientGet(async ({ ctx }) => {
    const scope = { organizationId: ctx.organizationId, clientId: ctx.clientId };
    let result: Awaited<ReturnType<typeof openPatientResource>> = null;
    let error: string | null = null;
    // Hidden from this proxy = not found (and never marked viewed)
    const allowed = await proxyMayOpenResource(ctx, id);
    try {
      if (allowed) result = await openPatientResource(scope, id, action);
    } catch (e) {
      if (!(e instanceof ResourceError)) throw e;
      error = e.message;
    }
    await writeAuditLog({
      action: action === 'completed' ? 'RESOURCE_COMPLETE' : 'RESOURCE_VIEW',
      actorUserId: ctx.accountId,
      actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: 'resourceAssignment',
      resourceId: id,
      patientId: ctx.clientId,
      outcome: result ? 'SUCCESS' : 'DENIED',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-web', changed: result?.changed ?? false, part2: result?.part2 ?? null },
    });
    if (error) return patientFail('UNAVAILABLE', error, 400);
    if (!result) return patientFail('NOT_FOUND', 'Resource not found', 404);
    return patientOk({ resource: result.resource });
  }, ['patient-resource', 240])(req);
}

/** GET /api/patient/resources/[id] — open one of my resources (first open marks it viewed). */
export async function GET(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return handle(req, id, 'viewed');
}

/** POST { action: 'viewed' | 'completed' } — mark my resource viewed or done. */
export async function POST(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  const body = await readPatientJson(req.clone()).catch(() => null);
  const parsed = z.object({ action: z.enum(['viewed', 'completed']) }).safeParse(body);
  if (!parsed.success) return patientFail('INVALID', 'action must be viewed or completed', 400);
  return handle(req, id, parsed.data.action);
}
