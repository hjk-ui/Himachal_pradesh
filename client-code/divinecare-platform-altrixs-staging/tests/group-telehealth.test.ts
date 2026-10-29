/**
 * Group telehealth (one Chime room per group session, many clients):
 *  - every member gets their own token (per-person attendance; tampered / expired links refused)
 *  - invites carry no PHI, no group name and no SUD wording
 *  - Part 2 (SUD) groups show first names only by default
 *  - attendance is prefilled from video, never saved or signed automatically
 *  - only session facilitators / leadership run the room
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  HEARTBEAT_GAP_MAX_SEC,
  applyHeartbeat,
  applyJoin,
  applyLeave,
  canRunGroupVideo,
  defaultNameDisplay,
  groupInviteMessage,
  inviteLooksSafe,
  linkChannels,
  memberDisplayName,
  memberMayEnter,
  prefillAttendanceFromVideo,
  roomCapacity,
  type Presence,
} from '../src/lib/groups/video';
import { createGroupJoinToken, groupTokenExpiry, readGroupJoinToken } from '../src/lib/groups/videoToken';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ─── Per-member tokens ───────────────────────────────────────────────────────

test('each member gets their own token, bound to their participant row', () => {
  const exp = Date.now() + 60 * 60 * 1000;
  const a = createGroupJoinToken({ participantId: 'part_member_a', exp });
  const b = createGroupJoinToken({ participantId: 'part_member_b', exp });
  assert.notEqual(a, b);
  assert.equal(readGroupJoinToken(a)?.participantId, 'part_member_a');
  assert.equal(readGroupJoinToken(b)?.participantId, 'part_member_b');
  // Same member, same day → same link (Copy link and Send links agree)
  assert.equal(createGroupJoinToken({ participantId: 'part_member_a', exp }), a);
});

test('tampered, expired and 1:1-style tokens are refused', () => {
  const exp = Date.now() + 60_000;
  const t = createGroupJoinToken({ participantId: 'part_member_a', exp });
  const raw = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const forged = Buffer.from(raw.replace('part_member_a', 'part_member_b')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  assert.equal(readGroupJoinToken(forged), null);
  assert.equal(readGroupJoinToken(t, exp + 1), null, 'expired');
  assert.equal(readGroupJoinToken('short'), null);
  assert.equal(readGroupJoinToken(Buffer.from('appt:client:9999999999999:abc').toString('base64')), null);
});

test('tokens expire at the end of the session day on the practice clock', () => {
  // Oct 27 2026 is EDT (UTC-4): 23:59:59 local = 03:59:59Z next day
  assert.equal(new Date(groupTokenExpiry('2026-10-27', 'America/New_York')).toISOString(), '2026-10-28T03:59:59.000Z');
  const exp = groupTokenExpiry('2026-10-27', 'America/New_York');
  const t = createGroupJoinToken({ participantId: 'p1', exp });
  assert.ok(readGroupJoinToken(t, Date.parse('2026-10-27T22:00:00Z')));
  assert.equal(readGroupJoinToken(t, Date.parse('2026-10-28T04:00:01Z')), null);
});

test('links and rooms are per member, not one shared link', () => {
  const store = read('src/lib/groups/videoStore.ts');
  assert.match(store, /joinUrlFor\(p\.id, exp\)/, 'send links: one link per participant row');
  assert.match(store, /joinUrlFor\(part\.id,/, 'copy link: that member only');
  assert.doesNotMatch(store, /createTelehealthJoinToken/, 'no shared 1:1 appointment token');
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model ClinicalGroupVideoParticipant[\s\S]*?@@unique\(\[roomId, clientId\]\)/);
  const sql = read('prisma/migrations/20261027_group_telehealth.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS group_video_rooms/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS group_video_participants/);
  assert.doesNotMatch(sql, /ALTER TABLE\s+"?(clinical_group|Appointment|Client)/i, 'no new columns on existing tables');
});

test('room cap: members + staff, never above Chime 250', () => {
  assert.equal(roomCapacity(8, 2), 10);
  assert.equal(roomCapacity(400, 2), 250);
  assert.equal(roomCapacity(0, 2), 2);
});

test('waiting room: only admitted (or admitted then left) members enter, only while open', () => {
  assert.equal(memberMayEnter('invited', 'open'), false);
  assert.equal(memberMayEnter('waiting', 'open'), false);
  assert.equal(memberMayEnter('admitted', 'open'), true);
  assert.equal(memberMayEnter('left', 'open'), true);
  assert.equal(memberMayEnter('removed', 'open'), false);
  assert.equal(memberMayEnter('admitted', 'ended'), false);
});

// ─── Invites: no PHI / SUD wording ───────────────────────────────────────────

test('invite says only "Your telehealth session link", the time and the link', () => {
  const when = 'Tuesday, October 27, 2026 at 6:00 PM ET';
  const joinUrl = 'https://altrixs.com/telehealth/join/g/abc123';
  const m = groupInviteMessage({ when, joinUrl });
  assert.equal(m.subject, 'Your telehealth session link');
  for (const body of [m.subject, m.text, m.html, m.portal]) {
    assert.ok(inviteLooksSafe(body), body);
    assert.doesNotMatch(body, /substance|sud|iop|recovery|relapse|alcohol|drug|group|counsel|therapy|diagnos/i);
  }
  assert.ok(m.text.includes(when) && m.text.includes(joinUrl));
  assert.ok(m.portal.includes(joinUrl));
});

test('invite builder takes no name, group or clinician fields; sendLinks passes only when + link', () => {
  const store = read('src/lib/groups/videoStore.ts');
  assert.match(store, /groupInviteMessage\(\{ when, joinUrl: joinUrlFor\(p\.id, exp\) \}\)/);
  assert.equal(inviteLooksSafe('Relapse Prevention IOP'), false);
  assert.equal(inviteLooksSafe('Your telehealth session link'), true);
});

test('links go only to active members with telehealth consent; email also honors opt-out', () => {
  const base = { memberActive: true, telehealthConsentOnFile: true, email: 'a@example.com', emailOptOutAt: null };
  assert.deepEqual(linkChannels(base), { ok: true, channels: { email: true, portal: true, emailSkip: null } });
  assert.deepEqual(linkChannels({ ...base, telehealthConsentOnFile: false }), { ok: false, reason: 'no_telehealth_consent' });
  assert.deepEqual(linkChannels({ ...base, memberActive: false }), { ok: false, reason: 'not_active' });
  assert.deepEqual(linkChannels({ ...base, removed: true }), { ok: false, reason: 'removed' });
  const optedOut = linkChannels({ ...base, emailOptOutAt: new Date() });
  assert.ok(optedOut.ok && optedOut.channels.email === false && optedOut.channels.portal === true);
});

// ─── Names (Part 2) ──────────────────────────────────────────────────────────

test('Part 2 (SUD) groups default to first names only; psychotherapy to first + last initial', () => {
  assert.equal(defaultNameDisplay({ kind: 'sud' }), 'first_only');
  assert.equal(defaultNameDisplay({ kind: 'psychotherapy' }), 'first_last_initial');
  assert.equal(defaultNameDisplay({ kind: 'psychotherapy', part2: true }), 'first_only');
});

test('display names never show a full last name', () => {
  assert.equal(memberDisplayName({ name: 'Jane Doe' }, 'first_last_initial'), 'Jane D.');
  assert.equal(memberDisplayName({ name: 'Jane Doe' }, 'first_only'), 'Jane');
  assert.equal(memberDisplayName({ name: 'Doe, Jane' }, 'first_last_initial'), 'Jane D.');
  assert.equal(memberDisplayName({ name: 'Robert Smith', preferredName: 'Bobby', legalLastName: 'Smith' }, 'first_last_initial'), 'Bobby S.');
  assert.doesNotMatch(memberDisplayName({ name: 'Maria Lopez-Garcia' }, 'first_last_initial'), /Lopez/);
});

test('member join API never returns the group name', () => {
  const store = read('src/lib/groups/videoStore.ts');
  const view = store.slice(store.indexOf('async function memberView'), store.indexOf('export async function memberStatus'));
  assert.doesNotMatch(view, /group\.name|groupName|\.name\b/);
  const page = read('src/app/telehealth/join/g/[token]/page.tsx');
  assert.doesNotMatch(page, /groupName|SUD|Substance/);
});

// ─── Attendance prefill ──────────────────────────────────────────────────────

const unmarked = { status: 'unmarked', minutesAttended: null, patientLocationType: null } as const;

test('prefill: joined → present with minutes and home default; no-shows absent once the room ends', () => {
  const r = prefillAttendanceFromVideo({
    marks: { a: { ...unmarked }, b: { ...unmarked }, c: { ...unmarked } },
    video: [
      { clientId: 'a', joined: true, minutes: 52, locationType: null },
      { clientId: 'b', joined: false, minutes: 0, locationType: null },
      { clientId: 'c', joined: true, minutes: 200, locationType: 'other' },
    ],
    roomEnded: true,
    durationMinutes: 60,
  });
  assert.deepEqual(r.marks.a, { status: 'present', minutesAttended: 52, patientLocationType: 'home' });
  assert.deepEqual(r.marks.b, { status: 'absent', minutesAttended: null, patientLocationType: null });
  assert.deepEqual(r.marks.c, { status: 'present', minutesAttended: 60, patientLocationType: 'other' });
  assert.deepEqual(Object.keys(r).sort(), ['changed', 'marks'], 'returns marks only: no save, no sign');
});

test('prefill never overrides the facilitator or a signed note; room still open leaves no-shows unmarked', () => {
  const r = prefillAttendanceFromVideo({
    marks: { a: { status: 'late', minutesAttended: 30, patientLocationType: 'other' }, b: { ...unmarked }, c: { ...unmarked } },
    video: [
      { clientId: 'a', joined: true, minutes: 55, locationType: 'home' },
      { clientId: 'b', joined: false, minutes: 0, locationType: null },
      { clientId: 'c', joined: true, minutes: 40, locationType: null },
    ],
    roomEnded: false,
    durationMinutes: 60,
    lockedClientIds: ['c'],
  });
  assert.deepEqual(r.marks.a, { status: 'late', minutesAttended: 30, patientLocationType: 'other' });
  assert.equal(r.marks.b.status, 'unmarked');
  assert.equal(r.marks.c.status, 'unmarked', 'signed note: untouched');
  assert.deepEqual(r.changed, []);
});

test('the Attendance step prefill only sets local marks: no save, no sign call', () => {
  const runner = read('src/features/groups/SessionRunner.tsx');
  const block = runner.slice(runner.indexOf('const applyVideoPrefill'), runner.indexOf('const saveAttendance = async'));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /apiJson|\/sign|signNotes|saveAttendance\(/);
  const video = read('src/lib/groups/video.ts');
  assert.doesNotMatch(video, /signNotes|\/sign\b|fetch\(/);
});

test('minutes: heartbeats credit time, drops and the waiting room do not', () => {
  const t0 = new Date('2026-10-27T22:00:00Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  let p: Presence = { connected: false, lastSeenAt: null, firstJoinedAt: null, lastJoinedAt: null, totalSeconds: 0, joinCount: 0, events: [] };
  p = applyJoin(p, at(0));
  p = applyHeartbeat(p, at(10));
  p = applyHeartbeat(p, at(20));
  assert.equal(p.totalSeconds, 20);
  p = applyHeartbeat(p, at(20 + HEARTBEAT_GAP_MAX_SEC + 100)); // dropped, came back
  assert.equal(p.totalSeconds, 20);
  assert.equal(p.joinCount, 2);
  p = applyLeave(p, at(20 + HEARTBEAT_GAP_MAX_SEC + 110));
  assert.equal(p.totalSeconds, 30);
  assert.equal(p.connected, false);
  assert.deepEqual(p.events.map((e) => e.t), ['join', 'leave', 'join', 'leave']);
  const store = read('src/lib/groups/videoStore.ts');
  assert.match(store, /const inCall = ctx\.part\.state === 'admitted' && ctx\.room\.status === 'open'/);
});

// ─── Roles ───────────────────────────────────────────────────────────────────

test('only the session facilitators or leadership run the room', () => {
  const group = { facilitatorId: 'fac', coFacilitatorId: 'cofac' };
  const session = { facilitatorId: 'fac', coFacilitatorId: null };
  assert.equal(canRunGroupVideo({ role: 'THERAPIST', userId: 'fac', session, group }), true);
  assert.equal(canRunGroupVideo({ role: 'THERAPIST', userId: 'cofac', session, group }), true);
  assert.equal(canRunGroupVideo({ role: 'ADMIN', userId: 'someone', session, group }), true);
  assert.equal(canRunGroupVideo({ role: 'THERAPIST', userId: 'other', session, group }), false);
  assert.equal(canRunGroupVideo({ role: 'FRONT_DESK', userId: 'other', session, group }), false);
  assert.equal(canRunGroupVideo({ role: 'BILLING', userId: 'other', session, group }), false);
});

test('staff API is gated (group page role + facilitator) and audited; member API audits as the link holder', () => {
  const route = read('src/app/api/ehr/groups/sessions/[sessionId]/video/route.ts');
  assert.match(route, /gateSession\(sessionId\)/);
  for (const a of ['GROUP_VIDEO_START', 'GROUP_VIDEO_SEND_LINKS', 'GROUP_VIDEO_ADMIT', 'GROUP_VIDEO_REMOVE', 'GROUP_VIDEO_END']) assert.ok(route.includes(a), a);
  assert.match(route, /auditPhiAccessGroup\(/);
  const store = read('src/lib/groups/videoStore.ts');
  assert.match(store, /canRunGroupVideo\(\{ role: actor\.role, userId: actor\.userId, session: ctx\.s, group: ctx\.s\.group \}\)/);
  const member = read('src/app/api/telehealth/join/g/[token]/route.ts');
  assert.match(member, /writeAuditLog/);
  assert.match(member, /actorRole: 'PATIENT'/);
});
