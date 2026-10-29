/**
 * Staff API gate for measures (server): the assessments page roles, else the MBC page roles (same
 * as GET /api/clinical/assessments). One-client calls also enforce the Part 2 / VIP lock.
 */
import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { MeasureError, type StaffScope } from './staffViews';

export async function measureGate(clientId?: string | null): Promise<{ ok: true; scope: StaffScope } | { ok: false; response: NextResponse }> {
  const one = { clientId: clientId ?? null };
  let gate = await requireClinicalContext('/dashboard/ehr/assessments', one);
  if (!gate.ok && gate.status === 403 && gate.error === 'Forbidden') gate = await requireClinicalContext('/dashboard/mbc', one);
  if (!gate.ok) return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  return { ok: true, scope: { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role), clientWhere: gate.clientWhere } };
}

export function measureError(err: unknown, fallback: string) {
  if (err instanceof MeasureError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
  console.error(`[measures] ${fallback}:`, err instanceof Error ? err.message : 'error');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
