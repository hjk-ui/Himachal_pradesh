/**
 * Oct 24 scribe safety — transcript risk gate.
 *
 * When an AI-scribe transcript (or the note drafted from it) contains risk language, the note cannot be
 * signed until the clinician attests, in their own words, why no further assessment is indicated.
 * Pure functions only — no I/O — so the sign path, the scribe API and the UI can share them.
 */

export const TRANSCRIPT_RISK_CODE = 'TRANSCRIPT_RISK' as const;

/** Fixed lead-in the clinician's reason is appended to. */
export const RISK_ATTESTATION_PREFIX =
  'Risk content was reviewed; no further assessment indicated because ';

/** Length limits apply to the clinician's reason (the text after the fixed prefix). */
export const RISK_ATTESTATION_MIN = 15;
export const RISK_ATTESTATION_MAX = 1000;

export const TRANSCRIPT_RISK_BLOCK_MESSAGE =
  'This transcript contains risk language. Review it and record why no further assessment is indicated before signing.';

export const RISK_ATTESTATION_TOO_SHORT_MESSAGE = `Say why no further assessment is indicated (at least ${RISK_ATTESTATION_MIN} characters).`;
export const RISK_ATTESTATION_TOO_LONG_MESSAGE = `Keep the reason to ${RISK_ATTESTATION_MAX} characters or fewer.`;

export type RiskCategory =
  | 'suicidal_ideation'
  | 'self_harm'
  | 'homicidal_ideation'
  | 'abuse_or_violence'
  | 'psychosis_or_command'
  | 'overdose_or_means';

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  suicidal_ideation: 'Suicidal thoughts or plan',
  self_harm: 'Self-harm',
  homicidal_ideation: 'Thoughts of harming others',
  abuse_or_violence: 'Abuse or violence',
  psychosis_or_command: 'Command voices or psychosis',
  overdose_or_means: 'Overdose or access to means',
};

type RiskPattern = { category: RiskCategory; pattern: RegExp };

const RISK_PATTERNS: RiskPattern[] = [
  {
    category: 'suicidal_ideation',
    pattern:
      /\b(suicid\w*|kill(?:ing)? (?:myself|himself|herself|themselves)|end(?:ing)? (?:my|his|her|their) (?:own )?life|want(?:s|ed)? to die|better off dead|no reason to live|don'?t want to (?:be here|live))\b/i,
  },
  {
    category: 'self_harm',
    pattern:
      /\b(self[- ]?harm\w*|self[- ]?injur\w*|cutting (?:myself|himself|herself)|cut (?:myself|himself|herself)|burn(?:ing|ed)? (?:myself|himself|herself))\b/i,
  },
  {
    category: 'homicidal_ideation',
    pattern:
      /\b(homicid\w*|kill (?:him|her|them|someone|my \w+)|want(?:s|ed)? to hurt (?:someone|him|her|them|others)|harm(?:ing)? (?:others|someone))\b/i,
  },
  {
    category: 'abuse_or_violence',
    pattern:
      /\b(abus(?:e|ed|ing|ive)|domestic violence|beat(?:s|en|ing)? (?:me|her|him|them)|hit(?:s|ting)? (?:me|her|him|them)|sexual(?:ly)? assault\w*|molest\w*|unsafe at home)\b/i,
  },
  {
    category: 'psychosis_or_command',
    pattern:
      /\b(command hallucination\w*|voices (?:are )?(?:telling|tell|told)|hearing voices|seeing things that)\b/i,
  },
  {
    category: 'overdose_or_means',
    pattern:
      /\b(overdos\w*|took (?:too many|all (?:of )?(?:my|his|her|their)) (?:pills|meds|medication)\w*|has (?:a )?(?:gun|firearm|weapon)\w*|access to (?:a )?(?:gun|firearm|weapons?))\b/i,
  },
];

export type RiskMatch = {
  category: RiskCategory;
  label: string;
  /** Short snippet around the match for the clinician to find it quickly. */
  excerpt: string;
};

export type TranscriptRiskScan = {
  flagged: boolean;
  matches: RiskMatch[];
};

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/** Scan a transcript (or note text) for risk language. One match per category (first hit). */
export function detectTranscriptRisk(text: string | null | undefined): TranscriptRiskScan {
  const source = (text || '').trim();
  if (!source) return { flagged: false, matches: [] };
  const matches: RiskMatch[] = [];
  for (const { category, pattern } of RISK_PATTERNS) {
    const hit = pattern.exec(source);
    if (!hit) continue;
    matches.push({
      category,
      label: RISK_CATEGORY_LABELS[category],
      excerpt: excerptAround(source, hit.index, hit[0].length),
    });
  }
  return { flagged: matches.length > 0, matches };
}

/** Stigmatizing wording the panel suggests replacing — guidance only, never blocks signing. */
export type StigmaWording = { avoid: string; prefer: string; pattern: RegExp };

export const STIGMA_WORDING: StigmaWording[] = [
  { avoid: 'committed suicide', prefer: 'died by suicide', pattern: /\bcommitted suicide\b/i },
  { avoid: 'failed suicide attempt', prefer: 'suicide attempt', pattern: /\bfailed (?:a )?suicide attempt\b/i },
  { avoid: 'addict / junkie', prefer: 'person with a substance use disorder', pattern: /\b(?:addicts?|junkies?)\b/i },
  { avoid: 'drug abuser / alcoholic', prefer: 'person who uses drugs / person with alcohol use disorder', pattern: /\b(?:drug abuser|alcoholic)\b/i },
  { avoid: 'clean / dirty (drug screen)', prefer: 'negative / positive (drug screen)', pattern: /\b(?:dirty|clean) (?:urine|screen|UDS|tox)\b/i },
  { avoid: 'schizophrenic / bipolar (as a noun)', prefer: 'person with schizophrenia / bipolar disorder', pattern: /\b(?:a|the) (?:schizophrenic|bipolar|borderline)\b/i },
  { avoid: 'non-compliant', prefer: 'not taking medication as prescribed / chose not to', pattern: /\bnon-?complian\w*\b/i },
  { avoid: 'manipulative / attention-seeking', prefer: 'describe the observed behavior and its function', pattern: /\b(?:manipulative|attention[- ]seeking)\b/i },
];

export const STIGMA_PANEL_COPY = {
  heading: 'Risk language and wording',
  intro:
    'This transcript contains risk language. Confirm it is documented accurately before you sign.',
  wordingHeading: 'Wording to review',
  wordingHelp:
    'These words can stigmatize the client. Consider the suggested wording. This is guidance only and does not block signing.',
  avoidLabel: 'Instead of',
  preferLabel: 'Consider',
  noWording: 'No wording to review.',
  attestationLabel: 'Why is no further assessment indicated?',
  attestationHelp: `Required before signing. ${RISK_ATTESTATION_MIN} to ${RISK_ATTESTATION_MAX} characters. Your words are saved to the note as written.`,
  attestationPlaceholder: 'the client denied intent or plan, has no access to means, and safety plan was reviewed.',
} as const;

export type StigmaFinding = { avoid: string; prefer: string };

export function detectStigmaWording(text: string | null | undefined): StigmaFinding[] {
  const source = text || '';
  if (!source.trim()) return [];
  return STIGMA_WORDING.filter((w) => w.pattern.test(source)).map(({ avoid, prefer }) => ({
    avoid,
    prefer,
  }));
}

export type AttestationValidation =
  | { ok: true; reason: string; text: string }
  | { ok: false; error: string };

/** Validate the clinician's reason (the part after the fixed prefix) and build the stored sentence. */
export function validateRiskAttestationReason(reason: string | null | undefined): AttestationValidation {
  const trimmed = (reason || '').trim().replace(/\.+$/, '').trim();
  if (trimmed.length < RISK_ATTESTATION_MIN) {
    return { ok: false, error: RISK_ATTESTATION_TOO_SHORT_MESSAGE };
  }
  if (trimmed.length > RISK_ATTESTATION_MAX) {
    return { ok: false, error: RISK_ATTESTATION_TOO_LONG_MESSAGE };
  }
  return { ok: true, reason: trimmed, text: `${RISK_ATTESTATION_PREFIX}${trimmed}.` };
}

/** True when a stored attestation sentence still has the exact prefix and a valid reason. */
export function isStoredAttestationValid(stored: string | null | undefined): boolean {
  if (!stored || !stored.startsWith(RISK_ATTESTATION_PREFIX)) return false;
  return validateRiskAttestationReason(stored.slice(RISK_ATTESTATION_PREFIX.length)).ok;
}

export type TranscriptRiskGateResult =
  | { ok: true; attestationText?: string }
  | { ok: false; code: typeof TRANSCRIPT_RISK_CODE; error: string };

/**
 * Sign gate. A note that is flagged (saved flag, or AI-drafted and its text scans as risk) needs a valid
 * attestation: either already stored on the note, or supplied now as a reason.
 */
export function evaluateTranscriptRiskGate(input: {
  flagged: boolean;
  storedAttestation?: string | null;
  attestationReason?: string | null;
}): TranscriptRiskGateResult {
  if (!input.flagged) return { ok: true };
  if (isStoredAttestationValid(input.storedAttestation)) return { ok: true };
  if (input.attestationReason && input.attestationReason.trim()) {
    const checked = validateRiskAttestationReason(input.attestationReason);
    if (checked.ok === false) return { ok: false, code: TRANSCRIPT_RISK_CODE, error: checked.error };
    return { ok: true, attestationText: checked.text };
  }
  return { ok: false, code: TRANSCRIPT_RISK_CODE, error: TRANSCRIPT_RISK_BLOCK_MESSAGE };
}

/** Whether a note must pass the gate: saved flag, or AI-drafted text that scans as risk. */
export function noteNeedsRiskAttestation(note: {
  transcriptRiskFlagged?: boolean | null;
  aiProvenance?: unknown;
  body: string;
}): boolean {
  if (note.transcriptRiskFlagged) return true;
  if (note.aiProvenance == null) return false;
  return detectTranscriptRisk(note.body).flagged;
}
