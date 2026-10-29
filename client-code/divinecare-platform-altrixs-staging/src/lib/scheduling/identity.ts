import type { Prisma } from '@prisma/client';

/**
 * Online-booking identity matching (public scheduling page, solo practice page).
 *
 * Before: the booking attached to ANY client whose email OR phone matched (scheduling) or to the
 * client holding that email in any organization (solo: findUnique by email, no org filter). A
 * shared family phone, a reused email, or a typo filed one person's appointment, insurance and
 * reason for visit on another person's chart, across practices.
 *
 * Now, inside the booking organization only:
 *   - exactly one client with the same first + last name (case / spacing ignored) AND the same
 *     date of birth -> the booking uses that client. Their chart contact details are never
 *     overwritten; if the email / phone typed differ, the chart is flagged for staff review.
 *   - otherwise -> a NEW client is created and flagged identityVerifyRequired, with the reason
 *     (possible duplicate by email / phone / name+DOB, or simply a new online booking). Staff merge
 *     by hand after verifying identity. Nothing is ever merged automatically.
 *
 * Client.email is unique across the whole database, so when the typed email already belongs to
 * another chart the new client keeps it in unverifiedEmail instead.
 */

export type IdentityReason =
  | 'new_online_booking'
  | 'possible_duplicate_email'
  | 'possible_duplicate_phone'
  | 'possible_duplicate_name_dob'
  | 'contact_mismatch';

export function normalizePersonName(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Digits only, last 10 (US) so "+1 (410) 555-0100" and "4105550100" compare equal. */
export function normalizePhoneDigits(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** "YYYY-MM-DD" (or an ISO string starting with it) -> [UTC midnight, next UTC midnight). */
export function dobDayRange(dob: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob?.trim() ?? '');
  if (!m) return null;
  const start = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(start.getTime()) || start.getUTCDate() !== +m[3]) return null;
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

type CandidateRow = {
  id: string;
  name: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  email: string | null;
  phone: string | null;
};

/** First / last name of a chart: legal fields when present, else first and last word of name. */
export function chartFirstLast(c: Pick<CandidateRow, 'name' | 'legalFirstName' | 'legalLastName'>) {
  if (c.legalFirstName?.trim() && c.legalLastName?.trim()) {
    return { first: normalizePersonName(c.legalFirstName), last: normalizePersonName(c.legalLastName) };
  }
  const parts = normalizePersonName(c.name).split(' ').filter(Boolean);
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/** Candidates (already filtered to same org + same DOB) whose first + last name match exactly. */
export function exactNameMatches<T extends CandidateRow>(rows: T[], firstName: string, lastName: string): T[] {
  const f = normalizePersonName(firstName);
  const l = normalizePersonName(lastName);
  if (!f || !l) return [];
  return rows.filter((r) => {
    const n = chartFirstLast(r);
    return n.first === f && n.last === l;
  });
}

export type BookingIdentityInput = {
  organizationId: string;
  firstName: string;
  lastName: string;
  dob: string;
  email?: string | null;
  phone?: string | null;
};

export type IdentityDecision =
  | { kind: 'existing'; clientId: string; flagReason: IdentityReason | null }
  | { kind: 'new'; reason: IdentityReason; emailAvailable: boolean };

type IdentityDb = {
  client: {
    findMany(args: Prisma.ClientFindManyArgs): Promise<CandidateRow[]>;
    findFirst(args: Prisma.ClientFindFirstArgs): Promise<{ id: string; organizationId?: string | null } | null>;
  };
};

const CANDIDATE_SELECT = {
  id: true,
  name: true,
  legalFirstName: true,
  legalLastName: true,
  email: true,
  phone: true,
} as const;

/** Decide which client an online booking belongs to. Pure lookups; the caller writes. */
export async function decideBookingIdentity(db: IdentityDb, input: BookingIdentityInput): Promise<IdentityDecision> {
  const email = input.email?.trim().toLowerCase() || null;
  const phoneDigits = normalizePhoneDigits(input.phone);
  const range = dobDayRange(input.dob);

  // Email is unique across the DB: can the new chart hold it?
  const emailOwner = email ? await db.client.findFirst({ where: { email }, select: { id: true, organizationId: true } }) : null;
  const emailAvailable = !emailOwner;

  if (range) {
    const sameDob = await db.client.findMany({
      where: { organizationId: input.organizationId, dateOfBirth: { gte: range.start, lt: range.end } },
      select: CANDIDATE_SELECT,
      take: 50,
    });
    const matches = exactNameMatches(sameDob, input.firstName, input.lastName);
    if (matches.length === 1) {
      const m = matches[0];
      const emailDiffers = Boolean(email && m.email && m.email.toLowerCase() !== email);
      const phoneDiffers = Boolean(phoneDigits && m.phone && normalizePhoneDigits(m.phone) !== phoneDigits);
      return { kind: 'existing', clientId: m.id, flagReason: emailDiffers || phoneDiffers ? 'contact_mismatch' : null };
    }
    if (matches.length > 1) return { kind: 'new', reason: 'possible_duplicate_name_dob', emailAvailable };
  }

  // No exact name + DOB match. Same contact in THIS org = a possible duplicate for staff to review.
  if (emailOwner && emailOwner.organizationId === input.organizationId) {
    return { kind: 'new', reason: 'possible_duplicate_email', emailAvailable };
  }
  if (phoneDigits.length >= 7) {
    const orgPhones = await db.client.findMany({
      where: { organizationId: input.organizationId, phone: { contains: phoneDigits.slice(-4) } },
      select: CANDIDATE_SELECT,
      take: 200,
    });
    if (orgPhones.some((c) => normalizePhoneDigits(c.phone) === phoneDigits)) {
      return { kind: 'new', reason: 'possible_duplicate_phone', emailAvailable };
    }
  }
  return { kind: 'new', reason: 'new_online_booking', emailAvailable };
}

/** Fields for a new online-booking client: always flagged for identity verification. */
export function newBookingClientFlags(decision: Extract<IdentityDecision, { kind: 'new' }>, email: string | null) {
  return {
    email: decision.emailAvailable ? email : null,
    unverifiedEmail: decision.emailAvailable ? null : email,
    identityVerifyRequired: true,
    identityVerifyReason: decision.reason,
  };
}
