import { NextResponse } from 'next/server';
import {
  patientGet,
  patientOptions,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';
import { getUnreadNotificationCount } from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/notifications/unread-count
 * Returns total unread notification count for the authenticated patient.
 */
export const GET = patientGet(async ({ ctx }) => {
  const count = await getUnreadNotificationCount(ctx);
  return NextResponse.json(
    {
      success: true,
      unreadCount: count,
      unread_count: count,
      count,
    },
    { headers: PATIENT_CORS }
  );
});
