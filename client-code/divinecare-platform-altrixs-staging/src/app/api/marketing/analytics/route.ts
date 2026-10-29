import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { analytics, listSpend } from '@/lib/marketing/hubService';

export const runtime = 'nodejs';

/** GET: attribution analytics (counts and rates; client-linked breakdown cells small-cell suppressed). */
export async function GET(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 90));
    const [a, spend] = await Promise.all([analytics(g.gate.organizationId, days), listSpend(g.gate.organizationId)]);
    return ok({ ...a, spend });
  } catch (err) {
    return serverError('analytics', err);
  }
}
