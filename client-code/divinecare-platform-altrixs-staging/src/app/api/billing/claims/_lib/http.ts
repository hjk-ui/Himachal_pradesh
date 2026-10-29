import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import type { ClaimActor } from '@/lib/billing/claims';

/** Billing claims gate (same path rule as the Claims page) -> actor, or the error response. */
export async function claimsGate(path = '/dashboard/billing/claims') {
  const gate = await requireClinicalContext(path);
  if (!gate.ok) return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  const actor: ClaimActor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  return { ok: true as const, gate, actor };
}

/** Maps a thrown error to a JSON response (validation errors -> 400 with the first message). */
export function errorJson(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ success: false, error: error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  console.error(`[billing claims] ${fallback}:`, error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

/** Lib result ({ ok: true, ...data } | { ok: false, error, status }) -> JSON response. */
export function resultJson(result: { ok: boolean } & Record<string, unknown>) {
  if (!result.ok) {
    return NextResponse.json({ success: false, error: String(result.error) }, { status: Number(result.status) || 400 });
  }
  const { ok: _ok, ...rest } = result;
  void _ok;
  return NextResponse.json({ success: true, ...rest });
}
