import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { listPortalMeasures } from '@/lib/measures/portal';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/measures — the signed-in patient's open questionnaires (count only; proxies see none). */
export const GET = patientGet(async ({ req, ctx }) => {
  const measures = await listPortalMeasures({ organizationId: ctx.organizationId, clientId: ctx.clientId, accountId: ctx.accountId, isProxy: Boolean(ctx.access?.isProxy) });
  await writeAuditLog({
    action: 'LIST',
    actorUserId: ctx.accountId,
    actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'measureRequest',
    patientId: ctx.clientId,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', purpose: 'questionnaires', count: measures.length },
  });
  return patientOk({ measures });
}, ['patient-measures', 60]);
