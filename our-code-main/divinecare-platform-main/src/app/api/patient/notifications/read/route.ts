import { NextResponse } from 'next/server';
import {
  patientOptions,
  patientPost,
  PATIENT_CORS,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

/**
 * POST /api/patient/notifications/read
 * Flexible endpoint to mark a single notification or all notifications as read.
 * Body options:
 *   - { id: "string" } -> marks single notification as read
 *   - { all: true } or { action: "read-all" } -> marks all as read
 */
export const POST = patientPost(async ({ req, ctx }) => {
  const body = (await readPatientJson(req).catch(() => ({}))) as Record<string, any>;

  if (body?.all === true || body?.action === 'read-all') {
    const res = await markAllNotificationsRead(ctx);
    return NextResponse.json({ success: true, ...res }, { headers: PATIENT_CORS });
  }

  if (body?.id && typeof body.id === 'string') {
    const res = await markNotificationRead(ctx, body.id);
    if (!res) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404, headers: PATIENT_CORS }
      );
    }
    return NextResponse.json({ success: true, data: res, ...res }, { headers: PATIENT_CORS });
  }

  return NextResponse.json(
    { success: false, error: 'Provide "id" or "all: true" in request body' },
    { status: 400, headers: PATIENT_CORS }
  );
});

export const PATCH = POST;
export const PUT = POST;
