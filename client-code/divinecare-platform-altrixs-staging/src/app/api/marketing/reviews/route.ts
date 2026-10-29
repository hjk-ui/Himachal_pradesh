import { z } from 'zod';
import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { createReview, listReviews, listTestimonials } from '@/lib/marketing/hubService';
import { REVIEW_SOURCES } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const [reviews, testimonials] = await Promise.all([listReviews(g.gate.organizationId), listTestimonials(g.gate.organizationId)]);
    return ok({ ...reviews, testimonials, sources: REVIEW_SOURCES });
  } catch (err) {
    return serverError('reviews GET', err);
  }
}

const schema = z.object({
  source: z.string().trim().min(2).max(60),
  rating: z.number().int().min(1).max(5),
  authorName: z.string().trim().max(120).nullable().optional(),
  body: z.string().trim().max(5000).optional(),
  reviewedAt: z.string().max(40).nullable().optional(),
  locationName: z.string().trim().max(120).nullable().optional(),
  externalId: z.string().trim().max(200).nullable().optional(),
});

/** POST: add a review by hand (until Google Business Profile is connected). */
export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const r = await createReview(g.gate.organizationId, schema.parse(await req.json()), g.gate.actor);
    return ok({ reviewId: r.id }, 201);
  } catch (err) {
    return serverError('reviews POST', err);
  }
}
