/**
 * Progress note documentation standard (benchmarked on TherapyNotes, Valant, SimplePractice,
 * athenaOne BH and Netsmart myAvatar). Pure functions (no I/O) so the worklist, the sign path,
 * the print view and the tests apply the same rules:
 *
 *   - timeliness: when a note is due (practice sign deadline after the service ended), overdue,
 *     and the "Late entry" label stamped on notes signed after the deadline;
 *   - billing / compliance elements every billable note needs before it is signed (DOS, time for
 *     timed codes, place of service + telehealth modality / patient location / consent, a linked
 *     ICD-10 diagnosis), plus note-type rules (crisis, collateral, group, no-show);
 *   - cloned-note detection (similarity to the client's previous note);
 *   - the printable / releasable note, which never contains psychotherapy notes.
 *
 * These complement, never duplicate, structuredSignBlockers (template rules, carry-forward, blanks,
 * AI markers) and the note quality checklist (src/lib/ai/noteQuality), which stay as they are.
 */
import { fromPracticeWallTime, toPracticeWallTime, DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { normalizeNoteType, structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { asStructuredNoteType, countPendingCarryForward } from '@/lib/ehr/structuredNotes';
import { DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM, formatElementIssues, willBeRequiredText, type FormatElementsGate } from '@/lib/notes/formatElements';
import { identifyingInfoIssues } from '@/lib/ehr/identifyingInfo';
import { prpNoteIssues, type PrpNoteDetail } from '@/lib/prp/progressNote';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// ─── Practice policy defaults ────────────────────────────────────────────────

/**
 * Practice policy: sign within 72 hours of the end of the service (industry standard for
 * outpatient behavioral health; decided 2026-10-20). PracticeSettings.noteSignDeadlineHours
 * (24 / 48 / 72) is the practice's own choice; this applies when no settings row exists.
 */
export const DEFAULT_NOTE_DUE_HOURS = 72;
/** Unsigned notes turn "due soon" this many hours before the deadline. */
export const DUE_SOON_HOURS = 24;
/** A note signed after the deadline needs a late-entry reason of at least this many characters. */
export const LATE_REASON_MIN_CHARS = 10;
export const LATE_REASON_MAX_CHARS = 500;
/** Unsigned notes more than this many days past due escalate to the author's supervisor. */
export const ESCALATION_OVERDUE_DAYS = 7;
export const DEFAULT_STALE_DRAFT_DAYS = 14;
export const DEFAULT_CLONE_WARN_PERCENT = 85;

export type NotePolicy = {
  /** Practice policy: sign within this many hours of the end of the service */
  deadlineHours: number;
  timeZone: string;
  staleDraftDays: number;
  cloneWarnPercent: number;
  requireDiagnosisToSign: boolean;
  /** Days between diagnosis-list reviews (src/lib/diagnoses; default 90) */
  diagnosisReviewDays?: number;
  /** Practice date (YYYY-MM-DD) from which missing note-format elements block signing; warnings before */
  formatElementsEnforceFrom?: string;
};

export const DEFAULT_NOTE_POLICY: NotePolicy = {
  deadlineHours: DEFAULT_NOTE_DUE_HOURS,
  timeZone: DEFAULT_PRACTICE_TIME_ZONE,
  staleDraftDays: DEFAULT_STALE_DRAFT_DAYS,
  cloneWarnPercent: DEFAULT_CLONE_WARN_PERCENT,
  requireDiagnosisToSign: true,
  formatElementsEnforceFrom: DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM,
};

// ─── Timeliness ──────────────────────────────────────────────────────────────

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** When the service ended on the practice clock: DOS + end time, else the end of that day. */
export function serviceEndedAt(dos: string | null | undefined, endTime: string | null | undefined, timeZone = DEFAULT_PRACTICE_TIME_ZONE): Date | null {
  if (!dos || !/^\d{4}-\d{2}-\d{2}$/.test(dos)) return null;
  const end = endTime && TIME_RE.test(endTime.trim()) ? endTime.trim().padStart(5, '0') : '23:59';
  return fromPracticeWallTime(dos, end, timeZone);
}

/** The note is due this many hours after the service ended (practice policy). */
export function noteDueAt(dos: string | null | undefined, endTime: string | null | undefined, deadlineHours: number, timeZone = DEFAULT_PRACTICE_TIME_ZONE): Date | null {
  const ended = serviceEndedAt(dos, endTime, timeZone);
  if (!ended) return null;
  const hours = deadlineHours > 0 ? deadlineHours : DEFAULT_NOTE_DUE_HOURS;
  return new Date(ended.getTime() + hours * HOUR);
}

/** Whole days from the date of service to `now` on the practice calendar (0 = same day). */
export function daysSinceService(dos: string | null | undefined, now: Date, timeZone = DEFAULT_PRACTICE_TIME_ZONE): number | null {
  if (!dos || !/^\d{4}-\d{2}-\d{2}$/.test(dos)) return null;
  const today = toPracticeWallTime(now, timeZone).date;
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dos}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / DAY)) : null;
}

export type TimelinessState = 'no_dos' | 'due' | 'due_soon' | 'overdue' | 'signed_on_time' | 'late_entry';

export type Timeliness = {
  state: TimelinessState;
  dueAt: string | null;
  /** Hours past due (unsigned: until now; signed: until the signature); 0 when not late */
  hoursLate: number;
  daysSinceService: number | null;
};

export function noteTimeliness(input: {
  dateOfService: string | null | undefined;
  endTime?: string | null;
  signedAt?: string | Date | null;
  now: Date;
  deadlineHours: number;
  timeZone?: string;
}): Timeliness {
  const tz = input.timeZone || DEFAULT_PRACTICE_TIME_ZONE;
  const due = noteDueAt(input.dateOfService, input.endTime ?? null, input.deadlineHours, tz);
  const days = daysSinceService(input.dateOfService, input.now, tz);
  if (!due) return { state: 'no_dos', dueAt: null, hoursLate: 0, daysSinceService: days };
  const signed = input.signedAt ? new Date(input.signedAt) : null;
  const ref = signed ?? input.now;
  const lateMs = ref.getTime() - due.getTime();
  const hoursLate = lateMs > 0 ? Math.round(lateMs / HOUR) : 0;
  const state: TimelinessState = signed
    ? lateMs > 0
      ? 'late_entry'
      : 'signed_on_time'
    : lateMs > 0
      ? 'overdue'
      : -lateMs <= DUE_SOON_HOURS * HOUR
        ? 'due_soon'
        : 'due';
  return { state, dueAt: due.toISOString(), hoursLate, daysSinceService: days };
}

/** "Late entry — documented on 2026-10-25 for service on 2026-10-20" (practice calendar). */
export function lateEntryLabel(signedAt: string | Date, dateOfService: string, timeZone = DEFAULT_PRACTICE_TIME_ZONE): string {
  const documented = toPracticeWallTime(new Date(signedAt), timeZone).date;
  return `Late entry — documented on ${documented} for service on ${dateOfService}`;
}

/**
 * Signing now would be a late entry: the reason is required (min LATE_REASON_MIN_CHARS) only then.
 * Returns the error message, or null when the signature may proceed.
 */
export function lateEntryReasonError(input: { dueAt: Date | null; signedAt: Date; reason: string | null | undefined }): string | null {
  if (!input.dueAt || input.signedAt.getTime() <= input.dueAt.getTime()) return null;
  const reason = (input.reason || '').trim();
  if (reason.length >= LATE_REASON_MIN_CHARS) return null;
  return `This note is past the practice sign deadline: enter a late-entry reason (at least ${LATE_REASON_MIN_CHARS} characters) when you sign.`;
}

/** The late-entry line printed on the note: the stamped label plus the clinician's reason. */
export function lateEntryPrintLine(label: string | null | undefined, reason: string | null | undefined): string | null {
  if (!label) return null;
  const r = (reason || '').trim().replace(/\s+/g, ' ');
  return r ? `${label}. Reason: ${r}` : label;
}

/** Whole days an unsigned note is past its due time (0 when not overdue). */
export function daysOverdue(dueAt: Date | string | null | undefined, now: Date): number {
  if (!dueAt) return 0;
  const ms = now.getTime() - new Date(dueAt).getTime();
  return ms > 0 ? Math.floor(ms / DAY) : 0;
}

/** Unsigned and more than ESCALATION_OVERDUE_DAYS past due: escalated to the author's supervisor. */
export function isEscalatedOverdue(dueAt: Date | string | null | undefined, now: Date): boolean {
  if (!dueAt) return false;
  return now.getTime() - new Date(dueAt).getTime() > ESCALATION_OVERDUE_DAYS * DAY;
}

/** Roles that receive escalations for authors with no assigned supervisor (clinical / practice director, admin). */
export const ESCALATION_LEADERSHIP_ROLES: readonly string[] = ['DIRECTOR', 'PRACTICE_DIRECTOR', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Who an overdue > 7 days note escalates to: the author's supervisor (SupervisionTrack) when one
 * exists, else leadership (clinical director / practice director / admin). True when `viewer` is
 * that recipient. The author never escalates to themselves.
 */
export function escalatesToViewer(input: {
  authorId: string | null;
  authorSupervisorId: string | null;
  viewerId: string;
  viewerRole: string;
}): boolean {
  if (input.authorId && input.authorId === input.viewerId) return false;
  if (input.authorSupervisorId) return input.authorSupervisorId === input.viewerId;
  return ESCALATION_LEADERSHIP_ROLES.includes((input.viewerRole || '').toUpperCase());
}

/** Unsigned notes escalated to `viewer`: more than 7 days past due and routed to them. */
export function selectEscalatedOverdue<T extends { authorId: string | null; dueAt: Date | string | null }>(
  notes: T[],
  input: { viewerId: string; viewerRole: string; supervisorByAuthor: Map<string, string>; now: Date }
): T[] {
  return notes.filter(
    (n) =>
      isEscalatedOverdue(n.dueAt, input.now) &&
      escalatesToViewer({
        authorId: n.authorId,
        authorSupervisorId: n.authorId ? input.supervisorByAuthor.get(n.authorId) ?? null : null,
        viewerId: input.viewerId,
        viewerRole: input.viewerRole,
      })
  );
}

/** Drafts not touched for `staleDays` days are flagged (never auto-locked or deleted). */
export function isStaleDraft(lastEditedAt: string | Date, now: Date, staleDays: number): boolean {
  const days = staleDays > 0 ? staleDays : DEFAULT_STALE_DRAFT_DAYS;
  return now.getTime() - new Date(lastEditedAt).getTime() > days * DAY;
}

// ─── Billing / compliance elements ───────────────────────────────────────────

/** Time-based codes: the note needs start/end time or total minutes (CPT time rule). */
export const TIMED_CODES: ReadonlySet<string> = new Set([
  '90832', '90833', '90834', '90836', '90837', '90838', '90839', '90840', '90846', '90847',
  // HCPCS billed per 15 minutes (units come from time)
  'H0004', 'H0038', 'H2014', 'H2017', 'H2019', 'T1016',
]);

/** Codes billed for an evaluation that establishes the diagnosis (the note itself may hold it). */
const EVAL_CODES = new Set(['90791', '90792']);

const TELEHEALTH_POS = ['02', '10'];
const ICD10_RE = /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/;

export type ElementIssue = {
  id: string;
  message: string;
  severity: 'block' | 'warn';
  /** Where to fix it (e.g. the client's consents page) */
  fix?: { label: string; href: string };
};

/** The client's consents page (record / send the telehealth consent). */
export function clientConsentsHref(clientId: string): string {
  return `/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`;
}

export function cptBase(code: string | null | undefined): string | null {
  const m = String(code ?? '').trim().toUpperCase().match(/^([0-9A-Z]\d{3}[0-9A-Z])/);
  return m ? m[1] : null;
}

export type BillingElementInput = {
  noteType: string | null;
  body: string;
  cptCode: string | null;
  dateOfService: string | null;
  durationMinutes: number | null;
  telehealth: boolean;
  audioOnly?: boolean;
  placeOfService: string | null;
  /** Service details (null = none saved yet) */
  detail: {
    startTime?: string | null;
    endTime?: string | null;
    telehealthModality?: string | null;
    patientLocationState?: string | null;
    telehealthConsent?: boolean | null;
    diagnosisCodes?: string[] | null;
  } | null;
  /** Patient state recorded on the linked appointment (telehealth), when any */
  appointmentPatientState?: string | null;
  /** Rendering clinician credentials (User.credentials), for the signature block */
  renderingCredentials?: string | null;
  requireDiagnosisToSign?: boolean;
  /** The note's client: lets a blocker link to where it is fixed (consents page) */
  clientId?: string | null;
};

/**
 * Required billing / compliance elements. `block` items stop signing (extending the existing sign
 * blockers); `warn` items are shown before signing. Non-billable notes (no CPT) only need a DOS.
 */
export function billingElementIssues(input: BillingElementInput): ElementIssue[] {
  const out: ElementIssue[] = [];
  const type = input.noteType ? normalizeNoteType(input.noteType) : '';
  const base = cptBase(input.cptCode);
  if (!input.dateOfService) out.push({ id: 'dos', message: 'Record the date of service.', severity: 'block' });
  if (!base) return out;

  // Time for timed codes: start + end time, or total minutes
  const d = input.detail;
  const hasClock = Boolean(d?.startTime && d?.endTime && TIME_RE.test(d.startTime) && TIME_RE.test(d.endTime));
  const bodyClock = /^Start time: \d{1,2}:\d{2}/m.test(input.body) && /^End time: \d{1,2}:\d{2}/m.test(input.body);
  if (TIMED_CODES.has(base) && !hasClock && !bodyClock && !(input.durationMinutes && input.durationMinutes > 0)) {
    out.push({ id: 'time', message: `${base} is time-based: record the start and end time or the total minutes.`, severity: 'block' });
  }

  // Place of service + telehealth
  const pos = (input.placeOfService || '').trim();
  if (!/^\d{2}$/.test(pos)) {
    // In person with no POS: the claim uses the practice's office POS (Practice settings › Billing)
    out.push(
      input.telehealth
        ? { id: 'telehealth.pos', message: 'Telehealth: choose POS 10 (client at home) or 02 (other location).', severity: 'block' }
        : { id: 'pos', message: 'No place of service on the note; the claim will use the practice office POS.', severity: 'warn' }
    );
  }
  if (input.telehealth) {
    if (pos && !TELEHEALTH_POS.includes(pos)) {
      out.push({ id: 'telehealth.pos', message: `Telehealth notes use POS 10 (patient at home) or 02 (other); this note has POS ${pos}.`, severity: 'block' });
    }
    const modality = d?.telehealthModality || (input.audioOnly ? 'audio_only' : null);
    if (!modality) out.push({ id: 'telehealth.modality', message: 'Telehealth: record the modality (audio-video or audio-only).', severity: 'block' });
    if (!(d?.patientLocationState || input.appointmentPatientState)) {
      out.push({ id: 'telehealth.state', message: 'Telehealth: record the state the client was located in during the session.', severity: 'block' });
    }
    if (d?.telehealthConsent !== true) {
      out.push({
        id: 'telehealth.consent',
        message:
          'Telehealth: confirm the client’s telehealth consent in Service details (tick “Client’s telehealth consent is on file or was obtained today”). No consent on file? Record or send it from the client’s Consents page first.',
        severity: 'block',
        ...(input.clientId ? { fix: { label: 'Open client consents', href: clientConsentsHref(input.clientId) } } : {}),
      });
    }
  }

  // Diagnosis linked from the chart (evaluations may establish it in the note itself)
  const linked = (d?.diagnosisCodes || []).filter((c) => ICD10_RE.test(c));
  if (input.requireDiagnosisToSign !== false && !linked.length) {
    const evalWithDx = EVAL_CODES.has(base) && ICD10_RE.test(input.body);
    if (!evalWithDx) {
      out.push({ id: 'diagnosis', message: 'Link at least one ICD-10 diagnosis from the client’s chart (Service details).', severity: 'block' });
    }
  }

  if (!(input.renderingCredentials || '').trim()) {
    out.push({ id: 'credentials', message: 'Your credentials (e.g. LCSW-C, LCPC, PMHNP-BC) are not on your staff profile; the signature block will show your name only.', severity: 'warn' });
  }
  if (type === 'No-Show') {
    out.push({ id: 'noshow.cpt', message: 'A no-show / missed appointment is not a billable service: remove the CPT code.', severity: 'block' });
  }
  return out;
}

// ─── Note-type rules (crisis, collateral, group, no-show, carry-forward) ─────

export { ROI_STATUS, COLLATERAL_RELATIONSHIPS } from '@/lib/ehr/noteTemplates';

/**
 * Text rules per note type, read from the saved body (blocking). Format elements (SOAP, DAP, BIRP …
 * required sections, SI / HI screen, functional status) follow `formatElements`
 * (formatElementsGate: Notes policy date): warnings before the date, blocking on / after it.
 * Without a gate they block (the strict rule).
 */
export function noteTypeIssues(input: { noteType: string | null; body: string; part2?: boolean; formatElements?: FormatElementsGate; now?: Date }): ElementIssue[] {
  const type = input.noteType ? normalizeNoteType(input.noteType) : '';
  const sections = structuredNoteSections(type, input.body);
  const text = (title: string) => sections.filter((s) => s.title === title).map((s) => s.text).join('\n').trim();
  const out: ElementIssue[] = [];
  if (type === 'Crisis') {
    if (!text('Risk Assessment')) out.push({ id: 'crisis.risk', message: 'Crisis note: document the risk assessment (C-SSRS or equivalent).', severity: 'block' });
    if (!text('Disposition / Safety Plan')) out.push({ id: 'crisis.disposition', message: 'Crisis note: document the disposition and safety plan.', severity: 'block' });
  }
  if (type === 'Collateral') {
    if (!text('Collateral Contact')) out.push({ id: 'collateral.who', message: 'Collateral note: record who you spoke with.', severity: 'block' });
    if (!text('Relationship to Client')) out.push({ id: 'collateral.relationship', message: 'Collateral note: record their relationship to the client.', severity: 'block' });
    const roi = text('Release of Information');
    if (!roi) out.push({ id: 'collateral.roi', message: 'Collateral note: record the release of information status.', severity: 'block' });
    else if (/^Not on file/i.test(roi)) {
      out.push({ id: 'collateral.roi', message: 'Collateral note: no release of information is on file. Obtain a signed ROI before disclosing (or document the emergency exception).', severity: 'block' });
    }
    if (input.part2 && /verbal consent/i.test(roi)) {
      out.push({ id: 'collateral.part2', message: '42 CFR Part 2: SUD information needs a written Part 2 consent; verbal consent is not enough.', severity: 'block' });
    }
  }
  // Section formats (SOAP, DAP, BIRP, GIRP, PIE, CBT, DBT, Crisis …): required elements warn until the
  // Notes policy date, then block signing
  const gate = input.formatElements;
  // Intake / evaluation / re-evaluation Identifying Information (chief complaint, visit modality, a
  // minor's legal guardian): same warn-then-block date as the format elements
  for (const i of [...formatElementIssues(type, input.body), ...identifyingInfoIssues(type, input.body)]) {
    if (!gate || gate.enforced) out.push({ id: i.id, message: i.message, severity: 'block' });
    else out.push({ id: i.id, message: `${i.message} ${willBeRequiredText(gate, input.now)}`, severity: 'warn' });
  }
  if (type === 'Group' && !text('Individual Response')) {
    out.push({ id: 'group.individual', message: 'Group note: document this client’s individual response (group notes must be individualized).', severity: 'block' });
  }
  // Brought-forward text not yet reviewed (structured templates check this themselves)
  if (!asStructuredNoteType(type)) {
    const pending = countPendingCarryForward(input.body);
    if (pending) {
      out.push({ id: 'carry_forward', message: `${pending} copied-forward block${pending === 1 ? '' : 's'} still marked "review": review the text and remove the marker before signing.`, severity: 'block' });
    }
  }
  return out;
}

/**
 * PRP progress note contact elements (src/lib/prp/progressNote.ts: the PRP encounter rule plus the
 * participant signature). Same warn-then-block date as the format elements; [] for other types.
 */
export function prpContactIssues(input: {
  noteType: string | null;
  body: string;
  detail: PrpNoteDetail | null;
  dateOfService: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  formatElements?: FormatElementsGate;
  now?: Date;
}): ElementIssue[] {
  const type = input.noteType ? normalizeNoteType(input.noteType) : '';
  if (type !== 'PRP') return [];
  const sections = structuredNoteSections(type, input.body);
  const text = (title: string) => sections.filter((s) => s.title === title).map((s) => s.text).join('\n').trim();
  const gate = input.formatElements;
  return prpNoteIssues({
    detail: input.detail,
    dateOfService: input.dateOfService,
    startTime: input.startTime,
    endTime: input.endTime,
    durationMinutes: input.durationMinutes,
    interventionText: text('Intervention'),
    responseText: text('Participant Response'),
  }).map((i) =>
    i.severity === 'warn' || !gate || gate.enforced ? i : { ...i, message: `${i.message} ${willBeRequiredText(gate, input.now)}`, severity: 'warn' as const }
  );
}

/** First blocking message (sign path), or null. */
export function firstSignBlocker(issues: ElementIssue[]): string | null {
  return issues.find((i) => i.severity === 'block')?.message ?? null;
}

// ─── Cloned-note detection ───────────────────────────────────────────────────

/** Template headings, carry-forward markers and punctuation removed; lower-case words. */
function noteWords(text: string, headings: readonly string[] = []): string[] {
  const skip = new Set(headings.map((h) => h.toLowerCase().trim()));
  return text
    .split('\n')
    .filter((l) => !skip.has(l.trim().toLowerCase()) && !/^\(from \d{4}-\d{2}-\d{2} — /.test(l.trim()))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(words: string[], n = 3): Set<string> {
  const out = new Set<string>();
  if (words.length < n) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Similarity of two notes, 0–100 (Jaccard of 3-word shingles, headings ignored). Short notes
 * (under 25 words) return 0: template-length text is expected to repeat.
 */
export function noteSimilarityPercent(a: string, b: string, headings: readonly string[] = []): number {
  const wa = noteWords(a, headings);
  const wb = noteWords(b, headings);
  if (wa.length < 25 || wb.length < 25) return 0;
  const sa = shingles(wa);
  const sb = shingles(wb);
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? Math.round((inter / union) * 100) : 0;
}

export function isLikelyClone(percent: number, threshold = DEFAULT_CLONE_WARN_PERCENT): boolean {
  return percent >= (threshold > 0 ? threshold : DEFAULT_CLONE_WARN_PERCENT);
}

// ─── Printable / releasable note ─────────────────────────────────────────────

export type PrintableNoteInput = {
  clientName: string;
  clientDob?: string | null;
  mrn?: string | null;
  noteType: string | null;
  dateOfService: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes: number | null;
  cptCode: string | null;
  addOnCptCode?: string | null;
  placeOfService: string | null;
  telehealth: boolean;
  telehealthModality?: string | null;
  diagnosisCodes?: string[];
  part2: boolean;
  aiDrafted: boolean;
  /** The signed body exactly as signed (workflow snapshot) */
  body: string;
  status: 'Draft' | 'Signed' | 'Locked';
  signedByName: string | null;
  signerCredentials?: string | null;
  signedAt: string | null;
  attestedAt?: string | null;
  lockedAt?: string | null;
  cosignRequired?: boolean;
  cosignedByName?: string | null;
  cosignerCredentials?: string | null;
  cosignedAt?: string | null;
  lateEntryLabel?: string | null;
  /** The clinician's late-entry reason, printed with the label */
  lateEntryReason?: string | null;
  addenda: { reason: string; text: string; authorName: string | null; createdAt: string }[];
};

export type PrintableNote = {
  title: string;
  header: { label: string; value: string }[];
  banners: string[];
  sections: { title: string; text: string }[];
  addenda: { heading: string; text: string }[];
  signature: string[];
};

export const SIGNER_ATTESTATION =
  'I attest that I personally provided or supervised this service and that this note accurately documents it.';
export const SUPERVISOR_ATTESTATION =
  'Reviewed as supervising clinician. I have reviewed this note and agree with the assessment and plan as documented.';
export const PART2_REDISCLOSURE_NOTICE =
  '42 CFR Part 2: This record contains substance use disorder information protected by federal confidentiality rules (42 CFR part 2). Federal law prohibits unauthorized use or disclosure of this record; it may not be used to criminally investigate or prosecute the patient except as permitted by 42 CFR part 2.';

/**
 * The note as printed / released. Built only from the clinical record fields listed in
 * PrintableNoteInput: psychotherapy notes are a separate record and are never an input, so they
 * can never appear in a print, PDF, export or release.
 */
export function buildPrintableNote(input: PrintableNoteInput): PrintableNote {
  const type = input.noteType ? normalizeNoteType(input.noteType) : 'Progress Note';
  const time =
    input.startTime && input.endTime
      ? `${input.startTime}–${input.endTime}${input.durationMinutes ? ` (${input.durationMinutes} min)` : ''}`
      : input.durationMinutes
        ? `${input.durationMinutes} min`
        : '—';
  const header = [
    { label: 'Client', value: input.clientName },
    ...(input.clientDob ? [{ label: 'Date of birth', value: input.clientDob }] : []),
    ...(input.mrn ? [{ label: 'MRN', value: input.mrn }] : []),
    { label: 'Note type', value: type },
    { label: 'Date of service', value: input.dateOfService || '—' },
    { label: 'Time', value: time },
    { label: 'Service code', value: [input.cptCode, input.addOnCptCode ? `+${input.addOnCptCode}` : null].filter(Boolean).join(' ') || '—' },
    { label: 'Place of service', value: input.placeOfService || '—' },
    ...(input.telehealth
      ? [{ label: 'Telehealth', value: input.telehealthModality === 'audio_only' ? 'Audio-only' : input.telehealthModality === 'audio_video' ? 'Audio-video' : 'Yes' }]
      : []),
    ...(input.diagnosisCodes?.length ? [{ label: 'Diagnoses addressed', value: input.diagnosisCodes.join(', ') }] : []),
  ];
  const banners: string[] = [];
  if (input.status === 'Draft') banners.push('DRAFT — not signed. Not part of the legal record until signed.');
  const late = lateEntryPrintLine(input.lateEntryLabel, input.lateEntryReason);
  if (late) banners.push(late);
  if (input.part2) banners.push(PART2_REDISCLOSURE_NOTICE);
  if (input.aiDrafted) banners.push('Parts of this note were drafted with AI assistance and reviewed and signed by the clinician.');
  const sections = structuredNoteSections(type, input.body)
    .filter((s) => s.text.trim())
    .map((s) => ({ title: s.title, text: s.text.trim() }));
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
  const signature: string[] = [];
  if (input.signedAt) {
    const who = [input.signedByName || 'Clinician', input.signerCredentials].filter(Boolean).join(', ');
    signature.push(`Electronically signed by ${who} on ${fmt(input.signedAt)}.`);
    signature.push(SIGNER_ATTESTATION);
    if (input.lockedAt) signature.push(`Locked ${fmt(input.lockedAt)}.`);
  }
  if (input.cosignedAt) {
    const who = [input.cosignedByName || 'Supervisor', input.cosignerCredentials].filter(Boolean).join(', ');
    signature.push(`Co-signed by ${who} on ${fmt(input.cosignedAt)}. ${SUPERVISOR_ATTESTATION}`);
  } else if (input.cosignRequired && input.signedAt) {
    signature.push('Supervisor co-signature pending.');
  }
  const addenda = input.addenda.map((a) => ({
    heading: `Addendum — ${a.reason} — ${a.authorName || 'Clinical staff'} — ${fmt(a.createdAt)}`,
    text: a.text,
  }));
  return { title: `${type} — ${input.clientName}`, header, banners, sections, addenda, signature };
}

/** Plain-text rendering (export / release copy). */
export function printableNoteText(p: PrintableNote): string {
  return [
    p.title,
    ...p.header.map((h) => `${h.label}: ${h.value}`),
    ...p.banners,
    '',
    ...p.sections.flatMap((s) => [s.title, s.text, '']),
    ...p.addenda.flatMap((a) => [a.heading, a.text, '']),
    ...p.signature,
  ].join('\n');
}

// ─── HIPAA 164.526 amendment due dates ───────────────────────────────────────

/** Act on a patient's amendment request within 60 days (one 30-day extension with notice). */
export function amendmentDueOn(requestedOn: string, extended = false): string {
  const base = Date.parse(`${requestedOn}T00:00:00Z`);
  return new Date(base + (extended ? 90 : 60) * DAY).toISOString().slice(0, 10);
}
