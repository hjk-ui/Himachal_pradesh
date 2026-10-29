import { NextResponse } from 'next/server';
import {
  patientOptions,
  patientPost,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';
import { markAllNotificationsRead } from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

/**
 * POST /api/patient/notifications/read-all
 * Marks all notifications for the authenticated patient as read.
 */
export const POST = patientPost(async ({ ctx }) => {
  const result = await markAllNotificationsRead(ctx);
  return NextResponse.json(
    {
      success: true,
      ...result,
    },
    { headers: PATIENT_CORS }
  );
});

export const PATCH = POST;
export const PUT = POST;
