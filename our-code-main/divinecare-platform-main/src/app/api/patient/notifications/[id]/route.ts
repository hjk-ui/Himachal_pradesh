import { NextResponse } from 'next/server';
import {
  patientOptions,
  PATIENT_CORS,
  patientRouteError,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';
import { requirePatient } from '@/patient/application/auth/session';
import { loadPatientContext } from '@/patient/infrastructure/persistence/patient-context';
import {
  markNotificationRead,
  deletePatientNotification,
} from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const me = await requirePatient(req);
    const ctx = await loadPatientContext(me);
    const resolvedParams = await Promise.resolve(props.params);
    const id = resolvedParams.id;

    const body = (await readPatientJson(req).catch(() => ({}))) as Record<string, any>;
    if (body?.isRead === true || body?.read === true || body?.is_read === true) {
      const result = await markNotificationRead(ctx, id);
      if (!result) {
        return NextResponse.json(
          { success: false, error: 'Notification not found' },
          { status: 404, headers: PATIENT_CORS }
        );
      }
      return NextResponse.json({ success: true, data: result, ...result }, { headers: PATIENT_CORS });
    }

    // Default to mark read if patched
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

export async function PUT(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  return PATCH(req, props);
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const me = await requirePatient(req);
    const ctx = await loadPatientContext(me);
    const resolvedParams = await Promise.resolve(props.params);
    const id = resolvedParams.id;

    const deleted = await deletePatientNotification(ctx, id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404, headers: PATIENT_CORS }
      );
    }
    return NextResponse.json({ success: true, deleted: true }, { headers: PATIENT_CORS });
  } catch (err) {
    return patientRouteError(err);
  }
}
