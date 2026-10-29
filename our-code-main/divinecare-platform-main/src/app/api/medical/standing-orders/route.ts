import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  listStandingOrders,
  updateStandingOrderStatus,
} from '@/lib/medical/standing-orders';

export const runtime = 'nodejs';

const LEADERSHIP = new Set([
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'PHYSICIAN',
]);

export async function GET() {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const orders = await listStandingOrders(gate.organizationId);
  return NextResponse.json({ success: true, orders });
}

const patchSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['draft', 'approved', 'retired']),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Approve: verified Medical Director / physician leadership only
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Medical Director / leadership can approve standing orders' },
      { status: 403 }
    );
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid standing order update' }, { status: 400 });
  }
  const result = await updateStandingOrderStatus(
    gate.organizationId,
    parsed.data.orderId,
    parsed.data.status,
    gate.userId
  );
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: 404 });
  }
  return NextResponse.json({ success: true, orders: result.orders });
}
