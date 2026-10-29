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
 * POST /api/patient/medications/[id]/skip
 * Fallback route in case the mobile app uses /skip instead of /intake.
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
  const skipIndex = segments.indexOf('skip');
  const pathId = skipIndex > 0 ? segments[skipIndex - 1] : undefined;

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  const payload: Record<string, unknown> = {
    scheduleId: pathId,
    skipped: true,
    taken: false,
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
