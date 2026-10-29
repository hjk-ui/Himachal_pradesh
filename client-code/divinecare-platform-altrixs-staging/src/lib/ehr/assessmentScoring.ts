import { z } from 'zod';
import { AssessmentError } from './assessmentErrors';

const common = { clientId: z.string().min(1).max(128), submissionId: z.string().uuid() };
const response = z.number().int().min(0).max(3);
export const assessmentSubmissionSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('PHQ-9'), responses: z.array(response).length(9) }).strict(),
  z.object({ ...common, type: z.literal('GAD-7'), responses: z.array(response).length(7) }).strict(),
  z.object({ ...common, type: z.enum(['PCL-5', 'AUDIT', 'DAST-10', 'C-SSRS', 'ASRS', 'CAGE-AID']),
    score: z.number().int().min(0).max(80), interpretation: z.string().trim().min(1).max(200),
    clinicianVerified: z.literal(true),
  }).strict(),
]);
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
export const assessmentScoreLimits: Record<string, number> = {
  'PCL-5': 80, AUDIT: 40, 'DAST-10': 10, 'C-SSRS': 5, ASRS: 24, 'CAGE-AID': 4,
};

/** Item 9 is evaluated independently of the PHQ-9 total; never infer it from total severity. */
export function scoreAssessment(input: AssessmentSubmission) {
  if ('responses' in input) {
    const score = input.responses.reduce((sum, item) => sum + item, 0);
    const severity = input.type === 'PHQ-9'
      ? score >= 20 ? 'Severe' : score >= 15 ? 'Moderately Severe' : score >= 10 ? 'Moderate' : score >= 5 ? 'Mild' : 'Minimal'
      : score >= 15 ? 'Severe' : score >= 10 ? 'Moderate' : score >= 5 ? 'Mild' : 'Minimal';
    const suicidalIdeation = input.type === 'PHQ-9' && input.responses[8] >= 1;
    const flags = suicidalIdeation ? ['PHQ-9 item 9 is positive. Follow the clinic crisis protocol and review the safety plan.'] : [];
    return { score, severity, flags, suicidalIdeation };
  }
  if (input.score > assessmentScoreLimits[input.type]) throw new AssessmentError('Assessment score is out of range', 400);
  // Other instruments retain the clinician's interpretation; no invented risk score conversion.
  return { score: input.score, severity: input.interpretation, flags: [] as string[], suicidalIdeation: false };
}
