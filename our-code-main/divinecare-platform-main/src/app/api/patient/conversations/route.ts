import { NextResponse } from 'next/server';
import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { createPatientConversation, listPatientConversations } from '@/patient/application/messages/service';
import {
  patientGet,
  patientOptions,
  patientPost,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ ctx }) => {
    const conversations = await listPatientConversations(ctx);
    const totalUnread = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    return NextResponse.json(
      {
        success: true,
        conversations,
        unreadCount: totalUnread,
        unread_count: totalUnread,
        unread: totalUnread,
        badge: totalUnread,
        count: totalUnread,
        data: {
          conversations,
          unreadCount: totalUnread,
          unread_count: totalUnread,
          unread: totalUnread,
          badge: totalUnread,
          count: totalUnread,
        },
      },
      { headers: PATIENT_CORS }
    );
  },
  ['patient-conversations', 60]
);

const createSchema = z
  .object({
    topic: z.enum(['general', 'scheduling', 'billing', 'clinical', 'rx-refill']).optional(),
    message: z.string().optional(),
    content: z.string().optional(),
    body: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((d) => !!(d.message?.trim() || d.content?.trim() || d.body?.trim() || d.text?.trim()), {
    message: 'Message cannot be empty',
  });

export const POST = patientPost(
  async ({ req, ctx }) => {
    const raw = (await readPatientJson(req)) as Record<string, unknown>;
    const body = createSchema.parse(raw);
    const text = (body.message || body.content || body.body || body.text)!.trim();
    const conversation = await createPatientConversation(ctx, { topic: body.topic, message: text });
    return NextResponse.json(
      {
        success: true,
        conversation,
        data: { conversation },
      },
      { status: 201, headers: PATIENT_CORS }
    );
  },
  ['patient-conversation-create', 30]
);
