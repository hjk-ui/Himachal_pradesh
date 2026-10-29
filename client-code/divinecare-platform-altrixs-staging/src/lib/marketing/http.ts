import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessMarketing, canWorkLeads } from './access';

export type MarketingGate = { organizationId: string; userId: string; role: string; actor: { userId: string; role: string; name: string | null } };

/** Org context + role check. 'hub' = marketing roles, 'leads' = marketing roles + Front Desk. */
export async function marketingGate(scope: 'hub' | 'leads'): Promise<{ ok: true; gate: MarketingGate; res?: undefined } | { ok: false; res: NextResponse; gate?: undefined }> {
  const g = await requireOrgContext();
  if (!g.ok) return { ok: false, res: NextResponse.json({ success: false, error: g.error }, { status: g.status }) };
  const allowed = scope === 'hub' ? canAccessMarketing(g.role) : canWorkLeads(g.role);
  if (!allowed) return { ok: false, res: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  const name = (g.session.user as { name?: string | null }).name ?? null;
  return { ok: true, gate: { organizationId: g.organizationId, userId: g.userId, role: String(g.role), actor: { userId: g.userId, role: String(g.role), name } } };
}

export function ok(data: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

export function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/** Result of a service call: { ok: false, status, error } -> error response. */
export function fromResult<T extends { ok: boolean }>(r: T, onOk: (r: T) => NextResponse): NextResponse {
  if (!r.ok) {
    const e = r as unknown as { status?: number; error?: string };
    const rest = Object.fromEntries(Object.entries(r as unknown as Record<string, unknown>).filter(([k]) => !['ok', 'status', 'error'].includes(k)));
    return bad(e.error ?? 'Request failed', e.status ?? 400, rest);
  }
  return onOk(r);
}

export function serverError(tag: string, err: unknown) {
  if (err instanceof z.ZodError) return bad(err.issues[0]?.message ? `Check the form: ${err.issues[0].path.join('.')} ${err.issues[0].message}`.trim() : 'Check the form and try again.');
  const status = (err as { status?: number })?.status;
  if (status && status < 500) return bad((err as Error).message, status);
  const code = (err as { code?: string })?.code;
  console.error(`[marketing ${tag}]`, err instanceof Error ? err.message : err);
  return bad(code === 'P2021' ? 'Marketing tables are not on this database yet. Run prisma/migrations/20261022_marketing_suite.sql.' : 'Something went wrong. Please try again.', 500);
}
