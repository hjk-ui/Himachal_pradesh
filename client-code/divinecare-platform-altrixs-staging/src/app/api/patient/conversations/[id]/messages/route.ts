import { NextResponse } from 'next/server';
import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { listPatientMessages, sendPatientMessage } from '@/patient/application/messages/service';
import {
  parsePagination,
  patientGet,
  patientOptions,
  patientPost,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

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
          messages: data.messages,
          conversation: data.conversation,
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
    ['patient-messages-list', 120]
  );
  return handler(req);
}

const sendSchema = z
  .object({
    message: z.string().optional(),
    content: z.string().optional(),
    body: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((d) => !!(d.message?.trim() || d.content?.trim() || d.body?.trim() || d.text?.trim()), {
    message: 'Message cannot be empty',
  });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientPost(
    async ({ req: request, ctx: patient }) => {
      const raw = await readPatientJson(request);
      const body = sendSchema.parse(raw);
      const text = (body.message || body.content || body.body || body.text)!.trim();
      const message = await sendPatientMessage(patient, id, text);
      return NextResponse.json(
        {
          success: true,
          message,
          data: { message },
        },
        { status: 201, headers: PATIENT_CORS }
      );
    },
    ['patient-message-send', 40]
  );
  return handler(req);
}
