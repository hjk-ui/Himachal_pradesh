/**
 * Measure guide: how to read each instrument's results (pure; browser-safe). ONE source of truth:
 *
 *  - Score bands are DERIVED from the instrument's own catalog scoring (calculateResult in
 *    src/features/ehr/assessments/catalog.ts): we run the scoring for every possible total and
 *    group the labels it returns. The guide can never show a band the scoring does not use.
 *  - Item count, score range, safety items, alert notes and worsening points come from the catalog
 *    and src/lib/measures/instruments.ts (SAFETY_ITEMS, WORSENING_POINTS).
 *  - The only data added here (REFERENCE) is what the catalog does not hold: the short citation,
 *    response / remission definitions, the recommended frequency, and whether the catalog bands
 *    were checked against the published manual. Only standard published values; anything not
 *    verified shows "See the instrument manual" (never an invented cutoff).
 *
 * Blank forms print only for instruments whose items are in the catalog AND are free to reproduce
 * (BLANK_PRINT_FREE). The catalog has no licence field; this allow-list is it. Never add
 * copyrighted item text.
 */
import type { AssessmentInstrument } from '@/features/ehr/assessments/catalog';
import { SOURCE_INSTRUMENTS } from '@/features/ehr/assessments/sourceInstruments';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
import { ASRS_POSITIVE_COUNT, DASS_BANDS, DASS_SCALE_NAME, DASS_SCALES, MDQ_PART1_POSITIVE, MDQ_TOTAL_ONLY, ASRS_TOTAL_ONLY, DASS_TOTAL_ONLY, PATTERN_SCORED } from '@/features/ehr/assessments/standardScoring';
import { instrumentById, isSendable, SAFETY_ITEMS, WORSENING_POINTS } from './instruments';

export const SEE_MANUAL = 'See the instrument manual';

export type GuideBand = { min: number; max: number; label: string };

type Reference = {
  /** Short citation of the instrument's source publication */
  cite?: string;
  /** Catalog bands match the published manual cutoffs */
  bandsVerified?: boolean;
  /** A published cutoff stated in words when the catalog bands are not verified */
  publishedCutoff?: string;
  /** Response / remission definitions (published) */
  response?: string;
  remission?: string;
  /** Extra change note (published) */
  changeNote?: string;
  frequency?: string;
  /** How the result is read when it is not a summed total (C-SSRS, AIMS, ASRS ...) */
  scoringNote?: string;
};

const DASS_NOTE = (version: 21 | 42) =>
  `Scored by subscale: Depression, Anxiety and Stress, each the sum of its ${version === 21 ? '7 items × 2' : '14 items'}${version === 21 ? ' (Depression items 3, 5, 10, 13, 16, 17, 21; Anxiety 2, 4, 7, 9, 15, 19, 20; Stress 1, 6, 8, 11, 12, 14, 18)' : ''}. All three are shown. A total alone cannot be banded (${DASS_TOTAL_ONLY.toLowerCase()}).`;

const MBC = 'Baseline, then each visit or at least every 30 days during active treatment (measurement-based care).';
const SCREEN = 'At intake and when clinically indicated (often yearly). A positive screen calls for a full assessment.';

/** Curated, published values only. Missing = "See the instrument manual". */
const REFERENCE: Readonly<Record<string, Reference>> = Object.freeze({
  'phq-9': { cite: 'Kroenke, Spitzer & Williams, 2001 (J Gen Intern Med)', bandsVerified: true, response: '50% or greater drop from baseline', remission: 'Score under 5', changeNote: 'A change of 5 points is clinically meaningful (Löwe et al., 2004).', frequency: MBC },
  'phq-a': { cite: 'Johnson et al., 2002 (J Adolesc Health)', bandsVerified: true, frequency: MBC },
  'phq-2': { cite: 'Kroenke, Spitzer & Williams, 2003 (Med Care)', bandsVerified: true, frequency: SCREEN },
  'gad-7': { cite: 'Spitzer et al., 2006 (Arch Intern Med)', bandsVerified: true, changeNote: 'A change of 4 points is the minimal clinically important difference (Toussaint et al., 2020).', frequency: MBC },
  'gad-2': { cite: 'Kroenke et al., 2007 (Ann Intern Med)', bandsVerified: true, frequency: SCREEN },
  'phq-15': { cite: 'Kroenke, Spitzer & Williams, 2002 (Psychosom Med)', bandsVerified: true, frequency: MBC },
  epds: { cite: 'Cox, Holden & Sagovsky, 1987 (Br J Psychiatry)', bandsVerified: true, frequency: 'During pregnancy and the postpartum period, and when clinically indicated.' },
  'pcl-5': { cite: 'Weathers et al., 2013 (National Center for PTSD); cutoff: VA National Center for PTSD', bandsVerified: true, publishedCutoff: '33 or higher suggests probable PTSD (VA National Center for PTSD; 31–33 is the suggested range).', changeNote: 'A 5–10 point change is reliable; 10–20 points is clinically meaningful (National Center for PTSD).', frequency: MBC },
  audit: { cite: 'Babor et al., 2001 (WHO)', bandsVerified: true, frequency: SCREEN },
  'audit-c': { cite: 'Bush et al., 1998 (Arch Intern Med)', bandsVerified: true, publishedCutoff: 'Positive: 4 or more for men, 3 or more for women.', frequency: SCREEN },
  'dast-10': { cite: 'Skinner, 1982 (Addict Behav)', bandsVerified: true, frequency: SCREEN },
  'cage-aid': { cite: 'Brown & Rounds, 1995 (Wis Med J)', bandsVerified: true, frequency: SCREEN },
  crafft: { cite: 'Knight et al., 2002 (Arch Pediatr Adolesc Med)', bandsVerified: true, frequency: SCREEN },
  mdq: { cite: 'Hirschfeld et al., 2000 (Am J Psychiatry)', bandsVerified: true, scoringNote: `Positive only when ${MDQ_PART1_POSITIVE} or more of the 13 Part 1 items are yes, AND Part 2 (several at the same time) is yes, AND Part 3 is a moderate or serious problem. A total alone cannot screen (${MDQ_TOTAL_ONLY.toLowerCase()}).`, frequency: SCREEN },
  'gds-15': { cite: 'Sheikh & Yesavage, 1986 (Clin Gerontol)', bandsVerified: true, frequency: SCREEN },
  'oci-r': { cite: 'Foa et al., 2002 (Psychol Assess)', publishedCutoff: '21 or higher suggests OCD.', frequency: MBC },
  aces: { cite: 'Felitti et al., 1998 (Am J Prev Med)', publishedCutoff: '4 or more adverse experiences is associated with markedly higher health risk. Not a diagnostic score.', frequency: 'Once (history); repeat only if new information.' },
  asrs: { cite: 'Kessler et al., 2005 (Psychol Med); WHO ASRS v1.1 screener', bandsVerified: true, scoringNote: `Positive when ${ASRS_POSITIVE_COUNT} or more of the 6 Part A answers fall in the shaded boxes (items 1–3 at Sometimes or more; items 4–6 at Often or more). The result shows the shaded count, not the total. A total alone cannot screen (${ASRS_TOTAL_ONLY.toLowerCase()}).`, frequency: SCREEN },
  'c-ssrs-brief': {
    cite: 'Posner et al., 2011 (Am J Psychiatry)',
    scoringNote: 'Read by item, not by total. Yes to item 3 (method) = moderate risk. Yes to item 4, 5 or 6 (intent, plan, or recent behavior) = high risk: start the safety protocol now.',
    frequency: 'At intake, at each visit while risk is present, and whenever a safety item (e.g. PHQ-9 item 9) is positive.',
  },
  'sbq-r': { cite: 'Osman et al., 2001 (Assessment)', publishedCutoff: '7 or higher (general population) or 8 or higher (psychiatric inpatients) indicates elevated suicide risk.', frequency: 'When clinically indicated.' },
  isi: { cite: 'Bastien, Vallières & Morin, 2001 (Sleep Med)', bandsVerified: true, frequency: MBC },
  spin: { cite: 'Connor et al., 2000 (Br J Psychiatry)', bandsVerified: true, publishedCutoff: 'Screening cutoff: 19 or higher suggests social anxiety disorder.', frequency: MBC },
  'des-ii': { cite: 'Carlson & Putnam, 1993 (Dissociation)', publishedCutoff: 'Average of 30 or higher suggests a dissociative disorder; follow with a structured interview.', frequency: SCREEN },
  'scared-c': { cite: 'Birmaher et al., 1999 (J Am Acad Child Adolesc Psychiatry)', publishedCutoff: '25 or higher may indicate an anxiety disorder.', frequency: SCREEN },
  'scared-p': { cite: 'Birmaher et al., 1999 (J Am Acad Child Adolesc Psychiatry)', publishedCutoff: '25 or higher may indicate an anxiety disorder.', frequency: SCREEN },
  asrm: { cite: 'Altman et al., 1997 (Biol Psychiatry)', bandsVerified: true, frequency: MBC },
  'ies-r': { cite: 'Weiss & Marmar, 1997', publishedCutoff: '33 or higher suggests probable PTSD (Creamer et al., 2003).', frequency: MBC },
  ess: { cite: 'Johns, 1991 (Sleep)', bandsVerified: true, publishedCutoff: 'Positive (excessive daytime sleepiness): above 10.', frequency: SCREEN },
  'who-5': { cite: 'Topp et al., 2015 (Psychother Psychosom)', bandsVerified: true, publishedCutoff: 'Percentage = raw × 4. Raw under 13 (50% or under): poor wellbeing, screen for depression. Raw 7 or under (28% or under): likely depression.', changeNote: 'A 10-percentage-point change (2.5 raw points) is clinically relevant (Topp et al., 2015).', frequency: MBC },
  'dass-21': { cite: 'Lovibond & Lovibond, 1995 (DASS manual)', bandsVerified: true, scoringNote: DASS_NOTE(21), frequency: MBC },
  'dass-42': { cite: 'Lovibond & Lovibond, 1995 (DASS manual)', bandsVerified: true, scoringNote: DASS_NOTE(42), frequency: MBC },
  swls: { cite: 'Diener et al., 1985 (J Pers Assess); bands: Pavot & Diener, 2008', bandsVerified: true, frequency: MBC },
  aims: {
    cite: 'Guy, 1976 (ECDEU Assessment Manual, NIMH)',
    scoringNote: 'Total of items 1–7 (0–28). Screen positive (Schooler & Kane) with a rating of 2 (mild) in two areas or 3 (moderate) or more in one area.',
    frequency: 'Baseline and every 6 months on an antipsychotic (more often with risk factors).',
  },
  ymrs: { cite: 'Young et al., 1978 (Br J Psychiatry)', frequency: MBC },
  'ham-d': { cite: 'Hamilton, 1960 (J Neurol Neurosurg Psychiatry); severity bands: Zimmerman et al., 2013 (J Affect Disord)', bandsVerified: true, response: '50% or greater drop from baseline', remission: '7 or under', frequency: MBC },
  madrs: { cite: 'Montgomery & Åsberg, 1979 (Br J Psychiatry)', bandsVerified: true, response: '50% or greater drop from baseline', remission: '10 or under (commonly used)', frequency: MBC },
  'ham-a': { cite: 'Hamilton, 1959 (Br J Med Psychol)', frequency: MBC },
  bprs: { cite: 'Overall & Gorham, 1962 (Psychol Rep)', frequency: MBC },
  panss: { cite: 'Kay, Fiszbein & Opler, 1987 (Schizophr Bull)', frequency: MBC },
  'ciwa-ar': { cite: 'Sullivan et al., 1989 (Br J Addict)', frequency: 'During alcohol withdrawal, per the withdrawal protocol.' },
  cows: { cite: 'Wesson & Ling, 2003 (J Psychoactive Drugs)', publishedCutoff: '5–12 mild, 13–24 moderate, 25–36 moderately severe, more than 36 severe withdrawal.', frequency: 'During opioid withdrawal / induction, per protocol.' },
  ybocs: { cite: 'Goodman et al., 1989 (Arch Gen Psychiatry)', bandsVerified: true, response: '35% or greater drop from baseline', remission: '12 or under (Mataix-Cols et al., 2016)', frequency: MBC },
  vanderbilt: { cite: 'Wolraich et al., 2003 (J Pediatr Psychol)', scoringNote: 'Scored by symptom counts (items rated 2 or 3) per domain plus a performance section, not by a total.', frequency: SCREEN },
  'vanderbilt-t': { cite: 'Wolraich et al., 2003', scoringNote: 'Scored by symptom counts (items rated 2 or 3) per domain plus a performance section, not by a total.', frequency: SCREEN },
  slums: { cite: 'Tariq et al., 2006 (Am J Geriatr Psychiatry)', scoringNote: 'Cutoffs depend on education level (high school or not).', frequency: SCREEN },
  'basis-24': { cite: 'Eisen et al., 2004 (Med Care)', frequency: MBC },
  whodas: { cite: 'Üstün et al., 2010 (WHO)', frequency: MBC },
  'nida-assist': { cite: 'NIDA, 2009', frequency: SCREEN },
  bam: { cite: 'Cacciola et al., 2013 (J Subst Abuse Treat)', frequency: MBC },
  ipds: { cite: 'Langbehn et al., 1999 (Compr Psychiatry)', frequency: SCREEN },
  'dsm5-cc': { cite: 'American Psychiatric Association, 2013', scoringNote: 'Read by domain: a rating of mild (2) or more on most domains (slight (1) or more for suicidal ideation, psychosis and substance use) calls for a Level 2 measure. Not a total-score cutoff.', frequency: MBC },
  bai: { cite: 'Beck et al., 1988 (J Consult Clin Psychol)', bandsVerified: true, frequency: MBC },
  'bdi-ii': { cite: 'Beck, Steer & Brown, 1996', bandsVerified: true, frequency: MBC },
  'qids-sr': { cite: 'Rush et al., 2003 (Biol Psychiatry)', bandsVerified: true, response: '50% or greater drop from baseline', remission: '5 or under', frequency: MBC },
  pswq: { cite: 'Meyer et al., 1990 (Behav Res Ther)', frequency: MBC },
  lsas: { cite: 'Liebowitz, 1987', frequency: MBC },
  pdss: { cite: 'Shear et al., 1997 (Am J Psychiatry)', frequency: MBC },
  'msi-bpd': { cite: 'Zanarini et al., 2003 (J Pers Disord)', bandsVerified: true, frequency: SCREEN },
  'oq-45': { cite: 'Lambert et al., 1996', frequency: MBC },
  'sf-12': { cite: 'Ware, Kosinski & Keller, 1996 (Med Care)', scoringNote: 'Physical and mental component scores are norm-based (mean 50); use the scoring software.', frequency: MBC },
  moca: { cite: 'Nasreddine et al., 2005 (J Am Geriatr Soc)', publishedCutoff: '26 or higher is normal (add 1 point for 12 years of education or less).', frequency: SCREEN },
  'aq-10': { cite: 'Allison, Auyeung & Baron-Cohen, 2012 (J Am Acad Child Adolesc Psychiatry)', bandsVerified: true, frequency: SCREEN },
  'raads-14': { cite: 'Eriksson, Andersen & Bejerot, 2013 (Mol Autism)', bandsVerified: true, frequency: SCREEN },
  'caps-5': { cite: 'Weathers et al., 2018 (Psychol Assess)', scoringNote: 'Diagnosis follows DSM-5 symptom rules; total severity is 0–80.', frequency: MBC },
  'cdrs-r': { cite: 'Poznanski & Mokros, 1996', frequency: MBC },
  mfq: { cite: 'Angold et al., 1995', frequency: MBC },
  cbcl: { cite: 'Achenbach & Rescorla, 2001', scoringNote: 'Read as T-scores from the scoring software (not raw totals).', frequency: SCREEN },
  caars: { cite: 'Conners, Erhardt & Sparrow, 1999', scoringNote: 'Read as T-scores from the scoring software (not raw totals).', frequency: SCREEN },
  rms: { cite: 'McIntyre et al., 2021 (Curr Med Res Opin)', frequency: SCREEN },
});

/**
 * Free to reproduce for clinical use, with the items in the catalog: a blank form may be printed.
 * PHQ / GAD family (Pfizer: no permission required), EPDS (with citation), PCL-5 and AIMS (public
 * domain), AUDIT / AUDIT-C (WHO), DAST-10, CAGE-AID, GDS-15, WHO-5, DASS-21, C-SSRS screener.
 * Everything else (licensed, permission-only or unknown) never prints blank.
 */
export const BLANK_PRINT_FREE: ReadonlySet<string> = new Set([
  'phq-9', 'phq-2', 'phq-a', 'phq-15', 'gad-7', 'gad-2', 'epds', 'pcl-5', 'audit', 'audit-c', 'dast-10', 'cage-aid',
  'c-ssrs-brief', 'gds-15', 'who-5', 'dass-21', 'aims',
]);

export type BlankPrintCheck = { ok: true } | { ok: false; reason: 'unknown' | 'no_items' | 'licensed' };

export function blankPrintCheck(id: string): BlankPrintCheck {
  const i = instrumentById(id);
  if (!i) return { ok: false, reason: 'unknown' };
  if (i.itemContentPending || !i.questions?.length) return { ok: false, reason: 'no_items' };
  if (!BLANK_PRINT_FREE.has(id)) return { ok: false, reason: 'licensed' };
  return { ok: true };
}

export const BLANK_PRINT_TEXT: Record<Exclude<BlankPrintCheck, { ok: true }>['reason'], string> = {
  unknown: 'Unknown measure.',
  no_items: 'The items are not stored in Altrixs: use the official form.',
  licensed: 'Licensed or permission-only form: print it from the official source.',
};

/** Paper entry: item responses, the total only, or both (items are in the catalog and summed) */
export type PaperEntryMode = 'items_or_total' | 'items_only' | 'total_only' | 'none';

/** Read by item, not by a summed total: paper entry needs the item responses */
const ITEMS_ONLY = new Set(['c-ssrs-brief', 'aims']);

export function paperEntryMode(id: string): PaperEntryMode {
  const i = instrumentById(id);
  if (!i || i.itemContentPending) return 'none';
  if (ITEMS_ONLY.has(id)) return i.questions?.length ? 'items_only' : 'none';
  return i.questions?.length ? 'items_or_total' : 'total_only';
}

/** Instruments whose catalog score is the mean of the items (the total entered is that mean) */
const MEAN_SCORED = new Set(['des-ii']);

/**
 * Score a TOTAL with the instrument's own catalog scoring (the same calculateResult the item form
 * uses). Null when the instrument is not read as a summed total.
 */
export function scoreFromTotal(id: string, total: number): { totalScore: number; severity: string; interpretation: string; safetyFlagged: boolean } | null {
  const i = instrumentById(id);
  if (!i || ITEMS_ONLY.has(id) || i.itemContentPending || !Number.isFinite(total)) return null;
  const n = MEAN_SCORED.has(id) ? i.questionCount : 1;
  const r = i.calculateResult({ __total: total * n });
  return { totalScore: r.totalScore, severity: r.severity, interpretation: r.interpretation, safetyFlagged: Boolean(r.safetyFlagged) };
}

/** Lowest possible total: sum of each item's lowest option, else the lowest catalog band */
export function scoreRangeOf(i: AssessmentInstrument): { min: number; max: number } {
  const max = i.maxScore ?? 0;
  if (i.questions?.length && !MEAN_SCORED.has(i.id)) {
    return { min: i.questions.reduce((s, q) => s + Math.min(...q.options.map((o) => o.score)), 0), max };
  }
  const mins = (i.scoreRanges ?? []).map((b) => b.min);
  return { min: mins.length ? Math.max(0, Math.min(...mins)) : 0, max };
}

/** Bands as the scoring assigns them: run the scoring over every whole total and group the labels */
export function bandsFromScoring(id: string): GuideBand[] | null {
  const i = instrumentById(id);
  if (!i || i.maxScore == null || PATTERN_SCORED.has(id) || !scoreFromTotal(id, 0)) return null;
  const { min, max } = scoreRangeOf(i);
  const out: GuideBand[] = [];
  for (let t = min; t <= max; t++) {
    const label = scoreFromTotal(id, t)!.severity;
    const last = out[out.length - 1];
    if (last && last.label === label && last.max === t - 1) last.max = t;
    else out.push({ min: t, max: t, label });
  }
  return out;
}

export type MeasureGuideEntry = {
  id: string;
  name: string;
  fullName: string;
  category: string;
  adminType: string;
  whatItMeasures: string;
  instructions: string | null;
  itemCount: number;
  scoreRange: { min: number; max: number } | null;
  /** Verified bands (published cutoffs); null -> SEE_MANUAL */
  bands: GuideBand[] | null;
  /** The labels Altrixs scoring uses when the bands are not verified (shown with that caveat) */
  scoringLabels: GuideBand[] | null;
  /** Scoring checked against the published source (total bands, or the item / subscale rule) */
  verified: boolean;
  /** Per-subscale bands (DASS) */
  subscaleBands: { name: string; bands: GuideBand[] }[] | null;
  publishedCutoff: string | null;
  scoringNote: string | null;
  change: { response: string | null; remission: string | null; worseningPoints: number | null; note: string | null };
  frequency: string;
  critical: string[];
  citation: string;
  sendable: boolean;
  blankPrint: BlankPrintCheck;
  paperEntry: PaperEntryMode;
};

function sourceFor(id: string) {
  return SOURCE_INSTRUMENTS.find((s) => (s.key === 'C-SSRS' ? 'c-ssrs-brief' : s.key.toLowerCase()) === id) ?? null;
}

export function measureGuideEntry(id: string): MeasureGuideEntry | null {
  const i = instrumentById(id);
  if (!i) return null;
  const ref = REFERENCE[id] ?? {};
  const src = sourceFor(id);
  const derived = bandsFromScoring(id);
  const safetyItem = SAFETY_ITEMS[id];
  const critical = [
    safetyItem ? `Item ${safetyItem.replace(/^q/, '')} above 0 is a positive safety screen whatever the total: the record is flagged for safety review and a high-priority risk alert goes to the treating clinician (in session, patient link or paper). Follow up the same day (C-SSRS and safety plan).` : null,
    id === 'c-ssrs-brief' ? 'Any Yes to items 3–6 flags the record for safety review and raises a high-priority risk alert; items 4–6 are high risk.' : null,
    src?.alertNote ?? null,
  ].filter((x): x is string => Boolean(x));
  return {
    id: i.id,
    name: i.name,
    fullName: i.fullName,
    category: i.category,
    adminType: i.adminType,
    whatItMeasures: src?.description ?? i.description,
    instructions: src?.administrationNote ?? null,
    itemCount: i.questionCount,
    scoreRange: i.maxScore != null && !ITEMS_ONLY.has(id) ? scoreRangeOf(i) : i.maxScore != null ? { min: 0, max: i.maxScore } : null,
    bands: ref.bandsVerified && derived ? derived : null,
    scoringLabels: !ref.bandsVerified && derived ? derived : null,
    verified: Boolean(ref.bandsVerified),
    subscaleBands: id === 'dass-21' || id === 'dass-42' ? DASS_SCALES.map((k) => ({ name: DASS_SCALE_NAME[k], bands: DASS_BANDS[k].map((b) => ({ ...b })) })) : null,
    publishedCutoff: ref.publishedCutoff ?? null,
    scoringNote: ref.scoringNote ?? (i.itemContentPending ? 'Item content pending licensed copy: score from the official form.' : null),
    change: {
      response: ref.response ?? null,
      remission: ref.remission ?? null,
      worseningPoints: WORSENING_POINTS[id] ?? null,
      note: ref.changeNote ?? null,
    },
    frequency: ref.frequency ?? 'As clinically indicated.',
    critical: [...new Set(critical)],
    citation: ref.cite ?? SEE_MANUAL,
    sendable: isSendable(id),
    blankPrint: blankPrintCheck(id),
    paperEntry: paperEntryMode(id),
  };
}

/** One entry per catalog instrument, catalog order */
export function measureGuide(): MeasureGuideEntry[] {
  return ASSESSMENT_CATALOG.map((i) => measureGuideEntry(i.id)!).filter(Boolean);
}

/** Band of a score in a guide entry (verified bands first, else the scoring labels) */
export function guideBandFor(entry: MeasureGuideEntry, score: number | null): GuideBand | null {
  if (score == null) return null;
  return (entry.bands ?? entry.scoringLabels ?? []).find((b) => score >= b.min && score <= b.max) ?? null;
}
