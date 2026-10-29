/**
 * Plan for turning a client's record diagnoses (Client.primaryDiagnosis / primaryDiagnosisCode /
 * secondaryDiagnoses, written by the Valant import, intake and the profile form) into the
 * diagnosis list. Pure apart from the code-set lookup; used by scripts/backfill-diagnoses.ts and
 * tests. Never guesses a code from words: uncoded text stays an uncoded entry ("Needs coding").
 */
import { checkIcd10Code } from '@/lib/icd10/validate';
import type { Icd10CodeSet } from '@/lib/icd10/codeSet';
import { parseLegacyDiagnoses, type ParsedLegacyDiagnosis } from './model';

export type BackfillClient = {
  id: string;
  sourcePlatform: string | null;
  primaryDiagnosisCode: string | null;
  primaryDiagnosis: string | null;
  secondaryDiagnoses: string | null;
};

export type BackfillPlan =
  | { action: 'skip'; reason: 'has_list' | 'no_diagnoses'; entries: []; counts?: undefined; source?: undefined }
  | {
      action: 'create';
      reason?: undefined;
      source: 'VALANT_IMPORT' | 'LEGACY_CHART';
      entries: (ParsedLegacyDiagnosis & { description: string })[];
      counts: { coded: number; uncoded: number; notInCodeSet: number; header: number };
    };

export function planDiagnosisBackfill(c: BackfillClient, opts: { hasList: boolean; codeSet?: Icd10CodeSet | null }): BackfillPlan {
  if (opts.hasList) return { action: 'skip', reason: 'has_list', entries: [] };
  const parsed = parseLegacyDiagnoses(c);
  if (!parsed.length) return { action: 'skip', reason: 'no_diagnoses', entries: [] };
  const counts = { coded: 0, uncoded: 0, notInCodeSet: 0, header: 0 };
  const entries = parsed.map((p) => {
    if (!p.code) {
      counts.uncoded++;
      return p;
    }
    counts.coded++;
    const chk = checkIcd10Code(p.code, opts.codeSet === undefined ? {} : { codeSet: opts.codeSet });
    if (chk.status !== 'ok') counts.notInCodeSet++;
    else if (!chk.billable) counts.header++;
    return { ...p, description: p.description || chk.description || '' };
  });
  return { action: 'create', source: String(c.sourcePlatform || '').toLowerCase() === 'valant' ? 'VALANT_IMPORT' : 'LEGACY_CHART', entries, counts };
}
