/**
 * Pure helpers for the Visit Guide UI (Start visit links, live note-step completion, progress,
 * follow-up dates and action targets). No React, no fetch: unit-tested in tests/visit-guide-ui.test.ts.
 */
import type {
  AssessmentInstrument,
  GuideAction,
  GuideStep,
  StepStatus,
  VisitKind,
} from '@/lib/visits/types';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type StartVisitAppointment = {
  id: string;
  clientId: string;
  /** Practice wall date (YYYY-MM-DD) when the caller has it */
  date?: string | null;
  /** UTC instant; used for the date of service when `date` is missing */
  startsAt?: string | null;
  timeZone?: string | null;
  isVirtual?: boolean;
  type?: string | null;
  status?: string | null;
  noteStatus?: string | null;
  /** Group occurrence this per-member visit belongs to: the group session page documents it */
  groupSessionId?: string | null;
};

/** 'IN_SESSION' / 'in-session' / 'In Session' → 'in-session' */
export function normalizeVisitStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

/** Date of service for a visit on the practice clock. */
export function visitDos(appt: Pick<StartVisitAppointment, 'date' | 'startsAt' | 'timeZone'>): string {
  if (appt.date && YMD.test(appt.date)) return appt.date;
  if (appt.startsAt) {
    const t = Date.parse(appt.startsAt);
    if (!Number.isNaN(t)) return toPracticeWallTime(new Date(t), appt.timeZone || undefined).date;
  }
  return '';
}

/**
 * Where "Start visit" goes: the group session page for a group occurrence, the primary care visit
 * page for primary care, otherwise the progress note editor with the guide beside it.
 */
export function startVisitHref(appt: StartVisitAppointment, opts: { target?: 'note' | 'medical' } = {}): string {
  if (appt.groupSessionId) return `/dashboard/ehr/group-sessions/sessions/${encodeURIComponent(appt.groupSessionId)}`;
  if (opts.target === 'medical') {
    const qs = new URLSearchParams({ patient: appt.clientId, appointmentId: appt.id, guide: '1' });
    return `/dashboard/medical/visits?${qs.toString()}`;
  }
  const qs = new URLSearchParams({ clientId: appt.clientId, appointmentId: appt.id });
  const dos = visitDos(appt);
  if (dos) qs.set('dos', dos);
  qs.set('guide', '1');
  if (appt.isVirtual) qs.set('telehealth', '1');
  return `/dashboard/ehr/notes?${qs.toString()}`;
}

const STARTABLE = new Set(['scheduled', 'confirmed', 'checked-in', 'arrived', 'in-session']);
/** Missed visits: documented with the No-Show note (outreach + risk review) from the same button */
const MISSED = new Set(['no-show', 'late-cancel']);

/**
 * Show "Start visit" for upcoming / active visits, and for completed or missed (no-show / late
 * cancel) visits without a signed note. A missed visit opens the No-Show note with its guide.
 */
export function canStartVisit(status: string | null | undefined, noteStatus?: string | null): boolean {
  const s = normalizeVisitStatus(status);
  if (STARTABLE.has(s)) return true;
  if (s === 'completed' || MISSED.has(s)) return normalizeVisitStatus(noteStatus) !== 'signed';
  return false;
}

export function startVisitLabel(status: string | null | undefined, noteStatus?: string | null): string {
  const n = normalizeVisitStatus(noteStatus);
  if (n === 'in-progress' || n === 'ai-draft') return 'Continue note';
  const s = normalizeVisitStatus(status);
  if (MISSED.has(s)) return 'Document no-show';
  if (s === 'completed') return 'Write note';
  return 'Start visit';
}

// ─── Checklist state ─────────────────────────────────────────────────────────

/** Text of a note section, matched case-insensitively (structured editors use their own headings). */
export function sectionText(sections: Record<string, string> | null | undefined, name: string): string {
  if (!sections || !name) return '';
  if (typeof sections[name] === 'string') return sections[name];
  const want = name.trim().toLowerCase();
  for (const [k, v] of Object.entries(sections)) {
    if (k.trim().toLowerCase() === want) return typeof v === 'string' ? v : '';
  }
  return '';
}

/** A section counts as written once it has real text (unfilled [___] blanks do not count). */
export function sectionHasText(sections: Record<string, string> | null | undefined, name: string): boolean {
  return sectionText(sections, name).replace(/\[_+\]/g, '').trim().length > 0;
}

/**
 * The note being written holds a completed C-SSRS screen (the in-note screener of the therapy and
 * psychiatry templates: "C-SSRS screen result: POSITIVE" or "NEGATIVE"; an incomplete screen does not count).
 */
export function noteHasCssrsScreen(sections: Record<string, string> | null | undefined): boolean {
  if (!sections) return false;
  return Object.values(sections).some((t) => typeof t === 'string' && /^C-SSRS screen result: (POSITIVE|NEGATIVE)\b/m.test(t));
}

/**
 * 'note' steps tick live from the note being written. A step the clinician marked N/A / deferred
 * keeps that status; steps without a matching section (or with no sections passed) are unchanged.
 */
export function withLiveNoteSteps(steps: GuideStep[], sections?: Record<string, string> | null): GuideStep[] {
  if (!sections) return steps;
  const cssrsInNote = noteHasCssrsScreen(sections);
  return steps.map((step) => {
    // The C-SSRS screen done inside the note counts for the screening step (no second entry on the assessments page)
    if (step.id === 'cssrs' && step.status === 'not_done' && cssrsInNote) {
      return { ...step, status: 'done' as StepStatus, detail: 'C-SSRS screen documented in this note' };
    }
    if (step.source !== 'note' || !step.noteSection) return step;
    if (step.status === 'not_applicable' || step.status === 'deferred') return step;
    const done = sectionHasText(sections, step.noteSection);
    const status: StepStatus = done ? 'done' : 'not_done';
    if (status === step.status) return step;
    return { ...step, status, detail: done ? `${step.noteSection} documented in this note` : step.detail };
  });
}

/** done, N/A and deferred all resolve a step (deferred / N/A carry the clinician's reason). */
export function isResolved(status: StepStatus): boolean {
  return status !== 'not_done';
}

export function guideProgress(steps: GuideStep[]): { required: number; requiredResolved: number; remaining: number; total: number; resolved: number } {
  const req = steps.filter((s) => s.level === 'required');
  const requiredResolved = req.filter((s) => isResolved(s.status)).length;
  return {
    required: req.length,
    requiredResolved,
    remaining: req.length - requiredResolved,
    total: steps.length,
    resolved: steps.filter((s) => isResolved(s.status)).length,
  };
}

/** Required steps still open: shown as (non-blocking) warnings before signing. */
export function outstandingRequired(steps: GuideStep[]): GuideStep[] {
  return steps.filter((s) => s.level === 'required' && s.status === 'not_done');
}

export function needsReason(status: StepStatus): boolean {
  return status === 'not_applicable' || status === 'deferred';
}

export type ChecklistIdentity = { clientId: string; appointmentId?: string | null; noteId?: string | null; kind: VisitKind };

/** Body for POST /api/visits/checklist; null when a required reason is missing. */
export function checklistMarkBody(
  id: ChecklistIdentity,
  stepId: string,
  status: Exclude<StepStatus, 'not_done'>,
  reason?: string
): Record<string, string> | null {
  const why = (reason || '').trim();
  if (needsReason(status) && !why) return null;
  const body: Record<string, string> = { clientId: id.clientId, kind: id.kind, stepId, status };
  if (id.appointmentId) body.appointmentId = id.appointmentId;
  if (id.noteId) body.noteId = id.noteId;
  if (why) body.reason = why;
  return body;
}

/** Body for DELETE /api/visits/checklist (un-mark). */
export function checklistUnmarkBody(id: ChecklistIdentity, stepId: string): Record<string, string> {
  const body: Record<string, string> = { clientId: id.clientId, stepId };
  if (id.appointmentId) body.appointmentId = id.appointmentId;
  if (id.noteId) body.noteId = id.noteId;
  return body;
}

export function guideUrl(p: { clientId: string; appointmentId?: string | null; kind?: string | null; noteId?: string | null }): string {
  const qs = new URLSearchParams({ clientId: p.clientId });
  if (p.appointmentId) qs.set('appointmentId', p.appointmentId);
  if (p.kind) qs.set('kind', p.kind);
  if (p.noteId) qs.set('noteId', p.noteId);
  return `/api/visits/guide?${qs.toString()}`;
}

// ─── Follow-up ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD + days (calendar arithmetic, no time-zone drift). */
export function addDaysYmd(ymd: string, days: number): string {
  if (!YMD.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + Math.round(days)));
  return t.toISOString().slice(0, 10);
}

export function followUpWeeks(days: number): number {
  return Math.max(1, Math.round(days / 7));
}

/** "2 weeks" / "3 days" / "1 week" */
export function followUpLabel(days: number): string {
  if (days < 7) {
    const n = Math.max(1, Math.round(days));
    return `${n} day${n === 1 ? '' : 's'}`;
  }
  const w = followUpWeeks(days);
  return `${w} week${w === 1 ? '' : 's'}`;
}

/**
 * Appointment type the follow-up is booked as (the schedule's APPOINTMENT_TYPES), so the New
 * Appointment form opens on the right visit type. null = let the scheduler choose.
 */
export function followUpTypeForKind(kind: VisitKind | string | null | undefined): string | null {
  switch (kind) {
    case 'med_management':
    case 'psych_eval_adult':
    case 'psych_eval_child':
    case 'psych_reeval':
      return 'Medication Management';
    case 'therapy_intake':
    case 'therapy_individual':
    case 'crisis_followup':
    case 'treatment_plan_review':
    case 'sud_individual':
    case 'sud_intake':
      return 'Individual Therapy';
    case 'prp':
      return 'PRP Session';
    default:
      return null;
  }
}

/** Opens the schedule's New Appointment form for the client on the suggested date. */
export function bookFollowUpHref(p: { clientId: string; days: number | null; from: string; type?: string | null }): string {
  const qs = new URLSearchParams({ new: '1', client: p.clientId });
  if (p.days != null && YMD.test(p.from)) qs.set('after', addDaysYmd(p.from, p.days));
  if (p.type) qs.set('type', p.type);
  return `/dashboard/appointments?${qs.toString()}`;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export type ActionTarget =
  | { kind: 'href'; href: string; label: string }
  | { kind: 'drfirst'; screen: string; label: string }
  | { kind: 'pdmp'; label: string }
  | { kind: 'section'; section: string; label: string };

const SUD_INSTRUMENTS = new Set<AssessmentInstrument>(['AUDIT-C', 'DAST-10', 'CRAFFT', 'ASAM']);

export function assessmentHref(instrument: AssessmentInstrument, clientId: string): string {
  const c = encodeURIComponent(clientId);
  if (instrument === 'C-SSRS') return `/dashboard/ehr/assessments/cssrs?clientId=${c}`;
  if (instrument === 'LOCUS') return `/dashboard/ehr/locus?clientId=${c}`;
  if (instrument === 'SDOH') return `/dashboard/sdoh?clientId=${c}`;
  if (SUD_INSTRUMENTS.has(instrument)) return `/dashboard/ehr/assessments/sud?clientId=${c}`;
  return `/dashboard/ehr/assessments?clientId=${c}&instrument=${encodeURIComponent(instrument)}`;
}

const DRFIRST_LABEL: Record<string, string> = {
  patient: 'Open DrFirst',
  manage_medications: 'Medications in DrFirst',
  manage_allergies: 'Allergies in DrFirst',
  message: 'DrFirst messages',
};

/** Maps a guide action to an in-app route (or a DrFirst launch / note section). */
export function guideActionTarget(
  action: GuideAction | undefined,
  ctx: { clientId: string; appointmentId?: string | null; today: string; followUpDays?: number | null; kind?: VisitKind | string | null }
): ActionTarget | null {
  if (!action) return null;
  const c = encodeURIComponent(ctx.clientId);
  switch (action.kind) {
    case 'assessment':
      return { kind: 'href', href: assessmentHref(action.instrument, ctx.clientId), label: `Give ${action.instrument}` };
    case 'drfirst':
      return { kind: 'drfirst', screen: action.screen, label: DRFIRST_LABEL[action.screen] || 'Open DrFirst' };
    case 'labs':
      return { kind: 'href', href: `/dashboard/ehr/labs?clientId=${c}`, label: 'Order labs' };
    case 'safety_plan':
      return { kind: 'href', href: `/dashboard/ehr/safety-plan?clientId=${c}`, label: 'Safety plan' };
    case 'treatment_plan':
      return { kind: 'href', href: `/dashboard/ehr/treatment-plans?clientId=${c}`, label: 'Treatment plan' };
    case 'consents':
      return {
        kind: 'href',
        href: `/dashboard/ehr/consents/client/${c}${action.template ? `?template=${encodeURIComponent(action.template)}` : ''}`,
        label: 'Consents',
      };
    case 'sdoh':
      return { kind: 'href', href: `/dashboard/sdoh?clientId=${c}`, label: 'SDOH screen' };
    case 'book_follow_up': {
      // The guide's suggestion (already shortened for elevated risk / a med change) wins over the
      // protocol's default weeks, so the step button and the Follow-up card agree.
      const days = ctx.followUpDays ?? (action.weeks != null ? action.weeks * 7 : null);
      return {
        kind: 'href',
        href: bookFollowUpHref({ clientId: ctx.clientId, days, from: ctx.today, type: followUpTypeForKind(ctx.kind) }),
        label: days != null ? `Book in ${followUpLabel(days)}` : 'Book follow-up',
      };
    }
    case 'scribe': {
      // The scribe docks inside the visit's note: never a separate page during a visit
      const qs = new URLSearchParams({ clientId: ctx.clientId });
      if (ctx.appointmentId) qs.set('appointmentId', ctx.appointmentId);
      qs.set('guide', '1');
      qs.set('scribe', '1');
      return { kind: 'href', href: `/dashboard/ehr/notes?${qs.toString()}`, label: 'AI Scribe' };
    }
    case 'note_section':
      return { kind: 'section', section: action.section, label: `Go to ${action.section}` };
    case 'pdmp_attest':
      return { kind: 'pdmp', label: 'Record PDMP (CRISP) query' };
    case 'link':
      return action.href.startsWith('/') ? { kind: 'href', href: action.href, label: action.label } : null;
    default:
      return null;
  }
}

export const PHASE_LABEL: Record<GuideStep['phase'], string> = {
  prepare: 'Prepare',
  during: 'During the visit',
  wrap_up: 'Wrap-up',
};

export const WHEN_LABEL: Record<string, string> = {
  controlled_meds: 'If on controlled meds',
  antipsychotic: 'If on an antipsychotic',
  minor: 'Minor',
  telehealth: 'Telehealth',
  new_med: 'New medication',
  elevated_risk: 'Elevated risk',
  positive_bh_screen: 'Positive PHQ-9 / GAD-7',
};

/** First suggested code the note type actually offers ('' when none fits). */
export function firstAllowedCpt(suggested: string[] | null | undefined, options: string[]): string {
  if (!suggested?.length) return '';
  const allowed = new Set(options);
  return suggested.find((c) => allowed.has(c)) || '';
}
