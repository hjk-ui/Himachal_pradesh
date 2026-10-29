import { z } from 'zod';
import { icd10ErrorText, validateIcd10Codes } from '@/lib/icd10/validate';
import { baseCptCode, chargeAmountCents, cptByCode, cptFeeMissing, missingFeeMessage } from '@/lib/constants/cpt';

/**
 * Multi-line claims. Each Claim keeps its legacy single-line columns
 * (cptCode / units / amountCents = first line / claim total) for existing
 * consumers, and stores every line in ClaimServiceLine. Per-line date of
 * service and diagnosis pointers have no columns on ClaimServiceLine, so they
 * live in Claim.submissionData.lineMeta keyed by the service line id.
 */

const MODIFIER_RE = /^[A-Z0-9]{2}$/;

export const claimLineInputSchema = z.object({
  cptCode: z.string().trim().min(3).max(12),
  modifiers: z.array(z.string().trim().toUpperCase().regex(MODIFIER_RE, 'Modifiers are 2 characters')).max(4).optional(),
  units: z.number().int().min(1).max(99).optional().default(1),
  /** Total line charge in dollars; defaults to the fee schedule rate x units. */
  charge: z.number().min(0).max(100000).optional().nullable(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  diagnosisPointers: z.array(z.number().int().min(1).max(12)).min(1).max(4).optional(),
  /** Fee schedule (Valant) code picked for this line, e.g. "90837T"; internal reference only */
  feeCode: z.string().trim().max(40).optional().nullable(),
});

export type ClaimLineInput = z.infer<typeof claimLineInputSchema>;

export type NormalizedClaimLine = {
  cptCode: string;
  modifiers: string[];
  units: number;
  chargeCents: number;
  serviceDate: string | null;
  diagnosisPointers: number[];
};

export type LineMeta = {
  serviceDate?: string | null;
  diagnosisPointers?: number[];
  /** Fee schedule (Valant) code that priced the line; never sent to the payer */
  feeCode?: string | null;
  feeSource?: string | null;
};

/** Split a stored modifier string ("HO:95", "HO,95", "HO 95") into codes. */
export function splitModifiers(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(/[\s,:;-]+/)
    .map((m) => m.trim().toUpperCase())
    .filter((m) => MODIFIER_RE.test(m));
}

/**
 * Validate and price each line. Returns an error string for the first bad line.
 * Pointers default to [1] and must reference an existing diagnosis.
 */
export function normalizeClaimLines(
  lines: ClaimLineInput[],
  diagnosisCount: number,
  opts: { isKnownCode?: (base: string) => boolean } = {}
): { ok: boolean; lines: NormalizedClaimLine[]; error: string | null } {
  const out: NormalizedClaimLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const base = baseCptCode(line.cptCode);
    // Built-in code list, or a code in the org fee schedule (e.g. 99212 / 99204 / 99205)
    if (!cptByCode(base) && !opts.isKnownCode?.(base)) {
      return { ok: false, lines: [], error: `Line ${i + 1}: unknown CPT/HCPCS code ${line.cptCode}` };
    }
    const units = Math.max(1, Math.min(99, Number(line.units) || 1));
    const pointers = line.diagnosisPointers?.length ? line.diagnosisPointers : [1];
    if (pointers.some((p) => p > diagnosisCount)) {
      return { ok: false, lines: [], error: `Line ${i + 1}: diagnosis pointer has no matching diagnosis` };
    }
    const hasCharge = line.charge != null && Number.isFinite(line.charge);
    // A code with no fee (e.g. 99212 before the practice sets one) is never priced as $0
    if (!hasCharge && cptFeeMissing(base)) {
      return { ok: false, lines: [], error: `Line ${i + 1}: ${missingFeeMessage(base)}, or enter the line charge` };
    }
    const chargeCents = hasCharge ? Math.round(line.charge * 100) : chargeAmountCents(base, units);
    out.push({
      cptCode: base,
      modifiers: Array.from(new Set((line.modifiers || []).map((m) => m.toUpperCase()))),
      units,
      chargeCents,
      serviceDate: line.serviceDate || null,
      diagnosisPointers: Array.from(new Set(pointers)),
    });
  }
  return { ok: true, lines: out, error: null };
}

/** Data for prisma.claimServiceLine.create (charges are stored in dollars). */
export function serviceLineData(claimId: string, line: NormalizedClaimLine) {
  const total = line.chargeCents / 100;
  return {
    claimId,
    cptCode: line.cptCode,
    modifier: line.modifiers.length ? line.modifiers.join(':') : null,
    units: line.units,
    unitCharge: Math.round((total / line.units) * 100) / 100,
    totalCharge: total,
  };
}

export type SubmissionLine = {
  procedureCode: string;
  modifiers: string[];
  units: number;
  /** Dollars */
  chargeAmount: number;
  serviceDate: string;
  diagnosisPointers: number[];
};

/** Read lineMeta from submissionData (tolerant of missing / malformed JSON). */
export function readLineMeta(submissionData: unknown): Record<string, LineMeta> {
  if (!submissionData || typeof submissionData !== 'object') return {};
  const meta = (submissionData as { lineMeta?: unknown }).lineMeta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, LineMeta>;
}

/**
 * Service lines for clearinghouse submission, in creation order.
 * Callers use these only when a claim has more than one line, so single-line
 * submissions keep their existing payload exactly.
 */
export function submissionLinesFor(
  rows: Array<{ id: string; cptCode: string; modifier: string | null; units: number; totalCharge: number }>,
  submissionData: unknown,
  defaults: { serviceDate: string; diagnosisCount: number }
): SubmissionLine[] {
  const meta = readLineMeta(submissionData);
  return [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => {
      const m = meta[row.id] || {};
      const pointers = (Array.isArray(m.diagnosisPointers) ? m.diagnosisPointers : [])
        .filter((p) => Number.isInteger(p) && p >= 1 && p <= defaults.diagnosisCount)
        .slice(0, 4);
      const [procedureCode, ...cptMods] = row.cptCode.split('-');
      return {
        procedureCode,
        modifiers: Array.from(new Set([...cptMods.map((x) => x.toUpperCase()), ...splitModifiers(row.modifier)])),
        units: row.units,
        chargeAmount: Math.round(row.totalCharge * 100) / 100,
        serviceDate:
          typeof m.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.serviceDate)
            ? m.serviceDate
            : defaults.serviceDate,
        diagnosisPointers: pointers.length ? pointers : [1],
      };
    });
}

/** Payload of ClaimEditorModal (PUT /api/billing/claims/[id] and create-from-charge). */
export const claimEditorSchema = z.object({
  dos: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  payer: z.string().trim().max(200).optional(),
  renderingProvider: z.string().trim().max(200).optional(),
  billingProvider: z.string().trim().max(200).optional(),
  icd10: z.string().max(400).optional(),
  authNumber: z.string().trim().max(80).optional(),
  pos: z.string().regex(/^\d{2}$/).optional(),
  lines: z
    .array(
      z.object({
        cpt: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,7}$/, 'CPT/HCPCS codes are 5 characters'),
        modifier: z.string().max(20).optional().default(''),
        units: z.number().int().min(1).max(99).default(1),
        /** Per-unit charge in dollars (line total = charge x units). */
        charge: z.number().min(0).max(100000).default(0),
      })
    )
    .min(1)
    .max(50),
});

export type ClaimEditorInput = z.infer<typeof claimEditorSchema>;

const ICD10_RE = /^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/;

/**
 * Parse "F33.1, F41.1" into validated codes: ICD-10-CM shape, then the FY2027 code set — each code
 * must exist and be billable (a category header like "F33" cannot go on a claim).
 */
export function parseIcd10List(raw: string | undefined): { ok: boolean; codes: string[]; error: string | null } {
  const codes = (raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const bad = codes.find((code) => !ICD10_RE.test(code));
  if (bad) return { ok: false, codes: [], error: `Invalid ICD-10 code: ${bad}` };
  if (codes.length > 12) return { ok: false, codes: [], error: 'A claim can carry at most 12 diagnoses' };
  const inSet = validateIcd10Codes(codes, { requireBillable: true });
  if (!inSet.ok) return { ok: false, codes: [], error: icd10ErrorText(inSet.errors) };
  return { ok: true, codes, error: null };
}

/** "Jane Doe, LCSW-C — NPI 1234567890" → "1234567890"; free text kept as typed. */
export function renderingNpiFrom(value: string | undefined) {
  const text = (value || '').trim();
  if (!text) return null;
  const npi = /\b(\d{10})\b/.exec(text);
  return npi ? npi[1] : text;
}

/** Editor lines → priced rows (cents kept integral). */
export function editorLines(lines: ClaimEditorInput['lines']) {
  return lines.map((l) => {
    const mods = splitModifiers(l.modifier);
    const lineCents = Math.round(l.charge * 100) * l.units;
    return { cpt: l.cpt, mods, units: l.units, unitCharge: l.charge, totalCharge: lineCents / 100, lineCents };
  });
}
