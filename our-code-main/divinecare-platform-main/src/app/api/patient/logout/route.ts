import { patientAccountHandler, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';

export function OPTIONS() {
  return patientOptions();
}

export const POST = patientAccountHandler(async ({ me }) => {
  await logPatientAudit({
    clientId: me.clientId,
    accountId: me.accountId,
    action: 'auth.logout',
    entityType: 'patient_account',
    entityId: me.accountId,
  });
  return patientOk({ message: 'Logged out successfully' });
});

export const GET = POST;
