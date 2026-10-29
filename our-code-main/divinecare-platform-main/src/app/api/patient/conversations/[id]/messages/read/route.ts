import { markPatientConversationRead } from '@/patient/application/messages/service';
import { patientOk, patientOptions, patientPatch, patientPost } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientPatch(
    async ({ ctx: patient }) => {
      const data = await markPatientConversationRead(patient, id);
      return patientOk(data);
    },
    ['patient-conversation-messages-read', 120]
  );
  return handler(req);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientPost(
    async ({ ctx: patient }) => {
      const data = await markPatientConversationRead(patient, id);
      return patientOk(data);
    },
    ['patient-conversation-messages-read-post', 120]
  );
  return handler(req);
}
