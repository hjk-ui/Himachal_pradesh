import { NextResponse } from 'next/server';
import {
  patientAccountHandler,
  patientOptions,
  readPatientJson,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';
import { recordMedicationIntake } from '@/patient/application/medications/intakeService';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() {
  return patientOptions();
}

/**
 * POST /api/patient/medications/[id]/take
 * Fallback route in case the mobile app uses /take instead of /intake.
 */
export const POST = patientAccountHandler(async ({ req, me }) => {
  let body: Record<string, unknown> = {};
  try {
    const raw = await readPatientJson(req, true);
    if (typeof raw === 'object' && raw !== null) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const takeIndex = segments.indexOf('take');
  const pathId = takeIndex > 0 ? segments[takeIndex - 1] : undefined;

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  const payload: Record<string, unknown> = {
    scheduleId: pathId,
    taken: true,
    ...queryParams,
    ...body,
  };

  const result = await recordMedicationIntake(me.clientId, payload);
  await writeAuditLog({
    action: 'CREATE',
    actorUserId: me.accountId,
    actorRole: 'PATIENT',
    resourceType: 'medicationIntakeLog',
    resourceId: result.ok ? (result.data?.id ?? null) : null,
    patientId: me.clientId,
    outcome: result.ok ? 'SUCCESS' : result.status === 404 ? 'DENIED' : 'FAILURE',
    ...auditRequestMeta(req),
    metadata: {
      portal: 'patient-app',
      route: 'id-take',
      scheduleId: result.data?.scheduleId ?? null,
      status: result.data?.status ?? null,
      ...(result.ok ? {} : { reason: result.status === 404 ? 'schedule-not-found-for-patient' : 'intake-failed' }),
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: result.error || 'Failed to record medication intake',
        },
      },
      { status: result.status || 404, headers: PATIENT_CORS }
    );
  }

  return NextResponse.json(
    {
      ...result.data,
      data: result.data,
    },
    { status: 200, headers: PATIENT_CORS }
  );
});
