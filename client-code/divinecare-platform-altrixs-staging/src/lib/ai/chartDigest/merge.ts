/**
 * Reduce step: merge validated per-chunk sections into one digest. Pure and deterministic (no
 * model call, so the reduce step cannot invent anything).
 *
 * - Items are de-duplicated by section + kind + normalized text; citations are unioned (max 4).
 * - Medication trials are merged by normalized drug name: doses unioned, start = earliest,
 *   end = latest, response / reason stopped from the newest chunk that has one, side effects unioned.
 * - Timelines are sorted by date; open items / follow-ups come only from the newest dated source
 *   (the last visit); the latest risk assessment and safety plan are picked from risk history.
 */
import type { ChartDigest, Citation, DigestItem, DigestSections, ItemSection, MedicationTrial } from '@/lib/ai/chartDigest/types';
import { ITEM_SECTIONS, emptySections } from '@/lib/ai/chartDigest/types';
import { normalizeDose, normalizeForMatch } from '@/lib/ai/chartDigest/validate';

export const MAX_CITES = 4;
export const SECTION_CAPS: Record<ItemSection | 'medicationTrials', number> = {
  diagnoses: 15,
  hospitalizations: 15,
  riskHistory: 15,
  substanceUse: 10,
  trauma: 6,
  socialFunctional: 10,
  therapy: 15,
  openItems: 8,
  medical: 12,
  medicationTrials: 25,
};

const doseKey = (s: string) => normalizeDose(s).replace(/\s+/g, '');
const textKey = (s: string) => normalizeForMatch(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Generic / brand-insensitive key: first word of the drug, letters only ("Sertraline HCl 50 mg" → sertraline) */
export function drugKey(drug: string): string {
  return (normalizeForMatch(drug).match(/[a-z][a-z-]+/)?.[0] ?? '').replace(/-/g, '');
}

function unionCites(a: Citation[], b: Citation[]): Citation[] {
  const out = [...a];
  const seen = new Set(a.map((c) => `${c.source}|${c.page}|${normalizeForMatch(c.quote)}`));
  for (const c of b) {
    const k = `${c.source}|${c.page}|${normalizeForMatch(c.quote)}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)).slice(-MAX_CITES);
}

const minDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const latestCite = (cs: Citation[]) => cs.reduce((m, c) => (c.date > m ? c.date : m), '');
const byDate = <T extends { date?: string | null; start?: string | null; cites: Citation[] }>(a: T, b: T) => {
  const da = a.date ?? a.start ?? latestCite(a.cites);
  const db = b.date ?? b.start ?? latestCite(b.cites);
  return da < db ? -1 : da > db ? 1 : 0;
};

export function mergeItems(lists: DigestItem[][]): DigestItem[] {
  const map = new Map<string, DigestItem>();
  for (const list of lists) {
    for (const it of list) {
      const k = `${(it.kind ?? '').toLowerCase()}|${textKey(it.text)}`;
      const prev = map.get(k);
      if (!prev) map.set(k, { ...it, cites: [...it.cites] });
      else {
        prev.cites = unionCites(prev.cites, it.cites);
        prev.date = minDate(prev.date, it.date);
        if (it.part2) prev.part2 = true;
      }
    }
  }
  return [...map.values()].sort(byDate);
}

export function mergeMedicationTrials(lists: MedicationTrial[][]): MedicationTrial[] {
  const map = new Map<string, MedicationTrial>();
  for (const list of lists) {
    for (const t of list) {
      const k = drugKey(t.drug);
      if (!k) continue;
      const prev = map.get(k);
      if (!prev) {
        map.set(k, { ...t, doses: [...t.doses], sideEffects: [...t.sideEffects], cites: [...t.cites] });
        continue;
      }
      const newer = latestCite(t.cites) >= latestCite(prev.cites);
      for (const d of t.doses) if (!prev.doses.some((x) => doseKey(x) === doseKey(d))) prev.doses.push(d);
      for (const s of t.sideEffects) if (!prev.sideEffects.some((x) => textKey(x) === textKey(s))) prev.sideEffects.push(s);
      prev.start = minDate(prev.start, t.start);
      prev.end = maxDate(prev.end, t.end);
      if (t.response && (newer || !prev.response)) prev.response = t.response;
      if (t.reasonStopped && (newer || !prev.reasonStopped)) prev.reasonStopped = t.reasonStopped;
      prev.cites = unionCites(prev.cites, t.cites);
      if (t.part2) prev.part2 = true;
    }
  }
  return [...map.values()].map((t) => ({ ...t, doses: t.doses.slice(0, 8), sideEffects: t.sideEffects.slice(0, 6) })).sort(byDate);
}

const RISK_ASSESSMENT_KIND = /risk[_ ]?assessment|c-?ssrs|screen/i;
const SAFETY_PLAN_KIND = /safety[_ ]?plan/i;

function latest(items: DigestItem[], re: RegExp): DigestItem | null {
  const hits = items.filter((i) => re.test(i.kind ?? '') || re.test(i.text));
  return hits.sort(byDate)[hits.length - 1] ?? null;
}

/** Merge chunk sections (any order) into the final digest */
export function mergeSections(
  chunks: DigestSections[],
  sources: ChartDigest['sources']
): ChartDigest {
  const out = emptySections();
  for (const s of ITEM_SECTIONS) {
    out[s] = mergeItems(chunks.map((c) => c[s]));
  }
  out.medicationTrials = mergeMedicationTrials(chunks.map((c) => c.medicationTrials));
  // Open items: only those cited from the newest source that produced any (the last visit)
  const newest = out.openItems.reduce((m, i) => (latestCite(i.cites) > m ? latestCite(i.cites) : m), '');
  out.openItems = out.openItems.filter((i) => latestCite(i.cites) === newest);
  const lastRiskAssessment = latest(out.riskHistory, RISK_ASSESSMENT_KIND);
  const safetyPlan = latest(out.riskHistory, SAFETY_PLAN_KIND);
  // Newest first for timelines that are capped: keep the most recent N, then sort ascending
  for (const s of ITEM_SECTIONS) out[s] = out[s].slice(-SECTION_CAPS[s]);
  out.medicationTrials = out.medicationTrials.slice(-SECTION_CAPS.medicationTrials);
  const hasPart2 = [...ITEM_SECTIONS.flatMap((s) => out[s]), ...out.medicationTrials].some((i) => i.part2);
  return { ...out, lastRiskAssessment, safetyPlan, sources, hasPart2 };
}
