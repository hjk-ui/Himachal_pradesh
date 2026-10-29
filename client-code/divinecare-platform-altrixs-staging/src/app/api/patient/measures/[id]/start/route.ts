import { PatientAppError } from '@/patient/domain';
import { patientOptions, patientPost, patientOk } from '@/patient/infrastructure/http/handler';
import { startPortalMeasure } from '@/lib/measures/portal';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() { return patientOptions(); }

/** POST /api/patient/measures/[id]/start — a portal link (/m/<token>) for an open questionnaire; the link still asks for the date of birth. */
export const POST = patientPost(async ({ req, ctx }) => {
  const id = new URL(req.url).pathname.split('/').slice(-2, -1)[0] ?? '';
  const r = await startPortalMeasure({ organizationId: ctx.organizationId, clientId: ctx.clientId, accountId: ctx.accountId, isProxy: Boolean(ctx.access?.isProxy) }, decodeURIComponent(id));
  if (r.ok === false) throw new PatientAppError(r.error, r.status, 'measure_unavailable');
  await writeAuditLog({
    action: 'MEASURE_PORTAL_START',
    actorUserId: ctx.accountId,
    actorRole: 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'measureRequest',
    resourceId: r.requestId,
    patientId: ctx.clientId,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', fromRequestId: r.fromRequestId, measureCount: r.measureCount },
  });
  return patientOk({ path: r.path });
}, ['patient-measures-start', 20]);
