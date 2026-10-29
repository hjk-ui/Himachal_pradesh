import { getPatientAppointment } from '@/patient/application/appointments/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { PatientAppError } from '@/patient/domain';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() {
  return patientOptions();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientGet(
    async ({ req: request, ctx: patient }) => {
      const audit = (outcome: 'SUCCESS' | 'DENIED') =>
        writeAuditLog({
          action: 'READ',
          actorUserId: patient.accountId,
          actorRole: patient.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
          organizationId: patient.organizationId,
          resourceType: 'appointment',
          resourceId: id,
          patientId: patient.clientId,
          outcome,
          ...auditRequestMeta(request),
          metadata: { portal: 'patient-app', ...(outcome === 'DENIED' ? { reason: 'not-own-appointment' } : {}) },
        });
      let appointment: Awaited<ReturnType<typeof getPatientAppointment>>;
      try {
        appointment = await getPatientAppointment(patient.clientId, id, patient);
      } catch (err) {
        if (err instanceof PatientAppError && err.status === 404) await audit('DENIED');
        throw err;
      }
      await audit('SUCCESS');
      return patientOk({ appointment });
    },
    ['patient-appointment-detail', 60]
  );
  return handler(req);
}
