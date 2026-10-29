/**
 * Waitlist to industry standard (SimplePractice / Valant / TherapyNotes style). PURE: no Prisma.
 * Persistence: src/lib/waitlist/manage.ts. Migration: prisma/migrations/20261028_waitlist_standard.sql.
 *
 *  - Pipeline: NEW → CONTACTED → INTAKE_SENT → READY → SCHEDULED / CONVERTED, or CLOSED with a reason.
 *    "WaitlistStatus" (WAITING / MATCHED / SCHEDULED / CLOSED) is unchanged and kept in step, so the
 *    front-office board, inbox offers, tasks and reports that read status keep working.
 *  - Safety screen "yes" raises urgency to at least URGENT and puts the entry at the top: crisis
 *    guidance (988, same-day triage) shows in the UI; it never just sits on a list.
 *  - Priority: open entries first; CRISIS, URGENT, ROUTINE; then longest waiting.
 *  - Conversion (runConversion): duplicate check → create or link client → book → optional intake
 *    and eligibility → mark the entry. Dependencies are injected so the flow is testable.
 */
import type { Role } from '@prisma/client';
import { matchPerson, type DedupeMatch } from '@/lib/marketing/leads';

// ─── Vocabularies ────────────────────────────────────────────────────────────────────────

/** Service requested (stored in WaitlistEntry.specialty). */
export const WAITLIST_SERVICES = [
  'Therapy',
  'Medication Management',
  'Psychiatric Evaluation',
  'PRP',
  'IOP',
  'TMS',
  'Primary Care',
  'Group',
] as const;
export type WaitlistService = (typeof WAITLIST_SERVICES)[number];

export const WAITLIST_STAGES = [
  ['NEW', 'New'],
  ['CONTACTED', 'Contacted'],
  ['INTAKE_SENT', 'Intake sent'],
  ['READY', 'Ready to schedule'],
  ['SCHEDULED', 'Scheduled'],
  ['CONVERTED', 'Converted'],
  ['CLOSED', 'Closed'],
] as const;
export type WaitlistStage = (typeof WAITLIST_STAGES)[number][0];
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(WAITLIST_STAGES);
export const OPEN_STAGES: WaitlistStage[] = ['NEW', 'CONTACTED', 'INTAKE_SENT', 'READY'];

export const CLOSE_REASONS = [
  ['no_response', 'No response'],
  ['went_elsewhere', 'Went elsewhere'],
  ['not_eligible', 'Not eligible'],
  ['declined', 'Declined services'],
  ['duplicate', 'Duplicate entry'],
  ['other', 'Other'],
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number][0];
export const CLOSE_REASON_LABEL: Record<string, string> = Object.fromEntries(CLOSE_REASONS);

export const CONTACT_METHODS = [
  ['call', 'Phone call'],
  ['voicemail', 'Voicemail'],
  ['email', 'Email'],
  ['portal', 'Portal message'],
  ['in_person', 'In person'],
] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number][0];

export const CONTACT_OUTCOMES = [
  ['reached', 'Reached'],
  ['left_voicemail', 'Left voicemail'],
  ['no_answer', 'No answer'],
  ['email_sent', 'Email sent, no reply yet'],
  ['portal_sent', 'Portal message sent, no reply yet'],
  ['wrong_number', 'Wrong / disconnected number'],
  ['declined', 'Reached, declined services'],
] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number][0];
/** Outcomes where the person was actually reached (resets the no-response streak). */
export const REACHED_OUTCOMES: ContactOutcome[] = ['reached', 'declined'];
/** Unanswered attempts in a row before staff are prompted to close as "no response". */
export const NO_RESPONSE_PROMPT_AT = 3;

export const CONTACT_PREFERENCES = [
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['portal', 'Portal'],
] as const;
export const AGE_GROUPS = [
  ['child', 'Child (under 12)'],
  ['adolescent', 'Adolescent (12-17)'],
  ['adult', 'Adult (18-64)'],
  ['older_adult', 'Older adult (65+)'],
] as const;
export const AVAILABILITY_DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
] as const;
export const AVAILABILITY_TIMES = [
  ['morning', 'Morning (before 12)'],
  ['afternoon', 'Afternoon (12-5)'],
  ['evening', 'Evening (after 5)'],
] as const;

export const SAFETY_SCREEN_QUESTION =
  'Are you having any current thoughts of harming yourself or someone else?';
export const CRISIS_GUIDANCE = [
  'If there is immediate danger, call 911.',
  'Call or text 988 (Suicide & Crisis Lifeline) now, with the person if possible.',
  'Same-day triage: tell the on-duty clinician or practice director before ending the call.',
  'Do not leave this person waiting on the list: book a same-day or next-day risk assessment.',
];

// ─── Roles ───────────────────────────────────────────────────────────────────────────────

/** Front desk, office manager (intake coordination) and leadership: full waitlist work. */
export const WAITLIST_MANAGE_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK'];
/** Clinicians: read the list and add their own referrals. */
export const WAITLIST_CLINICIAN_ROLES: Role[] = ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'];
export const WAITLIST_VIEW_ROLES: Role[] = [...WAITLIST_MANAGE_ROLES, ...WAITLIST_CLINICIAN_ROLES];

const roleOf = (role: Role | string | null | undefined) => (role ? String(role).toUpperCase() : '');

export function canViewWaitlist(role: Role | string | null | undefined): boolean {
  return (WAITLIST_VIEW_ROLES as string[]).includes(roleOf(role));
}
export function canManageWaitlist(role: Role | string | null | undefined): boolean {
  return (WAITLIST_MANAGE_ROLES as string[]).includes(roleOf(role));
}
export function canAddToWaitlist(role: Role | string | null | undefined): boolean {
  return canViewWaitlist(role);
}
/** Managers edit any entry; a clinician edits only an open entry they added. */
export function canEditWaitlistEntry(
  role: Role | string | null | undefined,
  userId: string,
  entry: { createdById?: string | null; stage: string }
): boolean {
  if (canManageWaitlist(role)) return true;
  return canViewWaitlist(role) && Boolean(entry.createdById) && entry.createdById === userId && (OPEN_STAGES as string[]).includes(entry.stage);
}

// ─── Services ────────────────────────────────────────────────────────────────────────────

/** Canonical service for a stored specialty. Legacy therapy specialties (CBT, Trauma, DBT ...) read as Therapy. */
export function serviceCategory(specialty: string | null | undefined): WaitlistService {
  const s = (specialty ?? '').toLowerCase();
  if (!s) return 'Therapy';
  const exact = WAITLIST_SERVICES.find((v) => v.toLowerCase() === s);
  if (exact) return exact;
  if (/med(ication)?\s*(management|mgmt|review)/.test(s)) return 'Medication Management';
  if (/psych(iatric)?\s*(eval|evaluation|assessment)|psychiatry/.test(s)) return 'Psychiatric Evaluation';
  if (/\bprp\b|psychiatric rehab/.test(s)) return 'PRP';
  if (/\biop\b|intensive outpatient/.test(s)) return 'IOP';
  if (/\btms\b|magnetic|spravato/.test(s)) return 'TMS';
  if (/primary care|physical|annual|well/.test(s)) return 'Primary Care';
  if (/group/.test(s)) return 'Group';
  return 'Therapy';
}

/** Staff roles that see each service (primary role or any extra role). */
export const SERVICE_ROLES: Record<WaitlistService, Role[]> = {
  Therapy: ['THERAPIST', 'CLINICIAN'],
  Group: ['THERAPIST', 'CLINICIAN'],
  IOP: ['THERAPIST', 'CLINICIAN'],
  'Medication Management': ['PSYCHIATRIST', 'NP'],
  'Psychiatric Evaluation': ['PSYCHIATRIST', 'NP'],
  TMS: ['PSYCHIATRIST', 'NP'],
  PRP: ['PRP_SPECIALIST', 'THERAPIST', 'CLINICIAN'],
  'Primary Care': ['PHYSICIAN', 'MEDICAL_NP'],
};

export function seesService(user: { role: string; roles?: string[] | null }, service: WaitlistService): boolean {
  const allowed = SERVICE_ROLES[service] as string[];
  return [user.role, ...(user.roles ?? [])].some((r) => allowed.includes(String(r)));
}

/**
 * First visit for the requested service: a new person starts with an intake / evaluation, not a
 * follow-up type (med management starts with a psychiatric evaluation). Types are from
 * src/features/appointments/types.ts APPOINTMENT_TYPES.
 */
export function intakeAppointmentFor(service: WaitlistService): { type: string; durationMin: number } {
  switch (service) {
    case 'Medication Management':
    case 'Psychiatric Evaluation':
    case 'TMS':
      return { type: 'Psychiatric Evaluation', durationMin: 75 };
    case 'Primary Care':
      return { type: 'Initial Evaluation', durationMin: 60 };
    default:
      return { type: 'Initial Assessment', durationMin: 60 };
  }
}

// ─── Stage / status ──────────────────────────────────────────────────────────────────────

type StageInput = { stage?: string | null; status: string; convertedClientId?: string | null; convertedAppointmentId?: string | null; clinicianId?: string | null };

/** Stage for a row; legacy rows (null stage) are read from their status. */
export function deriveStage(e: StageInput): WaitlistStage {
  const st = (e.stage ?? '').toUpperCase();
  const status = e.status.toUpperCase();
  // Status is authoritative for closed / done (older writers set only the status)
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'SCHEDULED') {
    if (st === 'SCHEDULED' || st === 'CONVERTED') return st;
    // Before 20261028 sending an intake link set status SCHEDULED with no client yet
    if (!e.convertedClientId) return 'INTAKE_SENT';
    return e.convertedClientId && !e.convertedAppointmentId ? 'CONVERTED' : 'SCHEDULED';
  }
  if ((OPEN_STAGES as string[]).includes(st)) return st as WaitlistStage;
  if (status === 'MATCHED') return 'READY';
  return 'NEW';
}

/** WaitlistStatus kept in step with the stage (MATCHED = open with a clinician). */
export function statusForStage(stage: WaitlistStage, clinicianId: string | null | undefined): 'WAITING' | 'MATCHED' | 'SCHEDULED' | 'CLOSED' {
  if (stage === 'CLOSED') return 'CLOSED';
  if (stage === 'SCHEDULED' || stage === 'CONVERTED') return 'SCHEDULED';
  return clinicianId ? 'MATCHED' : 'WAITING';
}

export function isOpenStage(stage: string): boolean {
  return (OPEN_STAGES as string[]).includes(stage);
}

// ─── Safety screen ───────────────────────────────────────────────────────────────────────

export type SafetyScreen = 'no' | 'yes' | 'not_asked';
type Urgency = 'ROUTINE' | 'URGENT' | 'CRISIS';

/** "yes" raises urgency to at least URGENT (CRISIS stays CRISIS); never lowers it. */
export function applySafetyScreen(urgency: Urgency, screen: SafetyScreen | null | undefined): { urgency: Urgency; crisisGuidance: boolean } {
  if (screen !== 'yes') return { urgency, crisisGuidance: false };
  return { urgency: urgency === 'CRISIS' ? 'CRISIS' : 'URGENT', crisisGuidance: true };
}

// ─── Priority ────────────────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<string, number> = { CRISIS: 0, URGENT: 1, ROUTINE: 2 };

export type PriorityRow = { urgency: string; createdAt: string | Date; stage: string; safetyScreen?: string | null };

/** Open first; then CRISIS, URGENT, ROUTINE (positive safety screen counts as at least URGENT); then longest waiting. */
export function comparePriority(a: PriorityRow, b: PriorityRow): number {
  const openA = isOpenStage(a.stage) ? 0 : 1;
  const openB = isOpenStage(b.stage) ? 0 : 1;
  if (openA !== openB) return openA - openB;
  const rank = (r: PriorityRow) => Math.min(URGENCY_RANK[r.urgency.toUpperCase()] ?? 9, r.safetyScreen === 'yes' ? 1 : 9);
  const d = rank(a) - rank(b);
  if (d) return d;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function sortByPriority<T extends PriorityRow>(rows: T[]): T[] {
  return [...rows].sort(comparePriority);
}

export function daysWaitingSince(createdAt: Date | string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}

// ─── Contact log ─────────────────────────────────────────────────────────────────────────

/** New no-response streak after an attempt with this outcome. */
export function nextNoResponseCount(current: number, outcome: ContactOutcome): number {
  return REACHED_OUTCOMES.includes(outcome) ? 0 : Math.max(0, current) + 1;
}

export function shouldPromptNoResponseClose(noResponseCount: number, stage: string): boolean {
  return isOpenStage(stage) && noResponseCount >= NO_RESPONSE_PROMPT_AT;
}

/** Stage after a contact attempt: first outreach moves NEW to CONTACTED; later stages are kept. */
export function stageAfterContact(stage: WaitlistStage): WaitlistStage {
  return stage === 'NEW' ? 'CONTACTED' : stage;
}

/** Follow-up due by the end of `now`'s day (server clock) or overdue. */
export function followUpDue(nextFollowUpAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!nextFollowUpAt) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return new Date(nextFollowUpAt).getTime() <= end.getTime();
}

// ─── Close ───────────────────────────────────────────────────────────────────────────────

export function validateClose(reason: string | null | undefined, stage: string): { ok: true; reason: CloseReason } | { ok: false; error: string } {
  if (stage === 'CLOSED') return { ok: false, error: 'Entry is already closed' };
  if (stage === 'SCHEDULED' || stage === 'CONVERTED') return { ok: false, error: 'Entry is already converted' };
  const r = (reason ?? '').trim();
  if (!CLOSE_REASONS.some(([k]) => k === r)) return { ok: false, error: 'Pick a close reason' };
  return { ok: true, reason: r as CloseReason };
}

// ─── Duplicates ──────────────────────────────────────────────────────────────────────────

export type ClientCandidate = { id: string; name: string; mrn?: string | null; dateOfBirth?: Date | string | null; phone?: string | null; email?: string | null; status?: string | null };
export type DuplicateMatch = { clientId: string; name: string; mrn: string | null; status: string | null; level: DedupeMatch['level']; basis: string };

/**
 * Existing clients that may be this person: name + DOB, phone, or email (same rules as marketing
 * lead dedupe; email equality is strong on its own). Strong matches first.
 */
export function findDuplicateCandidates(
  person: { firstName?: string | null; lastName?: string | null; name?: string | null; dateOfBirth?: Date | string | null; phone?: string | null; email?: string | null },
  candidates: ClientCandidate[]
): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  const email = (person.email ?? '').trim().toLowerCase();
  for (const c of candidates) {
    const emailHit = Boolean(email && c.email && c.email.trim().toLowerCase() === email);
    const m = matchPerson(
      person.firstName || person.lastName ? { firstName: person.firstName, lastName: person.lastName, dateOfBirth: person.dateOfBirth ?? null, phone: person.phone ?? null } : { name: person.name, dateOfBirth: person.dateOfBirth ?? null, phone: person.phone ?? null },
      { name: c.name, dateOfBirth: c.dateOfBirth ?? null, phone: c.phone ?? null }
    );
    if (!m && !emailHit) continue;
    const basis = [m?.basis, emailHit ? 'email' : null].filter(Boolean).join(' and ');
    out.push({ clientId: c.id, name: c.name, mrn: c.mrn ?? null, status: c.status ?? null, level: emailHit || m?.level === 'strong' ? 'strong' : 'possible', basis });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'strong' ? -1 : 1));
}

// ─── Matching ────────────────────────────────────────────────────────────────────────────

/** Does a slot (practice wall time HH:MM + weekday key) fit the stated availability? Empty = any. */
export function slotFitsAvailability(slot: { day: string; time: string }, days: string[], times: string[]): boolean {
  if (days.length && !days.includes(slot.day)) return false;
  if (!times.length) return true;
  const h = Number(slot.time.slice(0, 2));
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return times.includes(part);
}

export type PanelLike = { payerName: string; payerRegistryId: string | null; providerUserIds: string[]; status: string };

const normPayer = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * In network for a payer per credentialing panels: 'yes' (approved panel lists the clinician),
 * 'no' (the payer has panels on file but none approved for this clinician), 'unknown' (no panel
 * on file for this payer, or no payer: not used to exclude anyone).
 */
export function panelStatusFor(
  clinicianId: string,
  payer: { name?: string | null; registryId?: string | null },
  panels: PanelLike[]
): 'yes' | 'no' | 'unknown' {
  const name = normPayer(payer.name);
  if (!name && !payer.registryId) return 'unknown';
  if (/^(self ?pay|uninsured|none|cash)$/.test(name)) return 'unknown';
  const forPayer = panels.filter((p) => (payer.registryId && p.payerRegistryId === payer.registryId) || (name && normPayer(p.payerName) === name));
  if (!forPayer.length) return 'unknown';
  return forPayer.some((p) => p.status === 'approved' && p.providerUserIds.includes(clinicianId)) ? 'yes' : 'no';
}

/** Location fit: telehealth OK, no preference, or a clinician site in the preferred list. Clinicians with no sites on file are 'unknown'. */
export function locationFit(clinicianLocationIds: string[], preferred: string[], telehealthOk: boolean | null | undefined): 'yes' | 'no' | 'unknown' | 'telehealth' {
  if (!preferred.length) return telehealthOk ? 'telehealth' : 'unknown';
  if (!clinicianLocationIds.length) return telehealthOk ? 'telehealth' : 'unknown';
  if (clinicianLocationIds.some((id) => preferred.includes(id))) return 'yes';
  return telehealthOk ? 'telehealth' : 'no';
}

// ─── Conversion ──────────────────────────────────────────────────────────────────────────

export type ConversionRequest = {
  /** Link to this existing client instead of creating one */
  linkClientId?: string | null;
  /** Staff saw the possible duplicates and chose to create a new chart anyway */
  createDespiteMatches?: boolean;
  /** null = convert without scheduling */
  appointment?: { clinicianId: string; startsAt: string; endsAt: string; type: string; isVirtual: boolean } | null;
  assignedToId?: string | null;
  locationId?: string | null;
  sendIntake?: boolean;
  runEligibility?: boolean;
};

export type ConversionDeps = {
  findDuplicates: () => Promise<DuplicateMatch[]>;
  /** Client must exist in the org (link path) */
  verifyClient: (clientId: string) => Promise<boolean>;
  createClient: () => Promise<{ ok: true; clientId: string } | { ok: false; error: string; status: number }>;
  book: (clientId: string) => Promise<{ ok: true; appointmentId: string } | { ok: false; error: string; status: number }>;
  sendIntake: (clientId: string) => Promise<{ ok: true; token: string } | { ok: false; error: string }>;
  runEligibility: (clientId: string) => Promise<{ ok: true; status: string } | { ok: false; error: string }>;
  /** READY = client linked but no visit booked yet (booking failed); the entry stays open */
  markConverted: (r: { clientId: string; appointmentId: string | null; stage: 'SCHEDULED' | 'CONVERTED' | 'READY'; clinicianId: string | null }) => Promise<void>;
  audit: (step: string, detail: Record<string, unknown>) => Promise<void>;
};

export type ConversionResult =
  | { ok: false; status: number; error: string; code?: 'POSSIBLE_DUPLICATE'; duplicates?: DuplicateMatch[]; clientId?: string }
  | {
      ok: true;
      clientId: string;
      linked: boolean;
      appointmentId: string | null;
      /** Booking failed after the client was created: the entry stays open as READY with the client linked */
      bookingError: string | null;
      intake: { token: string } | { error: string } | null;
      eligibility: { status: string } | { error: string } | null;
      stage: 'SCHEDULED' | 'CONVERTED' | 'READY';
    };

/**
 * One confirm step: duplicate check, create or link the client, book, optional intake and
 * eligibility, mark the entry. A failed optional step (intake / eligibility) never undoes the
 * conversion; it is reported back. A booking failure after the client exists leaves the entry
 * READY with the client linked, so staff pick another time instead of creating a second chart.
 */
export async function runConversion(
  entry: { stage: string; convertedClientId: string | null },
  req: ConversionRequest,
  deps: ConversionDeps
): Promise<ConversionResult> {
  if (entry.stage === 'CLOSED') return { ok: false, status: 400, error: 'Entry is closed. Reopen it first.' };
  if (entry.stage === 'SCHEDULED' || entry.stage === 'CONVERTED') {
    return { ok: false, status: 409, error: 'Already converted to a client' };
  }

  let clientId: string;
  let linked = false;
  const preLinked = entry.convertedClientId;
  if (preLinked) {
    // An earlier attempt created / linked the client but booking failed: reuse it, never a second chart
    clientId = preLinked;
    linked = true;
  } else if (req.linkClientId) {
    if (!(await deps.verifyClient(req.linkClientId))) return { ok: false, status: 404, error: 'Client not found' };
    clientId = req.linkClientId;
    linked = true;
    await deps.audit('link_client', { clientId });
  } else {
    const dups = await deps.findDuplicates();
    if (dups.length && !req.createDespiteMatches) {
      return { ok: false, status: 409, code: 'POSSIBLE_DUPLICATE', error: 'Possible existing client: link or confirm a new chart', duplicates: dups };
    }
    const created = await deps.createClient();
    if (created.ok === false) return { ok: false, status: created.status, error: created.error };
    clientId = created.clientId;
    await deps.audit('create_client', { clientId, duplicatesOverridden: dups.length ? dups.map((d) => d.clientId) : null });
  }

  let appointmentId: string | null = null;
  let bookingError: string | null = null;
  if (req.appointment) {
    const booked = await deps.book(clientId);
    if (booked.ok === false) bookingError = booked.error;
    else {
      appointmentId = booked.appointmentId;
      await deps.audit('book', { appointmentId, clientId });
    }
  }

  let intake: { token: string } | { error: string } | null = null;
  if (req.sendIntake) {
    const r = await deps.sendIntake(clientId);
    intake = r.ok === false ? { error: r.error } : { token: r.token };
  }
  let eligibility: { status: string } | { error: string } | null = null;
  if (req.runEligibility) {
    const r = await deps.runEligibility(clientId);
    eligibility = r.ok === false ? { error: r.error } : { status: r.status };
  }

  const stage: 'SCHEDULED' | 'CONVERTED' | 'READY' = req.appointment ? (appointmentId ? 'SCHEDULED' : 'READY') : 'CONVERTED';
  await deps.markConverted({ clientId, appointmentId, stage, clinicianId: req.appointment?.clinicianId ?? req.assignedToId ?? null });
  return { ok: true, clientId, linked, appointmentId, bookingError, intake, eligibility, stage };
}

/** Display name from split parts (first + last), else the stored name. */
export function composeName(first: string | null | undefined, last: string | null | undefined, fallback?: string | null): string {
  const n = `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim();
  return n || (fallback ?? '').trim();
}

/** Split a legacy single name ("Ana Maria Lopez" → Ana Maria / Lopez). */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
