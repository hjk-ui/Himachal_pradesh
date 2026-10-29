import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { createTestimonial, listTestimonials, setTestimonialStatus } from '@/lib/marketing/hubService';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const testimonials = await listTestimonials(g.gate.organizationId);
    // Testimonials can be linked to a client: log the view.
    await writeAuditLog({ action: 'MARKETING_TESTIMONIAL_LIST_VIEW', actorUserId: g.gate.actor.userId, actorRole: g.gate.actor.role, organizationId: g.gate.organizationId, resourceType: 'marketing_testimonial', resourceId: null, metadata: { count: testimonials.length } }).catch(() => {});
    return ok({ testimonials });
  } catch (err) {
    return serverError('testimonials GET', err);
  }
}

const createSchema = z.object({
  quote: z.string().trim().min(5).max(2000),
  displayName: z.string().trim().min(1).max(80),
  clientId: z.string().max(64).nullable().optional(),
  authorizationSignedAt: z.string().max(40).nullable().optional(),
  authorizationExpiresAt: z.string().max(40).nullable().optional(),
  authorizationRef: z.string().trim().max(200).nullable().optional(),
  allowedChannels: z.array(z.string().max(40)).max(10).optional(),
});

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = createSchema.parse(await req.json());
    return fromResult(await createTestimonial(g.gate.organizationId, b, g.gate.actor), () => ok({}, 201));
  } catch (err) {
    return serverError('testimonials POST', err);
  }
}

export async function PATCH(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = z.object({ id: z.string().max(64), action: z.enum(['approve', 'retire', 'revoke']) }).parse(await req.json());
    return fromResult(await setTestimonialStatus(g.gate.organizationId, b.id, b.action, g.gate.actor), () => ok());
  } catch (err) {
    return serverError('testimonials PATCH', err);
  }
}
