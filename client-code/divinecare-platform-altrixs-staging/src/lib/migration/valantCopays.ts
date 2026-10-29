import { headerMatches, reportMoneyToCents } from './valantReportCommon';

/**
 * Valant "Patient Copays" report export (CSV): copay SETTINGS per patient and payer, not balances.
 * Columns by position: 0-4 report filters, 5 payer name, 6 patient name (not kept),
 * 7 Valant patient ID, 8 copay amount, 9 provider type ('' = all), 10 CPT rule ('', 'H2018',
 * 'Default'), 11 a Valant limit ('$100' or '($9,999)').
 *
 * Column 11 is the copay maximum (confirmed by the owner 2026-10-17): the copay charged never exceeds it.
 * Valant's ($9,999) is a placeholder meaning "no maximum".
 *
 * Blank provider type / CPT rule are stored as '' (= applies to all) so the unique key works.
 */

export const COPAY_HEADER = [
  'textBox10', 'textBox11', 'textBox1', 'textBox5', 'textBox6', 'textBox7', 'textBox2', 'textBox1',
  'textBox5', 'textBox3', 'textBox4', 'textBox6',
] as const;

export const VALANT_LIMIT_LABEL = 'Copay maximum';

/** Valant writes ($9,999) when there is no maximum; any non-positive or placeholder value means no cap */
export function copayCapCents(limitCents: number | null | undefined): number | null {
  if (limitCents == null || limitCents <= 0 || limitCents >= 999_900) return null;
  return limitCents;
}

export function formatCopayMaximum(raw: string | null, limitCents: number | null | undefined): string {
  if (!raw) return '—';
  return copayCapCents(limitCents) == null ? 'No maximum' : raw;
}

export type CopayRuleInput = {
  line: number;
  valantPatientId: string;
  payerName: string;
  /** '' = all provider types */
  providerType: string;
  /** '' = all CPT codes; 'Default' kept as Valant wrote it */
  cptRule: string;
  amountCents: number;
  valantLimitRaw: string | null;
  valantLimitCents: number | null;
};

export type CopayParse = {
  ok: boolean;
  error?: string;
  rules: CopayRuleInput[];
  errors: { line: number; error: string }[];
  /** Same patient + payer + provider type + CPT rule seen again (first kept) */
  duplicateKeys: number;
  /** ...of which the amount differed */
  conflictingDuplicates: number;
  distinctPatients: number;
  distinctPayers: number;
};

/** Valant's 'Nurse Practioner' typo -> 'Nurse Practitioner'; blank -> '' */
export function normalizeProviderType(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (/^nurse\s+practi(ti)?oner$/i.test(s)) return 'Nurse Practitioner';
  return s;
}

export function normalizeCptRule(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^default$/i.test(s)) return 'Default';
  return s.toUpperCase();
}

export function copayRuleKey(r: { valantPatientId?: string; clientId?: string; payerName: string; providerType: string; cptRule: string }) {
  return [r.clientId ?? r.valantPatientId ?? '', r.payerName.toLowerCase(), r.providerType.toLowerCase(), r.cptRule.toUpperCase()].join('|');
}

export function parseCopayRow(cells: readonly string[], line: number): { rule?: CopayRuleInput; error?: string } {
  const cell = (c: number) => String(cells[c] ?? '').trim();
  // Valant IDs are usually letters + digits but can hold spaces or punctuation ("DE ABC", "!!!ABC")
  const valantPatientId = cell(7).replace(/\s+/g, ' ').toUpperCase();
  if (!valantPatientId || valantPatientId.length > 40) return { error: 'Valant patient ID is missing or invalid' };
  const payerName = cell(5).replace(/\s+/g, ' ');
  if (!payerName) return { error: `Patient ${valantPatientId}: payer is blank` };
  const amountCents = reportMoneyToCents(cell(8));
  if (amountCents === null || amountCents < 0) return { error: `Patient ${valantPatientId}: copay is not a dollar amount` };
  const limitRaw = cell(11) || null;
  return {
    rule: {
      line,
      valantPatientId,
      payerName,
      providerType: normalizeProviderType(cell(9)),
      cptRule: normalizeCptRule(cell(10)),
      amountCents,
      valantLimitRaw: limitRaw,
      valantLimitCents: limitRaw ? reportMoneyToCents(limitRaw) : null,
    },
  };
}

export function parseCopayReport(records: readonly (readonly string[])[]): CopayParse {
  const empty: CopayParse = { ok: false, rules: [], errors: [], duplicateKeys: 0, conflictingDuplicates: 0, distinctPatients: 0, distinctPayers: 0 };
  const [header, ...data] = records;
  if (!header || !headerMatches(header, COPAY_HEADER)) {
    return { ...empty, error: 'This is not the Valant Patient Copays export (the header row does not match).' };
  }
  const rules: CopayRuleInput[] = [];
  const errors: { line: number; error: string }[] = [];
  const byKey = new Map<string, CopayRuleInput>();
  let duplicateKeys = 0;
  let conflicting = 0;
  data.forEach((cells, i) => {
    if (!cells.some((c) => String(c).trim())) return;
    const line = i + 2;
    const r = parseCopayRow(cells, line);
    if (!r.rule) return errors.push({ line, error: r.error ?? 'Unreadable row' });
    const key = copayRuleKey(r.rule);
    const prior = byKey.get(key);
    if (prior) {
      duplicateKeys += 1;
      if (prior.amountCents !== r.rule.amountCents) conflicting += 1;
      return;
    }
    byKey.set(key, r.rule);
    rules.push(r.rule);
  });
  return {
    ok: true,
    rules,
    errors,
    duplicateKeys,
    conflictingDuplicates: conflicting,
    distinctPatients: new Set(rules.map((r) => r.valantPatientId)).size,
    distinctPayers: new Set(rules.map((r) => r.payerName)).size,
  };
}

/** Altrixs staff role -> Valant provider type */
export function providerTypeForRole(role: string | null | undefined): string | null {
  switch (String(role ?? '').toUpperCase()) {
    case 'PSYCHIATRIST':
      return 'Psychiatrist';
    case 'NP':
    case 'MEDICAL_NP':
      return 'Nurse Practitioner';
    case 'PHYSICIAN':
      return 'Physician';
    case 'THERAPIST':
    case 'CLINICIAN':
      return 'Therapist';
    default:
      return null;
  }
}

export type CopayRuleLike = {
  payerName: string;
  providerType: string;
  cptRule: string;
  amountCents: number;
  /** 'altrixs' rules win over imported 'valant' rules at the same specificity */
  source: string;
  /** Copay maximum; the picked amount never exceeds it (null / placeholder = no cap) */
  valantLimitCents?: number | null;
};

export type CopayPick<T extends CopayRuleLike> =
  | { ok: true; rule: T; amountCents: number; capped: boolean; specificity: 'cpt+provider' | 'cpt' | 'provider' | 'general'; ambiguous: boolean; reason?: undefined }
  | { ok: false; reason: 'no-rules' | 'payer-unknown' | 'no-matching-rule' };

function generalCpt(cpt: string) {
  return cpt === '' || cpt === 'Default';
}

/**
 * Most specific rule for a visit: CPT match > provider type match > blank.
 * Payer must match by exact name (case/space-insensitive). Without a payer, rules are used only when
 * the client has rules for a single payer. A rule for a different CPT or provider type never applies.
 */
export function pickCopayRule<T extends CopayRuleLike>(
  rules: readonly T[],
  q: { payerName?: string | null; providerType?: string | null; cpt?: string | null }
): CopayPick<T> {
  if (!rules.length) return { ok: false, reason: 'no-rules' };
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  let pool: readonly T[];
  if (q.payerName && q.payerName.trim()) {
    pool = rules.filter((r) => norm(r.payerName) === norm(q.payerName as string));
  } else {
    const payers = new Set(rules.map((r) => norm(r.payerName)));
    if (payers.size !== 1) return { ok: false, reason: 'payer-unknown' };
    pool = rules;
  }
  const cpt = (q.cpt ?? '').trim().toUpperCase();
  const ptype = normalizeProviderType(q.providerType).toLowerCase();
  const scored: { r: T; score: number }[] = [];
  for (const r of pool) {
    let cptScore: number;
    if (generalCpt(r.cptRule)) cptScore = 0;
    else if (cpt && r.cptRule.toUpperCase() === cpt) cptScore = 1;
    else continue;
    let provScore: number;
    if (!r.providerType) provScore = 0;
    else if (ptype && r.providerType.toLowerCase() === ptype) provScore = 1;
    else continue;
    // CPT outranks provider type; within a tier Altrixs-entered beats imported, blank beats 'Default'
    const score = cptScore * 100 + provScore * 10 + (r.source === 'altrixs' ? 2 : 0) + (r.cptRule === '' ? 1 : 0);
    scored.push({ r, score });
  }
  if (!scored.length) return { ok: false, reason: 'no-matching-rule' };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const ambiguous = scored.some((s) => s !== best && Math.floor(s.score / 10) === Math.floor(best.score / 10) && s.r.amountCents !== best.r.amountCents);
  const tier = Math.floor(best.score / 10);
  const specificity = tier === 11 ? 'cpt+provider' : tier === 10 ? 'cpt' : tier === 1 ? 'provider' : 'general';
  const cap = copayCapCents(best.r.valantLimitCents);
  const capped = cap != null && best.r.amountCents > cap;
  return { ok: true, rule: best.r, amountCents: capped ? cap : best.r.amountCents, capped, specificity, ambiguous };
}
