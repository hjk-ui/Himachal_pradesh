import { z } from 'zod';
import { setFavorite } from '@/lib/resources/store';
import { errorResponse, ok, resourceGate } from '../../../_shared';

export const runtime = 'nodejs';

/** PUT { favorite }: star / unstar for the signed-in user (no PHI). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const { favorite } = z.object({ favorite: z.boolean() }).parse(await req.json());
    return ok(await setFavorite(g.actor, id, favorite));
  } catch (e) {
    return errorResponse(e, 'Could not update favorites');
  }
}
