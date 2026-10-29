import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { syncNow } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';
import { withJobLock } from '@/lib/jobs/advisoryLock';
import { HOMEBASE_SYNC_LOCK_KEY } from '@/lib/hr/homebase/sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .optional();

/** POST /api/hr/homebase/sync: "Sync now" (read-only pull from Homebase). HR + leadership. */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return hrJsonError('Invalid dates', 400);
  const range = parsed.data?.startDate && parsed.data?.endDate ? { startDate: parsed.data.startDate, endDate: parsed.data.endDate } : undefined;
  try {
    const lock = await withJobLock(`${HOMEBASE_SYNC_LOCK_KEY}:${g.ctx.organizationId}`, () => syncNow(g.ctx.organizationId, g.ctx.userId, 'manual', range));
    if (!lock.acquired) return hrJsonError('A Homebase sync is already running. Try again in a minute.', 409);
    const out = lock.result;
    if (out.ok === false) {
      await auditHr(g.ctx, req, 'HR_HOMEBASE_SYNC', 'HomebaseSyncRun', null, { trigger: 'manual', refused: out.status }, 'FAILURE');
      return hrJsonError(out.error, out.status);
    }
    await auditHr(
      g.ctx,
      req,
      'HR_HOMEBASE_SYNC',
      'HomebaseSyncRun',
      out.result.runId,
      { trigger: 'manual', status: out.result.status, rangeStart: out.range.startDate, rangeEnd: out.range.endDate, ...out.result.counts },
      out.result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
    );
    return NextResponse.json({ success: true, ...out.result, range: out.range });
  } catch (err) {
    return homebaseServerError('sync', err);
  }
}
