import { z } from 'zod';
import { bad, fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { convertLead } from '@/lib/marketing/leadService';
import { canConvertLeads } from '@/lib/marketing/access';
import { assertActiveClientLimit } from '@/lib/subscription/plans';

export const runtime = 'nodejs';

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  clinicianId: z.string().min(1).max(64),
  appointmentType: z.string().trim().max(80).optional(),
  isVirtual: z.boolean().optional(),
  locationId: z.string().max(64).nullable().optional(),
  confirmNewPerson: z.boolean().optional(),
});

/** POST: create the client + intake appointment through the existing client / appointment services. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  if (!canConvertLeads(g.gate.role)) return bad('Your role cannot create clients.', 403);
  try {
    const { id } = await ctx.params;
    const b = schema.parse(await req.json());
    const ent = await assertActiveClientLimit(g.gate.organizationId);
    if (!ent.ok) return bad(ent.error, 402, { upgradeRequired: true });
    const r = await convertLead(g.gate.organizationId, id, b, g.gate.actor);
    return fromResult(r, (x) => ok(x.ok ? { clientId: x.clientId, appointmentId: x.appointmentId, appointmentError: x.appointmentError } : {}));
  } catch (err) {
    return serverError('convert', err);
  }
}
