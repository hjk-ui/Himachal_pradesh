import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exclusionBoard, recordExclusionChecks } from '@/lib/hr/compliance';
import { EXCLUSION_SOURCES, EXCLUSION_SOURCE_KEYS } from '@/lib/hr/standard';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET /api/hr/exclusions: last check per staff per list and the next due date (monthly default). */
export async function GET(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const board = await exclusionBoard(g.ctx.organizationId);
    await auditHr(g.ctx, req, 'LIST', 'hrExclusionBoard', null, { rows: board.rows.length });
    return NextResponse.json({
      success: true,
      ...board,
      sources: EXCLUSION_SOURCES,
      automation: 'Checks are recorded by staff. An automated monthly screening feed is a future integration.',
    });
  } catch (err) {
    return hrServerError('exclusions', err);
  }
}

const bodySchema = z.object({
  userIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  sources: z.array(z.enum(EXCLUSION_SOURCE_KEYS as unknown as [string, ...string[]])).min(1),
  checkedOn: z.string().trim().length(10),
  result: z.enum(['clear', 'possible_match', 'match']),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/hr/exclusions: record checks (append-only; one person, or a monthly batch of clear results). */
export async function POST(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the exclusion check details', 400);
  }
  try {
    const result = await recordExclusionChecks(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrExclusionCheck', null, {
      count: result.count,
      sources: body.sources,
      result: body.result,
      staffCount: body.userIds.length,
    });
    return NextResponse.json({ success: true, count: result.count }, { status: 201 });
  } catch (err) {
    return hrServerError('exclusion record', err);
  }
}
