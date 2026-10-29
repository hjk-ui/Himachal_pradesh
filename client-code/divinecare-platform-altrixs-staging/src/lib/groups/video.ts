/**
 * Group telehealth (one Chime video room per group session, many clients). Pure and browser-safe:
 * no Prisma, no React, no secrets. Server side: src/lib/groups/videoStore.ts; tokens:
 * src/lib/groups/videoToken.ts.
 *
 * Rules (clinical director / Part 2):
 *   - One Chime meeting per group session. Facilitator and co-facilitator join as hosts.
 *   - Every member gets their OWN join link (token bound to that member's participant row): attendance
 *     is per person and a forwarded link admits nobody new (removed = refused, one row per member).
 *   - Links expire at the end of the session day (practice clock), like 1:1 links.
 *   - Room size cap = members + staff, never above Chime's 250.
 *   - Other members see first name + last initial; the facilitator can switch to first names only.
 *     SUD (42 CFR Part 2) groups default to first names only.
 *   - Invites say "Your telehealth session link" + time + link: no PHI, no group name, nothing that
 *     reveals substance use treatment.
 *   - Video joins / leaves PREFILL the attendance step; the facilitator reviews and saves. Nothing is
 *     ever signed automatically.
 */
import { canDocumentSession, type GroupStaffRef } from './access';

/** Chime SDK meeting attendee limit. */
export const CHIME_MAX_ATTENDEES = 250;

export const NAME_DISPLAY_MODES = ['first_last_initial', 'first_only'] as const;
export type NameDisplayMode = (typeof NAME_DISPLAY_MODES)[number];

export function isNameDisplayMode(v: unknown): v is NameDisplayMode {
  return v === 'first_last_initial' || v === 'first_only';
}

/** Part 2 (SUD) groups default to first names only; psychotherapy groups to first name + last initial. */
export function defaultNameDisplay(input: { kind: string; part2?: boolean | null }): NameDisplayMode {
  return input.kind === 'sud' || input.part2 ? 'first_only' : 'first_last_initial';
}

export type NameSource = {
  name?: string | null;
  preferredName?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
};

function firstToken(s: string | null | undefined): string {
  return String(s ?? '').trim().split(/\s+/)[0] ?? '';
}

/** What OTHER participants see on a member's video tile. Never the full name. */
export function memberDisplayName(c: NameSource, mode: NameDisplayMode): string {
  const full = String(c.name ?? '').trim();
  // "Last, First" (Valant style) → first is after the comma
  const commaFirst = full.includes(',') ? firstToken(full.split(',')[1]) : '';
  const first = firstToken(c.preferredName) || firstToken(c.legalFirstName) || commaFirst || firstToken(full) || 'Member';
  if (mode === 'first_only') return first;
  const lastRaw = String(c.legalLastName ?? '').trim() || (full.includes(',') ? full.split(',')[0].trim() : full.split(/\s+/).slice(1).pop() ?? '');
  const initial = lastRaw.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/** Staff tile label: first name + last initial and the role in the room. */
export function staffDisplayName(name: string | null | undefined, role: 'facilitator' | 'co-facilitator' | 'staff'): string {
  const label = memberDisplayName({ name }, 'first_last_initial');
  const suffix = role === 'facilitator' ? 'Facilitator' : role === 'co-facilitator' ? 'Co-facilitator' : 'Staff';
  return `${label} (${suffix})`;
}

/** Duplicate labels get a number so two "Mike"s stay distinguishable. */
export function disambiguateLabels<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.label) ?? 0) + 1;
    seen.set(r.label, n);
    return n === 1 ? r : { ...r, label: `${r.label} ${n}` };
  });
}

/** Max attendees in one group room: active members + staff (facilitator, co-facilitator), capped at 250. */
export function roomCapacity(memberCount: number, staffCount = 2): number {
  return Math.max(1, Math.min(CHIME_MAX_ATTENDEES, Math.max(0, memberCount) + Math.max(1, staffCount)));
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/** Start / admit / mute / remove / end / send links: the session's facilitators or leadership (same as taking attendance). */
export function canRunGroupVideo(input: { role: string; userId: string; session: GroupStaffRef; group: GroupStaffRef }): boolean {
  return canDocumentSession(input);
}

// ─── Participant state ──────────────────────────────────────────────────────

export const PARTICIPANT_STATES = ['invited', 'waiting', 'admitted', 'left', 'removed'] as const;
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

/** May a member (by their own link) get a Chime attendee now? Waiting room until admitted. */
export function memberMayEnter(state: string, roomStatus: string): boolean {
  if (roomStatus !== 'open') return false;
  return state === 'admitted' || state === 'left';
}

// ─── Presence and minutes (heartbeat accounting) ────────────────────────────

/** A heartbeat gap above this is a drop: the gap is not credited as attended time. */
export const HEARTBEAT_GAP_MAX_SEC = 45;
const MAX_EVENTS = 60;

export type PresenceEvent = { t: 'join' | 'leave'; at: string };
export type Presence = {
  connected: boolean;
  lastSeenAt: Date | null;
  firstJoinedAt: Date | null;
  lastJoinedAt: Date | null;
  totalSeconds: number;
  joinCount: number;
  events: PresenceEvent[];
};

function pushEvent(events: PresenceEvent[], e: PresenceEvent): PresenceEvent[] {
  const next = [...events, e];
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

function gapSec(from: Date | null, now: Date): number {
  return from ? Math.max(0, (now.getTime() - from.getTime()) / 1000) : Infinity;
}

export function applyJoin(p: Presence, now: Date): Presence {
  if (p.connected && gapSec(p.lastSeenAt, now) <= HEARTBEAT_GAP_MAX_SEC) return applyHeartbeat(p, now);
  let events = p.events;
  if (p.connected && p.lastSeenAt) events = pushEvent(events, { t: 'leave', at: p.lastSeenAt.toISOString() });
  return {
    ...p,
    connected: true,
    lastSeenAt: now,
    lastJoinedAt: now,
    firstJoinedAt: p.firstJoinedAt ?? now,
    joinCount: p.joinCount + 1,
    events: pushEvent(events, { t: 'join', at: now.toISOString() }),
  };
}

export function applyHeartbeat(p: Presence, now: Date): Presence {
  if (!p.connected) return applyJoin(p, now);
  const gap = gapSec(p.lastSeenAt, now);
  if (gap > HEARTBEAT_GAP_MAX_SEC) return applyJoin({ ...p }, now);
  return { ...p, lastSeenAt: now, totalSeconds: p.totalSeconds + Math.round(gap) };
}

export function applyLeave(p: Presence, now: Date): Presence {
  if (!p.connected) return p;
  const gap = gapSec(p.lastSeenAt, now);
  const credited = gap <= HEARTBEAT_GAP_MAX_SEC ? Math.round(gap) : 0;
  const at = gap <= HEARTBEAT_GAP_MAX_SEC ? now : p.lastSeenAt ?? now;
  return { ...p, connected: false, lastSeenAt: at, totalSeconds: p.totalSeconds + credited, events: pushEvent(p.events, { t: 'leave', at: at.toISOString() }) };
}

export function isConnectedNow(p: Pick<Presence, 'connected' | 'lastSeenAt'>, now: Date): boolean {
  return p.connected && gapSec(p.lastSeenAt, now) <= HEARTBEAT_GAP_MAX_SEC;
}

export function minutesInRoom(totalSeconds: number): number {
  return Math.round(Math.max(0, totalSeconds) / 60);
}

// ─── Attendance prefill (never signs) ───────────────────────────────────────

export type PrefillMark = { status: string; minutesAttended: number | null; patientLocationType: 'home' | 'other' | null };
export type VideoAttendance = { clientId: string; joined: boolean; minutes: number; locationType: 'home' | 'other' | null };

/**
 * Prefill the Attendance step from video data. Only UNMARKED members (not signed) are changed,
 * plus marks an earlier prefill set that the facilitator has not touched (refreshClientIds):
 *   joined                      → present, minutes in the room (1..scheduled), location answered at check-in or "home"
 *   never joined, room ended    → absent
 *   never joined, room open     → left unmarked
 * Attended members whose telehealth location is blank get the video answer (or "home").
 * The facilitator reviews and saves; this returns marks only and never signs anything.
 */
export function prefillAttendanceFromVideo(input: {
  marks: Record<string, PrefillMark>;
  video: VideoAttendance[];
  roomEnded: boolean;
  durationMinutes: number;
  lockedClientIds?: Iterable<string>;
  /** Marks this prefill set earlier and the facilitator has not edited: refreshed like unmarked ones */
  refreshClientIds?: Iterable<string>;
}): { marks: Record<string, PrefillMark>; changed: string[] } {
  const locked = new Set(input.lockedClientIds ?? []);
  const refresh = new Set(input.refreshClientIds ?? []);
  const byClient = new Map(input.video.map((v) => [v.clientId, v]));
  const out: Record<string, PrefillMark> = { ...input.marks };
  const changed: string[] = [];
  for (const [clientId, mark] of Object.entries(input.marks)) {
    if (locked.has(clientId)) continue;
    const v = byClient.get(clientId);
    if (!v) continue;
    const location = v.locationType ?? 'home';
    if (mark.status === 'unmarked' || refresh.has(clientId)) {
      if (v.joined) {
        const minutes = Math.min(Math.max(1, input.durationMinutes || 1), Math.max(1, Math.round(v.minutes)));
        out[clientId] = { status: 'present', minutesAttended: minutes, patientLocationType: location };
        changed.push(clientId);
      } else if (input.roomEnded) {
        out[clientId] = { status: 'absent', minutesAttended: null, patientLocationType: null };
        changed.push(clientId);
      }
      continue;
    }
    const attended = mark.status === 'present' || mark.status === 'late' || mark.status === 'left_early';
    if (attended && v.joined && !mark.patientLocationType) {
      out[clientId] = { ...mark, patientLocationType: location };
      changed.push(clientId);
    }
  }
  return { marks: out, changed };
}

// ─── Invites (no PHI, no group name) ────────────────────────────────────────

/** Words that must never appear in a group telehealth invite (would disclose SUD treatment or the group). */
export const INVITE_FORBIDDEN = /\b(substance|sud|addiction|alcohol|drug|opioid|recovery|iop|intensive outpatient|relapse|sobriety|detox|methadone|suboxone|group|counsel(?:ing|or)|therapy|psychotherapy|diagnos\w*|treatment|42 cfr|part 2)\b/i;

export function inviteLooksSafe(text: string): boolean {
  return !INVITE_FORBIDDEN.test(text);
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Email / portal text for a member's personal link. `when` is "Monday, October 27, 2026 at 6:00 PM ET".
 * Deliberately generic: no client name, no clinician, no group or program name.
 */
export function groupInviteMessage(input: { when: string; joinUrl: string }): { subject: string; text: string; html: string; portal: string } {
  const subject = 'Your telehealth session link';
  const text = [
    'Hello,',
    '',
    `Your telehealth session link for ${input.when}:`,
    input.joinUrl,
    '',
    'This link is only for you. Please do not share it.',
    '',
    'If you did not expect this message, contact the clinic.',
  ].join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;color:#5C2D91">Your telehealth session link</h2>
      <p style="margin:0 0 12px;color:#475569">Your session is at <strong>${esc(input.when)}</strong>.</p>
      <p style="margin:0 0 20px">
        <a href="${esc(input.joinUrl)}" style="display:inline-block;background:#5C2D91;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Join session</a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#5C2D91">${esc(input.joinUrl)}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#475569">This link is only for you. Please do not share it.</p>
      <p style="margin:0;font-size:12px;color:#94a3b8">If you did not expect this email, contact the clinic.</p>
    </div>
  `;
  const portal = `Your telehealth session link for ${input.when}: ${input.joinUrl}\nThis link is only for you. Please do not share it.`;
  return { subject, text, html, portal };
}

// ─── Link sending eligibility (consent gates) ───────────────────────────────

export type LinkSkipReason = 'not_active' | 'no_telehealth_consent' | 'removed';
export type LinkChannels = { email: boolean; portal: boolean; emailSkip: 'no_email' | 'email_opted_out' | null };

/**
 * Which channels a member's link may go out on. Telehealth consent must be on file (consent library
 * 'telehealth-consent'); email also needs an email on file and no email opt-out (same rule as
 * reminder emails). The portal message has no extra gate. SMS is not used (registration pending).
 */
export function linkChannels(input: {
  memberActive: boolean;
  removed?: boolean;
  telehealthConsentOnFile: boolean;
  email: string | null | undefined;
  emailOptOutAt: Date | string | null | undefined;
}): { ok: true; channels: LinkChannels } | { ok: false; reason: LinkSkipReason } {
  if (input.removed) return { ok: false, reason: 'removed' };
  if (!input.memberActive) return { ok: false, reason: 'not_active' };
  if (!input.telehealthConsentOnFile) return { ok: false, reason: 'no_telehealth_consent' };
  const emailSkip = input.emailOptOutAt ? ('email_opted_out' as const) : !String(input.email ?? '').trim() ? ('no_email' as const) : null;
  return { ok: true, channels: { email: emailSkip === null, portal: true, emailSkip } };
}

export const LINK_SKIP_TEXT: Record<LinkSkipReason | 'no_email' | 'email_opted_out', string> = {
  not_active: 'not an active member',
  no_telehealth_consent: 'no telehealth consent on file',
  removed: 'removed from this room',
  no_email: 'no email on file (portal message only)',
  email_opted_out: 'opted out of email (portal message only)',
};
