/**
 * Diagnosis code rules that need the ICD-10-CM code set (server side; tests pass the code set or
 * use the checked-in FY2027 file). Pure apart from the lazy code-set load in ../icd10/validate.
 *
 *  - Chart: the code must exist in the FY2027 set (effective 2026-10-01). Category / header codes
 *    (non-billable) are allowed on the chart with a warning: claims need a billable (leaf) code.
 *  - Specificity: "unspecified" F codes prompt for a more specific code (siblings listed).
 *  - Sequencing (ICD-10-CM Official Guidelines I.A.13): manifestation codes (F02) are never
 *    first-listed; "code first" codes (F01, F05, F06, F07, F54) warn when first.
 *  - Sex edits (CMS Medicare Code Editor style) for the few codes a BH chart meets: warning only.
 *  - Claims: primary present, at most 12, all billable, not resolved / ruled out / entered in error
 *    on the chart for the date of service, BH services led by an F code (warning; an error when the
 *    payer is Maryland Medicaid / PBHS / Carelon, which accept only F codes first).
 */
import { checkIcd10Code, type Icd10Check } from '@/lib/icd10/validate';
import { loadIcd10CodeSet, type Icd10CodeSet } from '@/lib/icd10/codeSet';
import { ICD10_FISCAL_YEAR, icd10Key } from '@/lib/icd10/normalize';
import { displayCode, isCurrent, type DiagnosisRow, DIAGNOSIS_STATUS_LABEL, type DiagnosisStatus } from './model';

export type DxIssueSeverity = 'block' | 'warn' | 'info';
export type DxIssue = {
  id: string;
  severity: DxIssueSeverity;
  message: string;
  /** More specific billable codes to consider (unspecified / header codes) */
  alternatives?: { code: string; description: string }[];
};

/** Code-set effective date (FY2027 ICD-10-CM) */
export const CODE_SET_EFFECTIVE = `${ICD10_FISCAL_YEAR - 1}-10-01`;

const MANIFESTATION_ONLY = ['F02'];
const CODE_FIRST = ['F01', 'F05', 'F06', 'F07', 'F54'];
// Keys without the dot: F52.22 female sexual arousal, F52.31 female orgasmic; F52.21 male erectile,
// F52.32 male orgasmic, F52.4 premature ejaculation; F53 puerperal; O chapter; Z33-Z36 / Z3A pregnancy
const FEMALE_ONLY = [/^O/, /^Z3[3-6]/, /^Z3A/, /^F53/, /^F5222/, /^F5231/, /^N[78]\d/, /^N9[0-8]/];
const MALE_ONLY = [/^N4\d/, /^N5[0-3]/, /^F524/, /^F5221/, /^F5232/];

function safeCodeSet(set?: Icd10CodeSet | null): Icd10CodeSet | null {
  if (set !== undefined) return set;
  try {
    return loadIcd10CodeSet();
  } catch {
    return null;
  }
}

/**
 * More specific billable codes: siblings under the closest parent that has other billable
 * children ("F43.10" → F43.11, F43.12; "F32.9" → F32.0 ... F32.A), or the billable children of a
 * header code ("F31.1" → F31.10 ... F31.13). Max 10.
 */
export function specificityAlternatives(code: string, set?: Icd10CodeSet | null): { code: string; description: string }[] {
  const cs = safeCodeSet(set);
  if (!cs) return [];
  const key = icd10Key(code);
  const ix = cs.index;
  const collect = (prefix: string) => {
    const out: { code: string; description: string }[] = [];
    for (let i = 0; i < ix.keys.length; i++) {
      const k = ix.keys[i];
      if (k !== key && k.startsWith(prefix) && ix.billable[i] === 1) out.push({ code: displayCode(k), description: ix.longs[i] });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  };
  const row = ix.byKey.get(key);
  if (row !== undefined && ix.billable[row] !== 1) return collect(key).slice(0, 10);
  for (let len = key.length - 1; len >= 3; len--) {
    const found = collect(key.slice(0, len));
    if (found.length) return found.slice(0, 10);
  }
  return [];
}

function sexEditIssue(key: string, sex: string | null | undefined): DxIssue | null {
  const s = String(sex || '').trim().toUpperCase().charAt(0);
  if (s !== 'F' && s !== 'M') return null;
  if (s === 'M' && FEMALE_ONLY.some((re) => re.test(key))) {
    return { id: 'sex', severity: 'warn', message: `${displayCode(key)} is a female-only code in the CMS code edits; the client's sex on file is male. Check the code or the client's sex.` };
  }
  if (s === 'F' && MALE_ONLY.some((re) => re.test(key))) {
    return { id: 'sex', severity: 'warn', message: `${displayCode(key)} is a male-only code in the CMS code edits; the client's sex on file is female. Check the code or the client's sex.` };
  }
  return null;
}

export type ChartCodeCheck = { check: Icd10Check; description: string | null; issues: DxIssue[] };

/**
 * Checks for a code being added to (or changed on) the chart list. `block` issues stop the save;
 * `warn` / `info` are shown to the clinician.
 */
export function checkChartDiagnosisCode(
  raw: string,
  opts: { codeSet?: Icd10CodeSet | null; asPrimary?: boolean; sex?: string | null } = {}
): ChartCodeCheck {
  const cs = safeCodeSet(opts.codeSet);
  const check = checkIcd10Code(raw, { codeSet: cs });
  const issues: DxIssue[] = [];
  if (check.status === 'malformed' || check.status === 'unknown' || check.status === 'deleted') {
    issues.push({ id: `code.${check.status}`, severity: 'block', message: check.message || `${check.code} is not a valid ICD-10-CM code`, ...(check.status === 'deleted' ? { alternatives: specificityAlternatives(check.code, cs) } : {}) });
    return { check, description: check.description, issues };
  }
  const key = icd10Key(check.code);
  if (cs && !check.billable) {
    issues.push({
      id: 'code.header',
      severity: 'warn',
      message: `${check.code} is a category (header) code, not billable: claims need a more specific code.`,
      alternatives: specificityAlternatives(check.code, cs),
    });
  } else if (check.description && /\bunspecified\b/i.test(check.description) && key.startsWith('F')) {
    issues.push({
      id: 'code.unspecified',
      severity: 'warn',
      message: `${check.code} (${check.description}) is unspecified. Document the specifics (episode, severity, type) and use a more specific code when the record supports it; payers increasingly deny unspecified codes on repeat visits.`,
      alternatives: specificityAlternatives(check.code, cs),
    });
  }
  issues.push(...sequencingIssues(key, Boolean(opts.asPrimary), 'chart'));
  const sex = sexEditIssue(key, opts.sex);
  if (sex) issues.push(sex);
  return { check, description: check.description, issues };
}

function sequencingIssues(key: string, first: boolean, where: 'chart' | 'claim'): DxIssue[] {
  if (!first) return [];
  const cat = key.slice(0, 3);
  if (MANIFESTATION_ONLY.includes(cat)) {
    return [{ id: 'seq.manifestation', severity: where === 'claim' ? 'block' : 'warn', message: `${displayCode(key)} is a manifestation code and cannot be listed first (ICD-10-CM guideline I.A.13): list the underlying condition first.` }];
  }
  if (CODE_FIRST.includes(cat)) {
    return [{ id: 'seq.codeFirst', severity: 'warn', message: `${displayCode(key)} has a "code first" instruction: the underlying physiological condition is normally listed before it.` }];
  }
  return [];
}

// ─── Claims ─────────────────────────────────────────────────────────────────

/** Psychotherapy, psychiatric evaluation / E&M with psychotherapy, and HCPCS BH service codes */
export function isBehavioralHealthService(cpt: string): boolean {
  const base = String(cpt || '').trim().toUpperCase().split('-')[0];
  return /^908\d\d$/.test(base) || /^9079[12]$/.test(base) || /^H\d{4}$/.test(base) || /^9688\d$/.test(base);
}

export type ClaimDxFinding = { code: string; severity: 'error' | 'warning' | 'tip'; message: string };

/**
 * Diagnosis findings for the claim scrubber. `codes` are the claim's diagnoses in pointer order
 * (primary first). `chart` is the client's diagnosis list (null when not loaded / no list yet).
 * A diagnosis resolved after the date of service is still valid for that service.
 */
export function claimDiagnosisFindings(input: {
  codes: string[];
  chart: Pick<DiagnosisRow, 'code' | 'status' | 'resolvedDate' | 'legacy'>[] | null;
  cptCodes: string[];
  dateOfService: string | null;
  codeSet?: Icd10CodeSet | null;
  /** Payer is Maryland Medicaid / PBHS / Carelon (isMarylandPbhsClaimPayer): non-F BH primary is an error */
  marylandPbhsPayer?: boolean;
}): ClaimDxFinding[] {
  const out: ClaimDxFinding[] = [];
  const codes = input.codes.map((c) => String(c || '').trim()).filter(Boolean);
  if (!codes.length) {
    out.push({ code: 'DX_PRIMARY_MISSING', severity: 'error', message: 'No primary diagnosis on the claim (837P HI01 / CMS-1500 box 21A).' });
    return out;
  }
  if (codes.length > 12) out.push({ code: 'DX_TOO_MANY', severity: 'error', message: `The claim has ${codes.length} diagnoses; an 837P / CMS-1500 carries at most 12.` });
  const cs = safeCodeSet(input.codeSet);
  const dos = input.dateOfService;
  codes.slice(0, 12).forEach((raw, i) => {
    const label = i === 0 ? 'Primary diagnosis' : `Diagnosis ${String.fromCharCode(65 + i)}`;
    const c = checkIcd10Code(raw, { requireBillable: true, codeSet: cs });
    if (c.status === 'deleted' && dos && dos < CODE_SET_EFFECTIVE) {
      out.push({ code: 'DX_CODE_SET', severity: 'warning', message: `${label} ${c.code} was deleted on ${CODE_SET_EFFECTIVE}; it is valid only for services before that date (this one is ${dos}).` });
    } else if (c.status !== 'ok') {
      out.push({ code: i === 0 ? 'DX_PRIMARY_INVALID' : 'DX_INVALID', severity: 'error', message: `${label}: ${c.message}` });
    } else if (i === 0 && c.description && /\bunspecified\b/i.test(c.description) && icd10Key(c.code).startsWith('F')) {
      out.push({ code: 'DX_UNSPECIFIED', severity: 'tip', message: `Primary diagnosis ${c.code} is unspecified; check the chart supports a more specific code.` });
    }
    for (const s of sequencingIssues(icd10Key(c.code), i === 0, 'claim')) {
      out.push({ code: s.id === 'seq.manifestation' ? 'DX_PRIMARY_MANIFESTATION' : 'DX_PRIMARY_CODE_FIRST', severity: s.severity === 'block' ? 'error' : 'warning', message: s.message });
    }
  });

  const primaryKey = icd10Key(codes[0]);
  if (input.cptCodes.some(isBehavioralHealthService) && !primaryKey.startsWith('F')) {
    out.push(
      input.marylandPbhsPayer
        ? {
            code: 'DX_PRIMARY_NOT_BH',
            severity: 'error',
            message: `Primary diagnosis ${displayCode(codes[0])} is not a mental health / substance use (F) code. Maryland Medicaid (Public Behavioral Health System, Carelon) requires an F code (ICD-10-CM chapter 5) as the primary diagnosis on behavioral health services; only F codes are accepted first. List the covered F diagnosis first.`,
          }
        : {
            code: 'DX_PRIMARY_NOT_BH',
            severity: 'warning',
            message: `Primary diagnosis ${displayCode(codes[0])} is not a mental health / substance use (F) code. Medicaid (Maryland PBHS) and most payers require a covered behavioral health diagnosis first for psychotherapy and psychiatric services.`,
          },
    );
  }

  const chart = input.chart && input.chart.some((r) => !r.legacy) ? input.chart : null;
  if (chart) {
    codes.slice(0, 12).forEach((raw, i) => {
      const k = icd10Key(raw);
      const rows = chart.filter((r) => icd10Key(r.code || '') === k);
      const label = i === 0 ? 'Primary diagnosis' : `Diagnosis ${displayCode(raw)}`;
      if (!rows.length) {
        out.push({ code: 'DX_NOT_ON_CHART', severity: 'warning', message: `${label}${i === 0 ? ` ${displayCode(raw)}` : ''} is not on the client's diagnosis list.` });
        return;
      }
      if (rows.some(isCurrent)) {
        if (i === 0 && rows.every((r) => !isCurrent(r) || r.status === 'PROVISIONAL')) {
          out.push({ code: 'DX_PRIMARY_PROVISIONAL', severity: 'warning', message: `Primary diagnosis ${displayCode(raw)} is provisional on the chart; confirm it before billing.` });
        }
        return;
      }
      // Resolved after the date of service: still valid for this service
      const validForDos = rows.some((r) => r.status === 'RESOLVED' && r.resolvedDate && dos && r.resolvedDate >= dos);
      if (validForDos) return;
      const st = rows[0].status as DiagnosisStatus;
      out.push({
        code: i === 0 ? 'DX_PRIMARY_STATUS' : 'DX_STATUS',
        severity: i === 0 ? 'error' : 'warning',
        message: `${label}${i === 0 ? ` ${displayCode(raw)}` : ''} is ${DIAGNOSIS_STATUS_LABEL[st]?.toLowerCase() ?? st} on the diagnosis list${rows[0].resolvedDate ? ` (since ${rows[0].resolvedDate})` : ''}.`,
      });
    });
  }
  return out;
}
