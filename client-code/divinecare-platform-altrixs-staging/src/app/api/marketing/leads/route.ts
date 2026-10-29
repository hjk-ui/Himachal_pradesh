import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { createLead, listAssignees, listLeads } from '@/lib/marketing/leadService';
import { listTemplates } from '@/lib/marketing/hubService';
import { LEAD_SOURCE_KEYS, LOST_REASONS, SERVICE_INTERESTS } from '@/lib/marketing/constants';
import { getMarketingSettings } from '@/lib/marketing/settings';

export const runtime = 'nodejs';

const CLINICAL_ROLES = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP'] as const;

/** GET /api/marketing/leads: pipeline + everything the lead workspace needs (no client data). */
export async function GET(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  const { organizationId } = g.gate;
  try {
    const url = new URL(req.url);
    const [data, assignees, templates, partners, events, clinicians, locations, settings] = await Promise.all([
      listLeads(organizationId, { includeClosed: url.searchParams.get('closed') === '1', q: url.searchParams.get('q') ?? undefined }),
      listAssignees(organizationId),
      listTemplates(organizationId),
      prisma.communityPartner.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.communityEvent.findMany({ where: { organizationId }, select: { id: true, title: true, startsAt: true }, orderBy: { startsAt: 'desc' }, take: 50 }),
      prisma.user.findMany({ where: { organizationId, status: 'ACTIVE', role: { in: [...CLINICAL_ROLES] } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
      prisma.location.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      getMarketingSettings(organizationId),
    ]);
    return ok({
      ...data,
      assignees,
      templates,
      partners,
      events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString() })),
      clinicians: clinicians.map((c) => ({ id: c.id, name: c.name ?? 'Clinician', role: c.role })),
      locations,
      serviceInterests: SERVICE_INTERESTS,
      lostReasons: LOST_REASONS,
      aiSuggestions: settings.aiFeatures.suggestedReply !== false,
    });
  } catch (err) {
    return serverError('leads GET', err);
  }
}

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal('')),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  source: z.enum(LEAD_SOURCE_KEYS as [string, ...string[]]),
  sourceDetail: z.string().trim().max(200).optional().nullable(),
  partnerId: z.string().max(64).optional().nullable(),
  eventId: z.string().max(64).optional().nullable(),
  serviceInterest: z.string().trim().max(120).optional().nullable(),
  locationId: z.string().max(64).optional().nullable(),
  insurance: z.string().trim().max(120).optional().nullable(),
  preferredContact: z.enum(['phone', 'sms', 'email']).optional().nullable(),
  contactConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  assignedToId: z.string().max(64).optional().nullable(),
});

export async function POST(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const b = createSchema.parse(await req.json());
    const loc = b.locationId ? await prisma.location.findFirst({ where: { id: b.locationId, organizationId: g.gate.organizationId }, select: { id: true, name: true } }) : null;
    const r = await createLead(
      g.gate.organizationId,
      { ...b, email: b.email || null, dateOfBirth: b.dateOfBirth || null, locationId: loc?.id ?? null, locationName: loc?.name ?? null, smsConsentSource: b.smsConsent ? 'staff_recorded_verbal' : null },
      g.gate.actor,
    );
    return fromResult(r, (x) => ok({ leadId: x.ok ? x.lead.id : null, possibleClientMatch: x.ok ? x.possibleClientMatch : null, duplicateLead: x.ok ? x.duplicateLead : null }, 201));
  } catch (err) {
    return serverError('leads POST', err);
  }
}
