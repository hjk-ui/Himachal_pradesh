import { patientFail, patientGet, patientOptions } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { readPatientFile, ResourceError } from '@/lib/resources/store';
import { proxyMayOpenResource } from '@/patient/application/proxy/visibility';

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/resources/[id]/file — download the handout attached to one of my resources. Audited. */
export async function GET(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return patientGet(async ({ ctx }) => {
    let file: Awaited<ReturnType<typeof readPatientFile>> = null;
    try {
      if (await proxyMayOpenResource(ctx, id)) file = await readPatientFile({ organizationId: ctx.organizationId, clientId: ctx.clientId }, id);
    } catch (e) {
      if (!(e instanceof ResourceError)) throw e;
    }
    await writeAuditLog({
      action: 'RESOURCE_FILE_DOWNLOAD',
      actorUserId: ctx.accountId,
      actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: 'resourceAssignment',
      resourceId: id,
      patientId: ctx.clientId,
      outcome: file ? 'SUCCESS' : 'DENIED',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-web', part2: file?.part2 ?? null },
    });
    if (!file) return patientFail('NOT_FOUND', 'File not found', 404);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="${file.name.replace(/["\\\r\n]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }, ['patient-resource-file', 60])(req);
}
