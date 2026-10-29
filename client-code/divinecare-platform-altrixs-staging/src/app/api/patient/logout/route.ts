import { patientAccountHandler, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() {
  return patientOptions();
}

export const POST = patientAccountHandler(async ({ req, me }) => {
  await logPatientAudit({
    clientId: me.clientId,
    accountId: me.accountId,
    action: 'auth.logout',
    entityType: 'patient_account',
    entityId: me.accountId,
  });
  await writeAuditLog({
    action: 'LOGOUT',
    actorUserId: me.accountId,
    actorRole: 'PATIENT',
    resourceType: 'patientAccount',
    resourceId: me.accountId,
    patientId: me.clientId,
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-app' },
  });
  return patientOk({ message: 'Logged out successfully' });
});

export const GET = POST;
