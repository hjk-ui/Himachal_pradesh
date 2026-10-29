import { z } from 'zod';
import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { handleMissedCall } from '@/lib/marketing/inboundHook';

export const runtime = 'nodejs';

/**
 * POST: record a missed call (manual today; a phone-system event feed can call handleMissedCall
 * directly once connected). Text-back only to a known lead number with SMS consent; unknown callers
 * get a call-back task, never a cold text.
 */
export async function POST(req: Request) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const b = z.object({ phone: z.string().trim().min(7).max(40) }).parse(await req.json());
    return ok(await handleMissedCall(g.gate.organizationId, b.phone));
  } catch (err) {
    return serverError('missed call', err);
  }
}
