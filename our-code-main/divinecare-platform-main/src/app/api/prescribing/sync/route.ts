import { drFirstRoute } from '@/lib/drfirst/http';
import { DrFirstError } from '@/lib/drfirst/errors';

export const runtime = 'nodejs';

/** Deprecated placeholder. It must never represent a local record as a DrFirst sync. */
export async function POST(req: Request) {
  return drFirstRoute(req, async () => {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  });
}
