import { z } from 'zod';
import {
  admit,
  endRoom,
  getVideoState,
  hostJoin,
  hostPresence,
  memberLink,
  removeParticipant,
  requestMute,
  sendLinks,
  setNameDisplay,
  startRoom,
  videoAttendance,
} from '@/lib/groups/videoStore';
import { auditPhiAccessGroup, failJson, gateSession, json, readJson } from '../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Group telehealth room for one session (src/lib/groups/videoStore.ts).
 * GET: room, roster (waiting / joined, minutes) and the attendance prefill data.
 * POST { action }: start | host_join | host_heartbeat | host_leave | admit | admit_all | mute | remove |
 *   end | name_display | send_links | copy_link. Facilitators of the session or leadership only.
 * Audit: start, link sends (counts only), admits, removes, mutes, copy link and end.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const r = await getVideoState(g.actor, sessionId);
  if (r.ok === false) return failJson(r);
  const att = await videoAttendance(g.actor, sessionId);
  await auditPhiAccessGroup(g, req, { action: 'READ', resourceType: 'groupVideoRoom', resourceId: sessionId, patientIds: r.patientIds });
  const { patientIds: _ids, ok: _ok, ...body } = r;
  void _ids;
  void _ok;
  return json(200, { success: true, ...body, attendance: att.ok ? { hasRoom: att.hasRoom, roomEnded: att.roomEnded, rows: att.rows } : null });
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('host_join') }),
  z.object({ action: z.literal('host_heartbeat') }),
  z.object({ action: z.literal('host_leave') }),
  z.object({ action: z.literal('admit'), participantId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('admit_all') }),
  z.object({ action: z.literal('mute'), participantId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('remove'), participantId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('end') }),
  z.object({ action: z.literal('name_display'), mode: z.enum(['first_last_initial', 'first_only']) }),
  z.object({ action: z.literal('send_links') }),
  z.object({ action: z.literal('copy_link'), participantId: z.string().min(1).max(64) }),
]);

export async function POST(req: Request, ctx: Ctx) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const b = body.data;
  const audit = (action: string, metadata: Record<string, unknown>, patientIds: string[] = []) =>
    auditPhiAccessGroup(g, req, { action, resourceType: 'groupVideoRoom', resourceId: sessionId, patientIds, metadata });

  switch (b.action) {
    case 'start': {
      const r = await startRoom(g.actor, sessionId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_START', { reused: r.reused, members: r.memberCount });
      return json(200, { success: true, reused: r.reused });
    }
    case 'host_join': {
      const r = await hostJoin(g.actor, sessionId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_HOST_JOIN', { demoMode: r.demoMode });
      const { ok: _ok, ...rest } = r;
      void _ok;
      return json(200, { success: true, ...rest });
    }
    case 'host_heartbeat':
    case 'host_leave': {
      const r = await hostPresence(g.actor, sessionId, b.action === 'host_leave');
      if (r.ok === false) return failJson(r);
      if (b.action === 'host_leave') await audit('GROUP_VIDEO_HOST_LEAVE', {});
      return json(200, { success: true, labels: r.labels, roomOpen: r.roomOpen });
    }
    case 'admit':
    case 'admit_all': {
      const r = await admit(g.actor, sessionId, b.action === 'admit_all' ? 'all' : b.participantId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_ADMIT', { admitted: r.admitted, all: b.action === 'admit_all' }, r.patientIds);
      return json(200, { success: true, admitted: r.admitted });
    }
    case 'mute': {
      const r = await requestMute(g.actor, sessionId, b.participantId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_MUTE', {}, r.patientIds);
      return json(200, { success: true });
    }
    case 'remove': {
      const r = await removeParticipant(g.actor, sessionId, b.participantId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_REMOVE', {}, r.patientIds);
      return json(200, { success: true });
    }
    case 'end': {
      const r = await endRoom(g.actor, sessionId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_END', { closedConnections: r.closed });
      return json(200, { success: true });
    }
    case 'name_display': {
      const r = await setNameDisplay(g.actor, sessionId, b.mode);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_NAME_DISPLAY', { mode: b.mode });
      return json(200, { success: true });
    }
    case 'send_links': {
      const r = await sendLinks(g.actor, sessionId);
      if (r.ok === false) return failJson(r);
      // Counts only: no addresses, no link text
      await audit('GROUP_VIDEO_SEND_LINKS', { emailed: r.emailed, portal: r.portal, skipped: r.skipped, emailFailed: r.emailFailed, reasons: r.reasons }, r.patientIds);
      return json(200, { success: true, emailed: r.emailed, portal: r.portal, skipped: r.skipped, emailFailed: r.emailFailed, reasons: r.reasons });
    }
    case 'copy_link': {
      const r = await memberLink(g.actor, sessionId, b.participantId);
      if (r.ok === false) return failJson(r);
      await audit('GROUP_VIDEO_COPY_LINK', {}, r.patientIds);
      return json(200, { success: true, url: r.url });
    }
  }
}
