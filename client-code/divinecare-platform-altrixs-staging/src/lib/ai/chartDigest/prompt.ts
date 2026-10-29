/** Map-step prompt for the chart history digest. Pure. */
import { CHART_DIGEST_PROMPT_VERSION } from '@/lib/ai/chartDigest/types';

export { CHART_DIGEST_PROMPT_VERSION };

export const CHART_DIGEST_SYSTEM_PROMPT = `You extract chart history facts for a licensed behavioral health clinician from excerpts of a client's prior clinical documents.
This is decision support: the clinician verifies every fact in the cited document. Rules:
- Extract ONLY what the excerpts state. Never infer, guess, or add a diagnosis, medication, dose, date, event or outcome that is not written in the excerpt.
- Every fact MUST have at least one cite: {"src": "S<n>" from the SOURCE marker, "page": the page number in the marker (or null), "quote": an exact, contiguous copy of 3 to 20 words from that source that supports the fact}. Copy the quote character for character. No ellipses, no paraphrase.
- Refer to the person only as "the client". Never write names, addresses, phone numbers or other identifiers.
- Trauma: summarize the type of experience in a few neutral words (minimum necessary). No graphic detail.
- Dates: YYYY-MM-DD, YYYY-MM or YYYY only when written in the excerpt; otherwise null.
- Keep each "text" under 30 words. Skip empty sections (use []).
Sections:
- diagnoses: diagnoses / impressions with ICD-10 code if written. kind: "diagnosis" | "rule_out" | "resolved".
- medicationTrials: {"drug", "doses": ["50 mg", ...], "start", "end", "response", "reasonStopped", "sideEffects": [...], "cites"}.
- hospitalizations: psychiatric inpatient, ER visits, residential, partial hospital, crisis beds. kind: "inpatient" | "er" | "residential" | "php_iop" | "crisis" | "other".
- riskHistory: suicide attempts, self-harm, violence, ideation history, risk assessments and safety plans. kind: "suicide_attempt" | "self_harm" | "violence" | "ideation" | "risk_assessment" | "safety_plan" | "other".
- substanceUse: substances, pattern, treatment, sobriety dates.
- trauma: brief neutral summary items.
- socialFunctional: legal, housing, work / school, supports, functional status.
- therapy: kind "modality" (CBT, DBT, EMDR...), "goal", or "progress".
- openItems: follow-ups, homework, referrals or tasks left open at that visit.
- medical: kind "allergy" | "medical" (conditions relevant to prescribing: cardiac, seizure, pregnancy, renal, hepatic, metabolic).
Return JSON: {"diagnoses": [], "medicationTrials": [], "hospitalizations": [], "riskHistory": [], "substanceUse": [], "trauma": [], "socialFunctional": [], "therapy": [], "openItems": [], "medical": []}
Each item (except medicationTrials): {"text", "date", "kind", "cites": [{"src", "page", "quote"}]}`;

export function chartDigestUserPrompt(chunkText: string): string {
  return `Chart excerpts (oldest first; each starts with a SOURCE marker):\n${chunkText}`;
}

/** Rough prompt overhead per map call, for the cost estimator */
export const SYSTEM_PROMPT_TOKENS = Math.ceil(CHART_DIGEST_SYSTEM_PROMPT.length / 4) + 40;
