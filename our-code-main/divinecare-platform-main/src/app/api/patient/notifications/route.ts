import { NextResponse } from 'next/server';
import {
  parsePagination,
  patientGet,
  patientOptions,
  patientPatch,
  PATIENT_CORS,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';
import {
  listPatientNotifications,
  markAllNotificationsRead,
} from '@/patient/application/notifications/service';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/notifications
 * Returns paginated persistent notification history for the authenticated patient.
 * Query params:
 *   - page: number (1-based, default 1)
 *   - limit: number (default 20, max 100)
 *   - unreadOnly: boolean (true/false)
 */
export const GET = patientGet(async ({ req, ctx }) => {
  const url = new URL(req.url);
  const { limit, skip } = parsePagination(url, 20);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true' || url.searchParams.get('unread') === 'true';
  const type = url.searchParams.get('type')?.trim() || undefined;

  const result = await listPatientNotifications(ctx, {
    skip,
    limit,
    unreadOnly,
    type,
  });

  return NextResponse.json(
    {
      success: true,
      notifications: result.notifications,
      data: {
        notifications: result.notifications,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          hasMore: result.hasMore,
        },
        unreadCount: result.unreadCount,
      },
      total: result.total,
      unreadCount: result.unreadCount,
      unread_count: result.unread_count,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    },
    { headers: PATIENT_CORS }
  );
});

/**
 * PATCH /api/patient/notifications
 * Bulk action (e.g. { action: "read-all" })
 */
export const PATCH = patientPatch(async ({ req, ctx }) => {
  const body = (await readPatientJson(req).catch(() => ({}))) as Record<string, any>;
  if (body?.action === 'read-all' || body?.all === true) {
    const res = await markAllNotificationsRead(ctx);
    return NextResponse.json({ success: true, ...res }, { headers: PATIENT_CORS });
  }

  return NextResponse.json(
    { success: false, error: 'Unknown action' },
    { status: 400, headers: PATIENT_CORS }
  );
});
