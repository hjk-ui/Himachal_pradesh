import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { loginPatient } from '@/patient/application/auth/login';
import {
  patientFail,
  patientOk,
  patientOptions,
  patientRateLimited,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { PatientAppError } from '@/patient/domain';
import { verifyPatientSession } from '@/patient/infrastructure/security/tokens';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(72),
});

export function OPTIONS() {
  return patientOptions();
}

export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-login', 10);
    if (blocked) return blocked;

    const body = schema.parse(await readPatientJson(req));
    const result = await loginPatient(body.email, body.password);

    const proxy = result.actingAs.isProxy;
    await logPatientAudit({
      clientId: result.client.id,
      accountId: result.accountId,
      action: proxy ? 'proxy.login' : 'login.success',
      ...(proxy ? { portalAccessId: result.accessId, relationship: result.actingAs.relationship } : {}),
    });

    let accountId: string | null = null;
    try {
      accountId = verifyPatientSession(result.token).accountId;
    } catch {
      accountId = null;
    }
    await writeAuditLog({
      action: 'LOGIN',
      actorUserId: accountId,
      actorRole: proxy ? 'PATIENT_PROXY' : 'PATIENT',
      resourceType: 'patientAccount',
      resourceId: accountId,
      patientId: result.client.id,
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      metadata: {
        method: 'password',
        portal: 'patient-app',
        ...(proxy ? { proxy: true, relationship: result.actingAs.relationship, accessLevel: result.actingAs.accessLevel, portalAccessId: result.accessId, linkedPeople: result.people.length } : {}),
      },
    });

    // Additive fields: older app builds read token + client only
    return patientOk({
      token: result.token,
      client: result.client,
      actingAs: result.actingAs,
      people: result.people,
    });
  } catch (err) {
    if (err instanceof PatientAppError) {
      // No identifier: the email may not belong to any account (never log the email itself)
      await writeAuditLog({
        action: 'LOGIN_FAILED',
        actorRole: 'PATIENT',
        resourceType: 'patientAccount',
        outcome: 'FAILURE',
        ...auditRequestMeta(req),
        metadata: { method: 'password', portal: 'patient-app', reason: err.code },
      });
    }
    if (err instanceof z.ZodError) {
      return patientFail('VALIDATION_ERROR', 'Email and password are required', 400);
    }
    return patientRouteError(err);
  }
}
