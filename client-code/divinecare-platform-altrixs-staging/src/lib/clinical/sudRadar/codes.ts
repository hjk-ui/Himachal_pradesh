/**
 * Diagnosis path of the SUD Referral Radar: ICD-10-CM F10–F19 rules. Pure module.
 *
 * Codes come only from the chart (Client diagnoses, problem list). Nothing here infers a
 * code; descriptions are passed in from charted / catalog sources and never generated.
 */
import { createHash } from 'node:crypto';
import {
  SUBSTANCE_LABEL,
  type Evidence,
  type EvidenceSourceType,
  type Finding,
  type Priority,
  type RoutedAction,
  type SubstanceClass,
} from './types';

export const SUD_CODE_CLASS: Record<string, SubstanceClass> = {
  F10: 'alcohol',
  F11: 'opioids',
  F12: 'cannabis',
  F13: 'sedatives',
  F14: 'cocaine',
  F15: 'stimulants',
  F16: 'hallucinogens',
  F17: 'nicotine',
  F18: 'inhalants',
  F19: 'other',
};

/** Withdrawal of these classes carries medical risk → level-of-care assessment. */
const WITHDRAWAL_REFERRAL_CLASSES = new Set<SubstanceClass>(['alcohol', 'opioids', 'sedatives']);

export type UseLevel = 'use-abuse' | 'dependence' | 'unspecified' | 'category';

export type SudCodeInfo = {
  code: string;
  substance: SubstanceClass;
  level: UseLevel;
  remission: boolean;
  withdrawal: boolean;
  severityLabel: string;
  action: RoutedAction;
};

const CODE_RE = /\bF1[0-9](?:\.?[0-9A-Z]{1,4})?\b/gi;

/** "f1020" / "F10.20" / " f10.20 " → "F10.20"; null when not an F10–F19 code. */
export function normalizeSudCode(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = v.match(/^(F1[0-9])\.?([0-9A-Z]{0,4})$/);
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2]}` : m[1];
}

/** Every F10–F19 code in a free-text diagnosis field (comma / semicolon / space separated). */
export function extractSudCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(CODE_RE)) {
    const code = normalizeSudCode(m[0]);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function isSudCode(code: string): boolean {
  return normalizeSudCode(code) !== null;
}

export function classifySudCode(rawCode: string, description?: string | null): SudCodeInfo | null {
  const code = normalizeSudCode(rawCode);
  if (!code) return null;
  const substance = SUD_CODE_CLASS[code.slice(0, 3)];
  const tail = code.length > 4 ? code.slice(4) : '';
  const d4 = tail[0];
  const d5 = tail[1];
  const desc = description ?? '';

  let level: UseLevel = 'category';
  if (d4 === '1') level = 'use-abuse';
  else if (d4 === '2') level = 'dependence';
  else if (d4 === '9') level = 'unspecified';

  // .x1 at the 5th character (F10.11, F10.21, F10.91) is "in remission"; descriptions also say so.
  const remission =
    (level !== 'category' && d5 === '1' && tail.length === 2) || /\bin\s+(?:early\s+|sustained\s+)?remission\b/i.test(desc);
  // .x3x is "with withdrawal" (F10.230, F11.23, F11.93, F13.239 …).
  const withdrawal = !remission && ((level !== 'category' && d5 === '3') || /\bwithdrawal\b/i.test(desc));

  const severityLabel =
    level === 'use-abuse'
      ? 'Mild — use / abuse'
      : level === 'dependence'
        ? 'Moderate / severe — dependence'
        : level === 'unspecified'
          ? 'Use, unspecified'
          : 'Unspecified (category code)';

  let action: RoutedAction;
  if (substance === 'nicotine') action = 'tobacco-cessation';
  else if (remission) action = 'chart-documentation';
  else if (withdrawal && WITHDRAWAL_REFERRAL_CLASSES.has(substance)) action = 'residential-referral';
  else if (level === 'dependence') action = 'residential-referral';
  else action = 'sbirt';

  return { code, substance, level, remission, withdrawal, severityLabel, action };
}

const ACTION_SEVERITY: Record<RoutedAction, number> = {
  'residential-referral': 3,
  sbirt: 2,
  'chart-documentation': 1,
  'tobacco-cessation': 0,
};

export function mostUrgentAction(actions: RoutedAction[]): RoutedAction {
  return actions.reduce<RoutedAction>(
    (best, a) => (ACTION_SEVERITY[a] > ACTION_SEVERITY[best] ? a : best),
    actions[0] ?? 'sbirt'
  );
}

export function fingerprintOf(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

export type ChartedCode = {
  code: string;
  /** Charted or catalog description; null shows the code only */
  description: string | null;
  sourceType: Extract<EvidenceSourceType, 'diagnosis' | 'problem-list'>;
  sourceId: string;
  sourceLabel: string;
  date: string | null;
  href: string;
};

export const SCREENING_RECOMMENDATION =
  'No SUD screening (AUDIT, DAST-10, CAGE-AID, NIDA Quick Screen or BAM) in the last 12 months — administer one to document current use.';

function recommendationFor(action: RoutedAction, infos: SudCodeInfo[]): string {
  if (action === 'residential-referral') {
    const w = infos.some((i) => i.withdrawal && WITHDRAWAL_REFERRAL_CLASSES.has(i.substance));
    return (
      'Consider ASAM level-of-care assessment; residential/IOP referral if indicated.' +
      (w ? ' A withdrawal code is charted — assess withdrawal risk (CIWA-Ar / COWS) and medical management first.' : '')
    );
  }
  if (action === 'sbirt') {
    return 'SBIRT brief intervention: screen, brief motivational intervention, and referral to treatment if use escalates.';
  }
  return 'Charted as in remission — confirm remission status at the next visit, document it, and review the relapse-prevention plan.';
}

const PRIORITY_FOR: Record<RoutedAction, Priority> = {
  'residential-referral': 'urgent',
  sbirt: 'high',
  'chart-documentation': 'low',
  'tobacco-cessation': 'low',
};

function evidenceFor(c: ChartedCode): Evidence {
  return {
    quote: c.description ? `${c.code} — ${c.description}` : c.code,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    sourceLabel: c.sourceLabel,
    date: c.date,
    href: c.href,
    key: c.code,
  };
}

/** One entry per code; prefer the source that carries a description. */
export function dedupeChartedCodes(codes: ChartedCode[]): ChartedCode[] {
  const byCode = new Map<string, ChartedCode>();
  for (const raw of codes) {
    const code = normalizeSudCode(raw.code);
    if (!code) continue;
    const c = { ...raw, code, description: raw.description?.trim() || null };
    const prev = byCode.get(code);
    if (!prev || (!prev.description && c.description)) byCode.set(code, c);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Diagnosis-path findings for one client: one signal for F10–F16/F18/F19 codes (grouped),
 * and a separate low-priority tobacco signal for F17 (never routed to SUD referral).
 */
export function buildDiagnosisFindings(input: {
  clientId: string;
  codes: ChartedCode[];
  /** Any SUD screening in the last 12 months */
  hasRecentScreening: boolean;
}): Finding[] {
  const codes = dedupeChartedCodes(input.codes);
  const sud: { c: ChartedCode; info: SudCodeInfo }[] = [];
  const nicotine: { c: ChartedCode; info: SudCodeInfo }[] = [];
  for (const c of codes) {
    const info = classifySudCode(c.code, c.description);
    if (!info) continue;
    (info.substance === 'nicotine' ? nicotine : sud).push({ c, info });
  }

  const findings: Finding[] = [];
  if (sud.length) {
    const infos = sud.map((s) => s.info);
    const action = mostUrgentAction(infos.map((i) => i.action));
    const active = infos.some((i) => !i.remission);
    const needsScreening = active && !input.hasRecentScreening;
    const classes = [...new Set(infos.map((i) => i.substance))];
    const condition = sud
      .map(({ c, info }) => `${SUBSTANCE_LABEL[info.substance]} — ${info.remission ? 'in remission' : info.severityLabel.toLowerCase()} (${c.code})`)
      .join('; ');
    findings.push({
      clientId: input.clientId,
      detectionSource: 'diagnosis',
      fingerprint: fingerprintOf(['dx', ...sud.map((s) => s.c.code)]),
      substanceClasses: classes,
      codes: sud.map((s) => s.c.code),
      evidence: sud.map((s) => evidenceFor(s.c)),
      evidenceKeys: sud.map((s) => s.c.code),
      confidence: 'high',
      confidencePercent: 95,
      detectedCondition: condition.slice(0, 500),
      recommendation: recommendationFor(action, infos) + (needsScreening ? ` ${SCREENING_RECOMMENDATION}` : ''),
      routedAction: action,
      priority: PRIORITY_FOR[action],
      needsScreening,
    });
  }
  if (nicotine.length) {
    findings.push({
      clientId: input.clientId,
      detectionSource: 'diagnosis',
      fingerprint: fingerprintOf(['dx', ...nicotine.map((s) => s.c.code)]),
      substanceClasses: ['nicotine'],
      codes: nicotine.map((s) => s.c.code),
      evidence: nicotine.map((s) => evidenceFor(s.c)),
      evidenceKeys: nicotine.map((s) => s.c.code),
      confidence: 'high',
      confidencePercent: 95,
      detectedCondition: `Nicotine / tobacco (${nicotine.map((s) => s.c.code).join(', ')})`,
      recommendation:
        'Tobacco use (F17) is not routed for SUD referral. Offer cessation counseling or pharmacotherapy and document a tobacco cessation note.',
      routedAction: 'tobacco-cessation',
      priority: 'low',
      needsScreening: false,
    });
  }
  return findings;
}

/** True when the client has a charted SUD code other than F17 (nicotine). */
export function hasNonNicotineSudCode(codes: string[]): boolean {
  return codes.some((c) => {
    const n = normalizeSudCode(c);
    return Boolean(n && !n.startsWith('F17'));
  });
}
