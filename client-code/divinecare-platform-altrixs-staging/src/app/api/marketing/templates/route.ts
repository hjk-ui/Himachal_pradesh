import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listTemplates, saveTemplate } from '@/lib/marketing/hubService';
import { TEMPLATE_TOKENS } from '@/lib/marketing/consent';
import { clinicalTermsIn } from '@/lib/marketing/leads';
import { bad } from '@/lib/marketing/http';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    return ok({ templates: await listTemplates(g.gate.organizationId), tokens: TEMPLATE_TOKENS });
  } catch (err) {
    return serverError('templates GET', err);
  }
}

const schema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(2).max(120),
  channel: z.enum(['sms', 'email']),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(4000),
  remove: z.boolean().optional(),
});

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    if (clinicalTermsIn(b.body).length) return bad('Templates cannot include clinical details.');
    return fromResult(await saveTemplate(g.gate.organizationId, b), () => ok());
  } catch (err) {
    return serverError('templates POST', err);
  }
}
