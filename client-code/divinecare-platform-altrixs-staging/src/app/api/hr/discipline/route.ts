import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createDiscipline, listDiscipline } from '@/lib/hr/performance';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';
import { DISCIPLINE_TYPES } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/discipline?userId=: corrective action records. HR + leadership only. */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const userId = new URL(req.url).searchParams.get('userId') || undefined;
    const records = await listDiscipline(g.ctx.organizationId, { userId });
    await auditHr(g.ctx, req, 'READ', 'hrDiscipline', userId ?? null, { count: records.length });
    return NextResponse.json({ success: true, records, types: DISCIPLINE_TYPES });
  } catch (err) {
    return hrServerError('discipline', err);
  }
}

const bodySchema = z.object({
  userId: z.string().min(1).max(128),
  actionType: z.enum(DISCIPLINE_TYPES.map((t) => t.key) as unknown as [string, ...string[]]),
  issuedOn: z.string().trim().length(10),
  summary: z.string().trim().min(1).max(8000),
  expectations: z.string().trim().max(8000).optional().nullable(),
  sharedWithEmployee: z.boolean().default(true),
});

/** POST: record a corrective action (HR / leadership only). */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the record', 400);
  }
  try {
    const result = await createDiscipline(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrDiscipline', result.id, { staffUserId: body.userId, actionType: body.actionType, shared: body.sharedWithEmployee });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('discipline create', err);
  }
}
