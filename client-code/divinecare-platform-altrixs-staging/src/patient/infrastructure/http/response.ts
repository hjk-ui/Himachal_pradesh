import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PatientAppError } from '@/patient/domain';

const CORS_ORIGIN = process.env.PATIENT_CORS_ORIGIN?.trim() || '*';

export const PATIENT_CORS = {
  'Cache-Control': 'private, no-store',
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function patientOptions() {
  return new NextResponse(null, { status: 204, headers: PATIENT_CORS });
}

export function patientOk<T>(data: T, status = 200, message?: string) {
  return NextResponse.json(
    { success: true, data, ...(message ? { message } : {}) },
    { status, headers: PATIENT_CORS }
  );
}

export function patientFail(
  code: string,
  message: string,
  status: number,
  fields?: Record<string, string>
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, ...(fields && Object.keys(fields).length ? { fields } : {}) },
    },
    { status, headers: PATIENT_CORS }
  );
}

export function patientRouteError(err: unknown) {
  if (err instanceof PatientAppError) {
    return patientFail(err.code, err.message, err.status, err.fields);
  }
  if (err instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join('.') || 'body'] = issue.message;
    }
    return patientFail('VALIDATION_ERROR', 'Invalid request', 400, fields);
  }
  console.error('[patient api]', err instanceof Error ? err.message : err);
  return patientFail('INTERNAL_ERROR', 'Something went wrong', 500);
}

export function parsePagination(url: URL, defaultLimit = 20) {
  const positiveInteger = (key: string, fallback: number) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PatientAppError(`${key} must be a positive integer`, 400, 'VALIDATION_ERROR');
    }
    return value;
  };
  const page = positiveInteger('page', 1);
  const limit = Math.min(100, positiveInteger('limit', defaultLimit));
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw new PatientAppError('Page is too large', 400, 'VALIDATION_ERROR');
  }
  return { page, limit, skip };
}

export async function readPatientJson(req: Request, allowEmpty = false): Promise<unknown> {
  try {
    const text = await req.text();
    if (allowEmpty && !text.trim()) return {};
    return JSON.parse(text);
  } catch {
    throw new PatientAppError('Request body must be valid JSON', 400, 'VALIDATION_ERROR');
  }
}
