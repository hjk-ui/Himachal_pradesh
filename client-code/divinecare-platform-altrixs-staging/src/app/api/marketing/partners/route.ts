import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listPartners, logPartnerTouch, savePartner } from '@/lib/marketing/hubService';
import { listAssignees } from '@/lib/marketing/leadService';
import { PARTNER_TYPES, TOUCH_KINDS } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const [partners, owners] = await Promise.all([listPartners(g.gate.organizationId), listAssignees(g.gate.organizationId)]);
    return ok({ partners, owners, partnerTypes: PARTNER_TYPES, touchKinds: TOUCH_KINDS });
  } catch (err) {
    return serverError('partners GET', err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().max(64).optional(),
    name: z.string().trim().min(2).max(160),
    category: z.string().trim().max(60).optional(),
    partnerType: z.string().max(40).nullable().optional(),
    ownerUserId: z.string().max(64).nullable().optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    contactEmail: z.string().trim().max(200).nullable().optional(),
    contactPhone: z.string().trim().max(40).nullable().optional(),
    status: z.enum(['active', 'prospect', 'inactive']).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({ action: z.literal('touch'), partnerId: z.string().max(64), kind: z.string().max(40), summary: z.string().trim().min(2).max(500), touchedAt: z.string().max(40).nullable().optional() }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    if (b.action === 'touch') return fromResult(await logPartnerTouch(g.gate.organizationId, b.partnerId, b, g.gate.actor), () => ok());
    return fromResult(await savePartner(g.gate.organizationId, b), () => ok());
  } catch (err) {
    return serverError('partners POST', err);
  }
}
