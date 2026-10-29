import { NextResponse } from 'next/server';
import {
  patientAccountHandler,
  patientOptions,
  readPatientJson,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';
import { recordMedicationIntake } from '@/patient/application/medications/intakeService';

export function OPTIONS() {
  return patientOptions();
}

/**
 * POST /api/patient/medications/[id]/intake
 * Fallback route in case the mobile app includes the medication or schedule ID in the URL path.
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

  // Extract ID from pathname: /api/patient/medications/[id]/intake
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const intakeIndex = segments.indexOf('intake');
  const pathId = intakeIndex > 0 ? segments[intakeIndex - 1] : undefined;

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  const payload: Record<string, unknown> = {
    scheduleId: pathId,
    ...queryParams,
    ...body,
  };

  const result = await recordMedicationIntake(me.clientId, payload);

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
