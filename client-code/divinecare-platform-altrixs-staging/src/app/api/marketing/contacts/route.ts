import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { createContact, listContacts, updateContact } from '@/lib/marketing/hubService';
import { CONTACT_KINDS } from '@/lib/marketing/constants';
import { hasSudTerm } from '@/lib/marketing/segments';
import { bad } from '@/lib/marketing/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const contacts = await listContacts(g.gate.organizationId);
    // List can include client-linked (authorized) contacts: log the view.
    await writeAuditLog({ action: 'MARKETING_CONTACT_LIST_VIEW', actorUserId: g.gate.actor.userId, actorRole: g.gate.actor.role, organizationId: g.gate.organizationId, resourceType: 'marketing_contact', resourceId: null, metadata: { count: contacts.length } }).catch(() => {});
    return ok({ contacts, kinds: CONTACT_KINDS });
  } catch (err) {
    return serverError('contacts GET', err);
  }
}

const createSchema = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  kind: z.enum(CONTACT_KINDS.map((k) => k.key) as [string, ...string[]]),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  partnerId: z.string().max(64).nullable().optional(),
  emailConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  clientId: z.string().max(64).nullable().optional(),
});

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = createSchema.parse(await req.json());
    if ((b.tags ?? []).some(hasSudTerm)) return bad('Tags cannot describe substance use (42 CFR Part 2).');
    if (b.kind !== 'client_authorized' && b.name.length < 2) return bad('Enter a name.');
    return fromResult(await createContact(g.gate.organizationId, { ...b, email: b.email || null }, g.gate.actor), () => ok({}, 201));
  } catch (err) {
    return serverError('contacts POST', err);
  }
}

const patchSchema = z.object({
  id: z.string().max(64),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  emailConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  emailOptOut: z.boolean().optional(),
  smsOptOut: z.boolean().optional(),
  remove: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = patchSchema.parse(await req.json());
    if ((b.tags ?? []).some(hasSudTerm)) return bad('Tags cannot describe substance use (42 CFR Part 2).');
    return fromResult(await updateContact(g.gate.organizationId, b.id, b), () => ok());
  } catch (err) {
    return serverError('contacts PATCH', err);
  }
}
