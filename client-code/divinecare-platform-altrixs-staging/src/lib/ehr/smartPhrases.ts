import { z } from 'zod';

/**
 * EHR smart phrases — insert clinical boilerplate with [___] placeholders.
 * Trigger keys match common EHR dot-phrases (e.g. `.cbt`).
 */

export type SmartPhrase = {
  key: string;
  label: string;
  text: string;
  category:
    | 'Mental Status'
    | 'Risk'
    | 'Progress'
    | 'Plan'
    | 'Medications'
    | 'Interventions'
    | 'Substance Use';
};

export const SMART_PHRASE_CATEGORIES: SmartPhrase['category'][] = [
  'Mental Status',
  'Risk',
  'Progress',
  'Plan',
  'Medications',
  'Interventions',
  'Substance Use',
];

export const SMART_PHRASES: SmartPhrase[] = [
  {
    key: '.mental-normal',
    label: 'Mental status — WNL',
    category: 'Mental Status',
    text: 'Mental status exam within normal limits. Client [___] was alert and oriented \u00d74, with logical thought process, intact memory, and no evidence of psychosis. Insight and judgment appear [___].',
  },
  {
    key: '.mood',
    label: 'Mood / affect',
    category: 'Mental Status',
    text: 'Mood described as [___] with [congruent/incongruent] affect. Client reports sleep [___], appetite [___], and energy [___] since last session.',
  },
  {
    key: '.appear',
    label: 'Appearance / behavior',
    category: 'Mental Status',
    text: 'Client appeared [___], dressed [___], and was [cooperative/guarded] throughout the encounter. Eye contact was [___]; psychomotor activity was [___].',
  },
  {
    key: '.risk-none',
    label: 'Risk — none',
    category: 'Risk',
    text: 'Client denies current suicidal ideation, homicidal ideation, and self-harm intent or plan. No acute safety concerns identified. Crisis resources reviewed; client verbalized understanding.',
  },
  {
    key: '.risk-passive',
    label: 'Risk — passive SI',
    category: 'Risk',
    text: 'Client reports passive suicidal ideation without plan, intent, or means. Protective factors include [___]. Safety plan reviewed and reinforced; client agrees to contact [___] or 988 if ideation intensifies.',
  },
  {
    key: '.risk-plan',
    label: 'Risk — plan present',
    category: 'Risk',
    text: 'Client endorsed suicidal ideation with plan involving [___]. Intent [___]; means [___]. Immediate safety interventions: [___]. Emergency contacts notified: [___]. Disposition: [___].',
  },
  {
    key: '.progress-good',
    label: 'Progress — good',
    category: 'Progress',
    text: 'Client demonstrates good progress toward treatment goals. Notable gains include [___]. Homework completion and skill practice support continued improvement.',
  },
  {
    key: '.progress-limited',
    label: 'Progress — limited',
    category: 'Progress',
    text: 'Progress toward goals remains limited. Barriers identified: [___]. Plan adjusted to address [___] and increase session focus on [___].',
  },
  {
    key: '.homework',
    label: 'Homework assigned',
    category: 'Progress',
    text: 'Homework assigned: [___]. Client agreed to complete by next session and will track [mood/urges/sleep] daily. Barriers to completion discussed: [___].',
  },
  {
    key: '.plan',
    label: 'Plan / next steps',
    category: 'Plan',
    text: 'Plan: Continue [modality] focusing on [___]. Next appointment scheduled for [___]. Collaborate with [___] as indicated. Reassess [PHQ-9/GAD-7/safety] at next visit.',
  },
  {
    key: '.referral',
    label: 'Referral',
    category: 'Plan',
    text: 'Referral initiated to [specialty/provider] for [reason]. Client consented to release of information. Follow-up on referral status at next contact.',
  },
  {
    key: '.meds',
    label: 'Medication review',
    category: 'Medications',
    text: 'Medications reviewed: [___]. Adherence reported as [___]. Side effects: [___]. No changes made this visit / changes: [___]. Client educated on risks/benefits.',
  },
  {
    key: '.pdmp',
    label: 'PDMP check',
    category: 'Medications',
    text: 'PDMP reviewed on [date]. Findings: [consistent with prescribed regimen / discrepancies noted: ___]. Clinical decision: [___].',
  },
  {
    key: '.cbt',
    label: 'CBT intervention',
    category: 'Interventions',
    text: 'Utilized CBT techniques including identification of automatic thoughts related to [___], cognitive restructuring, and behavioral experiments. Client practiced generating balanced alternative thoughts: [___].',
  },
  {
    key: '.mi',
    label: 'Motivational interviewing',
    category: 'Interventions',
    text: 'Applied motivational interviewing (OARS) to explore ambivalence about [___]. Client articulated change talk regarding [___] and identified next small step: [___].',
  },
  {
    key: '.grounding',
    label: 'Grounding skills',
    category: 'Interventions',
    text: 'Practiced grounding skills (5-4-3-2-1 / paced breathing) in session. Client reported subjective distress decreased from [___]/10 to [___]/10. Encouraged daily practice when [trigger].',
  },
  {
    key: '.sober',
    label: 'Sobriety / recovery',
    category: 'Substance Use',
    text: 'Client reports [___] days/weeks of sobriety. Cravings rated [___]/10. Triggers discussed: [___]. Relapse prevention plan reviewed; support network includes [___].',
  },
];

export function getSmartPhrase(key: string): SmartPhrase | undefined {
  const normalized = key.trim().toLowerCase().startsWith('.')
    ? key.trim().toLowerCase()
    : `.${key.trim().toLowerCase()}`;
  return SMART_PHRASES.find((p) => p.key === normalized);
}

export function expandSmartPhrase(key: string): string | null {
  return getSmartPhrase(key)?.text ?? null;
}

/** Number of unfilled [___] placeholders left in a note; signing is blocked while any remain */
export function findUnfilledBlanks(text: string): number {
  return (text.match(/\[_{2,}\]/g) || []).length;
}

/** User-defined phrase keys: a dot, then lowercase letters, digits, '_' or '-' (e.g. `.my-intro`) */
export const SMART_PHRASE_KEY_PATTERN = /^\.[a-z0-9][a-z0-9_-]*$/;

export const SMART_PHRASE_LIMITS = {
  key: 40,
  label: 80,
  category: 40,
  text: 4000,
} as const;

/** Validation message for a custom phrase key, or null when the key is valid */
export function smartPhraseKeyError(key: string): string | null {
  if (!key) return 'Key is required';
  if (key.length > SMART_PHRASE_LIMITS.key) return `Key must be ${SMART_PHRASE_LIMITS.key} characters or fewer`;
  if (!SMART_PHRASE_KEY_PATTERN.test(key)) {
    return "Key must start with '.' followed by lowercase letters, numbers, '_' or '-'";
  }
  return null;
}

/** Insert phrase text into a note body at cursor/end. */
export function insertSmartPhrase(body: string, key: string, cursor?: number): string {
  const phrase = expandSmartPhrase(key);
  if (!phrase) return body;
  if (cursor == null || cursor < 0 || cursor > body.length) {
    const sep = body.trim() ? '\n\n' : '';
    return `${body.trimEnd()}${sep}${phrase}`;
  }
  const before = body.slice(0, cursor);
  const after = body.slice(cursor);
  const needsPadBefore = before.length > 0 && !/\n\s*$/.test(before);
  const pad = needsPadBefore ? '\n\n' : '';
  return `${before}${pad}${phrase}${after}`;
}

/** Fields of a user-defined phrase (POST body; PATCH uses `.partial()`) */
export const smartPhraseInputSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .max(SMART_PHRASE_LIMITS.key)
    .regex(SMART_PHRASE_KEY_PATTERN, "Key must start with '.' followed by lowercase letters, numbers, '_' or '-'"),
  label: z.string().trim().min(1, 'Label is required').max(SMART_PHRASE_LIMITS.label),
  text: z.string().trim().min(1, 'Text is required').max(SMART_PHRASE_LIMITS.text),
  category: z.string().trim().max(SMART_PHRASE_LIMITS.category).nullish(),
});
