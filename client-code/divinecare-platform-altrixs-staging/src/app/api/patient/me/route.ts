import {
  deletePatientAccount,
  getPatientProfile,
  updatePatientProfile,
  updatePatientProfileSchema,
} from '@/patient/application/profile/service';
import { patientAccountHandler, patientOk, patientOptions, readPatientJson } from '@/patient/infrastructure/http/handler';
import type { PatientProfile } from '@/patient/domain';
import { actingAsView } from '@/patient/application/auth/session';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

/** Patient-app actor: the patient's account id; the patient's own client id as patientId. Never throws. */
function auditPatient(req: Request, me: PatientProfile, action: string, resourceType: string, metadata?: Record<string, unknown>) {
  return writeAuditLog({
    action,
    actorUserId: me.accountId,
    actorRole: me.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
    resourceType,
    resourceId: resourceType === 'patientAccount' ? me.accountId : me.clientId,
    patientId: me.clientId,
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-app', ...(me.access?.isProxy ? { proxy: true, relationship: me.access.relationship, portalAccessId: me.access.accessId } : {}), ...metadata },
  });
}

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientAccountHandler(async ({ req, me }) => {
  const client = await getPatientProfile(me);
  await auditPatient(req, me, 'READ', 'patientProfile');
  // actingAs: who is signed in and for whom ("Acting as guardian for …" banner); additive field
  return patientOk({ client, actingAs: actingAsView(me) });
});

export const PATCH = patientAccountHandler(async ({ req, me }) => {
  const input = await readPatientJson(req);
  const client = await updatePatientProfile(me, input);
  const allowed = Object.keys(updatePatientProfileSchema.shape);
  const fields =
    input && typeof input === 'object' ? Object.keys(input).filter((k) => allowed.includes(k)) : [];
  await auditPatient(req, me, 'WRITE', 'patientProfile', { fields });
  return patientOk({ client });
},
  ['patient-profile-update', 30]
);

export const DELETE = patientAccountHandler(async ({ req, me }) => {
  const result = await deletePatientAccount(me);
  await auditPatient(req, me, 'DELETE', 'patientAccount');
  return patientOk(result);
},
  ['patient-account-delete', 5]
);
