/**
 * CMS Accountable Health Communities (AHC) Health-Related Social Needs (HRSN) Screening Tool.
 *
 * Question text, answer options and "positive" answers are copied word for word from the CMS
 * tool (Center for Medicare and Medicaid Innovation, "The Accountable Health Communities
 * Health-Related Social Needs Screening Tool", https://www.cms.gov/priorities/innovation/files/worksheets/ahcm-screeningtool.pdf).
 * In the tool, the underlined answers mark a possible unmet need; here they are `positive: true`.
 * Item citations, notification rules and LOINC codes come from CMS "AHC HRSN Screening Tool
 * Citation and Notification Information" (September 2021,
 * https://www.cms.gov/priorities/innovation/media/document/ahcm-screening-tool-citation).
 *
 * Included: the 10 core items (5 core domains: living situation, food, transportation, utilities,
 * safety) and the supplemental items 11-16 (financial strain, employment, family and community
 * support, education). Not included: supplemental physical activity (17-18), substance use (19-22),
 * mental health (23-24) and disabilities (25-26). Substance use answers would be 42 CFR Part 2
 * records in this program and the clinic already uses the PHQ / GAD / AUDIT / DAST screeners for
 * mental health and substance use.
 *
 * Pure module (no Prisma): imported by the page, the API and the tests.
 */

export const AHC_INSTRUMENT = 'AHC_HRSN' as const;
/** Bump when question text or scoring changes; stored on every screening. */
export const AHC_VERSION = 'cms-2021-core10-supp11-16' as const;
/** CMS: "A score of 11 or more when the numerical values for answers to questions 7-10 are added shows that the person might not be safe." */
export const AHC_SAFETY_THRESHOLD = 11;

export const AHC_SOURCE = {
  tool: 'The Accountable Health Communities Health-Related Social Needs Screening Tool. Centers for Medicare & Medicaid Services, Center for Medicare and Medicaid Innovation.',
  toolUrl: 'https://www.cms.gov/priorities/innovation/files/worksheets/ahcm-screeningtool.pdf',
  citationTable: 'Accountable Health Communities Health-Related Social Needs Screening Tool Citation and Notification Information. CMS, September 2021.',
  citationTableUrl: 'https://www.cms.gov/priorities/innovation/media/document/ahcm-screening-tool-citation',
  paper: 'Billioux A, Verlander K, Anthony S, Alley D. Standardized Screening for Health-Related Social Needs in Clinical Settings: The Accountable Health Communities Screening Tool. NAM Perspectives, 2017.',
  coreLoinc: '96777-8',
  supplementalLoinc: '97023-6',
} as const;

export type AhcDomain =
  | 'housing_instability'
  | 'housing_quality'
  | 'food'
  | 'transportation'
  | 'utilities'
  | 'safety'
  | 'financial_strain'
  | 'employment'
  | 'family_support'
  | 'education';

export const CORE_DOMAINS: AhcDomain[] = ['housing_instability', 'housing_quality', 'food', 'transportation', 'utilities', 'safety'];
export const SUPPLEMENTAL_DOMAINS: AhcDomain[] = ['financial_strain', 'employment', 'family_support', 'education'];
export const ALL_DOMAINS: AhcDomain[] = [...CORE_DOMAINS, ...SUPPLEMENTAL_DOMAINS];

export const DOMAIN_LABEL: Record<AhcDomain, string> = {
  housing_instability: 'Housing instability',
  housing_quality: 'Housing quality',
  food: 'Food',
  transportation: 'Transportation',
  utilities: 'Utilities',
  safety: 'Interpersonal safety',
  financial_strain: 'Financial strain',
  employment: 'Employment',
  family_support: 'Family & community support',
  education: 'Education',
};

export interface AhcOption {
  value: string;
  label: string;
  /** Underlined in the CMS tool = possible unmet need */
  positive: boolean;
  /** Safety items: numeric value printed in the tool (Never (1) ... Frequently (5)) */
  points?: number;
}

export interface AhcQuestion {
  /** q1 ... q16 = the CMS item number */
  id: string;
  number: number;
  domain: AhcDomain;
  /** The card the question is shown on (one domain per card; living situation holds q1 + q2) */
  card: AhcCard;
  text: string;
  multi?: boolean;
  options: AhcOption[];
  supplemental: boolean;
  citation: string;
  /** CMS: author asks to be notified before use outside the AHC Model */
  notifyAuthor?: string;
  loinc: string;
}

export type AhcCard =
  | 'living'
  | 'food'
  | 'transportation'
  | 'utilities'
  | 'safety'
  | 'financial_strain'
  | 'employment'
  | 'family_support'
  | 'education';

export const CARD_META: Record<AhcCard, { title: string; intro?: string; supplemental: boolean }> = {
  living: { title: 'Living situation', supplemental: false },
  food: {
    title: 'Food',
    intro:
      'Some people have made the following statements about their food situation. Please answer whether the statements were OFTEN, SOMETIMES, or NEVER true for you and your household in the last 12 months.',
    supplemental: false,
  },
  transportation: { title: 'Transportation', supplemental: false },
  utilities: { title: 'Utilities', supplemental: false },
  safety: {
    title: 'Safety',
    intro: 'Because violence and abuse happens to a lot of people and affects their health we are asking the following questions.',
    supplemental: false,
  },
  financial_strain: { title: 'Financial strain', supplemental: true },
  employment: { title: 'Employment', supplemental: true },
  family_support: { title: 'Family and community support', supplemental: true },
  education: { title: 'Education', supplemental: true },
};

const PRAPARE = 'National Association of Community Health Centers and partners (2017). PRAPARE. http://www.nachc.org/research-and-data/prapare/';
const TEP = 'Identifying and Recommending Screening Questions for the Accountable Health Communities Model (2016, July). Technical Expert Panel, CMS, Baltimore, MD.';

const OFTEN_SOMETIMES_NEVER: AhcOption[] = [
  { value: 'often', label: 'Often true', positive: true },
  { value: 'sometimes', label: 'Sometimes true', positive: true },
  { value: 'never', label: 'Never true', positive: false },
];

const HITS: AhcOption[] = [
  { value: '1', label: 'Never', positive: false, points: 1 },
  { value: '2', label: 'Rarely', positive: false, points: 2 },
  { value: '3', label: 'Sometimes', positive: false, points: 3 },
  { value: '4', label: 'Fairly often', positive: false, points: 4 },
  { value: '5', label: 'Frequently', positive: false, points: 5 },
];
const HITS_CITE = 'Sherin KM, Sinacore JM, Li XQ, Zitter RE, Shakil A. HITS: a Short Domestic Violence Screening Tool for Use in a Family Practice Setting. Family Medicine 1998;30(7):508-512.';

export const HOUSING_PROBLEM_OPTIONS: AhcOption[] = [
  { value: 'pests', label: 'Pests such as bugs, ants, or mice', positive: true },
  { value: 'mold', label: 'Mold', positive: true },
  { value: 'lead', label: 'Lead paint or pipes', positive: true },
  { value: 'no_heat', label: 'Lack of heat', positive: true },
  { value: 'oven', label: 'Oven or stove not working', positive: true },
  { value: 'smoke_detectors', label: 'Smoke detectors missing or not working', positive: true },
  { value: 'water_leaks', label: 'Water leaks', positive: true },
  { value: 'none', label: 'None of the above', positive: false },
];

export const AHC_QUESTIONS: AhcQuestion[] = [
  {
    id: 'q1', number: 1, domain: 'housing_instability', card: 'living', supplemental: false,
    text: 'What is your living situation today?',
    options: [
      { value: 'steady', label: 'I have a steady place to live', positive: false },
      { value: 'worried', label: 'I have a place to live today, but I am worried about losing it in the future', positive: true },
      {
        value: 'not_steady',
        label: 'I do not have a steady place to live (I am temporarily staying with others, in a hotel, in a shelter, living outside on the street, on a beach, in a car, abandoned building, bus or train station, or in a park)',
        positive: true,
      },
    ],
    citation: PRAPARE, notifyAuthor: 'PRAPARE team: prapare@nachc.org', loinc: '71802-3',
  },
  {
    id: 'q2', number: 2, domain: 'housing_quality', card: 'living', supplemental: false, multi: true,
    text: 'Think about the place you live. Do you have problems with any of the following? (Choose all that apply)',
    options: HOUSING_PROBLEM_OPTIONS,
    citation: 'Nuruzzaman N, Broadwin M, Kourouma K, Olson DP. Making the Social Determinants of Health a Routine Part of Medical Care. J Health Care Poor Underserved 2015;26(2):321-327.',
    loinc: '96778-6',
  },
  {
    id: 'q3', number: 3, domain: 'food', card: 'food', supplemental: false,
    text: 'Within the past 12 months, you worried that your food would run out before you got money to buy more.',
    options: OFTEN_SOMETIMES_NEVER,
    citation: 'Hager ER, Quigg AM, Black MM, et al. Development and Validity of a 2-Item Screen to Identify Families at Risk for Food Insecurity. Pediatrics 2010;126(1):26-32.',
    loinc: '88122-7',
  },
  {
    id: 'q4', number: 4, domain: 'food', card: 'food', supplemental: false,
    text: "Within the past 12 months, the food you bought just didn't last and you didn't have money to get more.",
    options: OFTEN_SOMETIMES_NEVER,
    citation: 'Hager ER, Quigg AM, Black MM, et al. Development and Validity of a 2-Item Screen to Identify Families at Risk for Food Insecurity. Pediatrics 2010;126(1):26-32.',
    loinc: '88123-5',
  },
  {
    id: 'q5', number: 5, domain: 'transportation', card: 'transportation', supplemental: false,
    text: 'In the past 12 months, has lack of reliable transportation kept you from medical appointments, meetings, work or from getting things needed for daily living?',
    options: [
      { value: 'yes', label: 'Yes', positive: true },
      { value: 'no', label: 'No', positive: false },
    ],
    citation: PRAPARE, notifyAuthor: 'PRAPARE team: prapare@nachc.org', loinc: '93030-5',
  },
  {
    id: 'q6', number: 6, domain: 'utilities', card: 'utilities', supplemental: false,
    text: 'In the past 12 months has the electric, gas, oil, or water company threatened to shut off services in your home?',
    options: [
      { value: 'yes', label: 'Yes', positive: true },
      { value: 'no', label: 'No', positive: false },
      { value: 'shut_off', label: 'Already shut off', positive: true },
    ],
    citation: 'Cook JT, Frank DA, Casey PH, et al. A Brief Indicator of Household Energy Security. Pediatrics 2008;122(4):867-875.',
    notifyAuthor: 'Richard Sheward, MPP: richard.sheward@bmc.org', loinc: '96779-4',
  },
  { id: 'q7', number: 7, domain: 'safety', card: 'safety', supplemental: false, text: 'How often does anyone, including family and friends, physically hurt you?', options: HITS, citation: HITS_CITE, notifyAuthor: 'Dr. Kevin Sherin: sherinkmj@gmail.com', loinc: '95618-5' },
  { id: 'q8', number: 8, domain: 'safety', card: 'safety', supplemental: false, text: 'How often does anyone, including family and friends, insult or talk down to you?', options: HITS, citation: HITS_CITE, notifyAuthor: 'Dr. Kevin Sherin: sherinkmj@gmail.com', loinc: '95617-7' },
  { id: 'q9', number: 9, domain: 'safety', card: 'safety', supplemental: false, text: 'How often does anyone, including family and friends, threaten you with harm?', options: HITS, citation: HITS_CITE, notifyAuthor: 'Dr. Kevin Sherin: sherinkmj@gmail.com', loinc: '95616-9' },
  { id: 'q10', number: 10, domain: 'safety', card: 'safety', supplemental: false, text: 'How often does anyone, including family and friends, scream or curse at you?', options: HITS, citation: HITS_CITE, notifyAuthor: 'Dr. Kevin Sherin: sherinkmj@gmail.com', loinc: '95615-1' },
  {
    id: 'q11', number: 11, domain: 'financial_strain', card: 'financial_strain', supplemental: true,
    text: 'How hard is it for you to pay for the very basics like food, housing, medical care, and heating? Would you say it is:',
    options: [
      { value: 'very_hard', label: 'Very hard', positive: true },
      { value: 'somewhat_hard', label: 'Somewhat hard', positive: true },
      { value: 'not_hard', label: 'Not hard at all', positive: false },
    ],
    citation: 'Hall MH, Matthews KA, Kravitz HM, et al. Race and Financial Strain are Independent Correlates of Sleep in Midlife Women: The SWAN Sleep Study. Sleep 2009;32(1):73-82.',
    loinc: '76513-1',
  },
  {
    id: 'q12', number: 12, domain: 'employment', card: 'employment', supplemental: true,
    text: 'Do you want help finding or keeping work or a job?',
    options: [
      { value: 'finding', label: 'Yes, help finding work', positive: true },
      { value: 'keeping', label: 'Yes, help keeping work', positive: true },
      { value: 'no', label: 'I do not need or want help', positive: false },
    ],
    citation: TEP, loinc: '96780-2',
  },
  {
    id: 'q13', number: 13, domain: 'family_support', card: 'family_support', supplemental: true,
    text: 'If for any reason you need help with day-to-day activities such as bathing, preparing meals, shopping, managing finances, etc., do you get the help you need?',
    options: [
      { value: 'no_help_needed', label: "I don't need any help", positive: false },
      { value: 'all_help', label: 'I get all the help I need', positive: false },
      { value: 'little_more', label: 'I could use a little more help', positive: true },
      { value: 'lot_more', label: 'I need a lot more help', positive: true },
    ],
    citation: 'Kaiser Permanente (2012). Medicare Total Health Assessment Questionnaire.',
    loinc: '96781-0',
  },
  {
    id: 'q14', number: 14, domain: 'family_support', card: 'family_support', supplemental: true,
    text: 'How often do you feel lonely or isolated from those around you?',
    options: [
      { value: 'never', label: 'Never', positive: false },
      { value: 'rarely', label: 'Rarely', positive: false },
      { value: 'sometimes', label: 'Sometimes', positive: false },
      { value: 'often', label: 'Often', positive: true },
      { value: 'always', label: 'Always', positive: true },
    ],
    citation: 'Anderson GO, Thayer CE. Loneliness and Social Connections: A National Survey of Adults 45 and Older. AARP Research, 2018.',
    loinc: '93159-2',
  },
  {
    id: 'q15', number: 15, domain: 'education', card: 'education', supplemental: true,
    text: 'Do you speak a language other than English at home?',
    options: [
      { value: 'yes', label: 'Yes', positive: true },
      { value: 'no', label: 'No', positive: false },
    ],
    citation: 'US Census Bureau (2017). American Community Survey.',
    loinc: '97027-7',
  },
  {
    id: 'q16', number: 16, domain: 'education', card: 'education', supplemental: true,
    text: 'Do you want help with school or training? For example, starting or completing job training or getting a high school diploma, GED or equivalent.',
    options: [
      { value: 'yes', label: 'Yes', positive: true },
      { value: 'no', label: 'No', positive: false },
    ],
    citation: TEP, loinc: '96782-8',
  },
];

export const QUESTION_BY_ID = new Map(AHC_QUESTIONS.map((q) => [q.id, q]));
export const CORE_QUESTION_IDS = AHC_QUESTIONS.filter((q) => !q.supplemental).map((q) => q.id);
export const SAFETY_QUESTION_IDS = ['q7', 'q8', 'q9', 'q10'] as const;

/** q2 holds a list of values; every other item a single value. Missing / null = not answered (declined or skipped). */
export type AhcAnswers = Partial<Record<string, string | string[] | null>>;

export function cardsFor(includeSupplemental: boolean): AhcCard[] {
  return (Object.keys(CARD_META) as AhcCard[]).filter((c) => includeSupplemental || !CARD_META[c].supplemental);
}

export function questionsFor(includeSupplemental: boolean): AhcQuestion[] {
  return AHC_QUESTIONS.filter((q) => includeSupplemental || !q.supplemental);
}

/** Drops unknown items / values; q2 "None of the above" cannot be combined with a problem. */
export function normalizeAnswers(raw: AhcAnswers, includeSupplemental: boolean): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of questionsFor(includeSupplemental)) {
    const v = raw[q.id];
    const allowed = new Set(q.options.map((o) => o.value));
    if (q.multi) {
      const list = Array.isArray(v) ? [...new Set(v.filter((x) => allowed.has(x)))] : [];
      if (!list.length) continue;
      out[q.id] = list.includes('none') && list.length > 1 ? list.filter((x) => x !== 'none') : list;
    } else if (typeof v === 'string' && allowed.has(v)) {
      out[q.id] = v;
    }
  }
  return out;
}

export interface DomainResult {
  domain: AhcDomain;
  positive: boolean;
  /** Every item in the domain answered */
  complete: boolean;
}

export interface AhcScore {
  domains: DomainResult[];
  positiveDomains: AhcDomain[];
  /** Sum of items 7-10 (1-5 each); null when not all four are answered and the partial sum is under 11 */
  safetyScore: number | null;
  safetyPositive: boolean;
  /**
   * Clinical prompt (not AHC scoring): q7 "physically hurt" or q9 "threaten you with harm" answered
   * above Never while the total stays under 11. The page asks staff to follow up; no risk alert.
   */
  safetyItemEndorsed: boolean;
  unanswered: string[];
}

function positiveSingle(q: AhcQuestion, v: string | string[] | undefined): boolean {
  if (typeof v !== 'string') return false;
  return q.options.find((o) => o.value === v)?.positive === true;
}

/** Scores per the CMS tool: an underlined answer on any item makes the domain positive; safety = sum of 7-10 >= 11. */
export function scoreAhcHrsn(raw: AhcAnswers, includeSupplemental: boolean): AhcScore {
  const answers = normalizeAnswers(raw, includeSupplemental);
  const qs = questionsFor(includeSupplemental);
  const unanswered = qs.filter((q) => answers[q.id] === undefined).map((q) => q.id);
  const domains = includeSupplemental ? ALL_DOMAINS : CORE_DOMAINS;

  const safetyPoints = SAFETY_QUESTION_IDS.map((id) => {
    const v = answers[id];
    return typeof v === 'string' ? Number(v) : null;
  });
  const partial = safetyPoints.reduce<number>((s, p) => s + (p ?? 0), 0);
  const allSafety = safetyPoints.every((p) => p !== null);
  const safetyPositive = partial >= AHC_SAFETY_THRESHOLD;
  const safetyScore = allSafety || safetyPositive ? partial : null;
  const safetyItemEndorsed = !safetyPositive && [answers.q7, answers.q9].some((v) => typeof v === 'string' && Number(v) > 1);

  const results: DomainResult[] = domains.map((domain) => {
    const items = qs.filter((q) => q.domain === domain);
    const complete = items.every((q) => answers[q.id] !== undefined);
    let positive: boolean;
    if (domain === 'safety') positive = safetyPositive;
    else if (domain === 'housing_quality') {
      const v = answers.q2;
      positive = Array.isArray(v) && v.some((x) => x !== 'none');
    } else positive = items.some((q) => positiveSingle(q, answers[q.id]));
    return { domain, positive, complete };
  });

  return {
    domains: results,
    positiveDomains: results.filter((r) => r.positive).map((r) => r.domain),
    safetyScore,
    safetyPositive,
    safetyItemEndorsed,
    unanswered,
  };
}
