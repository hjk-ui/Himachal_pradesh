/**
 * Carelon non-overlap attestation workflow (pure, browser-safe).
 *
 * Status flow (ConsentForm.formStatus):
 *   NOT_STARTED → SENT (to the client portal) → CLIENT_SIGNED (Part A) → COMPLETE (Part B, provider
 *   signed) → SUBMITTED (staff uploaded it in Carelon's provider portal and recorded the date; Altrixs
 *   never transmits to Carelon) → SUPERSEDED (a newer attestation was completed).
 *   An unfinished request can be cancelled (VOIDED).
 * Requirement: one completed attestation on file per Medicaid client. Starting a service with
 * non-overlap rules (PRP, IOP, residential...) opens a new request ("needs new").
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import type { CarelonTemplate } from './template';

export const CARELON_STATUSES = ['NOT_STARTED', 'SENT', 'CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED', 'SUPERSEDED', 'VOIDED'] as const;
export type CarelonStatus = (typeof CARELON_STATUSES)[number];

export const CARELON_STATUS_LABEL: Record<CarelonStatus, string> = {
  NOT_STARTED: 'Not started',
  SENT: 'Sent to client',
  CLIENT_SIGNED: 'Client signed',
  COMPLETE: 'Provider signed (complete)',
  SUBMITTED: 'Submitted to Carelon',
  SUPERSEDED: 'Superseded',
  VOIDED: 'Cancelled',
};

export const OPEN_STATUSES: readonly CarelonStatus[] = ['NOT_STARTED', 'SENT', 'CLIENT_SIGNED'];
export const DONE_STATUSES: readonly CarelonStatus[] = ['COMPLETE', 'SUBMITTED'];

export function asCarelonStatus(v: string | null | undefined): CarelonStatus {
  return (CARELON_STATUSES as readonly string[]).includes(v || '') ? (v as CarelonStatus) : 'NOT_STARTED';
}

/** ConsentForm.status kept in step with formStatus (other consent screens read it). */
export function consentStatusFor(s: CarelonStatus): 'PENDING' | 'SIGNED' | 'EXPIRED' | 'DECLINED' {
  if (s === 'COMPLETE' || s === 'SUBMITTED') return 'SIGNED';
  if (s === 'SUPERSEDED') return 'EXPIRED';
  if (s === 'VOIDED') return 'DECLINED';
  return 'PENDING';
}

export type CarelonAction = 'send' | 'sign_participant' | 'sign_provider' | 'mark_submitted' | 'void' | 'supersede';

const TRANSITIONS: Record<CarelonAction, { from: readonly CarelonStatus[]; to: CarelonStatus; error: string }> = {
  send: { from: ['NOT_STARTED', 'SENT'], to: 'SENT', error: 'Only an attestation the client has not signed can be sent.' },
  sign_participant: { from: ['NOT_STARTED', 'SENT'], to: 'CLIENT_SIGNED', error: 'Part A is already signed (or this attestation is closed).' },
  sign_provider: { from: ['CLIENT_SIGNED'], to: 'COMPLETE', error: 'Part B is signed after the participant (or Authorized Representative) signs Part A.' },
  mark_submitted: { from: ['COMPLETE'], to: 'SUBMITTED', error: 'Record the Carelon submission after both parts are signed.' },
  void: { from: ['NOT_STARTED', 'SENT', 'CLIENT_SIGNED'], to: 'VOIDED', error: 'A completed attestation cannot be cancelled; it is superseded by the next one.' },
  supersede: { from: ['COMPLETE', 'SUBMITTED'], to: 'SUPERSEDED', error: 'Only a completed attestation can be superseded.' },
};

export function transition(current: CarelonStatus, action: CarelonAction): { ok: true; next: CarelonStatus } | { ok: false; error: string } {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? { ok: true, next: t.to } : { ok: false, error: t.error };
}

// ─── Signatures and the frozen document ──────────────────────────────────────

export type SignerType = 'participant' | 'representative';
export type PartAMethod = 'portal' | 'in_office' | 'intake';

export type PartAInput = {
  signerType: SignerType;
  printedName: string;
  relationship?: string | null;
  authority?: string | null;
  /** Typed signature (the printed name typed again as the electronic signature) */
  signature: string;
  agree: boolean;
};

export type PartBInput = { printedName: string; title: string; signature: string; agree: boolean };

export type PartASignature = {
  signerType: SignerType;
  printedName: string;
  relationship: string | null;
  authority: string | null;
  signature: string;
  method: PartAMethod;
  signedAt: string;
  /** MM/DD/YYYY, practice time zone */
  dateSigned: string;
  /** Staff who recorded an in-office signature (null for portal / intake) */
  recordedById: string | null;
  recordedByName: string | null;
};

export type PartBSignature = {
  printedName: string;
  title: string;
  signature: string;
  signedAt: string;
  dateSigned: string;
  userId: string;
  role: string;
};

/** null only when Part A was signed in the intake packet before the chart had the value (staff fill blanks before Part B) */
export type FrozenParticipant = { participantName: string | null; participantId: string | null; dateOfBirth: string | null };
export type FrozenProvider = { organizationName: string | null; npi: string | null; tin: string | null };

export type FrozenDocument = {
  template: CarelonTemplate;
  participant: FrozenParticipant;
  provider: FrozenProvider;
  frozenAt: string;
};

export type CarelonEvent = { at: string; action: string; byId: string | null; byRole: string | null; detail?: string };

export type CarelonFormData = {
  formKey: string;
  version: string;
  timeZone: string;
  /** Provider option staff picked ("bp:<npi>" / "ps:<npi>" / "site:<locationId>"); null = default */
  providerOptionKey: string | null;
  neededReasons: string[];
  /** Exact form text + prefilled values as of Part A signature; never changes afterwards */
  document: FrozenDocument | null;
  partA: PartASignature | null;
  partB: PartBSignature | null;
  submission: { submittedOn: string; recordedAt: string; recordedById: string; recordedByName: string | null; reference: string | null } | null;
  events: CarelonEvent[];
};

export function emptyFormData(version: string, timeZone: string, reason: string | null): CarelonFormData {
  return {
    formKey: 'carelon-md-nonoverlap-attestation',
    version,
    timeZone,
    providerOptionKey: null,
    neededReasons: reason ? [reason] : [],
    document: null,
    partA: null,
    partB: null,
    submission: null,
    events: [],
  };
}

export function parseFormData(raw: unknown): CarelonFormData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<CarelonFormData>;
  if (r.formKey !== 'carelon-md-nonoverlap-attestation' || typeof r.version !== 'string') return null;
  return {
    formKey: r.formKey,
    version: r.version,
    timeZone: typeof r.timeZone === 'string' ? r.timeZone : 'America/New_York',
    providerOptionKey: typeof r.providerOptionKey === 'string' ? r.providerOptionKey : null,
    neededReasons: Array.isArray(r.neededReasons) ? r.neededReasons.filter((x): x is string => typeof x === 'string') : [],
    document: (r.document as FrozenDocument) ?? null,
    partA: (r.partA as PartASignature) ?? null,
    partB: (r.partB as PartBSignature) ?? null,
    submission: (r.submission as CarelonFormData['submission']) ?? null,
    events: Array.isArray(r.events) ? (r.events as CarelonEvent[]) : [],
  };
}

const t = (v: string | null | undefined) => (v ?? '').trim();

/** Part A checks: the representative needs a relationship and a description of their authority. */
export function validatePartA(input: PartAInput): string[] {
  const errors: string[] = [];
  if (input.signerType !== 'participant' && input.signerType !== 'representative') errors.push('Choose who is signing: the participant or an Authorized Representative.');
  if (t(input.printedName).length < 2) errors.push('Printed name is required.');
  if (t(input.signature).length < 2) errors.push('Type the name again as the signature.');
  else if (t(input.signature).toLowerCase() !== t(input.printedName).toLowerCase()) errors.push('The typed signature must match the printed name.');
  if (input.signerType === 'representative') {
    if (t(input.relationship).length < 2) errors.push("Relationship to the participant is required for an Authorized Representative.");
    if (t(input.authority).length < 3) errors.push('A brief description of the legal authority is required for an Authorized Representative (for example: court-appointed guardian, parent of a minor, health care power of attorney).');
  }
  if (input.agree !== true) errors.push('The signer must agree to the attestation statements.');
  return errors;
}

export function validatePartB(input: PartBInput): string[] {
  const errors: string[] = [];
  if (t(input.printedName).length < 2) errors.push('Printed name is required.');
  if (t(input.title).length < 2) errors.push('Title is required.');
  if (t(input.signature).length < 2) errors.push('Type the name again as the signature.');
  else if (t(input.signature).toLowerCase() !== t(input.printedName).toLowerCase()) errors.push('The typed signature must match the printed name.');
  if (input.agree !== true) errors.push('Agree to the provider attestation statements.');
  return errors;
}

/** Freezes the exact template text and the prefilled values at Part A signature. */
export function freezeDocument(template: CarelonTemplate, participant: FrozenParticipant, provider: FrozenProvider, at: Date): FrozenDocument {
  return {
    template: JSON.parse(JSON.stringify(template)) as CarelonTemplate,
    participant: { ...participant },
    provider: { ...provider },
    frozenAt: at.toISOString(),
  };
}

/** Blank participant / provider fields on a frozen document (Part B is blocked until none remain). */
export function frozenBlanks(doc: FrozenDocument): string[] {
  const out: string[] = [];
  if (!doc.participant.participantName) out.push('Participant Full Name');
  if (!doc.participant.participantId) out.push('Participant ID');
  if (!doc.participant.dateOfBirth) out.push('Date of Birth');
  if (!doc.provider.organizationName) out.push('Provider Organization Name');
  if (!doc.provider.npi) out.push('Provider NPI');
  if (!doc.provider.tin) out.push('Provider TIN Number');
  return out;
}

/**
 * Fills ONLY blank fields of a frozen document from the current prefill (values already on the
 * signed document never change). Returns the filled field names for the event log.
 */
export function fillBlanks(doc: FrozenDocument, participant: Partial<FrozenParticipant>, provider: Partial<FrozenProvider>): { doc: FrozenDocument; filled: string[] } {
  const next: FrozenDocument = { ...doc, participant: { ...doc.participant }, provider: { ...doc.provider } };
  const filled: string[] = [];
  for (const k of ['participantName', 'participantId', 'dateOfBirth'] as const) {
    if (!next.participant[k] && participant[k]) {
      next.participant[k] = participant[k] as string;
      filled.push(k);
    }
  }
  for (const k of ['organizationName', 'npi', 'tin'] as const) {
    if (!next.provider[k] && provider[k]) {
      next.provider[k] = provider[k] as string;
      filled.push(k);
    }
  }
  return { doc: next, filled };
}

// ─── Requirement per client ──────────────────────────────────────────────────

export type AttestationRow = {
  id: string;
  formStatus: string;
  createdAt: Date;
  signedAt: Date | null;
  submittedAt: Date | null;
  neededReason: string | null;
};

export type RequirementState = 'not_required' | 'not_started' | 'pending_client' | 'pending_provider' | 'needs_new' | 'complete';

export const REQUIREMENT_LABEL: Record<RequirementState, string> = {
  not_required: 'Not required',
  not_started: 'Not started',
  pending_client: 'Waiting for client signature',
  pending_provider: 'Waiting for provider signature',
  needs_new: 'New attestation needed',
  complete: 'Complete',
};

export type Requirement = {
  state: RequirementState;
  /** Shown on the banner / inbox / scheduler */
  needsAction: boolean;
  /** Valid completed attestation (latest COMPLETE / SUBMITTED) */
  current: AttestationRow | null;
  /** Open request (latest NOT_STARTED / SENT / CLIENT_SIGNED) */
  open: AttestationRow | null;
  /** Current attestation recorded as submitted to Carelon */
  submitted: boolean;
};

const latest = (rows: AttestationRow[], statuses: readonly CarelonStatus[]) =>
  rows.filter((r) => statuses.includes(asCarelonStatus(r.formStatus))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

export function attestationRequirement(medicaid: boolean, rows: AttestationRow[]): Requirement {
  const current = latest(rows, DONE_STATUSES);
  const open = latest(rows, OPEN_STATUSES);
  const submitted = Boolean(current && asCarelonStatus(current.formStatus) === 'SUBMITTED');
  let state: RequirementState;
  if (!medicaid) state = 'not_required';
  else if (open && current) state = 'needs_new';
  else if (open) {
    const s = asCarelonStatus(open.formStatus);
    state = s === 'CLIENT_SIGNED' ? 'pending_provider' : s === 'SENT' ? 'pending_client' : 'not_started';
  } else if (current) state = 'complete';
  else state = 'not_started';
  return { state, needsAction: state !== 'complete' && state !== 'not_required', current, open, submitted };
}

/** What a "new attestation needed" request does for this client. */
export function requestDecision(medicaid: boolean, rows: AttestationRow[], opts: { manual?: boolean } = {}): 'create' | 'already_open' | 'not_medicaid' {
  if (!medicaid && !opts.manual) return 'not_medicaid';
  return latest(rows, OPEN_STATUSES) ? 'already_open' : 'create';
}

// ─── Services with non-overlap rules ─────────────────────────────────────────

export const NON_OVERLAP_SERVICES = [
  { value: 'prp', label: 'Psychiatric Rehabilitation Program (PRP)', auto: true },
  { value: 'iop', label: 'Intensive Outpatient Program (IOP)', auto: true },
  { value: 'residential', label: 'Residential treatment', auto: true },
  { value: 'tms', label: 'TMS', auto: false },
  { value: 'case_management', label: 'Case management / targeted case management', auto: false },
  { value: 'php', label: 'Partial hospitalization (PHP)', auto: false },
  { value: 'aot', label: 'AOT / ACT', auto: false },
  { value: 'other', label: 'Other service with non-overlap rules', auto: false },
] as const;
export type NonOverlapService = (typeof NON_OVERLAP_SERVICES)[number]['value'];

/** Starting one of these (enrollment or referral) opens a new attestation request automatically. */
export function programTriggersAttestation(program: string | null | undefined): boolean {
  const p = (program || '').trim().toLowerCase();
  return NON_OVERLAP_SERVICES.some((s) => s.auto && s.value === p);
}

export function serviceLabel(program: string | null | undefined): string {
  const p = (program || '').trim().toLowerCase();
  return NON_OVERLAP_SERVICES.find((s) => s.value === p)?.label ?? (program || 'service');
}

// ─── Permissions (minimum necessary) ─────────────────────────────────────────

/** Start, send, record an in-office Part A, mark "new needed", cancel, view the PDF */
export const CARELON_MANAGE_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'] as const;
/** Sign Part B (the provider or the provider's authorized representative) */
export const CARELON_PROVIDER_SIGN_ROLES = CARELON_MANAGE_ROLES;
/** Record the Carelon portal submission (front office and leadership) */
export const CARELON_SUBMIT_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK'] as const;
/** "Carelon attestation status" report: front office, billing and leadership */
export const CARELON_REPORT_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING'] as const;
/** Inbox "Medicaid attestations to complete": front desk, office manager, leadership */
export const CARELON_INBOX_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;

const has = (list: readonly string[], role: string | null | undefined) => Boolean(role) && list.includes(normalizeStaffRole(role));
export const canManageCarelon = (role: string | null | undefined) => has(CARELON_MANAGE_ROLES, role);
export const canSignCarelonProvider = (role: string | null | undefined) => has(CARELON_PROVIDER_SIGN_ROLES, role);
export const canMarkCarelonSubmitted = (role: string | null | undefined) => has(CARELON_SUBMIT_ROLES, role);
/** Banner flag / scheduler badge: the roles that can open and complete the form (billing uses the report) */
export const canSeeCarelonFlag = (role: string | null | undefined) => has(CARELON_MANAGE_ROLES, role);

// ─── Worklist / report summary ───────────────────────────────────────────────

export type ClientStatusRow = {
  clientId: string;
  clientName: string;
  mrn: string | null;
  payerName: string | null;
  medicaidReasons: string[];
  state: RequirementState;
  openStatus: CarelonStatus | null;
  openId: string | null;
  currentId: string | null;
  completedAt: string | null;
  submitted: boolean;
  submittedAt: string | null;
  neededReason: string | null;
};

export type StatusSummary = {
  total: number;
  complete: number;
  pendingSignature: number;
  notStarted: number;
  needsNew: number;
  submitted: number;
  completeNotSubmitted: number;
};

export function summarizeStatuses(rows: ClientStatusRow[]): StatusSummary {
  const s: StatusSummary = { total: 0, complete: 0, pendingSignature: 0, notStarted: 0, needsNew: 0, submitted: 0, completeNotSubmitted: 0 };
  for (const r of rows) {
    if (r.state === 'not_required') continue;
    s.total += 1;
    if (r.state === 'complete') s.complete += 1;
    else if (r.state === 'pending_client' || r.state === 'pending_provider') s.pendingSignature += 1;
    else if (r.state === 'not_started') s.notStarted += 1;
    else if (r.state === 'needs_new') s.needsNew += 1;
    if (r.currentId) {
      if (r.submitted) s.submitted += 1;
      else s.completeNotSubmitted += 1;
    }
  }
  return s;
}

/** Report view filter → rows (KPIs are computed from the same rows, so counts always equal lists) */
export type StatusFilter = 'all' | 'needs_action' | 'complete' | 'pending_signature' | 'not_started' | 'needs_new' | 'not_submitted' | 'submitted';

export function filterStatusRows(rows: ClientStatusRow[], f: StatusFilter): ClientStatusRow[] {
  const req = rows.filter((r) => r.state !== 'not_required');
  switch (f) {
    case 'needs_action': return req.filter((r) => r.state !== 'complete');
    case 'complete': return req.filter((r) => r.state === 'complete');
    case 'pending_signature': return req.filter((r) => r.state === 'pending_client' || r.state === 'pending_provider');
    case 'not_started': return req.filter((r) => r.state === 'not_started');
    case 'needs_new': return req.filter((r) => r.state === 'needs_new');
    case 'not_submitted': return req.filter((r) => r.currentId && !r.submitted);
    case 'submitted': return req.filter((r) => r.currentId && r.submitted);
    default: return req;
  }
}
