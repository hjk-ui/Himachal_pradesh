import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canViewValantBalances } from '@/lib/billing/valantBalances';

export type ValantGate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/** Org-scoped session with billing / leadership access to Valant reference balances */
export async function requireValantBalancesGate(): Promise<{ gate: ValantGate; denied?: never } | { gate?: never; denied: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { denied: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!canViewValantBalances(gate.role)) {
    return { denied: NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 }) };
  }
  return { gate };
}

/** ?asOf=YYYY-MM-DD -> Date at noon UTC, or null for "latest" */
export function asOfParam(req: Request): Date | null {
  const v = new URL(req.url).searchParams.get('asOf');
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) : null;
}
