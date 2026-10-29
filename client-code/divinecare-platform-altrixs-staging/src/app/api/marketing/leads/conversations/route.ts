import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listConversations } from '@/lib/marketing/leadService';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    return ok({ conversations: await listConversations(g.gate.organizationId) });
  } catch (err) {
    return serverError('conversations', err);
  }
}
