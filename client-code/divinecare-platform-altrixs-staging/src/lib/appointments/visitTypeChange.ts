/**
 * Change the visit type during the visit (pure, browser-safe; tested in tests/visit-type-change.test.ts).
 *
 * Clinician feedback: the booked visit type sometimes changes once the visit starts (a med check
 * becomes a psychiatric re-evaluation, an in-person visit moves to video). Industry standard
 * (Valant / athena): the clinician changes the visit type from inside the visit, the change is
 * audited, and the signed note's codes drive the charge.
 *
 *  - Types offered: the schedule's catalog (APPOINTMENT_TYPES) filtered to what the visit's
 *    clinician's role delivers, minus types the practice switched off in Scheduling settings,
 *    plus enabled practice-defined types. The current type is always shown.
 *  - Length: the scheduled end moves to the new type's default length only when that does not run
 *    into the clinician's next appointment; otherwise the time is kept and the clinician is told.
 *  - Blocked once the visit note is signed or the visit is billed (claim on file / telehealth charge
 *    routed): "Visit already billed — use a charge correction". Nothing changes then.
 *  - In person <-> telehealth: the note's POS / modifier follow (11 in office; 10 / 02 from where the
 *    patient is, never guessed; modifier 95 for audio-video telehealth).
 *
 * Server: src/lib/appointments/visitTypeChangeServer.ts, PATCH /api/appointments/[id]/visit-type.
 */
import { APPOINTMENT_TYPES } from '@/features/appointments/types';
import { PROTOCOLS } from '@/lib/visits/protocols';
import { resolveVisitKind } from '@/lib/visits/resolveKind';
import { resolveTelehealthPos, type TelehealthPosSettings } from '@/lib/telehealth/pos';

export const VISIT_ALREADY_BILLED = 'Visit already billed — use a charge correction';
export const VISIT_NOTE_SIGNED = 'The visit note is signed. Correct it with an addendum; billing handles any charge correction.';
export const VISIT_TYPE_REASON_MAX = 300;

/** Default length (minutes) per catalog type when the practice has no matching Scheduling service. */
export const VISIT_TYPE_DEFAULT_MINUTES: Record<string, number> = {
  'Individual Therapy': 60,
  'Group Therapy': 60,
  'Medication Review': 20,
  'Initial Assessment': 60,
  'Crisis Follow-up': 60,
  'Telehealth Check-in': 15,
  'Psychiatric Evaluation': 60,
  'Medication Management': 20,
  'PRP Session': 60,
  Telehealth: 45,
  'Initial Evaluation': 60,
};

/** Catalog type -> Scheduling settings service id (practice-configured length / on-off). */
const SERVICE_ID_FOR_TYPE: Record<string, string> = {
  'Individual Therapy': 'individual_therapy',
  'Group Therapy': 'group_therapy',
  'Medication Management': 'med_management',
  'Medication Review': 'med_management',
  'Initial Assessment': 'new_client_intake',
  'Psychiatric Evaluation': 'psych_eval',
  'Initial Evaluation': 'psych_eval',
  Telehealth: 'telehealth_session',
};

const THERAPY_TYPES = ['Individual Therapy', 'Group Therapy', 'Initial Assessment', 'Crisis Follow-up', 'Telehealth Check-in', 'Telehealth'];
const PRESCRIBER_TYPES = [
  'Medication Management',
  'Medication Review',
  'Psychiatric Evaluation',
  'Initial Evaluation',
  'Crisis Follow-up',
  'Telehealth Check-in',
  'Telehealth',
  // Psychiatrists / NPs may deliver psychotherapy-only visits
  'Individual Therapy',
];
const MEDICAL_TYPES = ['Initial Evaluation', 'Medication Review', 'Telehealth Check-in', 'Telehealth'];
const PRP_TYPES = ['PRP Session', 'Crisis Follow-up', 'Telehealth Check-in'];
const SUPPORT_TYPES = ['Crisis Follow-up', 'Telehealth Check-in', 'PRP Session'];

const ROLE_TYPES: Record<string, readonly string[]> = {
  THERAPIST: THERAPY_TYPES,
  CLINICIAN: THERAPY_TYPES,
  PSYCHIATRIST: PRESCRIBER_TYPES,
  NP: PRESCRIBER_TYPES,
  PHYSICIAN: MEDICAL_TYPES,
  MEDICAL_NP: MEDICAL_TYPES,
  MEDICAL_ASSISTANT: MEDICAL_TYPES,
  PRP_SPECIALIST: PRP_TYPES,
  CASE_MANAGER: SUPPORT_TYPES,
  PEER_SUPPORT: SUPPORT_TYPES,
  CRISIS_RESPONDER: ['Crisis Follow-up', 'Telehealth Check-in'],
};

/** Catalog types the clinician's role delivers; every catalog type for other / unknown roles. */
export function visitTypesForRole(role: string | null | undefined): readonly string[] {
  return ROLE_TYPES[String(role ?? '').toUpperCase()] ?? APPOINTMENT_TYPES;
}

export type PracticeService = { id?: string; title?: string; durationMin?: number; enabled?: boolean; telehealth?: boolean; inPerson?: boolean };

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

function serviceFor(type: string, services: readonly PracticeService[]): PracticeService | null {
  const id = SERVICE_ID_FOR_TYPE[type];
  return services.find((s) => norm(s.title) === norm(type)) ?? (id ? services.find((s) => s.id === id) : undefined) ?? null;
}

/** Default length of a type: the practice's Scheduling service, else the built-in default, else null. */
export function defaultMinutesForType(type: string, services: readonly PracticeService[] = []): number | null {
  const svc = serviceFor(type, services);
  const m = Number(svc?.durationMin);
  if (Number.isFinite(m) && m > 0) return Math.round(m);
  return VISIT_TYPE_DEFAULT_MINUTES[type] ?? null;
}

export type VisitTypeOption = { type: string; durationMin: number | null; current: boolean };

/**
 * Types the visit can change to: the role's catalog types the practice has not switched off, plus
 * enabled practice-defined types (not in the catalog); the current type is always listed first.
 */
export function visitTypeOptions(input: {
  clinicianRole?: string | null;
  currentType: string;
  services?: readonly PracticeService[];
}): VisitTypeOption[] {
  const services = input.services ?? [];
  const out: VisitTypeOption[] = [];
  const seen = new Set<string>();
  const push = (type: string, current = false) => {
    const k = norm(type);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ type, durationMin: defaultMinutesForType(type, services), current });
  };
  push(input.currentType.trim(), true);
  for (const t of visitTypesForRole(input.clinicianRole)) {
    const svc = serviceFor(t, services);
    if (svc && svc.enabled === false) continue;
    push(t);
  }
  const catalog = new Set((APPOINTMENT_TYPES as readonly string[]).map(norm));
  for (const s of services) {
    if (s.enabled === false || !s.title || catalog.has(norm(s.title))) continue;
    // Online-booking ids that mirror a catalog type ("New Client Intake") are not offered twice
    if (Object.values(SERVICE_ID_FOR_TYPE).includes(String(s.id))) continue;
    push(s.title.trim());
  }
  return out;
}

/** Null when the type may be chosen; else why not. */
export function visitTypeChoiceError(toType: string, options: readonly VisitTypeOption[]): string | null {
  const t = norm(toType);
  if (!t) return 'Choose a visit type.';
  if (!options.some((o) => norm(o.type) === t)) return "That visit type isn't offered for this clinician.";
  return null;
}

/** Canonical spelling of a chosen type (as listed). */
export function canonicalVisitType(toType: string, options: readonly VisitTypeOption[]): string {
  return options.find((o) => norm(o.type) === norm(toType))?.type ?? toType.trim();
}

export type VisitBlockInput = {
  status: string;
  /** Notes started from this appointment (dismissed ones are ignored) */
  notes: { workflowStatus?: string | null; dismissed?: boolean }[];
  /** Claims linked to the appointment or to its notes */
  claimCount: number;
  /** Telehealth charge already routed to billing */
  chargeRouted?: boolean;
};

export type VisitBlock = { code: 'BILLED' | 'NOTE_SIGNED' | 'STATUS'; message: string };

const CHANGEABLE_STATUSES = new Set(['SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED']);

/** Why the visit type can no longer change (null = it can). Billed wins over signed. */
export function visitTypeChangeBlock(input: VisitBlockInput): VisitBlock | null {
  if (input.claimCount > 0 || input.chargeRouted) return { code: 'BILLED', message: VISIT_ALREADY_BILLED };
  const signed = input.notes.some((n) => !n.dismissed && n.workflowStatus && String(n.workflowStatus).toUpperCase() !== 'DRAFT');
  if (signed) return { code: 'NOTE_SIGNED', message: VISIT_NOTE_SIGNED };
  const s = String(input.status).toUpperCase();
  if (!CHANGEABLE_STATUSES.has(s)) {
    return { code: 'STATUS', message: `A ${s.toLowerCase().replace('_', '-')} visit's type can't be changed.` };
  }
  return null;
}

export type EndAdjust = {
  endsAt: Date;
  adjusted: boolean;
  /** Kept the booked end because the new length would run into the next appointment */
  collision: boolean;
  message: string | null;
};

/**
 * Scheduled end for the new type: start + the type's default length, unless that runs past the
 * start of the clinician's next appointment (then the booked time is kept). Shortening always fits.
 * `nextStartsAt` = earliest start of another live appointment of the clinician that would overlap
 * the longer slot (null = none); `formatTime` renders it for the message.
 */
export function adjustEndForType(input: {
  startsAt: Date;
  endsAt: Date;
  durationMin: number | null;
  nextStartsAt: Date | null;
  formatTime?: (d: Date) => string;
}): EndAdjust {
  const keep = (message: string | null, collision = false): EndAdjust => ({ endsAt: input.endsAt, adjusted: false, collision, message });
  if (!input.durationMin || input.durationMin <= 0) return keep(null);
  const target = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  if (target.getTime() === input.endsAt.getTime()) return keep(null);
  if (target.getTime() > input.endsAt.getTime() && input.nextStartsAt && input.nextStartsAt.getTime() < target.getTime()) {
    const at = input.formatTime ? input.formatTime(input.nextStartsAt) : input.nextStartsAt.toISOString();
    return keep(`Kept the scheduled time: ${input.durationMin} minutes would run into the next appointment at ${at}.`, true);
  }
  return { endsAt: target, adjusted: true, collision: false, message: `Scheduled end moved to fit ${input.durationMin} minutes.` };
}

export type BillingPlace = {
  telehealth: boolean;
  /** 11 in office; 10 / 02 from where the patient is; null = telehealth location unknown (billing asks) */
  placeOfService: string | null;
  /** Telehealth modifier the claim carries (audio-only uses the payer's audio-only modifier instead) */
  modifier: '95' | null;
  audioOnly: boolean;
};

/** POS / modifier for the visit's modality (same POS helper as the telehealth routes). */
export function billingPlaceForVisit(input: {
  isVirtual: boolean;
  audioOnly?: boolean | null;
  patientLocationType?: string | null;
  settings?: (TelehealthPosSettings & { posOffice?: string | null }) | null;
}): BillingPlace {
  if (!input.isVirtual) {
    const office = /^\d{2}$/.test(String(input.settings?.posOffice ?? '')) ? String(input.settings?.posOffice) : '11';
    return { telehealth: false, placeOfService: office, modifier: null, audioOnly: false };
  }
  const pos = resolveTelehealthPos({ patientLocationType: input.patientLocationType, settings: input.settings }).pos;
  const audioOnly = Boolean(input.audioOnly);
  return { telehealth: true, placeOfService: pos, modifier: audioOnly ? null : '95', audioOnly };
}

/** Note template that matches a visit type (Visit Guide protocol); null when the type does not decide one. */
export function noteTypeForVisitType(type: string, input: { clinicianRole?: string | null; clientAgeYears?: number | null } = {}): string | null {
  const r = resolveVisitKind({ appointmentType: type, clinicianRole: input.clinicianRole ?? null, clientAgeYears: input.clientAgeYears ?? null });
  if (r.kind === 'other' || !r.resolvedFrom.startsWith('appointment type')) {
    // Only the type text decides here; a role default is not a reason to switch the note
    return null;
  }
  return PROTOCOLS[r.kind]?.noteType ?? null;
}

/** "Individual Therapy, in person -> Medication Management, telehealth" (UI / confirmation line). */
export function visitTypeChangeSummary(from: { type: string; isVirtual: boolean }, to: { type: string; isVirtual: boolean }): string {
  const mode = (v: boolean) => (v ? 'telehealth' : 'in person');
  return `${from.type}, ${mode(from.isVirtual)} -> ${to.type}, ${mode(to.isVirtual)}`;
}
