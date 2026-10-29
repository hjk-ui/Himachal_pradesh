import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listEvents, listRegistrations, setAttendance, updateEventMarketing } from '@/lib/marketing/hubService';
import { appBaseUrl } from '@/lib/marketing/tokens';

export const runtime = 'nodejs';

/** GET: events with registration / attendance / ROI fields; ?eventId= adds that event's registrations. */
export async function GET(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const eventId = new URL(req.url).searchParams.get('eventId');
    const [events, org] = await Promise.all([listEvents(g.gate.organizationId), prisma.organization.findUnique({ where: { id: g.gate.organizationId }, select: { slug: true } })]);
    const base = appBaseUrl();
    return ok({
      events: events.map((e) => ({ ...e, publicUrl: e.registrationSlug && org ? `${base}/p/${org.slug}/events/${e.registrationSlug}` : null })),
      registrations: eventId ? await listRegistrations(g.gate.organizationId, eventId) : [],
    });
  } catch (err) {
    return serverError('events GET', err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), id: z.string().max(64), registrationOpen: z.boolean().optional(), registrationSlug: z.string().trim().max(60).nullable().optional(), costCents: z.number().int().min(0).max(100_000_000).optional(), attendedCount: z.number().int().min(0).max(100000).optional() }),
  z.object({ action: z.literal('attendance'), registrationId: z.string().max(64), attended: z.boolean() }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    if (b.action === 'attendance') return fromResult(await setAttendance(g.gate.organizationId, b.registrationId, b.attended), () => ok());
    return fromResult(await updateEventMarketing(g.gate.organizationId, b.id, b), () => ok());
  } catch (err) {
    return serverError('events POST', err);
  }
}
