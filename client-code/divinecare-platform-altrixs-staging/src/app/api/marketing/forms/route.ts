import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listForms, saveForm } from '@/lib/marketing/hubService';
import { appBaseUrl } from '@/lib/marketing/tokens';
import { embedSnippet, hostedFormPath } from '@/lib/marketing/forms';
import { SERVICE_INTERESTS } from '@/lib/marketing/constants';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const d = await listForms(g.gate.organizationId);
    const base = appBaseUrl();
    const locations = await prisma.location.findMany({ where: { organizationId: g.gate.organizationId, active: true }, select: { name: true }, orderBy: { name: 'asc' } });
    return ok({
      ...d,
      serviceDefaults: SERVICE_INTERESTS,
      locationDefaults: locations.map((l) => l.name),
      forms: d.forms.map((f) => ({ ...f, hostedUrl: `${base}${hostedFormPath(d.orgSlug, f.slug)}`, embed: embedSnippet(base, d.orgSlug, f.slug) })),
    });
  } catch (err) {
    return serverError('forms GET', err);
  }
}

const schema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(60).optional(),
  active: z.boolean().optional(),
  fields: z.array(z.object({ key: z.string().max(40), label: z.string().max(80).optional(), required: z.boolean().optional() })).max(20),
  serviceOptions: z.array(z.string().max(80)).max(20).optional(),
  locationOptions: z.array(z.string().max(80)).max(20).optional(),
  confirmationMessage: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    return fromResult(await saveForm(g.gate.organizationId, b, g.gate.actor), (r) => ok({ formId: r.ok ? r.form.id : null }));
  } catch (err) {
    return serverError('forms POST', err);
  }
}
