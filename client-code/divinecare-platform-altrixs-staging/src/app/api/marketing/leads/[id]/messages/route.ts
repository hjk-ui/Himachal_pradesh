import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { sendLeadMessage } from '@/lib/marketing/leadService';
import { BLOCK_REASON_TEXT, type BlockReason } from '@/lib/marketing/consent';
import { SEND_STATUS_TEXT } from '@/lib/marketing/send';

export const runtime = 'nodejs';

const schema = z.object({
  channel: z.enum(['sms', 'email']),
  body: z.string().trim().min(1).max(1600),
  subject: z.string().trim().max(200).optional().nullable(),
  templateId: z.string().max(64).optional().nullable(),
});

/** POST: text / email a lead about their inquiry (consent gate; never a fake send). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const b = schema.parse(await req.json());
    const r = await sendLeadMessage(g.gate.organizationId, id, { ...b, templateId: b.templateId?.startsWith('builtin-') ? null : b.templateId }, g.gate.actor);
    return fromResult(r, (x) => {
      const res = x.ok ? x.result : null;
      const reason = res && 'reason' in res ? String(res.reason) : null;
      const message = !res ? '' : res.status === 'blocked' ? BLOCK_REASON_TEXT[reason as BlockReason] ?? SEND_STATUS_TEXT.blocked : reason ? SEND_STATUS_TEXT[reason] ?? SEND_STATUS_TEXT[res.status] : SEND_STATUS_TEXT[res.status];
      return ok({ status: res?.status, reason, message });
    });
  } catch (err) {
    return serverError('lead message', err);
  }
}
