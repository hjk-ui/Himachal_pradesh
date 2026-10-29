/**
 * Claim rules shared by claim creation (claims.ts), the claim scrubber and the Waystar
 * pre-send mapper (waystarSftpClaims.ts). Pure: no DB.
 *
 *  - noteClaimFindings(): the signed note is the source of truth for the date of service,
 *    the rendering clinician and the CPT. The appointment the note was started from is only
 *    a cross-check (clinician + practice date must match).
 *  - prpClaimBlock(): PRP codes follow the practice's confirmed PRP billing model
 *    (PracticeSettings.prpBillingModel: per-encounter H2017, or monthly H2018 + H2016). With no
 *    confirmed model, PRP claims are held; codes from the other model are refused.
 *  - codingEditFindings(): minutes vs CPT (CPT time rule), add-on / primary pairing, NCCI
 *    pairs and per-day unit caps. Errors block; warnings inform.
 */
import { isPrpBillingModel } from '@/lib/prp/standard';

export type RuleFinding = { code: string; severity: 'error' | 'warning'; message: string };

const err = (code: string, message: string): RuleFinding => ({ code, severity: 'error', message });
const warn = (code: string, message: string): RuleFinding => ({ code, severity: 'warning', message });

/** "90837-95" / "90837 GT" -> "90837"; H2017HK stays one code. */
export function baseCode(raw: string | null | undefined): string {
  const c = String(raw ?? '').trim().toUpperCase();
  if (c.startsWith('H2017HK')) return 'H2017HK';
  return c.split(/[-\s:]/)[0] || '';
}

/**
 * ProgressNote.dateOfService is stored as UTC midnight of the practice calendar date the
 * clinician entered (dateOfServiceFromInput), so the ISO date part IS the practice date.
 */
export function notePracticeDate(dateOfService: Date | string | null | undefined): string | null {
  if (!dateOfService) return null;
  const d = typeof dateOfService === 'string' ? new Date(dateOfService) : dateOfService;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Practice-calendar date (YYYY-MM-DD) of an instant, e.g. an appointment start. */
export function practiceDateOf(at: Date, timeZone = 'America/New_York') {
  return at.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ─── Co-signature ─────────────────────────────────────────────────────────────

export type CosignState = { cosignRequired?: boolean | null; cosignedAt?: Date | string | null } | null | undefined;

/** A supervised clinician's note waiting for the supervisor's co-signature is not billable. */
export function cosignPending(workflow: CosignState): boolean {
  return Boolean(workflow?.cosignRequired && !workflow?.cosignedAt);
}

export const COSIGN_PENDING_MESSAGE =
  'Supervisor co-signature is pending on the progress note; the claim cannot be created, marked ready or sent until it is co-signed.';

// ─── PRP ──────────────────────────────────────────────────────────────────────

export const PRP_CODES = new Set(['H2016', 'H2017', 'H2017HK', 'H2018']);
export const PRP_BLOCK_MESSAGE =
  'PRP billing model not confirmed: choose per-encounter H2017 or monthly H2018 + H2016 in PRP > Program Settings before billing PRP.';

/**
 * PRP claim check against the practice's confirmed billing model (owner turned PRP claims on 2026-10-21).
 * No PRP code: null. No confirmed model: held. Codes from the other model: refused. Else null.
 */
export function prpClaimBlock(cpts: Array<string | null | undefined>, billingModel?: string | null): string | null {
  const codes = cpts.map((c) => baseCode(c)).filter((c) => PRP_CODES.has(c));
  if (!codes.length) return null;
  if (!isPrpBillingModel(billingModel)) return PRP_BLOCK_MESSAGE;
  if (billingModel === 'per_encounter_h2017') {
    return codes.some((c) => c === 'H2018' || c === 'H2016')
      ? 'This practice bills PRP per encounter (H2017). H2018 / H2016 lines are not used; bill the encounter as H2017.'
      : null;
  }
  return codes.some((c) => c === 'H2017' || c === 'H2017HK')
    ? 'This practice bills PRP as the monthly case rate (H2018 + H2016 encounter lines). H2017 is not used.'
    : null;
}

/**
 * PRP services need a current IRP: the client's PrpWorkflow at stage "irp" with an effective date
 * on or before the date of service, and the review due date not passed. Null = OK.
 */
export function prpIrpProblem(
  workflow: { stage: string; irpEffectiveDate: Date | null; irpReviewDueDate: Date | null } | null | undefined,
  serviceDate: string | null
): string | null {
  if (!workflow || workflow.stage !== 'irp' || !workflow.irpEffectiveDate) {
    return 'PRP requires a finalized Individual Rehabilitation Plan (IRP) for the client.';
  }
  const dos = serviceDate ?? new Date().toISOString().slice(0, 10);
  if (workflow.irpEffectiveDate.toISOString().slice(0, 10) > dos) return `The client's IRP is effective ${workflow.irpEffectiveDate.toISOString().slice(0, 10)}, after the date of service ${dos}.`;
  if (workflow.irpReviewDueDate && workflow.irpReviewDueDate.toISOString().slice(0, 10) < dos) {
    return `The client's IRP review was due ${workflow.irpReviewDueDate.toISOString().slice(0, 10)}; update the IRP before billing PRP.`;
  }
  return null;
}

// ─── Note vs appointment ──────────────────────────────────────────────────────

export type NoteForClaim = {
  id: string;
  clinicianId: string | null;
  dateOfService: Date | string | null;
  cptCode: string | null;
  appointmentId?: string | null;
  workflow?: ({ status?: string | null } & NonNullable<CosignState>) | null;
};

export type AppointmentForCheck = { id: string; clinicianId: string | null; startsAt: Date };

/** Problems with billing this note (errors block). `appointment` = the note's linked appointment. */
export function noteClaimFindings(
  note: NoteForClaim,
  appointment: AppointmentForCheck | null | undefined,
  opts: { timeZone?: string; requireCpt?: boolean } = {}
): RuleFinding[] {
  const out: RuleFinding[] = [];
  if (cosignPending(note.workflow)) out.push(err('COSIGN_PENDING', COSIGN_PENDING_MESSAGE));
  if (opts.requireCpt !== false && !baseCode(note.cptCode)) {
    out.push(err('NOTE_CPT_MISSING', 'No CPT on the signed note. The clinician (or an addendum) must record the CPT; codes are never guessed.'));
  }
  const dos = notePracticeDate(note.dateOfService);
  if (!dos) out.push(err('NOTE_DOS_MISSING', 'The progress note has no date of service; the claim date of service comes from the note.'));
  if (!note.clinicianId) out.push(err('NOTE_CLINICIAN_MISSING', 'The progress note has no clinician; the rendering provider comes from the note.'));
  if (appointment) {
    if (appointment.clinicianId && note.clinicianId && appointment.clinicianId !== note.clinicianId) {
      out.push(err('APPT_CLINICIAN_MISMATCH', 'The note was written by a different clinician than the linked appointment; fix the appointment or the note before billing.'));
    }
    const apptDate = practiceDateOf(appointment.startsAt, opts.timeZone);
    if (dos && apptDate !== dos) {
      out.push(err('APPT_DATE_MISMATCH', `The note's date of service (${dos}) differs from the linked appointment's practice date (${apptDate}).`));
    }
  }
  return out;
}

/** Appointment statuses a visit can have happened in (cancellations / no-shows are never linked). */
const LINKABLE_STATUSES = new Set(['SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED']);

/**
 * Backfill: the appointment an existing note belongs to, ONLY when exactly one appointment of the
 * same client, with the same clinician, falls on the note's practice date. Otherwise null + why.
 */
export function matchNoteToAppointment(
  note: { clientId: string; clinicianId: string | null; dateOfService: Date | string | null },
  appointments: Array<AppointmentForCheck & { clientId: string; status: string }>,
  timeZone = 'America/New_York'
): { appointmentId: string | null; reason: 'matched' | 'no-dos' | 'no-clinician' | 'none' | 'ambiguous' } {
  const dos = notePracticeDate(note.dateOfService);
  if (!dos) return { appointmentId: null, reason: 'no-dos' };
  if (!note.clinicianId) return { appointmentId: null, reason: 'no-clinician' };
  const hits = appointments.filter(
    (a) =>
      a.clientId === note.clientId &&
      a.clinicianId === note.clinicianId &&
      LINKABLE_STATUSES.has(a.status) &&
      practiceDateOf(a.startsAt, timeZone) === dos
  );
  if (hits.length === 1) return { appointmentId: hits[0].id, reason: 'matched' };
  return { appointmentId: null, reason: hits.length ? 'ambiguous' : 'none' };
}

// ─── Coding edits ─────────────────────────────────────────────────────────────

export type CodedLine = { cpt: string; units: number };

const EM_RE = /^992(0[2-5]|1[1-5])$/;
export const isEmCode = (c: string) => EM_RE.test(baseCode(c));

/** Psychotherapy time windows (CPT time rule: a unit of time is attained when the midpoint is passed). */
const TIME_WINDOWS: Record<string, { min: number; max?: number }> = {
  '90832': { min: 16, max: 37 },
  '90834': { min: 38, max: 52 },
  '90837': { min: 53 },
  '90846': { min: 26 },
  '90847': { min: 26 },
  '90839': { min: 30 },
};
const ADD_ON_WINDOWS: Record<string, { min: number; max?: number }> = {
  '90833': { min: 16, max: 37 },
  '90836': { min: 38, max: 52 },
  '90838': { min: 53 },
};
const PSYCH_ADD_ONS = new Set(Object.keys(ADD_ON_WINDOWS));
const PSYCHOTHERAPY = new Set(['90832', '90833', '90834', '90836', '90837', '90838', '90846', '90847', '90853']);
const DIAGNOSTIC_EVAL = new Set(['90791', '90792']);
/** Primary codes 90785 (interactive complexity) may be added to. */
const INTERACTIVE_PRIMARY = new Set(['90791', '90792', '90832', '90834', '90837', '90853', '90833', '90836', '90838']);
/**
 * Per-day unit cap. CMS publishes practitioner MUE values, but they are not loaded in Altrixs and
 * are not cited here, so a conservative cap of 1 per day applies to these codes until billing
 * verifies the CMS MUE table.
 */
const CONSERVATIVE_DAILY_CAP = new Set(['90791', '90792', '90832', '90833', '90834', '90836', '90837', '90838', '90839', '90846', '90847', '90853', '90785']);

function windowText(w: { min: number; max?: number }) {
  return w.max ? `${w.min}-${w.max} minutes` : `${w.min}+ minutes`;
}

/** 90840 units required by total crisis minutes: one per additional 30 minutes beyond the first 60 (75, 105, 135 ...). */
export function crisisAddOnUnits(minutes: number): number {
  return minutes >= 75 ? Math.floor((minutes - 75) / 30) + 1 : 0;
}

/**
 * Coding edits on one claim's lines. `minutes` = documented session minutes (note duration);
 * `psychotherapyMinutes` = psychotherapy time documented separately from an E/M;
 * `sameDayCodes` = codes already billed for this client by the same rendering provider on the
 * same date (other claims), for NCCI pairs and per-day caps.
 */
export function codingEditFindings(
  lines: CodedLine[],
  ctx: { minutes: number | null | undefined; psychotherapyMinutes?: number | null; sameDayCodes?: string[] }
): RuleFinding[] {
  const out: RuleFinding[] = [];
  const codes = lines.map((l) => baseCode(l.cpt));
  const has = (c: string) => codes.includes(c);
  const minutes = ctx.minutes ?? null;
  const sameDay = (ctx.sameDayCodes || []).map(baseCode);
  const all = [...codes, ...sameDay];

  // Minutes vs CPT
  for (const code of new Set(codes)) {
    const w = TIME_WINDOWS[code];
    if (!w) continue;
    if (!minutes || minutes < 1) {
      out.push(err('MINUTES_MISSING', `${code} is a timed code but the note documents no session minutes.`));
      continue;
    }
    if (minutes < w.min || (w.max != null && minutes > w.max)) {
      out.push(err('MINUTES_CPT_MISMATCH', `${code} needs ${windowText(w)} (CPT time rule); the note documents ${minutes} minutes.`));
    }
  }

  // Crisis: 90840 needs 90839, units by time
  if (has('90840')) {
    if (!has('90839')) out.push(err('ADDON_NO_PRIMARY', '90840 (each additional 30 minutes of crisis psychotherapy) requires 90839 on the same claim.'));
    if (minutes) {
      const want = crisisAddOnUnits(minutes);
      const units = lines.filter((l) => baseCode(l.cpt) === '90840').reduce((t, l) => t + l.units, 0);
      if (want === 0) out.push(err('MINUTES_CPT_MISMATCH', `90840 needs at least 75 minutes of crisis psychotherapy; the note documents ${minutes}.`));
      else if (units !== want) out.push(err('UNITS_MINUTES_MISMATCH', `${minutes} crisis minutes support ${want} unit(s) of 90840, not ${units}.`));
    }
  } else if (has('90839') && minutes && crisisAddOnUnits(minutes) > 0) {
    out.push(warn('CRISIS_ADDON_MISSING', `${minutes} crisis minutes support ${crisisAddOnUnits(minutes)} unit(s) of 90840, which is not on the claim.`));
  }

  // Psychotherapy add-ons with E/M
  for (const code of new Set(codes.filter((c) => PSYCH_ADD_ONS.has(c)))) {
    if (!codes.some(isEmCode)) {
      out.push(err('ADDON_NO_PRIMARY', `${code} is a psychotherapy add-on and requires an E/M primary (99202-99215) on the same claim.`));
    }
    const pm = ctx.psychotherapyMinutes ?? null;
    if (!pm) {
      out.push(err('ADDON_TIME_MISSING', `${code} requires psychotherapy time documented separately from the E/M; the note has none.`));
    } else {
      const w = ADD_ON_WINDOWS[code];
      if (pm < w.min || (w.max != null && pm > w.max)) {
        out.push(err('MINUTES_CPT_MISMATCH', `${code} needs ${windowText(w)} of psychotherapy (CPT time rule); the note documents ${pm}.`));
      }
    }
  }
  if (codes.filter((c) => PSYCH_ADD_ONS.has(c)).length > 1) {
    out.push(err('ADDON_DUPLICATE', 'Only one psychotherapy add-on (90833 / 90836 / 90838) can be billed with an E/M.'));
  }

  // Interactive complexity
  if (has('90785')) {
    if (has('90839') || has('90840') || sameDay.includes('90839') || sameDay.includes('90840')) {
      out.push(err('NCCI_PAIR', '90785 (interactive complexity) cannot be billed with crisis psychotherapy 90839 / 90840.'));
    }
    if (!codes.some((c) => INTERACTIVE_PRIMARY.has(c))) {
      out.push(err('ADDON_NO_PRIMARY', '90785 (interactive complexity) requires a primary psychiatric code (90791, 90792, 90832, 90834, 90837, 90853 or an E/M with 90833 / 90836 / 90838) on the same claim.'));
    }
  }

  // Diagnostic evaluation with E/M or psychotherapy, same day same provider
  if (all.some((c) => DIAGNOSTIC_EVAL.has(c))) {
    const others = all.filter((c) => isEmCode(c) || PSYCHOTHERAPY.has(c));
    if (others.length) {
      out.push(err('NCCI_PAIR', `90791 / 90792 cannot be billed with ${Array.from(new Set(others)).join(', ')} on the same day by the same provider.`));
    }
    if (all.includes('90791') && all.includes('90792')) {
      out.push(err('NCCI_PAIR', '90791 and 90792 cannot both be billed on the same day by the same provider.'));
    }
  }

  // Per-day unit caps
  const unitsByCode = new Map<string, number>();
  lines.forEach((l) => unitsByCode.set(baseCode(l.cpt), (unitsByCode.get(baseCode(l.cpt)) ?? 0) + l.units));
  sameDay.forEach((c) => unitsByCode.set(c, (unitsByCode.get(c) ?? 0) + 1));
  for (const [code, units] of unitsByCode) {
    if (CONSERVATIVE_DAILY_CAP.has(code) && units > 1) {
      out.push(err('MUE_EXCEEDED', `${code}: ${units} units on this date exceed the per-day cap of 1 (conservative cap; verify MUE against the CMS practitioner MUE table).`));
    }
  }
  return out;
}

/** NUCC provider taxonomy code: 10 characters ending in X (e.g. 101YP2500X, 261QM0801X). */
export function isTaxonomyCode(code: string | null | undefined): boolean {
  return /^[0-9]{3}[0-9A-Z]{6}X$/.test(String(code ?? '').trim().toUpperCase());
}

// ─── Timely filing ───────────────────────────────────────────────────────────

/**
 * Days left to file a claim under the payer's timely filing limit (days from the date of service).
 * 'past' = over the limit, 'near' = 30 days or fewer left. Null when no limit is configured.
 */
export function timelyFiling(serviceDate: string | null, limitDays: number | null | undefined, today = new Date()) {
  if (!serviceDate || !limitDays) return null;
  const age = Math.floor((today.getTime() - new Date(`${serviceDate}T00:00:00Z`).getTime()) / 86_400_000);
  const daysLeft = limitDays - age;
  return { age, limitDays, daysLeft, status: (daysLeft < 0 ? 'past' : daysLeft <= 30 ? 'near' : 'ok') as 'past' | 'near' | 'ok' };
}
