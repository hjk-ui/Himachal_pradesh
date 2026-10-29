import { NextResponse } from 'next/server';
import { listPatientMessages } from '@/patient/application/messages/service';
import {
  patientGet,
  patientOptions,
  PATIENT_CORS,
  parsePagination,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/conversations/[id]
 * Returns conversation details along with its messages.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientGet(
    async ({ req: request, ctx: patient }) => {
      const url = new URL(request.url);
      const { limit, skip } = parsePagination(url, 100);
      const before = url.searchParams.get('before') || null;
      const data = await listPatientMessages(patient, id, skip, limit, before);
      return NextResponse.json(
        {
          success: true,
          conversation: data.conversation,
          messages: data.messages,
          pagination: data.pagination,
          hasMore: data.hasMore,
          oldestMessageId: data.oldestMessageId,
          unreadCount: data.conversation?.unreadCount || 0,
          unread_count: data.conversation?.unreadCount || 0,
          unread: data.conversation?.unreadCount || 0,
          badge: data.conversation?.unreadCount || 0,
          data,
        },
        { headers: PATIENT_CORS }
      );
    },
    ['patient-conversation-detail', 120]
  );
  return handler(req);
}
