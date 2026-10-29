import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { parseTelehealthCheckIn } from '@/lib/telehealth/checkIn';
import { memberCheckIn, memberJoin, memberPresence, memberStatus, type MemberCtx } from '@/lib/groups/videoStore';

export const runtime = 'nodejs';

/**
 * Group telehealth: a member's PERSONAL join link (public; the signed token is the credential).
 * GET: waiting-room status. POST { action }: check_in (consent + location) | join | heartbeat | leave.
 * Responses never carry the group name, other members' records or full names.
 */

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

function err(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

/** Link holder (the member, no portal session): ids only. Never throws. */
async function audit(req: Request, ctx: MemberCtx, action: string, metadata: Record<string, unknown> = {}) {
  await writeAuditLog({
    action,
    actorUserId: null,
    actorRole: 'PATIENT',
    organizationId: ctx.part.organizationId,
    resourceType: 'groupVideoParticipant',
    resourceId: ctx.part.id,
    patientId: ctx.part.clientId ?? null,
    ...auditRequestMeta(req),
    metadata: { via: 'group-join-link', sessionId: ctx.room.sessionId, part2: ctx.s.group.kind === 'sud', ...metadata },
  });
}

async function tokenOf(ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return decodeURIComponent(token || '');
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const r = await memberStatus(await tokenOf(ctx));
    if (r.ok === false) return err(r.status, r.error);
    return NextResponse.json({ success: true, session: r.view }, { headers: NO_STORE });
  } catch (e) {
    console.error('[telehealth/join/g] GET failed:', e instanceof Error ? e.message : e);
    return err(400, 'Could not load join link');
  }
}

const postSchema = z.object({
  action: z.enum(['check_in', 'join', 'heartbeat', 'leave']),
  ackMute: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const token = await tokenOf(ctx);
    const raw = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return err(400, 'Invalid request');
    const { action, ackMute } = parsed.data;

    if (action === 'check_in') {
      const c = parseTelehealthCheckIn(raw);
      if (c.ok === false) return NextResponse.json({ success: false, error: c.error, field: c.field }, { status: 400, headers: NO_STORE });
      const r = await memberCheckIn(token, { locationType: c.value.locationType as 'home' | 'other', locationState: c.value.locationState });
      if (r.ok === false) return err(r.status, r.error);
      await audit(req, r.ctx, 'TELEHEALTH_CHECK_IN', { consentSigned: true, fields: ['consentAt', 'locationType', 'locationState', 'checkedInAt', 'state'] });
      return NextResponse.json({ success: true, session: r.view }, { headers: NO_STORE });
    }
    if (action === 'join') {
      const r = await memberJoin(token);
      if (r.ok === false) return err(r.status, r.error);
      await audit(req, r.ctx, 'TELEHEALTH_JOIN', { provider: 'chime', demoMode: r.chime.demoMode });
      return NextResponse.json({ success: true, session: r.view, chime: r.chime }, { headers: NO_STORE });
    }
    const r = await memberPresence(token, { leave: action === 'leave', ackMute });
    if (r.ok === false) return err(r.status, r.error);
    if (action === 'leave') await audit(req, r.ctx, 'TELEHEALTH_LEAVE', {});
    return NextResponse.json({ success: true, session: r.view }, { headers: NO_STORE });
  } catch (e) {
    console.error('[telehealth/join/g] POST failed:', e instanceof Error ? e.message : e);
    return err(400, 'Could not update your session');
  }
}
