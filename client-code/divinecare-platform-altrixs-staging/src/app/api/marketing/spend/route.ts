import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { addSpend, deleteSpend } from '@/lib/marketing/hubService';

export const runtime = 'nodejs';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), channel: z.string().trim().min(2).max(60), month: z.string().regex(/^\d{4}-\d{2}$/), amountCents: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(200).nullable().optional() }),
  z.object({ action: z.literal('delete'), id: z.string().max(64) }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    if (b.action === 'delete') return fromResult(await deleteSpend(g.gate.organizationId, b.id), () => ok());
    return fromResult(await addSpend(g.gate.organizationId, b, g.gate.actor), () => ok({}, 201));
  } catch (err) {
    return serverError('spend', err);
  }
}
