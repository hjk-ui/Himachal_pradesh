/**
 * Classify an intake document and pull out its key fields with Claude (Bedrock, under BAA).
 * Only what the text says: no defaults, no guesses. Patient identity is matched separately
 * by patientMatcher (never by the model alone).
 */
import { invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { parseDate, type ExtractedIdentifiers } from './patientMatcher';

export const DOC_TYPES = [
  'Insurance Card',
  'Lab Report',
  'Referral',
  'Court Order',
  'Prior Auth Letter',
  'Progress Note',
  'Treatment Plan',
  'Assessment',
  'Consent / ROI',
  'Discharge Summary',
  'Correspondence',
  'Unclassified',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Types assigned only by rule-based imports (Valant documents ZIP: folder and file names), never
 * by the AI classifier, so the model's choice list above is unchanged.
 */
export const IMPORT_DOC_TYPES = [
  'Intake Note',
  'Addendum',
  'Measures',
  'Intake Form',
  'Patient ID',
  'Demographics',
  'Payment Receipt',
  'Other',
] as const;
export type ImportDocType = (typeof IMPORT_DOC_TYPES)[number];
export type AnyDocType = DocType | ImportDocType;

/** Where a confirmed document is filed on the chart */
export const FILING_PATH: Record<AnyDocType, string> = {
  'Insurance Card': 'Chart › Insurance',
  'Lab Report': 'Chart › Documents › Labs',
  Referral: 'Chart › Documents › Referrals',
  'Court Order': 'Chart › Documents › Legal',
  'Prior Auth Letter': 'Chart › Documents › Authorizations',
  'Progress Note': 'Chart › Documents › Prior Records',
  'Treatment Plan': 'Chart › Documents › Prior Records',
  Assessment: 'Chart › Documents › Prior Records',
  'Consent / ROI': 'Chart › Documents › Consents',
  'Discharge Summary': 'Chart › Documents › Prior Records › Discharge',
  Correspondence: 'Chart › Documents',
  Unclassified: 'Chart › Documents',
  'Intake Note': 'Chart › Documents › Prior Records › Intake',
  Addendum: 'Chart › Documents › Prior Records › Addenda',
  Measures: 'Chart › Documents › Measures',
  'Intake Form': 'Chart › Documents › Intake Forms',
  'Patient ID': 'Chart › Documents › Identification',
  Demographics: 'Chart › Documents › Demographics',
  'Payment Receipt': 'Chart › Documents › Billing documents',
  Other: 'Chart › Documents › Other (Valant)',
};

export type Classification = {
  documentType: DocType;
  title: string | null;
  documentDate: string | null;
  patient: { firstName: string | null; lastName: string | null; dob: string | null; sourceId: string | null };
  fields: { label: string; value: string }[];
  confidence: number;
};

const SYSTEM = `You read documents received by an outpatient behavioral health clinic and return structured data.
Use only information printed in the document. Use null when something is not present. Never invent values.
documentType must be one of: ${DOC_TYPES.map((t) => `"${t}"`).join(', ')}.
Return JSON: {"documentType": string, "title": string|null, "documentDate": "YYYY-MM-DD"|null,
"patient": {"firstName": string|null, "lastName": string|null, "dob": "YYYY-MM-DD"|null, "sourceId": string|null},
"fields": [{"label": string, "value": string}] (up to 8 key facts a records clerk needs, e.g. payer, member ID,
ordering provider, test names, court and case number, authorization number and dates, referral reason),
"confidence": number between 0 and 1 for the document type}.`;

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() && !/^(null|n\/a|unknown)$/i.test(v.trim()) ? v.trim().slice(0, max) : null;

export function isClassifierConfigured() {
  return isBedrockConfigured();
}

/**
 * Fields to show for a classification, and the model's patient details used only to fill gaps in
 * the printed identifiers (mutates ids). With `sourceIdMustAppearIn`, a model-reported patient ID
 * is used only if it is printed in that text (split documents: the file name names one patient).
 */
export function applyClassification(
  c: Classification,
  ids: ExtractedIdentifiers,
  opts: { sourceIdMustAppearIn?: string } = {}
): { label: string; value: string }[] {
  if (!ids.lastName && c.patient.lastName) {
    ids.lastName = c.patient.lastName;
    ids.firstName = ids.firstName ?? c.patient.firstName ?? undefined;
  }
  if (!ids.dob && c.patient.dob) ids.dob = parseDate(c.patient.dob);
  const sid = c.patient.sourceId;
  if (sid && !ids.sourceIds.includes(sid) && (opts.sourceIdMustAppearIn === undefined || opts.sourceIdMustAppearIn.includes(sid))) {
    ids.sourceIds.push(sid);
  }
  return [
    ...(c.title ? [{ label: 'Title', value: c.title }] : []),
    ...(c.documentDate ? [{ label: 'Document date', value: c.documentDate }] : []),
    ...c.fields,
  ];
}

/** Throws when Bedrock is unavailable or the reply can't be parsed; the caller records the error. */
export async function classifyDocument(text: string, fileName: string): Promise<Classification> {
  const output = await invokeBedrock({
    model: 'HAIKU',
    system: SYSTEM,
    userPrompt: `File name: ${fileName}\n\nDocument text:\n"""\n${text.slice(0, 14000)}\n"""`,
    maxTokens: 1200,
    temperature: 0,
    jsonMode: true,
  });
  const raw = JSON.parse(output) as Record<string, unknown>;
  const p = (raw.patient ?? {}) as Record<string, unknown>;
  const type = DOC_TYPES.includes(raw.documentType as DocType) ? (raw.documentType as DocType) : 'Unclassified';
  const dob = clean(p.dob);
  const docDate = clean(raw.documentDate);
  const fields = Array.isArray(raw.fields)
    ? (raw.fields as Array<Record<string, unknown>>)
        .map((f) => ({ label: clean(f.label, 60), value: clean(f.value, 300) }))
        .filter((f): f is { label: string; value: string } => Boolean(f.label && f.value))
        .slice(0, 8)
    : [];
  const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  return {
    documentType: type,
    title: clean(raw.title, 160),
    documentDate: docDate && DOB_RE.test(docDate) ? docDate : null,
    patient: {
      firstName: clean(p.firstName, 80),
      lastName: clean(p.lastName, 80),
      dob: dob && DOB_RE.test(dob) ? dob : null,
      sourceId: clean(p.sourceId, 40),
    },
    fields,
    confidence,
  };
}
