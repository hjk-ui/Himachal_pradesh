import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { listPatientResources } from '@/lib/resources/store';
import { filterPortalResources } from '@/patient/application/proxy/visibility';

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/resources — "My resources": only the signed-in patient's own, non-withdrawn assignments. */
export const GET = patientGet(async ({ req, ctx }) => {
  // A proxy never sees Part 2 / SUD or confidential resources (src/patient/domain/proxy-policy.ts)
  const resources = await filterPortalResources(ctx, await listPatientResources({ organizationId: ctx.organizationId, clientId: ctx.clientId }));
  await writeAuditLog({
    action: 'LIST',
    actorUserId: ctx.accountId,
    actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'resourceAssignment',
    patientId: ctx.clientId,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', purpose: 'my_resources', count: resources.length },
  });
  return patientOk({ resources });
}, ['patient-resources', 120]);
