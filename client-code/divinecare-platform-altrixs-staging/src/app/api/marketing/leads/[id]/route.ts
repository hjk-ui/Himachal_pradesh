import { z } from 'zod';
import { bad, fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { addActivity, getLeadDetail, logCall, markConversationRead, markIntakeNoShow, updateLead } from '@/lib/marketing/leadService';
import { LEAD_STAGE_KEYS } from '@/lib/marketing/constants';
import { clinicalTermsIn } from '@/lib/marketing/leads';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const d = await getLeadDetail(g.gate.organizationId, id, g.gate.actor);
    if (!d) return bad('Lead not found.', 404);
    return ok(d);
  } catch (err) {
    return serverError('lead GET', err);
  }
}

const patchSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  source: z.string().max(40).optional(),
  sourceDetail: z.string().trim().max(200).nullable().optional(),
  partnerId: z.string().max(64).nullable().optional(),
  eventId: z.string().max(64).nullable().optional(),
  serviceInterest: z.string().trim().max(120).nullable().optional(),
  insurance: z.string().trim().max(120).nullable().optional(),
  preferredContact: z.enum(['phone', 'sms', 'email']).nullable().optional(),
  contactConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assignedToId: z.string().max(64).nullable().optional(),
  stage: z.enum(LEAD_STAGE_KEYS as [string, ...string[]]).optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
  intakeScheduledAt: z.string().max(40).nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const b = patchSchema.parse(await req.json());
    const r = await updateLead(g.gate.organizationId, id, { ...b, dateOfBirth: b.dateOfBirth === '' ? null : b.dateOfBirth }, g.gate.actor);
    return fromResult(r, () => ok());
  } catch (err) {
    return serverError('lead PATCH', err);
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('call'), outcome: z.enum(['reached', 'voicemail', 'no_answer', 'wrong_number']) }),
  z.object({ action: z.literal('no_show') }),
  z.object({ action: z.literal('note'), text: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('read') }),
]);

/** POST /api/marketing/leads/:id: log a call, mark missed intake, add a note, mark the thread read. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const b = actionSchema.parse(await req.json());
    const { organizationId, actor } = g.gate;
    if (b.action === 'call') return fromResult(await logCall(organizationId, id, b.outcome, actor), () => ok());
    if (b.action === 'no_show') return fromResult(await markIntakeNoShow(organizationId, id, actor), () => ok());
    if (b.action === 'read') {
      await markConversationRead(organizationId, id);
      return ok();
    }
    if (clinicalTermsIn(b.text).length) return bad('Keep clinical details out of lead notes (minimum necessary). Record them in the intake assessment after conversion.');
    const d = await getLeadDetail(organizationId, id);
    if (!d) return bad('Lead not found.', 404);
    await addActivity(organizationId, id, 'note', b.text, actor);
    return ok();
  } catch (err) {
    return serverError('lead POST', err);
  }
}
