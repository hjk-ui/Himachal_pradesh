import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addLedgerEntry, balancesFor, ledgerFor } from '@/lib/hr/timeOff';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/time-off/ledger?userId=: balance history (HR / leadership, or your own). */
export async function GET(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const userId = new URL(req.url).searchParams.get('userId') || g.ctx.userId;
  if (userId !== g.ctx.userId && !isHrAdminRole(g.ctx.role)) return hrJsonError('Forbidden', 403);
  try {
    const [ledger, balances] = await Promise.all([ledgerFor(g.ctx.organizationId, userId), balancesFor(g.ctx.organizationId, [userId])]);
    return NextResponse.json({ success: true, ledger, balance: balances[userId] ?? { pto: 0, sick: 0 } });
  } catch (err) {
    return hrServerError('ledger', err);
  }
}

const bodySchema = z.object({
  userId: z.string().min(1).max(128),
  bucket: z.enum(['pto', 'sick']),
  entryType: z.enum(['accrual', 'adjustment', 'carryover']),
  hours: z.number().min(-2000).max(2000).optional().nullable(),
  hoursWorked: z.number().min(0).max(5000).optional().nullable(),
  effectiveOn: z.string().trim().length(10),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST: HR records an accrual (sick from hours worked uses the HR policy setting; PTO per pay
 * period from the PTO policy), an adjustment or a carryover.
 */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the entry', 400);
  }
  try {
    const result = await addLedgerEntry(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrTimeOffLedger', result.id, { staffUserId: body.userId, bucket: body.bucket, entryType: body.entryType, hours: result.hours });
    return NextResponse.json({ success: true, hours: result.hours }, { status: 201 });
  } catch (err) {
    return hrServerError('ledger add', err);
  }
}
