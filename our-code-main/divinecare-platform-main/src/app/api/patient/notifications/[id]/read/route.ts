import { NextResponse } from 'next/server';
import {
  patientOptions,
  PATIENT_CORS,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { requirePatient } from '@/patient/application/auth/session';
import { loadPatientContext } from '@/patient/infrastructure/persistence/patient-context';
import { markNotificationRead } from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

async function handleMarkRead(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const me = await requirePatient(req);
    const ctx = await loadPatientContext(me);
    const resolvedParams = await Promise.resolve(props.params);
    const id = resolvedParams.id;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Notification ID is required' },
        { status: 400, headers: PATIENT_CORS }
      );
    }

    const result = await markNotificationRead(ctx, id);
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404, headers: PATIENT_CORS }
      );
    }
    return NextResponse.json({ success: true, data: result, ...result }, { headers: PATIENT_CORS });
  } catch (err) {
    return patientRouteError(err);
  }
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  return handleMarkRead(req, props);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  return handleMarkRead(req, props);
}

export async function PUT(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  return handleMarkRead(req, props);
}
