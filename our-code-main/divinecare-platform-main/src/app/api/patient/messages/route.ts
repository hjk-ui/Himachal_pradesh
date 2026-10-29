import { NextResponse } from 'next/server';
import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import {
  listPatientConversations,
  listPatientMessages,
  sendPatientMessage,
  createPatientConversation,
} from '@/patient/application/messages/service';
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

/**
 * GET /api/patient/messages
 * Fallback endpoint: returns messages for a given threadId or for the patient's active conversation.
 */
export const GET = patientGet(
  async ({ req, ctx }) => {
    const url = new URL(req.url);
    let threadId = url.searchParams.get('threadId') || url.searchParams.get('conversationId');

    if (!threadId) {
      const convos = await listPatientConversations(ctx);
      if (convos.length > 0) {
        threadId = convos[0]!.id;
      }
    }

    if (!threadId) {
      return NextResponse.json(
        {
          success: true,
          messages: [],
          conversation: null,
          data: { messages: [], conversation: null },
        },
        { headers: PATIENT_CORS }
      );
    }

    const { limit, skip } = parsePagination(url, 100);
    const data = await listPatientMessages(ctx, threadId, skip, limit);

    return NextResponse.json(
      {
        success: true,
        messages: data.messages,
        conversation: data.conversation,
        pagination: data.pagination,
        unreadCount: data.conversation?.unreadCount || 0,
        unread_count: data.conversation?.unreadCount || 0,
        unread: data.conversation?.unreadCount || 0,
        badge: data.conversation?.unreadCount || 0,
        data,
      },
      { headers: PATIENT_CORS }
    );
  },
  ['patient-messages-root', 120]
);

const sendSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    message: z.string().optional(),
    content: z.string().optional(),
    body: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((d) => !!(d.message?.trim() || d.content?.trim() || d.body?.trim() || d.text?.trim()), {
    message: 'Message cannot be empty',
  });

/**
 * POST /api/patient/messages
 * Sends a message to the specified thread or to the patient's active conversation.
 */
export const POST = patientPost(
  async ({ req, ctx }) => {
    const raw = (await readPatientJson(req)) as Record<string, unknown>;
    const parsed = sendSchema.parse(raw);
    const text = (parsed.message || parsed.content || parsed.body || parsed.text)!.trim();

    let threadId = parsed.threadId || parsed.conversationId;

    if (!threadId) {
      const convos = await listPatientConversations(ctx);
      if (convos.length > 0) {
        threadId = convos[0]!.id;
      }
    }

    if (!threadId) {
      const convo = await createPatientConversation(ctx, { message: text });
      return NextResponse.json(
        {
          success: true,
          conversation: convo,
          data: { conversation: convo },
        },
        { status: 201, headers: PATIENT_CORS }
      );
    }

    const message = await sendPatientMessage(ctx, threadId, text);
    return NextResponse.json(
      {
        success: true,
        message,
        data: { message },
      },
      { status: 201, headers: PATIENT_CORS }
    );
  },
  ['patient-messages-send-root', 40]
);
