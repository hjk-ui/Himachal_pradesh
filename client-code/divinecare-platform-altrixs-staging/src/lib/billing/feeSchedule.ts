/**
 * Practice fee schedule (imported from Valant's "Fees" export, editable in Billing → Fee Schedule).
 * Pure: safe in tests, API routes and client components (no server imports).
 *
 * Valant codes are a CPT/HCPCS base plus an optional variant suffix: 90837T (telehealth),
 * 90837S (self-pay rate), 90791C (child), 90791CS (child self-pay), 90834-ITP (with individual
 * treatment plan), 99205-Spravato ... and admin codes with no CPT at all (Cancelled, NSH - Thrpy,
 * PRP IRP). The "billed code" column is what Valant sends to the payer; blank = never billed.
 */
import { baseCptCode, chargeAmountCents, cptByCode, cptFeeMissing, missingFeeMessage } from '@/lib/constants/cpt';
import { parseCsvText, reportMoneyToCents } from '@/lib/migration/valantReportCommon';
import type { ClaimLineInput } from '@/lib/billing/claimLines';

export const FEE_SCHEDULE_HEADER = ['PatientName1', 'ServiceDate11', 'textBox1', 'textBox2'] as const;

export type FeeSource = 'valant' | 'altrixs';

/** Fields the import derives from one CSV row (and recomputes when staff edit an item). */
export type DerivedFee = {
  code: string;
  description: string;
  feeCents: number;
  billedCpt: string | null;
  baseCpt: string | null;
  telehealth: boolean;
  selfPay: boolean;
  child: boolean;
  itp: boolean;
  /** Only used when this exact Valant code is picked (Spravato, "Dr G" self-pay, unknown suffixes) */
  exactOnly: boolean;
  variantLabel: string;
  insuranceBillable: boolean;
  needsReview: boolean;
  reviewNote: string | null;
};

export type FeeItem = DerivedFee & {
  id?: string;
  active: boolean;
  source: FeeSource;
};

/** 5-digit CPT or letter + 4 digits HCPCS (no suffix). */
const CPT_RE = /^(?:\d{5}|[A-Z]\d{4})$/;
const CPT_PREFIX_RE = /^(\d{5}|[A-Z]\d{4})/;

export function isCptOrHcpcs(code: string | null | undefined): boolean {
  return CPT_RE.test(String(code ?? '').trim().toUpperCase());
}

/** "90837T" -> "90837", "q0091" -> "Q0091", "Cancelled" -> null */
export function feeBaseCpt(code: string | null | undefined): string | null {
  const m = String(code ?? '').trim().toUpperCase().match(CPT_PREFIX_RE);
  return m ? m[1] : null;
}

type SuffixPart = { telehealth?: true; selfPay?: true; child?: true; itp?: true; label?: string; exactOnly?: true };

/** Known suffix tokens (after the CPT, split on "-"). */
const SUFFIX_TOKENS: Record<string, SuffixPart> = {
  T: { telehealth: true },
  S: { selfPay: true },
  C: { child: true },
  CS: { child: true, selfPay: true },
  CH: { child: true },
  AD: { label: 'Adult' },
  SG: { selfPay: true, label: 'Dr G', exactOnly: true },
  ITP: { itp: true },
  ITPC: { itp: true, child: true },
  SPRAVATO: { label: 'Spravato', exactOnly: true },
};

export type VariantFlags = Pick<DerivedFee, 'telehealth' | 'selfPay' | 'child' | 'itp' | 'exactOnly'> & {
  baseCpt: string | null;
  suffix: string;
  labels: string[];
  unknownSuffix: string | null;
};

/** Variant flags from the code suffix AND the description. */
export function deriveVariant(code: string, description: string): VariantFlags {
  const upper = code.trim().toUpperCase();
  const baseCpt = feeBaseCpt(upper);
  const suffix = baseCpt ? upper.slice(baseCpt.length).replace(/^-+/, '') : '';
  const v: VariantFlags = { baseCpt, suffix, telehealth: false, selfPay: false, child: false, itp: false, exactOnly: false, labels: [], unknownSuffix: null };
  const unknown: string[] = [];
  for (const piece of suffix.split('-').map((p) => p.trim()).filter(Boolean)) {
    const t = SUFFIX_TOKENS[piece];
    if (!t) {
      unknown.push(piece);
      continue;
    }
    if (t.telehealth) v.telehealth = true;
    if (t.selfPay) v.selfPay = true;
    if (t.child) v.child = true;
    if (t.itp) v.itp = true;
    if (t.exactOnly) v.exactOnly = true;
    if (t.label) v.labels.push(t.label);
  }
  const d = description;
  if (/tele\s*-?\s*health/i.test(d)) v.telehealth = true;
  if (/self[\s_-]*pay|\bself\s*$/i.test(d)) v.selfPay = true;
  if (/\bchild\b/i.test(d)) v.child = true;
  if (/w\/\s*ITP\b/i.test(d)) v.itp = true;
  if (unknown.length) {
    v.unknownSuffix = unknown.join('-');
    v.exactOnly = true;
  }
  return v;
}

export function variantLabelFor(f: Pick<DerivedFee, 'baseCpt' | 'telehealth' | 'selfPay' | 'child' | 'itp'>, extra: string[] = []): string {
  if (!f.baseCpt) return 'Admin (no CPT)';
  const parts = [
    ...(f.child ? ['Child'] : []),
    ...(f.selfPay ? ['Self-pay'] : []),
    ...(f.telehealth ? ['Telehealth'] : []),
    ...(f.itp ? ['With ITP'] : []),
    ...extra,
  ];
  return parts.length ? parts.join(' · ') : 'Standard';
}

/**
 * Insurance-billable = there is a real CPT/HCPCS billed code and the item is not a self-pay fee.
 * Self-pay and admin fees are never sent on an 837, whatever Valant's billed-code column says.
 */
export function isInsuranceBillable(f: Pick<DerivedFee, 'baseCpt' | 'billedCpt' | 'selfPay'>): boolean {
  return Boolean(f.baseCpt && f.billedCpt && isCptOrHcpcs(f.billedCpt) && !f.selfPay);
}

/** Review notes for anomalies. Flagged only; never auto-corrected. */
export function feeAnomalies(
  f: Pick<DerivedFee, 'code' | 'baseCpt' | 'billedCpt' | 'selfPay'> & { description?: string },
  unknownSuffix: string | null = null
): string[] {
  const notes: string[] = [];
  const billed = f.billedCpt?.trim().toUpperCase() || null;
  const billedBase = feeBaseCpt(billed);
  if (f.baseCpt && billed && billedBase && billedBase !== f.baseCpt) {
    notes.push(
      `Check: Valant code ${f.code}${f.description ? ` (${f.description})` : ''} bills to the payer as ${billed}, a different CPT; probably a Valant typo. Confirm the billed code before billing.`
    );
  }
  if (f.baseCpt && billed && !f.selfPay && billedBase === f.baseCpt && !isCptOrHcpcs(billed)) {
    notes.push(`Check: billed code ${billed} keeps a variant suffix; payers expect ${billedBase}. Not billable until fixed.`);
  }
  if (f.selfPay && billed && isCptOrHcpcs(billed)) {
    notes.push(`Check: self-pay variant, but Valant sends it to the payer as ${billed}. Altrixs never bills self-pay fees to insurance; confirm which it is.`);
  }
  if (unknownSuffix) {
    notes.push(`Unrecognized suffix "${unknownSuffix}": set the variant flags. Used only when this exact code is picked.`);
  }
  return notes;
}

/** Recompute derived fields from code, description, fee, billed code and (optionally) staff-set flags. */
export function deriveFee(input: {
  code: string;
  description: string;
  feeCents: number;
  billedCpt: string | null;
  flags?: Partial<Pick<DerivedFee, 'telehealth' | 'selfPay' | 'child' | 'itp' | 'exactOnly'>>;
  variantLabel?: string | null;
}): DerivedFee {
  const code = input.code.trim();
  const description = input.description.trim();
  const billedCpt = input.billedCpt?.trim().toUpperCase() || null;
  const v = deriveVariant(code, description);
  const flags = {
    telehealth: input.flags?.telehealth ?? v.telehealth,
    selfPay: input.flags?.selfPay ?? v.selfPay,
    child: input.flags?.child ?? v.child,
    itp: input.flags?.itp ?? v.itp,
    exactOnly: input.flags?.exactOnly ?? v.exactOnly,
  };
  const base = { code, baseCpt: v.baseCpt, billedCpt, ...flags };
  const notes = feeAnomalies({ ...base, description }, v.unknownSuffix);
  const extra = [...v.labels, ...(v.unknownSuffix ? [`Suffix ${v.unknownSuffix}`] : [])];
  return {
    ...base,
    description,
    feeCents: input.feeCents,
    variantLabel: input.variantLabel?.trim() || variantLabelFor({ baseCpt: v.baseCpt, ...flags }, extra),
    insuranceBillable: isInsuranceBillable({ baseCpt: v.baseCpt, billedCpt, selfPay: flags.selfPay }),
    needsReview: notes.length > 0,
    reviewNote: notes.length ? notes.join(' ') : null,
  };
}

export type FeeParseResult = {
  items: DerivedFee[];
  errors: { line: number; error: string }[];
  headerOk: boolean;
};

/** Parse Valant's Fees.csv (generic headers; read by position after verifying the header). */
export function parseFeeScheduleRecords(records: string[][]): FeeParseResult {
  const [header, ...rows] = records;
  const headerOk = Boolean(
    header &&
      FEE_SCHEDULE_HEADER.every((h, i) => String(header[i] ?? '').replace(/^﻿/, '').trim().toLowerCase() === h.toLowerCase())
  );
  const out: FeeParseResult = { items: [], errors: [], headerOk };
  if (!headerOk) return out;
  const seen = new Map<string, number>();
  rows.forEach((cells, i) => {
    const line = i + 2;
    if (!cells.some((c) => String(c).trim())) return;
    const description = String(cells[0] ?? '').trim();
    const feeRaw = String(cells[1] ?? '').trim();
    const code = String(cells[2] ?? '').trim();
    const billed = String(cells[3] ?? '').trim();
    if (!code) {
      out.errors.push({ line, error: 'Missing code' });
      return;
    }
    const feeCents = reportMoneyToCents(feeRaw);
    if (feeCents === null || feeCents < 0) {
      out.errors.push({ line, error: `Code ${code}: unreadable fee "${feeRaw}"` });
      return;
    }
    const key = code.toUpperCase();
    if (seen.has(key)) {
      out.errors.push({ line, error: `Code ${code} repeats line ${seen.get(key)}; first row kept` });
      return;
    }
    seen.set(key, line);
    out.items.push(deriveFee({ code, description: description || code, feeCents, billedCpt: billed || null }));
  });
  return out;
}

export function parseFeeScheduleCsv(text: string): FeeParseResult {
  return parseFeeScheduleRecords(parseCsvText(text));
}

export type FeeSummary = {
  items: number;
  cptItems: number;
  adminItems: number;
  insuranceBillable: number;
  notBillable: number;
  byVariant: Record<'standard' | 'telehealth' | 'selfPay' | 'child' | 'itp' | 'exactOnly', number>;
  needsReview: { code: string; note: string }[];
};

export function summarizeFees(items: DerivedFee[]): FeeSummary {
  const s: FeeSummary = {
    items: items.length,
    cptItems: 0,
    adminItems: 0,
    insuranceBillable: 0,
    notBillable: 0,
    byVariant: { standard: 0, telehealth: 0, selfPay: 0, child: 0, itp: 0, exactOnly: 0 },
    needsReview: [],
  };
  for (const f of items) {
    if (f.baseCpt) s.cptItems++;
    else s.adminItems++;
    if (f.insuranceBillable) s.insuranceBillable++;
    else s.notBillable++;
    if (f.baseCpt && !f.telehealth && !f.selfPay && !f.child && !f.itp && !f.exactOnly) s.byVariant.standard++;
    if (f.telehealth) s.byVariant.telehealth++;
    if (f.selfPay) s.byVariant.selfPay++;
    if (f.child) s.byVariant.child++;
    if (f.itp) s.byVariant.itp++;
    if (f.exactOnly) s.byVariant.exactOnly++;
    if (f.needsReview) s.needsReview.push({ code: f.code, note: f.reviewNote ?? '' });
  }
  return s;
}

// ─── Re-import planning ─────────────────────────────────────────────────────

const COMPARED: (keyof DerivedFee)[] = [
  'description', 'feeCents', 'billedCpt', 'baseCpt', 'telehealth', 'selfPay', 'child', 'itp',
  'exactOnly', 'variantLabel', 'insuranceBillable', 'needsReview', 'reviewNote',
];

export type ExistingFee = DerivedFee & { id: string; source: FeeSource; active: boolean };

export type FeeImportPlan = {
  create: DerivedFee[];
  update: { id: string; code: string; data: DerivedFee; changed: string[]; overwritesEdit: boolean }[];
  unchanged: string[];
  /** Altrixs-edited rows whose Valant values differ (kept; tick "overwrite edits" to replace) */
  keptEdits: { code: string; changed: string[] }[];
  /** In Altrixs but not in this file (left as they are) */
  notInFile: string[];
};

function diffFields(a: DerivedFee, b: DerivedFee): string[] {
  return COMPARED.filter((k) => a[k] !== b[k]);
}

/**
 * Idempotent: importing the same file twice yields only "unchanged". Valant-sourced rows are
 * updated in place; rows staff edited in Altrixs (source 'altrixs') are kept unless overwriteEdits.
 * Active state is never changed by an import.
 */
export function planFeeImport(existing: ExistingFee[], incoming: DerivedFee[], opts: { overwriteEdits?: boolean } = {}): FeeImportPlan {
  const byCode = new Map(existing.map((e) => [e.code.toUpperCase(), e]));
  const plan: FeeImportPlan = { create: [], update: [], unchanged: [], keptEdits: [], notInFile: [] };
  const inFile = new Set<string>();
  for (const f of incoming) {
    const key = f.code.toUpperCase();
    inFile.add(key);
    const e = byCode.get(key);
    if (!e) {
      plan.create.push(f);
      continue;
    }
    const changed = diffFields(e, f);
    if (e.source === 'altrixs') {
      if (opts.overwriteEdits) plan.update.push({ id: e.id, code: e.code, data: f, changed, overwritesEdit: true });
      else if (changed.length) plan.keptEdits.push({ code: e.code, changed });
      else plan.unchanged.push(e.code);
      continue;
    }
    if (changed.length) plan.update.push({ id: e.id, code: e.code, data: f, changed, overwritesEdit: false });
    else plan.unchanged.push(e.code);
  }
  for (const e of existing) if (!inFile.has(e.code.toUpperCase())) plan.notInFile.push(e.code);
  return plan;
}

// ─── Fee lookup ─────────────────────────────────────────────────────────────

export type FeeContext = {
  cpt: string;
  /** Exact Valant code staff picked (e.g. "99205-Spravato"); wins when active */
  code?: string | null;
  telehealth?: boolean;
  selfPay?: boolean;
  child?: boolean;
  itp?: boolean;
  units?: number;
};

export type FeeQuote = {
  /** Per-unit fee */
  feeCents: number;
  /** CPT to send to the payer (never a Valant suffix code); null when not insurance-billable */
  billedCpt: string | null;
  /** Valant code of the item used; null when the constants fallback was used */
  code: string | null;
  source: FeeSource | 'constants';
  baseCpt: string;
  variantLabel: string;
  insuranceBillable: boolean;
  /** The item is flagged for review (anomaly); see warnings */
  needsReview: boolean;
  description: string;
  warnings: string[];
  /** No fee anywhere: not in the fee schedule and the built-in code has no fee (e.g. 99212). feeCents is 0 and must not be billed. */
  feeMissing?: boolean;
};

const FLAG_KEYS = ['telehealth', 'selfPay', 'child', 'itp'] as const;

function quoteFrom(item: FeeItem, base: string, warnings: string[]): FeeQuote {
  return {
    feeCents: item.feeCents,
    billedCpt: item.insuranceBillable ? item.billedCpt : null,
    code: item.code,
    source: item.source,
    baseCpt: base,
    variantLabel: item.variantLabel,
    insuranceBillable: item.insuranceBillable,
    needsReview: item.needsReview,
    description: item.description,
    warnings: item.needsReview && item.reviewNote ? [...warnings, item.reviewNote] : warnings,
  };
}

/**
 * Best matching fee item. Most specific variant match wins: an item is a candidate only when
 * every flag it carries applies to the visit; among candidates the one matching most of the
 * visit's flags wins, ties go to the plain base code. Insurance visits (selfPay false) never
 * pick a self-pay / non-billable item. No candidate -> constants in src/lib/constants/cpt.ts.
 */
export function pickFee(items: FeeItem[], ctx: FeeContext): FeeQuote {
  const base = feeBaseCpt(ctx.cpt) ?? baseCptCode(ctx.cpt);
  const warnings: string[] = [];
  const active = items.filter((i) => i.active);
  if (ctx.code) {
    const exact = active.find((i) => i.code.toUpperCase() === ctx.code!.trim().toUpperCase());
    if (exact) {
      if (!ctx.selfPay && !exact.insuranceBillable) {
        warnings.push(`${exact.code} (${exact.variantLabel}) is a self-pay / non-billable fee and can't go on an insurance claim.`);
      }
      return quoteFrom(exact, exact.baseCpt ?? base, warnings);
    }
    warnings.push(`Fee code ${ctx.code} is not in the active fee schedule; matched by CPT instead.`);
  }
  const candidates = active.filter((i) => {
    if (i.baseCpt !== base || i.exactOnly) return false;
    if (!ctx.selfPay && !i.insuranceBillable) return false;
    return FLAG_KEYS.every((k) => !i[k] || Boolean(ctx[k]));
  });
  if (candidates.length) {
    // A matching self-pay rate counts double: on a self-pay visit the price matters most
    const score = (i: FeeItem) => FLAG_KEYS.reduce((n, k) => n + (i[k] && ctx[k] ? (k === 'selfPay' ? 2 : 1) : 0), 0);
    candidates.sort(
      (a, b) =>
        score(b) - score(a) ||
        Number(a.code.toUpperCase() !== base) - Number(b.code.toUpperCase() !== base) ||
        Number(a.needsReview) - Number(b.needsReview) ||
        a.code.length - b.code.length ||
        a.code.localeCompare(b.code)
    );
    return quoteFrom(candidates[0], base, warnings);
  }
  const row = cptByCode(base);
  if (cptFeeMissing(base)) {
    return {
      feeCents: 0,
      billedCpt: base,
      code: null,
      source: 'constants',
      baseCpt: base,
      variantLabel: 'Standard',
      insuranceBillable: true,
      needsReview: false,
      description: row?.desc ?? `CPT ${base}`,
      warnings: [...warnings, missingFeeMessage(base)],
      feeMissing: true,
    };
  }
  return {
    feeCents: chargeAmountCents(base, 1),
    billedCpt: base,
    code: null,
    source: 'constants',
    baseCpt: base,
    variantLabel: 'Standard',
    insuranceBillable: true,
    needsReview: false,
    description: row?.desc ?? `CPT ${base}`,
    warnings: row ? warnings : [...warnings, `${base} is not in the fee schedule or the built-in code list; default rate used.`],
  };
}

/**
 * CPT to put on the claim line. Insurance claims send the fee item's billed code, except when the
 * item is flagged for review AND bills a different CPT than the one picked (e.g. 93306 -> 99306):
 * then the picked CPT is kept and a warning is returned. Self-pay visits keep the base CPT.
 */
export function claimLineCpt(q: FeeQuote, opts: { selfPay: boolean }): { cpt: string; warning: string | null } {
  if (opts.selfPay || !q.billedCpt) return { cpt: q.baseCpt, warning: null };
  if (feeBaseCpt(q.billedCpt) !== q.baseCpt && q.needsReview) {
    return { cpt: q.baseCpt, warning: `Fee schedule bills ${q.code} as ${q.billedCpt}; kept ${q.baseCpt} until the fee schedule item is reviewed.` };
  }
  return { cpt: q.billedCpt, warning: null };
}

// ─── Claim lines ────────────────────────────────────────────────────────────

type FeeVisit = { telehealth: boolean; selfPay: boolean; child: boolean; itp?: boolean };

export type FeeScheduleClaimInfo = {
  context: FeeVisit;
  lines: {
    requestedCpt: string;
    lineCpt: string;
    code: string | null;
    source: string;
    variantLabel: string;
    feeCents: number;
    insuranceBillable: boolean;
    chargeFromFeeSchedule: boolean;
  }[];
  warnings: string[];
};

/**
 * Price claim lines from the fee schedule. A blank charge defaults to fee x units; the line CPT
 * becomes the item's billed CPT. A self-pay / non-billable fee picked on an insurance claim is
 * refused (self-pay fees never go on an 837).
 */
export function priceClaimLines(
  items: FeeItem[],
  lines: ClaimLineInput[],
  visit: FeeVisit
): { ok: false; error: string } | { ok: true; lines: ClaimLineInput[]; summary: FeeScheduleClaimInfo; isKnownCode: (base: string) => boolean } {
  const known = new Set<string>();
  for (const i of items) {
    if (i.baseCpt) known.add(i.baseCpt);
    const billed = feeBaseCpt(i.billedCpt);
    if (billed && i.insuranceBillable) known.add(billed);
  }
  const summary: FeeScheduleClaimInfo = { context: visit, lines: [], warnings: [] };
  const out: ClaimLineInput[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const [rawBase, ...cptMods] = (line.cptCode || '').trim().toUpperCase().split('-');
    const units = Math.max(1, Math.min(99, Number(line.units) || 1));
    const q = pickFee(items, { cpt: rawBase, code: line.feeCode || null, ...visit, units });
    if (!visit.selfPay && q.code && !q.insuranceBillable) {
      return {
        ok: false,
        error: `Line ${i + 1}: ${q.code} (${q.variantLabel}) is a self-pay or non-billable fee and can't go on an insurance claim. Pick the insurance code, or remove the payer for a self-pay claim.`,
      };
    }
    const lc = claimLineCpt(q, { selfPay: visit.selfPay });
    const fromSchedule = line.charge == null || !Number.isFinite(line.charge);
    out.push({
      ...line,
      cptCode: [lc.cpt, ...cptMods].join('-'),
      units,
      // No fee set (e.g. 99212): never priced as $0; the charge stays blank and normalizeClaimLines refuses it
      charge: fromSchedule ? (q.feeMissing ? undefined : (q.feeCents * units) / 100) : line.charge,
    });
    summary.lines.push({
      requestedCpt: rawBase,
      lineCpt: lc.cpt,
      code: q.code,
      source: q.source,
      variantLabel: q.variantLabel,
      feeCents: q.feeCents,
      insuranceBillable: q.insuranceBillable,
      chargeFromFeeSchedule: fromSchedule,
    });
    for (const w of [...q.warnings, ...(lc.warning ? [lc.warning] : [])]) summary.warnings.push(`Line ${i + 1}: ${w}`);
  }
  return { ok: true, lines: out, summary, isKnownCode: (b: string) => known.has(b) };
}

/**
 * Scrubber rule: a claim that has a payer but was priced with a self-pay / non-billable fee
 * schedule item (submissionData.feeSchedule) must not be sent on an 837. Returns the message.
 */
export function selfPayFeeProblem(submissionData: unknown, payer: string | null | undefined): string | null {
  if (!String(payer ?? '').trim() || !submissionData || typeof submissionData !== 'object') return null;
  const fee = (submissionData as { feeSchedule?: { context?: { selfPay?: boolean }; lines?: unknown } }).feeSchedule;
  if (!fee || typeof fee !== 'object') return null;
  const codes = (Array.isArray(fee.lines) ? (fee.lines as { code?: unknown; insuranceBillable?: unknown }[]) : [])
    .filter((l) => l && typeof l.code === 'string' && l.insuranceBillable === false)
    .map((l) => l.code as string);
  if (codes.length) {
    return `Priced with self-pay / non-billable fee ${codes.join(', ')}; self-pay fees are never sent to insurance. Re-create the claim with the insurance code.`;
  }
  if (fee.context?.selfPay === true) {
    return 'Priced at self-pay fee schedule rates (no active insurance when it was created). Re-create the claim for insurance billing.';
  }
  return null;
}

/** Self-pay payer names (blank payer counts as self-pay). */
export function isSelfPayPayer(payer: string | null | undefined): boolean {
  const p = String(payer ?? '').trim();
  return !p || /self[\s-]*pay|private\s*pay|^cash$|^none$/i.test(p);
}

/** Age in whole years on the date of service (UTC dates). */
export function ageOn(dob: Date | string | null | undefined, dos: Date | string | null | undefined): number | null {
  if (!dob) return null;
  const b = new Date(dob);
  const d = dos ? new Date(dos) : new Date();
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function isChildOn(dob: Date | string | null | undefined, dos: Date | string | null | undefined): boolean {
  const a = ageOn(dob, dos);
  return a !== null && a < 18;
}

/**
 * Visit context from the client chart: self-pay when no payer is on file (or the coverage ended
 * before the date of service), child when under 18 on the date of service. An explicit payer
 * (the New Claim form) replaces the chart payer.
 */
export function visitContext(
  client: { dateOfBirth?: Date | null; insurancePayer?: string | null; insuranceEffectiveTo?: Date | null },
  opts: { serviceDate?: Date | string | null; payer?: string | null; telehealth?: boolean }
) {
  const explicit = opts.payer !== undefined && opts.payer !== null && opts.payer.trim() !== '';
  const payer = explicit ? opts.payer : client.insurancePayer;
  const dos = opts.serviceDate ? new Date(opts.serviceDate) : new Date();
  const ended = !explicit && client.insuranceEffectiveTo && !Number.isNaN(dos.getTime()) && client.insuranceEffectiveTo < dos;
  return {
    telehealth: Boolean(opts.telehealth),
    selfPay: isSelfPayPayer(payer) || Boolean(ended),
    child: isChildOn(client.dateOfBirth ?? null, opts.serviceDate ?? null),
  };
}

/** rate null = no fee set (show "Fee not set") */
export type CptOption = { code: string; desc: string; rate: number | null; fromFeeSchedule: boolean };

/**
 * CPT pick list: the built-in constants plus every base CPT in the org fee schedule (so 99212,
 * 99204, 99205 become selectable). Existing codes are never removed; fee-schedule rates win.
 */
export function mergeCptOptions(
  constants: { code: string; desc: string; rate: number | null }[],
  feeCodes: { code: string; description: string; feeCents: number }[]
): CptOption[] {
  const fee = new Map(feeCodes.map((f) => [f.code.toUpperCase(), f]));
  const out: CptOption[] = constants.map((c) => {
    const f = fee.get(c.code.toUpperCase());
    return { code: c.code, desc: c.desc, rate: f ? f.feeCents / 100 : c.rate, fromFeeSchedule: Boolean(f) };
  });
  const have = new Set(out.map((o) => o.code.toUpperCase()));
  const extra = feeCodes
    .filter((f) => !have.has(f.code.toUpperCase()))
    .map((f) => ({ code: f.code.toUpperCase(), desc: f.description, rate: f.feeCents / 100, fromFeeSchedule: true }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return [...out, ...extra];
}

/** One entry per base CPT (the plain-code item's description/fee when present). */
export function baseCptCodes(items: FeeItem[]): { code: string; description: string; feeCents: number }[] {
  const map = new Map<string, FeeItem>();
  for (const i of items) {
    if (!i.active || !i.baseCpt) continue;
    const cur = map.get(i.baseCpt);
    const plain = i.code.toUpperCase() === i.baseCpt;
    if (!cur || (plain && cur.code.toUpperCase() !== i.baseCpt)) map.set(i.baseCpt, i);
  }
  return [...map.entries()]
    .map(([code, i]) => ({ code, description: i.description, feeCents: i.feeCents }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
