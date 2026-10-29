/** C-SSRS ideation items (q1–q5). Shared by the C-SSRS page and the med-management note screen. */
export const CSSRS_IDEATION = [
  { id: 'q1', text: 'Wish to be Dead — Have you wished you were dead or wished you could go to sleep and not wake up?' },
  { id: 'q2', text: 'Non-Specific Active Suicidal Thoughts — Have you actually had any thoughts of killing yourself?' },
  { id: 'q3', text: 'Active Suicidal Ideation with Any Methods (Not Plan) without Intent — Have you been thinking about how you might do this?' },
  { id: 'q4', text: 'Active Suicidal Ideation with Some Intent to Act, without Specific Plan — Have you had these thoughts and had some intention of acting on them?' },
  { id: 'q5', text: 'Active Suicidal Ideation with Specific Plan and Intent — Have you started to work out or worked out the details of how to kill yourself? Do you intend to carry out this plan?' },
] as const;

/** C-SSRS behavior items (q6–q10). */
export const CSSRS_BEHAVIOR = [
  { id: 'q6', text: 'Actual Attempt — Have you made a suicide attempt?' },
  { id: 'q7', text: 'Interrupted Attempt — Has there been a time when you started to do something to end your life but someone or something stopped you before you actually did anything?' },
  { id: 'q8', text: 'Aborted / Self-Interrupted Attempt — Has there been a time when you started to do something to try to end your life but you stopped yourself before you actually did anything?' },
  { id: 'q9', text: 'Preparatory Acts or Behavior — Have you taken any steps toward making a suicide attempt or preparing to kill yourself (such as collecting pills, getting a gun, giving valuables away, writing a suicide note)?' },
  { id: 'q10', text: 'Non-Suicidal Self-Injurious Behavior — Have you done anything to hurt yourself without intending to kill yourself?' },
] as const;

export type CssrsRiskLevel = 'imminent' | 'high' | 'moderate' | 'low';

export type CssrsYesNo = Record<string, number | boolean | undefined>;

function yes(answers: CssrsYesNo, key: string): boolean {
  const value = answers[key];
  return value === true || value === 1;
}

/**
 * C-SSRS risk algorithm (exact product rules):
 * - q5 yes AND any q6–q10 yes → imminent
 * - q3 or q4 or q5 yes OR any behavior yes → high
 * - q2 yes → moderate
 * - q1 yes or none → low
 */
export function computeRisk(answers: CssrsYesNo): CssrsRiskLevel {
  const q1 = yes(answers, 'q1');
  const q2 = yes(answers, 'q2');
  const q3 = yes(answers, 'q3');
  const q4 = yes(answers, 'q4');
  const q5 = yes(answers, 'q5');
  const behavior = ['q6', 'q7', 'q8', 'q9', 'q10'].some((key) => yes(answers, key));

  if (q5 && behavior) return 'imminent';
  if (q3 || q4 || q5 || behavior) return 'high';
  if (q2) return 'moderate';
  if (q1) return 'low';
  return 'low';
}

export function cssrsRiskLabel(level: CssrsRiskLevel): string {
  switch (level) {
    case 'imminent':
      return 'Imminent Risk';
    case 'high':
      return 'High Risk';
    case 'moderate':
      return 'Moderate Risk';
    default:
      return 'Low Risk';
  }
}

export function cssrsRiskColor(level: CssrsRiskLevel): string {
  switch (level) {
    case 'imminent':
      return '#991B1B';
    case 'high':
      return '#DC2626';
    case 'moderate':
      return '#D97706';
    default:
      return '#15803D';
  }
}
