/**
 * Abnormal Involuntary Movement Scale (AIMS) — NIMH, public domain (Guy W., ECDEU Assessment Manual, 1976).
 *
 * 12 items: 1–7 rate movements by body area, 8–10 are global judgements, 11–12 dental status.
 * Total score = sum of items 1–7 (0–28). The "positive screen" uses the Schooler-Kane research criteria
 * (≥2 in two or more areas, or ≥3 in any one area). That is screening guidance only: a diagnosis of
 * tardive dyskinesia is a clinical judgement (exposure history, course, other causes).
 *
 * Stored with instrument name exactly 'AIMS' (id 'aims') so the Visit Guide (src/lib/visits/loader.ts)
 * marks AIMS done / due.
 */

export const AIMS_NAME = 'AIMS';
export const AIMS_ID = 'aims';

const MOVEMENT_OPTIONS = [
  { label: '0 — None', value: 0 },
  { label: '1 — Minimal (may be extreme normal)', value: 1 },
  { label: '2 — Mild', value: 2 },
  { label: '3 — Moderate', value: 3 },
  { label: '4 — Severe', value: 4 },
];
const GLOBAL_OPTIONS = [
  { label: '0 — None, normal', value: 0 },
  { label: '1 — Minimal', value: 1 },
  { label: '2 — Mild', value: 2 },
  { label: '3 — Moderate', value: 3 },
  { label: '4 — Severe', value: 4 },
];
const AWARENESS_OPTIONS = [
  { label: '0 — No awareness', value: 0 },
  { label: '1 — Aware, no distress', value: 1 },
  { label: '2 — Aware, mild distress', value: 2 },
  { label: '3 — Aware, moderate distress', value: 3 },
  { label: '4 — Aware, severe distress', value: 4 },
];
const YES_NO = [
  { label: 'No', value: 0 },
  { label: 'Yes', value: 1 },
];

const MOVEMENT_NOTE = 'Rate highest severity observed. Rate movements that occur upon activation one less than those observed spontaneously.';

/** Items 1–7 (movement areas); these are the only items summed. */
export const AIMS_MOVEMENT_AREAS = [
  'Muscles of facial expression',
  'Lips and perioral area',
  'Jaw',
  'Tongue',
  'Upper extremities',
  'Lower extremities',
  'Neck, shoulders, hips (trunk)',
] as const;

export const AIMS_QUESTIONS: { text: string; options: { label: string; value: number }[]; note?: string }[] = [
  { text: 'Facial and oral movements — 1. Muscles of facial expression (e.g., movements of forehead, eyebrows, periorbital area, cheeks; include frowning, blinking, smiling, grimacing)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Facial and oral movements — 2. Lips and perioral area (e.g., puckering, pouting, smacking)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Facial and oral movements — 3. Jaw (e.g., biting, clenching, chewing, mouth opening, lateral movement)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Facial and oral movements — 4. Tongue (rate only increase in movement both in and out of mouth, not inability to sustain movement)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Extremity movements — 5. Upper (arms, wrists, hands, fingers): include choreic movements (rapid, objectively purposeless, irregular, spontaneous) and athetoid movements (slow, irregular, complex, serpentine); do not include tremor (repetitive, regular, rhythmic)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Extremity movements — 6. Lower (legs, knees, ankles, toes) (e.g., lateral knee movement, foot tapping, heel dropping, foot squirming, inversion and eversion of foot)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Trunk movements — 7. Neck, shoulders, hips (e.g., rocking, twisting, squirming, pelvic gyrations)', options: MOVEMENT_OPTIONS, note: MOVEMENT_NOTE },
  { text: 'Global judgements — 8. Severity of abnormal movements overall', options: GLOBAL_OPTIONS },
  { text: 'Global judgements — 9. Incapacitation due to abnormal movements', options: GLOBAL_OPTIONS },
  { text: "Global judgements — 10. Patient's awareness of abnormal movements (rate only patient's report)", options: AWARENESS_OPTIONS },
  { text: 'Dental status — 11. Current problems with teeth and/or dentures', options: YES_NO },
  { text: 'Dental status — 12. Does patient usually wear dentures?', options: YES_NO },
];

/** NIMH AIMS examination procedure (checklist shown with the instrument). */
export const AIMS_EXAM_PROCEDURE = [
  'Either before or after the examination, observe the patient unobtrusively at rest (e.g., in the waiting room). Use a hard, firm chair without arms.',
  '1. Ask the patient whether there is anything in their mouth (gum, candy, etc.) and, if so, to remove it.',
  '2. Ask about the current condition of their teeth, whether they wear dentures, and whether teeth or dentures bother them now.',
  '3. Ask whether they notice any movements in mouth, face, hands, or feet; if yes, ask them to describe and to what extent the movements bother them or interfere with activities.',
  '4. Have the patient sit with hands on knees, legs slightly apart, feet flat on the floor (look at the entire body for movements).',
  '5. Ask the patient to sit with hands hanging unsupported (observe hands and other body areas).',
  '6. Ask the patient to open their mouth (observe the tongue at rest within the mouth). Do this twice.',
  '7. Ask the patient to protrude the tongue (observe abnormalities of tongue movement). Do this twice.',
  '8. * Ask the patient to tap thumb with each finger as rapidly as possible for 10–15 seconds, right hand then left hand (observe facial and leg movements).',
  "9. Flex and extend the patient's left and right arms, one at a time (note any rigidity).",
  '10. Ask the patient to stand up (observe in profile; observe all body areas again, hips included).',
  '11. * Ask the patient to extend both arms outstretched in front, palms down (observe trunk, legs, and mouth).',
  '12. * Have the patient walk a few paces, turn, and walk back to the chair (observe hands and gait). Do this twice.',
  '* Activated movements.',
];

export type AimsResult = {
  totalScore: number;
  positiveScreen: boolean;
  /** Areas rated ≥2 / ≥3 among items 1–7 */
  areasAtLeast2: string[];
  areasAtLeast3: string[];
};

/** Score = sum of items 1–7 (q1–q7). Positive screen per Schooler-Kane criteria (screening guidance). */
export function scoreAims(answers: Record<string, number>): AimsResult {
  const movement = AIMS_MOVEMENT_AREAS.map((area, i) => ({ area, v: Number(answers[`q${i + 1}`]) || 0 }));
  const totalScore = movement.reduce((s, m) => s + m.v, 0);
  const areasAtLeast2 = movement.filter((m) => m.v >= 2).map((m) => m.area);
  const areasAtLeast3 = movement.filter((m) => m.v >= 3).map((m) => m.area);
  return { totalScore, positiveScreen: areasAtLeast2.length >= 2 || areasAtLeast3.length >= 1, areasAtLeast2, areasAtLeast3 };
}

export function calculateAimsResult(answers: Record<string, number>) {
  const r = scoreAims(answers);
  const why = r.areasAtLeast3.length
    ? `≥3 in ${r.areasAtLeast3.join(', ')}`
    : r.areasAtLeast2.length >= 2
      ? `≥2 in ${r.areasAtLeast2.length} areas (${r.areasAtLeast2.join(', ')})`
      : '';
  const severity = r.positiveScreen ? 'Positive screen' : 'Negative screen';
  return {
    totalScore: r.totalScore,
    severity,
    interpretation:
      `AIMS total (items 1–7): ${r.totalScore}/28. ${severity}${why ? ` — ${why}` : ''}. ` +
      'Screening guidance (Schooler-Kane criteria: ≥2 in two or more areas, or ≥3 in any one area); ' +
      'tardive dyskinesia remains a clinical judgement.',
    // Not a suicide / safety-protocol flag; the positive screen is carried in severity and interpretation.
    safetyFlagged: false,
  };
}
