/**
 * Visit kind from the appointment (pure). Order: explicit kind → billing code (Valant code in the
 * notes, or a code typed as the appointment type) → group → appointment type text → label meaning →
 * client program → clinician role default. `resolvedFrom` says which input decided, for the UI.
 */
import type { VisitKind } from './types';
import { isVisitKind } from './protocols';

export type ResolveKindInput = {
  appointmentType?: string | null;
  notes?: string | null;
  labelMeaning?: string | null;
  isGroup?: boolean;
  groupIsSud?: boolean;
  clientAgeYears?: number | null;
  clinicianRole?: string | null;
  clientProgram?: string | null;
  explicitKind?: string | null;
};

const PRESCRIBER_ROLES = new Set(['PSYCHIATRIST', 'NP']);
const MEDICAL_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']);
const PROGRAM_ROLES = new Set(['PRP_SPECIALIST']);

/** "Valant code: H2017", "Valant code: 90837T" → base code */
export function billingCodeFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes ?? '').match(/Valant code:\s*([A-Z]?\d{4,5}[A-Z]?)/i);
  return m ? normalizeCode(m[1]) : null;
}

/** "90837T" / "90834-95" / "h2017 HE" → "90837" / "90834" / "H2017"; null when not a code */
export function normalizeCode(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim().toUpperCase();
  const m = t.match(/^([A-Z]\d{4}|\d{5})/);
  return m ? m[1] : null;
}

function isChild(age: number | null | undefined): boolean {
  return typeof age === 'number' && age < 18;
}

function roleOf(role: string | null | undefined): 'prescriber' | 'medical' | 'program' | 'other' {
  const r = String(role ?? '').toUpperCase();
  if (PRESCRIBER_ROLES.has(r)) return 'prescriber';
  if (MEDICAL_ROLES.has(r)) return 'medical';
  if (PROGRAM_ROLES.has(r)) return 'program';
  return 'other';
}

/** Billing code → kind (null when the code does not decide it) */
export function kindForCode(code: string, input: ResolveKindInput): VisitKind | null {
  const n = Number(code);
  const medical = roleOf(input.clinicianRole) === 'medical';
  const evalKind: VisitKind = isChild(input.clientAgeYears) ? 'psych_eval_child' : 'psych_eval_adult';
  if (code === '90791') return 'therapy_intake';
  if (code === '90792') return evalKind;
  // New-patient E/M: primary care for the medical team, else a psychiatric evaluation
  if (n >= 99202 && n <= 99205) return medical ? 'primary_care' : evalKind;
  if (n >= 99211 && n <= 99215) return medical ? 'primary_care' : 'med_management';
  if (['90833', '90836', '90838'].includes(code)) return 'med_management';
  if (['90832', '90834', '90837'].includes(code)) return 'therapy_individual';
  if (code === '90846' || code === '90847') return 'therapy_family';
  if (code === '90853') return input.groupIsSud ? 'sud_group' : 'group_therapy';
  if (code === 'H2016' || code === 'H2017' || code === 'H2018') return 'prp';
  if (code === 'H0015' || code === 'S9480') return 'iop';
  if (code === 'H0035' || code === 'S0201') return 'php';
  if (code === 'H0001') return 'sud_intake';
  if (code === 'H0004') return 'sud_individual';
  if (code === 'H0005') return 'sud_group';
  if (n >= 90867 && n <= 90869) return 'tms';
  if (code === 'G2082' || code === 'G2083') return 'spravato';
  if ((n >= 99441 && n <= 99443) || (n >= 98966 && n <= 98968)) return 'telephone';
  return null;
}

/** Appointment type text → kind (null when ambiguous, e.g. "Telehealth" / "Appointment") */
export function kindForTypeText(type: string, input: ResolveKindInput): VisitKind | null {
  const t = type.trim().toLowerCase();
  if (!t) return null;
  const role = roleOf(input.clinicianRole);
  const evalKind: VisitKind = isChild(input.clientAgeYears) ? 'psych_eval_child' : 'psych_eval_adult';
  const sud = /\bsud\b|substance|addiction|chemical dependency/.test(t);
  if (/no[- ]?show|missed appointment/.test(t)) return 'no_show';
  if (/discharge/.test(t)) return 'discharge';
  if (/crisis/.test(t)) return 'crisis_followup';
  if (/spravato|esketamine/.test(t)) return 'spravato';
  if (/\btms\b|transcranial/.test(t)) return 'tms';
  if (/\bprp\b|psychiatric rehab/.test(t)) return 'prp';
  if (/\bphp\b|partial hospitali[sz]ation/.test(t)) return 'php';
  if (/\biop\b|intensive outpatient/.test(t)) return 'iop';
  if (/treatment plan/.test(t)) return 'treatment_plan_review';
  if (/re-?eval/.test(t)) return 'psych_reeval';
  if (/psychiatric evaluation|psych eval|initial evaluation/.test(t)) return role === 'medical' ? 'primary_care' : evalKind;
  if (/intake|initial assessment/.test(t)) return sud ? 'sud_intake' : 'therapy_intake';
  if (/group/.test(t)) return sud || input.groupIsSud ? 'sud_group' : 'group_therapy';
  if (/medication (review|management)|med (management|check|review)|med mgmt/.test(t)) return role === 'medical' ? 'primary_care' : 'med_management';
  if (/telehealth check-?in/.test(t)) return role === 'prescriber' ? 'med_management' : 'telephone';
  if (/telephone|phone call|phone encounter/.test(t)) return 'telephone';
  if (/family|couples|marriage/.test(t)) return 'therapy_family';
  if (sud) return 'sud_individual';
  if (/primary care|physical|sick visit|annual|wellness/.test(t)) return 'primary_care';
  if (/therapy|psychotherapy|counsel/.test(t)) return 'therapy_individual';
  return null;
}

export function resolveVisitKind(input: ResolveKindInput): { kind: VisitKind; resolvedFrom: string } {
  if (input.explicitKind && isVisitKind(input.explicitKind)) return { kind: input.explicitKind, resolvedFrom: 'chosen by clinician' };

  const role = roleOf(input.clinicianRole);
  const label = String(input.labelMeaning ?? '').toLowerCase();
  const reeval = (r: { kind: VisitKind; resolvedFrom: string }) =>
    label === 'reeval' && role === 'prescriber' && ['med_management', 'psych_eval_adult', 'psych_eval_child'].includes(r.kind)
      ? { kind: 'psych_reeval' as VisitKind, resolvedFrom: `${r.resolvedFrom} + re-eval label` }
      : r;

  const valant = billingCodeFromNotes(input.notes);
  if (valant) {
    const k = kindForCode(valant, input);
    if (k) return reeval({ kind: k, resolvedFrom: `Valant code ${valant}` });
  }
  const typeCode = normalizeCode(input.appointmentType);
  if (typeCode && /^\s*[A-Z]?\d/i.test(String(input.appointmentType))) {
    const k = kindForCode(typeCode, input);
    if (k) return reeval({ kind: k, resolvedFrom: `code ${typeCode}` });
  }
  if (input.isGroup) {
    return { kind: input.groupIsSud ? 'sud_group' : 'group_therapy', resolvedFrom: input.groupIsSud ? 'SUD group session' : 'group session' };
  }
  if (input.appointmentType) {
    const k = kindForTypeText(input.appointmentType, input);
    if (k) return reeval({ kind: k, resolvedFrom: `appointment type "${input.appointmentType.trim()}"` });
  }
  if (label === 'reeval' && role === 'prescriber') return { kind: 'psych_reeval', resolvedFrom: 're-eval label' };
  if (label === 'new') {
    if (role === 'prescriber') return { kind: isChild(input.clientAgeYears) ? 'psych_eval_child' : 'psych_eval_adult', resolvedFrom: 'new-patient label' };
    if (role === 'medical') return { kind: 'primary_care', resolvedFrom: 'new-patient label' };
    return { kind: 'therapy_intake', resolvedFrom: 'new-patient label' };
  }
  const program = String(input.clientProgram ?? '').toLowerCase();
  if (program === 'prp' && (role === 'program' || role === 'other')) return { kind: 'prp', resolvedFrom: 'client PRP enrollment' };
  // Admitted to an intensive program (src/lib/intensive): a non-prescriber visit is a program day
  if ((program === 'iop' || program === 'php') && role === 'other') return { kind: program, resolvedFrom: `client ${program.toUpperCase()} admission` };
  if (role === 'prescriber') return { kind: 'med_management', resolvedFrom: 'clinician role (prescriber)' };
  if (role === 'medical') return { kind: 'primary_care', resolvedFrom: 'clinician role (primary care)' };
  if (role === 'program') return { kind: 'prp', resolvedFrom: 'clinician role (PRP)' };
  return { kind: 'other', resolvedFrom: 'not enough information' };
}

// ─── No appointment given (e.g. Scribe opened from the client) ─────────────

const THERAPY_ROLES = new Set(['THERAPIST', 'CLINICIAN']);
/** Appointment statuses that can stand in for "this visit" (missed / cancelled ones cannot) */
const FALLBACK_STATUSES = new Set(['SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED']);
const ACTIVE_STATUSES = new Set(['CHECKED_IN', 'IN_SESSION']);

/**
 * Today's appointment to use when none was given. Order: the viewer's own appointments first; then a
 * checked-in / in-session visit, the next upcoming one, else the most recent one earlier today.
 * Pass only today's appointments (practice clock).
 */
export function pickFallbackAppointment<T extends { startsAt: Date; status: string; clinicianId?: string | null }>(
  appts: T[],
  now: Date,
  viewerId?: string | null,
): { appt: T; which: 'current' | 'next' | 'most recent' } | null {
  const usable = appts.filter((a) => FALLBACK_STATUSES.has(String(a.status)));
  const own = viewerId ? usable.filter((a) => a.clinicianId === viewerId) : [];
  const pool = own.length ? own : usable;
  if (!pool.length) return null;
  const active = pool.filter((a) => ACTIVE_STATUSES.has(String(a.status))).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (active) return { appt: active, which: 'current' };
  const next = pool.filter((a) => a.startsAt.getTime() >= now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (next) return { appt: next, which: 'next' };
  const recent = [...pool].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  return { appt: recent, which: 'most recent' };
}

/** Default visit kind by the clinician's role when nothing else decides it (null: no sensible default). */
export function defaultKindForRole(role: string | null | undefined): { kind: VisitKind; resolvedFrom: string } | null {
  const r = String(role ?? '').toUpperCase();
  const group = roleOf(r);
  if (group === 'prescriber') return { kind: 'med_management', resolvedFrom: 'default for clinician role (prescriber)' };
  if (group === 'medical') return { kind: 'primary_care', resolvedFrom: 'default for clinician role (primary care)' };
  if (group === 'program') return { kind: 'prp', resolvedFrom: 'default for clinician role (PRP)' };
  if (THERAPY_ROLES.has(r)) return { kind: 'therapy_individual', resolvedFrom: 'default for clinician role (therapist)' };
  return null;
}
