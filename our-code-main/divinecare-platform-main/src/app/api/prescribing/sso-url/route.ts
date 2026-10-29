import { drFirstRoute } from '@/lib/drfirst/http';
import { DrFirstError } from '@/lib/drfirst/errors';

export const runtime = 'nodejs';

/** Deprecated placeholder. Keep fail-closed until the official SSO contract is implemented. */
export async function POST(req: Request) {
  return drFirstRoute(req, async () => {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  });
}
