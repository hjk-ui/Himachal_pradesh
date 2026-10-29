import { canEditClientDiagnoses } from '@/lib/clients/orgScope';

type TemplateLike = { sections: { type: string }[] };

/** A template with a Diagnostic Impressions (ICD-10) section is a diagnostic evaluation. */
export function isDiagnosticEvaluationTemplate(template: TemplateLike | null | undefined): boolean {
  return Boolean(template?.sections?.some((s) => s.type === 'diagnosis'));
}

/**
 * POST /api/clinical/evaluations: diagnosing is outside the scope of PRP / case managers / peers /
 * crisis responders (canEditClientDiagnoses = leadership + licensed BH). They may author the
 * non-diagnostic content of an evaluation, but may not record diagnoses or finalize (sign out) a
 * diagnostic evaluation template. Returns the reason, or null when allowed.
 */
export function evaluationDiagnosisBlock(
  role: string | null | undefined,
  template: TemplateLike | null | undefined,
  input: { diagnoses?: unknown[] | null; status?: string | null; amendment?: boolean },
): string | null {
  if (canEditClientDiagnoses(role)) return null;
  if (Array.isArray(input.diagnoses) && input.diagnoses.length > 0) return 'diagnoses_not_permitted';
  if (isDiagnosticEvaluationTemplate(template) && (input.status === 'FINALIZED' || input.amendment)) {
    return 'diagnostic_finalize_not_permitted';
  }
  return null;
}
