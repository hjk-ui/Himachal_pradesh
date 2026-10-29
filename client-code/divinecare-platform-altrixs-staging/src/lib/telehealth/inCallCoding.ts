/**
 * In-call coding preview and draft-note helpers (no I/O; safe for client and server).
 *
 * Psychotherapy CPT follows the CMS time ranges for the documented face-to-face time:
 *   90832 = 16-37 min, 90834 = 38-52 min, 90837 = 53+ min (under 16 min: no psychotherapy code).
 * The psychotherapy add-on with an E/M visit uses the same ranges: 90833 / 90836 / 90838,
 * and only when an E/M service was documented. The E/M level itself is never guessed.
 */

export type PsychotherapyCpt = '90832' | '90834' | '90837';
export type PsychotherapyAddOnCpt = '90833' | '90836' | '90838';

/** Psychotherapy CPT for the elapsed minutes; null under 16 min or when the time is unknown. */
export function psychotherapyCptForMinutes(minutes: number | null | undefined): PsychotherapyCpt | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  const m = Math.floor(minutes);
  if (m < 16) return null;
  if (m <= 37) return '90832';
  if (m <= 52) return '90834';
  return '90837';
}

/** Psychotherapy add-on with E/M for the psychotherapy minutes; null under 16 min. */
export function psychotherapyAddOnForMinutes(minutes: number | null | undefined): PsychotherapyAddOnCpt | null {
  const base = psychotherapyCptForMinutes(minutes);
  if (!base) return null;
  return base === '90832' ? '90833' : base === '90834' ? '90836' : '90838';
}

export type InCallCodingPreview = {
  /** e.g. "90834", or null when it cannot be determined yet */
  primaryCpt: string | null;
  /** Shown when primaryCpt is null */
  primaryNote: string | null;
  addOnCpt: string | null;
  addOnNote: string | null;
  /** "10" / "02", or null when the patient's location is not known */
  pos: string | null;
  posNote: string;
};

export function previewInCallCoding(input: {
  elapsedMinutes: number | null;
  /** Prescriber medication-management visit (E/M + optional psychotherapy add-on) */
  isPrescriberVisit: boolean;
  /** E/M level documented in the note (CPT 99212-99215), if any */
  emCode?: string | null;
  /** From resolveTelehealthPos on the server: two-digit code or null */
  pos?: string | null;
}): InCallCodingPreview {
  const pos = input.pos && /^\d{2}$/.test(input.pos) ? input.pos : null;
  const posNote = pos
    ? pos === '10'
      ? 'POS 10 (telehealth, patient at home)'
      : pos === '02'
        ? 'POS 02 (telehealth, patient not at home)'
        : `POS ${pos}`
    : 'POS: confirm patient location';

  if (input.isPrescriberVisit) {
    const em = input.emCode && /^9921[2-5]$/.test(input.emCode) ? input.emCode : null;
    if (!em) {
      return {
        primaryCpt: null,
        primaryNote: 'E/M level not documented — choose it in the note',
        addOnCpt: null,
        addOnNote: 'Psychotherapy add-on only with a documented E/M',
        pos,
        posNote,
      };
    }
    const addOn = psychotherapyAddOnForMinutes(input.elapsedMinutes);
    return {
      primaryCpt: em,
      primaryNote: null,
      addOnCpt: addOn,
      addOnNote: addOn ? null : 'No add-on (psychotherapy under 16 min)',
      pos,
      posNote,
    };
  }

  const cpt = psychotherapyCptForMinutes(input.elapsedMinutes);
  return {
    primaryCpt: cpt,
    primaryNote: cpt
      ? null
      : input.elapsedMinutes == null
        ? 'Session time not known'
        : 'Under 16 min — no psychotherapy code',
    addOnCpt: null,
    addOnNote: null,
    pos,
    posNote,
  };
}

// ─── Draft note from the in-call SOAP / MSE ─────────────────────────────────────

export const NOT_ASSESSED = 'Not assessed';

export type InCallNoteFields = {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  mseAppearance?: string | null;
  mseMood?: string | null;
  mseThought?: string | null;
  cssrsRiskScore?: string | null;
};

/** Labels of the MSE / C-SSRS fields that still need an explicit choice (may be "Not assessed"). */
export function missingInCallSelections(n: InCallNoteFields): string[] {
  const out: string[] = [];
  if (!n.cssrsRiskScore?.trim()) out.push('C-SSRS risk');
  if (!n.mseAppearance?.trim()) out.push('MSE appearance');
  if (!n.mseMood?.trim()) out.push('MSE mood / affect');
  if (!n.mseThought?.trim()) out.push('MSE thought process');
  return out;
}

/** Plain-text SOAP body for the draft progress note. Blank sections say "Not recorded". */
export function buildInCallDraftBody(n: InCallNoteFields): string {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : 'Not recorded');
  return [
    'Telehealth session note (drafted during the visit — review before signing)',
    '',
    `Subjective:\n${t(n.subjective)}`,
    '',
    `Objective:\n${t(n.objective)}`,
    '',
    'Mental status exam:',
    `- Appearance: ${t(n.mseAppearance)}`,
    `- Mood / affect: ${t(n.mseMood)}`,
    `- Thought process: ${t(n.mseThought)}`,
    `- C-SSRS screen: ${t(n.cssrsRiskScore)}`,
    '',
    `Assessment:\n${t(n.assessment)}`,
    '',
    `Plan:\n${t(n.plan)}`,
  ].join('\n');
}
