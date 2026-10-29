import { createSecondaryClaim } from '@/lib/billing/claims';
import { claimsGate, errorJson, resultJson } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: create the secondary (or tertiary) claim from an adjudicated claim. Audited in createSecondaryClaim (writeAuditLog). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await claimsGate();
  if (!g.ok) return g.response;
  try {
    const { id } = await context.params;
    return resultJson(await createSecondaryClaim(g.actor, id));
  } catch (error) {
    return errorJson(error, 'Could not create the secondary claim');
  }
}
