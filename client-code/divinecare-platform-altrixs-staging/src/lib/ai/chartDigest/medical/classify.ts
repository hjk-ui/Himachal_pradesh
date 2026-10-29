/**
 * Which chart documents feed the MEDICAL digest. Pure (no I/O).
 *
 * Included: primary-care records — office visit / progress notes, H&P, labs, imaging / radiology,
 * pathology, specialist / consult letters and reports, hospital discharge summaries, operative /
 * procedure reports, ECG / echo, immunization records — including Valant "Family Practice" imports.
 * Skipped: billing, IDs, insurance, demographics, receipts, consents / ROI, measures and intake
 * forms (same never-clinical list as the BH digest), psychotherapy notes (always), and behavioral
 * health records (psychiatric / therapy / counseling / BPS / treatment plans): those feed the BH
 * digest, and the medical audience gets only the minimum-necessary behavioral health summary.
 *
 * Generic clinical types ("Progress Note", "Intake Note", "Addendum", "Evaluation", "Assessment",
 * "Clinical Record", "Other") are medical only when marked Family Practice / primary care (Valant
 * folder, path or title), or when the patient has no behavioral health chart (primary care only):
 * otherwise a BH progress note could leak therapy content to the medical audience.
 */
import { classifyChartDocument, type DocClassInput } from '@/lib/ai/chartDigest/classify';

export type MedicalDocClass =
  | { include: true; reason: 'medical_type' | 'medical_title' | 'family_practice' | 'primary_care_only' }
  | { include: false; reason: 'psychotherapy_note' | 'non_clinical_type' | 'behavioral_health_record' | 'not_medical' };

const NEVER_TYPES = new Set(['payment receipt', 'patient id', 'demographics', 'insurance card', 'consent / roi', 'billing archive', 'prior auth letter', 'measures', 'intake form']);

/** Types that are medical records whatever the title */
const MEDICAL_TYPES = new Set(['lab report', 'lab result', 'lab results', 'imaging', 'radiology report', 'immunization record', 'consult letter', 'consult report', 'history and physical']);

/** Generic clinical types: medical only with a Family Practice marker or for primary-care-only patients */
const GENERIC_TYPES = new Set(['progress note', 'intake note', 'addendum', 'evaluation', 'assessment', 'clinical record', 'other', 'unclassified', 'referral', 'discharge summary']);

/** Behavioral health records (never medical sources) */
const BH_TYPES = new Set(['psychiatric evaluation', 'treatment plan']);
const BH_TITLE_RE =
  /\b(psych(iatric|ological|otherapy)?|therapy|therapist|counsel(ing|or)?|behavioral health|mental health|biopsychosocial|bps|treatment plans?|safety plans?|c[\s-]?ssrs|phq|gad|prp|case management|peer support|substance use|sud|asam)\b/i;

const MEDICAL_TITLE_RE =
  /\b(office visit|h\s*&\s*p|h and p|history (and|&) physical|annual (exam|physical)|physical exam|wellness visit|lab(s|oratory)?( results?| reports?)?|cbc|cmp|bmp|lipid|a1c|hba1c|tsh|urinalysis|culture|pathology|biopsy|imaging|radiology|x[\s-]?rays?|xr|mri|ct( scan)?|ultrasound|sonogram|mammo(gram|graphy)?|dexa|echo(cardiogram)?|ekg|ecg|holter|stress test|colonoscopy|endoscopy|egd|pap( smear)?|consult(ation)?( note| letter| report)?|specialist|cardiology|endocrinology|nephrology|gastroenterology|pulmonology|neurology|orthopedic|dermatology|ophthalmology|retinal|podiatry|oncology|urology|ob\s*-?\s*gyn|hospital (records?|discharge( summary)?)|emergency (department|room)|ed visit|er visit|operative report|op note|procedure (note|report)|surgery|surgical|immunizations?|vaccin(e|ation)s?|shot record|tdap|influenza|pneumococcal)\b/i;

const FAMILY_PRACTICE_RE = /\b(family practice|family medicine|primary care|pcp|internal medicine)\b/i;

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.+()[\]{}#,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Marked as a Valant Family Practice / primary-care record (folder, path, title) */
export function isFamilyPracticeDocument(d: DocClassInput): boolean {
  return FAMILY_PRACTICE_RE.test([d.title, d.fileName, d.sourcePath, d.folder].map(norm).join(' | '));
}

export function classifyMedicalDocument(d: DocClassInput, patient: { behavioral: boolean }): MedicalDocClass {
  const base = classifyChartDocument(d);
  if (base.include === false && base.reason === 'psychotherapy_note') return { include: false, reason: 'psychotherapy_note' };
  const rawType = String(d.documentType ?? '').trim().toLowerCase();
  const type = norm(d.documentType).toLowerCase();
  if (NEVER_TYPES.has(rawType) || NEVER_TYPES.has(type)) return { include: false, reason: 'non_clinical_type' };
  const titleText = [d.title, d.fileName, d.sourcePath, d.folder].map(norm).join(' | ');
  const fp = isFamilyPracticeDocument(d);
  // Behavioral health records stay in the BH digest (a Family Practice marker cannot override a psych title)
  if (BH_TYPES.has(rawType) || BH_TYPES.has(type) || BH_TITLE_RE.test(titleText)) return { include: false, reason: 'behavioral_health_record' };
  if (MEDICAL_TYPES.has(rawType) || MEDICAL_TYPES.has(type)) return { include: true, reason: 'medical_type' };
  if (MEDICAL_TITLE_RE.test(titleText)) return { include: true, reason: 'medical_title' };
  if (GENERIC_TYPES.has(rawType) || GENERIC_TYPES.has(type)) {
    if (fp) return { include: true, reason: 'family_practice' };
    if (!patient.behavioral) return { include: true, reason: 'primary_care_only' };
    return { include: false, reason: 'not_medical' };
  }
  if (fp) return { include: true, reason: 'family_practice' };
  return { include: false, reason: 'not_medical' };
}
