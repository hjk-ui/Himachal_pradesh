/**
 * Campaign audience segments (pure). Only non-clinical attributes: contact kind, tags, partner
 * type, event attendance, signup source / date. Never diagnoses, appointments, programs,
 * insurance or anything from the chart (HIPAA marketing rule) and never SUD terms (42 CFR Part 2).
 * Clients are reachable only as kind client_authorized (signed marketing authorization).
 */
import { CONTACT_KINDS, FORBIDDEN_SEGMENT_FIELDS, SUD_TERMS, type ContactKind } from './constants';
import { decideSend, type ConsentRecipient, type SendChannel, type SendContext } from './consent';

export type Segment = {
  kinds?: ContactKind[];
  /** Any of these tags */
  tags?: string[];
  partnerIds?: string[];
  /** Registered for / attended any of these events */
  eventIds?: string[];
  attendedOnly?: boolean;
  createdAfter?: string | null;
};

export const SEGMENT_FIELDS = ['kinds', 'tags', 'partnerIds', 'eventIds', 'attendedOnly', 'createdAfter'] as const;

export type SegmentCheck = { ok: true; segment: Segment } | { ok: false; error: string };

const sudRe = new RegExp(`\\b(${SUD_TERMS.map((t) => t.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');

export function hasSudTerm(s: string): boolean {
  return sudRe.test(s);
}

/** Validate a segment from the client. Unknown / clinical fields are refused, not ignored. */
export function validateSegment(raw: unknown): SegmentCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Choose an audience.' };
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const k = key.toLowerCase();
    if ((FORBIDDEN_SEGMENT_FIELDS as readonly string[]).some((f) => k.includes(f))) {
      return { ok: false, error: `Audiences cannot use clinical or health information (${key}).` };
    }
    if (!(SEGMENT_FIELDS as readonly string[]).includes(key)) return { ok: false, error: `Unknown audience field: ${key}.` };
  }
  const kinds = Array.isArray(obj.kinds) ? obj.kinds.map(String) : [];
  const validKinds = CONTACT_KINDS.map((c) => c.key) as string[];
  for (const k of kinds) if (!validKinds.includes(k)) return { ok: false, error: `Unknown audience type: ${k}.` };
  const tags = Array.isArray(obj.tags) ? obj.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  for (const t of tags) {
    if (hasSudTerm(t)) return { ok: false, error: 'Audiences cannot target substance use (42 CFR Part 2).' };
  }
  const segment: Segment = {
    kinds: kinds as ContactKind[],
    tags,
    partnerIds: Array.isArray(obj.partnerIds) ? obj.partnerIds.map(String) : [],
    eventIds: Array.isArray(obj.eventIds) ? obj.eventIds.map(String) : [],
    attendedOnly: Boolean(obj.attendedOnly),
    createdAfter: typeof obj.createdAfter === 'string' && obj.createdAfter ? obj.createdAfter : null,
  };
  if (!segment.kinds?.length && !segment.tags?.length && !segment.partnerIds?.length && !segment.eventIds?.length) {
    return { ok: false, error: 'Pick at least one audience type, tag, partner or event.' };
  }
  return { ok: true, segment };
}

export type AudienceContact = ConsentRecipient & {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  partnerId?: string | null;
  clientId?: string | null;
  createdAt: Date;
  /** Event ids this contact registered for (and whether attended) */
  events?: { eventId: string; attended: boolean }[];
};

export function matchesSegment(c: AudienceContact, s: Segment): boolean {
  if (s.kinds?.length && !s.kinds.includes(c.kind as ContactKind)) return false;
  if (s.tags?.length && !s.tags.some((t) => c.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()))) return false;
  if (s.partnerIds?.length && !(c.partnerId && s.partnerIds.includes(c.partnerId))) return false;
  if (s.eventIds?.length) {
    const hit = (c.events ?? []).some((e) => s.eventIds!.includes(e.eventId) && (!s.attendedOnly || e.attended));
    if (!hit) return false;
  }
  if (s.createdAfter) {
    const d = new Date(s.createdAfter);
    if (!Number.isNaN(d.getTime()) && c.createdAt < d) return false;
  }
  return true;
}

export type AudiencePlan = {
  matched: number;
  sendable: { id: string; to: string }[];
  blocked: { id: string; reason: string }[];
  deferred: { id: string; reason: string }[];
};

/**
 * Who in the segment can receive this campaign now. A client contact is always checked for a
 * valid marketing authorization (isClient is derived from kind / clientId, not trusted input).
 */
export function planAudience(contacts: AudienceContact[], s: Segment, channel: SendChannel, ctx: SendContext): AudiencePlan {
  const plan: AudiencePlan = { matched: 0, sendable: [], blocked: [], deferred: [] };
  for (const c of contacts) {
    if (!matchesSegment(c, s)) continue;
    plan.matched += 1;
    const isClient = c.kind === 'client_authorized' || Boolean(c.clientId);
    const d = decideSend({ ...c, isClient }, channel, 'marketing', ctx);
    if (d.ok) plan.sendable.push({ id: c.id, to: d.to });
    else if (d.reason === 'quiet_hours') plan.deferred.push({ id: c.id, reason: d.reason });
    else plan.blocked.push({ id: c.id, reason: d.reason });
  }
  return plan;
}

/** A/B subject split: deterministic by recipient index (even = A, odd = B). */
export function abVariant(index: number, hasB: boolean): 'A' | 'B' {
  return hasB && index % 2 === 1 ? 'B' : 'A';
}
