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
