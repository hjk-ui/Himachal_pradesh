/**
 * Note-text path of the SUD Referral Radar: keyword + context rules with negation handling.
 * Pure module (no database, no network). Never infers a diagnosis code.
 *
 * Each hit is one sentence of a signed note or filed document, attributed to the patient
 * (not a relative), not negated, and not a blank checkbox / question / prescribed-med line.
 */
import type { Confidence, RoutedAction, SubstanceClass } from './types';

export type TermKind = 'substance' | 'consequence' | 'treatment';

type TermDef = {
  id: string;
  re: RegExp;
  substance: SubstanceClass;
  kind: TermKind;
  /** Prescribable drug: only counts with misuse wording (non-prescribed, street, more than prescribed …) */
  needsMisuse?: boolean;
  /** Consequence that warrants a level-of-care look (overdose, withdrawal, IV use) */
  severe?: boolean;
  /** Ambiguous term (social withdrawal, depressive relapse …): the sentence must also match this */
  needsContext?: RegExp;
  /** Generic wording ("substance use"): dropped unless current or quantified */
  dropIfLow?: boolean;
};

/** A named substance anywhere in the sentence (context for generic terms) */
const ANY_SUBSTANCE =
  /\b(?:alcohol|etoh|beers?|wine|liquor|vodka|drinking|drinks|heroin|fentanyl|fent|opioids?|opiates?|oxy\w*|percocets?|pills|xanax|benzos?|cocaine|crack|meth\w*|cannabis|marijuana|thc|weed|kratom|drugs?|substances?|using)\b/i;
const WITHDRAWAL_CONTEXT = new RegExp(
  `${ANY_SUBSTANCE.source}|\\b(?:ciwa|cows|shakes|sweats|tremors?|seizures?|dope\\s?sick|detox\\w*)\\b`,
  'i'
);
const OVERDOSE_CONTEXT =
  /\b(?:heroin|fentanyl|fent|opioids?|opiates?|oxy\w*|percocets?|cocaine|crack|meth\w*|alcohol|etoh|narcan|naloxone|accidental(?:ly)?|street|drugs?)\b/i;

const TERMS: TermDef[] = [
  // Alcohol
  { id: 'alcohol', re: /\b(?:alcohol(?:ic|ism)?|etoh|liquor|vodka|whiske?y|tequila|beers?|wine|hard seltzers?)\b/i, substance: 'alcohol', kind: 'substance' },
  { id: 'drinks', re: /\b(?:\d+(?:\s*-\s*\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|several|multiple)\s+(?:alcoholic\s+)?(?:drinks|beers|shots|glasses of wine|pints|fifths|bottles of wine)\b/i, substance: 'alcohol', kind: 'substance' },
  { id: 'drinking', re: /\b(?:drink(?:s|ing)?|drank)\s+(?:alcohol|heavily|daily|every\s+(?:day|night)|nightly|a lot|excessively|to cope|to sleep)\b/i, substance: 'alcohol', kind: 'substance' },
  { id: 'drinks-per', re: /(?<!(?:energy|soft|sugary|caffeinated|protein|sports|diet)\s)\bdrinks?\s+(?:per|a|each|every)\s+(?:day|night|week|weekend)\b/i, substance: 'alcohol', kind: 'substance' },
  { id: 'binge', re: /\bbinge[-\s]?drink(?:s|ing)?\b|\bbinges?\s+on\s+alcohol\b/i, substance: 'alcohol', kind: 'substance' },
  { id: 'drunk', re: /\b(?:drunk|intoxicated|hangovers?|blackouts?|blacked out)\b/i, substance: 'alcohol', kind: 'consequence' },
  { id: 'dts', re: /\b(?:DTs|delirium tremens)\b/, substance: 'alcohol', kind: 'consequence', severe: true },
  { id: 'aa', re: /\b(?:Alcoholics Anonymous|AA\s+meetings?|attend(?:s|ing|ed)?\s+AA)\b/, substance: 'alcohol', kind: 'treatment' },
  // Opioids
  { id: 'heroin', re: /\b(?:heroin|dope|smack)\b/i, substance: 'opioids', kind: 'substance' },
  { id: 'fentanyl', re: /\bfent(?:anyl)?\b/i, substance: 'opioids', kind: 'substance' },
  { id: 'opioid', re: /\b(?:opioids?|opiates?|pain\s?pills)\b/i, substance: 'opioids', kind: 'substance', needsMisuse: true },
  { id: 'oxy', re: /\b(?:oxys?|oxycodone|oxycontin|percocets?|percs|vicodin|hydrocodone|dilaudid|roxicodone|roxys?|tramadol)\b/i, substance: 'opioids', kind: 'substance', needsMisuse: true },
  { id: 'narcan', re: /\b(?:narcan|naloxone)\b/i, substance: 'opioids', kind: 'consequence', severe: true },
  { id: 'mat', re: /\b(?:suboxone|buprenorphine|subutex|sublocade|zubsolv|methadone(?:\s+clinic)?|vivitrol)\b/i, substance: 'opioids', kind: 'treatment' },
  { id: 'mat-acronym', re: /\b(?:MAT|MOUD)\b/, substance: 'opioids', kind: 'treatment' },
  // Sedatives
  { id: 'benzo', re: /\b(?:xanax|alprazolam|benzos?|benzodiazepines?|klonopin|clonazepam|valium|diazepam|ativan|lorazepam|bars)\b/i, substance: 'sedatives', kind: 'substance', needsMisuse: true },
  // Cocaine
  { id: 'cocaine', re: /\b(?:cocaine|crack(?:\s+cocaine)?)\b/i, substance: 'cocaine', kind: 'substance' },
  // Stimulants
  { id: 'meth', re: /\b(?:meth|methamphetamines?|crystal meth)\b/i, substance: 'stimulants', kind: 'substance' },
  { id: 'rx-stim', re: /\b(?:adderall|amphetamines?|ritalin|vyvanse)\b/i, substance: 'stimulants', kind: 'substance', needsMisuse: true },
  // Cannabis
  { id: 'cannabis', re: /\b(?:cannabis|marijuana|marihuana|thc|weed|edibles?|blunts?|smok\w*\s+(?:a\s+)?joints?|joints?\s+(?:a|per)\s+day|dabs?|dabbing|delta[-\s]?8)\b/i, substance: 'cannabis', kind: 'substance' },
  // Hallucinogens / inhalants / other
  { id: 'hallucinogen', re: /\b(?:lsd|psilocybin|shrooms|magic mushrooms|mdma|ecstasy|molly|pcp)\b/i, substance: 'hallucinogens', kind: 'substance' },
  { id: 'inhalant', re: /\b(?:inhalants?|huffing|huffs)\b/i, substance: 'inhalants', kind: 'substance' },
  { id: 'kratom', re: /\bkratom\b/i, substance: 'other', kind: 'substance' },
  { id: 'iv', re: /\b(?:IV\s+drug\s+use|IVDU|IVDA|injection drug use|inject(?:s|ing|ed)\s+(?:drugs|heroin|fentanyl|meth))\b/i, substance: 'other', kind: 'consequence', severe: true },
  { id: 'drug-use', re: /\b(?:illicit\s+drugs?|street\s+drugs|drug\s+use|substance\s+(?:use|abuse)|polysubstance|using\s+drugs)\b/i, substance: 'other', kind: 'substance', dropIfLow: true },
  // Intentional pill overdoses are crisis events, not SUD signals, unless a substance / naloxone is named
  { id: 'overdose', re: /\b(?:overdos(?:e|ed|es|ing)|OD['’]?d|ODed)\b/i, substance: 'other', kind: 'consequence', severe: true, needsContext: OVERDOSE_CONTEXT },
  // "Social withdrawal" / "withdrawal from friends" are mood symptoms, not substance withdrawal
  {
    id: 'withdrawal',
    re: /(?<!(?:social|emotional|behavioral|behavioural|psychological)\s)\bwithdrawals?\b(?!\s+from\s+(?:friends|family|others|people|activities|school|social))|\bdope\s?sick\b|\bdetox(?:ing|ed)?\b/i,
    substance: 'other',
    kind: 'consequence',
    severe: true,
    needsContext: WITHDRAWAL_CONTEXT,
  },
  { id: 'relapse', re: /\brelaps(?:e|ed|es|ing)\b/i, substance: 'other', kind: 'consequence', needsContext: ANY_SUBSTANCE },
  { id: 'na', re: /\b(?:Narcotics Anonymous|NA\s+meetings?|attend(?:s|ing|ed)?\s+NA)\b/, substance: 'other', kind: 'treatment' },
  { id: 'recovery', re: /\b(?:in recovery|sobriety|sober\s+(?:since|for)|clean\s+(?:since|for)\s+\d|sponsor)\b/i, substance: 'other', kind: 'treatment' },
];

const NEGATION_PRE =
  /\b(?:denies|denied|denying|deny|no\s+(?:known\s+)?(?:history|hx|h\/o|evidence|signs?|reports?|current|use|indication)\s*(?:of|or)?|negative\s+for|never\s+(?:used|drank|tried|smoked|had|been)|never|not\s+(?:using|drinking|currently)|does\s+not|doesn['’]t|did\s+not|didn['’]t|has\s+not|hasn['’]t|abstains?\s+from|no(?!\s+longer)|none|free\s+of|rule\s+out|r\/o)\b/gi;
/** Words that end a negation's scope before the term */
const NEGATION_TERMINATOR = /\b(?:but|however|although|though|except|yet|reports?|endorses?|admits?|states?|says|currently)\b/i;
const NEGATION_POST =
  /^[\s,]*(?:use|abuse|intake|consumption)?\s*(?:history|hx)?[\s:–-]*(?:none|denie[sd]|negative|never|nil|n\/a|no\b|not\s+(?:reported|endorsed|used))/i;

const RELATIVE =
  /\b(?:mother|mom|father|dad|stepfather|stepmother|parents?|brother|sister|siblings?|uncle|aunt|grand(?:father|mother|parents?|pa|ma)|husband|wife|spouse|boyfriend|girlfriend|partner|fianc[ée]e?|son|daughter|cousin|roommates?|friends?|neighbou?r)\b/gi;
const PATIENT_SUBJECT = /\b(?:patient|pt|client|she|he|they|i|reports?|endorses?|admits?)\b/i;

const HISTORICAL =
  /\b(?:history\s+of|hx\s+of|h\/o|past|previously|prior|formerly|former|used\s+to|years?\s+ago|months\s+ago|as\s+a\s+(?:teen|teenager|youth|kid)|in\s+(?:high\s+school|college|the\s+past)|quit|stopped|no\s+longer|sober|clean\s+(?:since|for)|in\s+remission|remote)\b/i;
/** Intent to stop is current use, and "past week" is recent — neither makes a sentence historical */
const NOT_HISTORICAL_PHRASES =
  /\b(?:(?:want(?:s|ing)?|trying|tries|plans?|planning|would\s+like|ready|attempting|hopes?|unable)\s+to\s+(?:quit|stop|cut\s+(?:down|back))|(?:past|last|prior)\s+(?:\d+\s+)?(?:week|weeks|month|few\s+days|days|weekend|night|30\s+days|session))\b/gi;
const CURRENT =
  /\b(?:current(?:ly)?|reports?|endorses?|admits?|continues?|ongoing|using|uses|drinks|drinking|smokes|smoking|last\s+use|yesterday|today|tonight|this\s+(?:week|weekend|morning)|last\s+(?:night|week|weekend)|since\s+(?:our\s+)?last\s+session|relapsed|recently|now|has\s+been|have\s+been|is\s+(?:on|taking))\b/i;
const FREQUENCY =
  /\b(?:daily|every\s+(?:day|night|morning|evening)|nightly|each\s+(?:day|night)|\d+\s*(?:x|times)\s*(?:a|per|\/)\s*(?:day|week|month)|(?:per|a|each)\s+(?:day|week|night)|several\s+times|most\s+days|every\s+weekend|weekends|\d+\s*(?:drinks|beers|shots|bags|bundles|pills|grams|g|joints|blunts|bowls|bottles|pints|fifths|mg)\b)/i;
const DAILY = /\b(?:daily|every\s+(?:day|morning|night)|nightly|each\s+day|\d+\s*(?:x|times)\s*(?:a|per|\/)\s*day|(?:per|a)\s+day)\b/i;
const HEAVY_ALCOHOL =
  /\b(?:(?:[4-9]|1\d|2\d)\s*(?:-\s*\d+\s*)?(?:drinks|beers|shots)|fifths?|a\s+pint|pints|(?:a|one|two)\s+bottles?\s+of|heavily|heavy\s+drinking|case\s+of\s+beer)\b/i;
const CONSEQUENCE =
  /\b(?:dui|dwi|arrest(?:ed)?|charged|lost\s+(?:his|her|their|my)?\s*job|fired|evicted|hospitali[sz]ed|er\s+visit|ed\s+visit|emergency\s+(?:room|department)|seizures?|shakes|tremors?|cravings?|can['’]?t\s+stop|unable\s+to\s+(?:stop|cut\s+down)|tolerance|withdrawal|overdos\w*|blackouts?|legal\s+(?:issues|problems|charges))\b/i;
const MISUSE =
  /\b(?:non[-\s]?prescribed|not\s+prescribed|without\s+a\s+prescription|more\s+than\s+prescribed|than\s+prescribed|(?:off|from)\s+the\s+street|street|bought|buys|buying|purchas\w*|from\s+(?:a\s+)?(?:friends?|dealer)|misus\w*|abusing|abused\s+(?:pills|xanax|benzos|opioids|meds|medications?|adderall)|snort\w*|crush\w*|pressed|recreational(?:ly)?|to\s+get\s+high|getting\s+high|illicit\w*|addict\w*|hooked)\b/i;
const PRESCRIBED = /\b(?:prescribed|rx|mg|tablets?|tabs?|bid|tid|qid|qhs|prn)\b/i;
const BLANK_CHECKBOX = /^\s*(?:[:\-–]\s*)?(?:\[\s?\]|☐|□|\(\s\)|_{2,})/;
const QUESTION_END = /\?\s*$/;
/** A form label with no value ("Substance Use:") */
const EMPTY_LABEL = /^[^:]{1,60}:\s*$/;

export const QUOTE_MAX = 240;

export type KeywordHit = {
  termId: string;
  term: string;
  substance: SubstanceClass;
  kind: TermKind;
  sentence: string;
  quote: string;
  confidence: Confidence;
  action: RoutedAction;
  historical: boolean;
};

/** Removes markup and the legacy metadata comment; normalises whitespace but keeps line structure. */
export function cleanNoteText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ');
}

const LABEL_LINE = /^\s*(?:[-*•]|\d+[.)]\s|[A-Z][A-Za-z0-9 /()&'-]{1,40}:)/;

/**
 * Sentences of a note. OCR text wraps mid-sentence, so single line breaks join unless the next
 * line starts a labelled field ("Alcohol: …") or a bullet; form fields become their own sentence.
 */
export function splitSentences(text: string): string[] {
  const lines = cleanNoteText(text).split('\n');
  const blocks: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (cur) blocks.push(cur);
      cur = '';
      continue;
    }
    if (cur && (LABEL_LINE.test(line) || /[.!?:]$/.test(cur))) {
      blocks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur} ${line}` : line;
    }
  }
  if (cur) blocks.push(cur);
  const out: string[] = [];
  for (const block of blocks) {
    for (const s of block.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\s+(?=[A-Z][A-Za-z /()&'-]{1,30}:\s)/)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Trims a sentence to ~QUOTE_MAX chars, keeping the matched term in view. */
export function quoteSentence(sentence: string, matchIndex = 0, matchLength = 0): string {
  const s = sentence.replace(/\s+/g, ' ').trim();
  if (s.length <= QUOTE_MAX) return s;
  const center = Math.max(0, matchIndex + Math.floor(matchLength / 2));
  let start = Math.max(0, center - Math.floor(QUOTE_MAX / 2));
  const end = Math.min(s.length, start + QUOTE_MAX);
  start = Math.max(0, end - QUOTE_MAX);
  let q = s.slice(start, end);
  if (start > 0) q = `…${q.replace(/^\S*\s/, '')}`;
  if (end < s.length) q = `${q.replace(/\s\S*$/, '')}…`;
  return q;
}

/** NegEx-style: a negation cue shortly before the term (no scope terminator between), or "X: denies" after. */
export function isNegated(sentence: string, termIndex: number, termLength: number): boolean {
  const before = sentence.slice(Math.max(0, termIndex - 80), termIndex);
  NEGATION_PRE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastCueEnd = -1;
  while ((m = NEGATION_PRE.exec(before))) lastCueEnd = m.index + m[0].length;
  if (lastCueEnd >= 0) {
    const between = before.slice(lastCueEnd);
    // A clause break, a terminator ("but", "reports") or a long gap ends the negation's scope
    if (!NEGATION_TERMINATOR.test(between) && !/[;.]/.test(between) && between.split(/\s+/).filter(Boolean).length <= 8) {
      return true;
    }
  }
  const after = sentence.slice(termIndex + termLength, termIndex + termLength + 40);
  return NEGATION_POST.test(after);
}

/** True when the use belongs to someone else (family history, a relative as the subject). */
export function isAboutOthers(sentence: string, termIndex: number): boolean {
  const before = sentence.slice(0, termIndex);
  if (/\b(?:family\s+(?:history|hx)|fhx|f\/h)\b/i.test(before)) return true;
  const window = before.slice(-60);
  let last: RegExpExecArray | null = null;
  RELATIVE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RELATIVE.exec(window))) {
    // "drinks with friends" — the relative is company, not the subject
    if (!/\bwith\s+(?:(?:his|her|their|my)\s+)?$/i.test(window.slice(0, m.index))) last = m;
  }
  if (!last) return false;
  const afterRel = window.slice(last.index + last[0].length);
  return !PATIENT_SUBJECT.test(afterRel);
}

function hitAction(term: TermDef, sentence: string, historical: boolean): RoutedAction {
  if (term.kind === 'treatment' || historical) return 'chart-documentation';
  if (term.severe) return 'residential-referral';
  if (term.substance === 'opioids' && DAILY.test(sentence)) return 'residential-referral';
  if (term.substance === 'alcohol' && DAILY.test(sentence) && HEAVY_ALCOHOL.test(sentence)) return 'residential-referral';
  return 'sbirt';
}

function hitConfidence(term: TermDef, sentence: string, historical: boolean): Confidence {
  if (historical) return 'low';
  if (term.kind === 'treatment') return CURRENT.test(sentence) || PRESCRIBED.test(sentence) ? 'medium' : 'low';
  const current = CURRENT.test(sentence) || term.kind === 'consequence';
  const quantified =
    FREQUENCY.test(sentence) ||
    CONSEQUENCE.test(sentence) ||
    term.id === 'drinks' ||
    (Boolean(term.needsMisuse) && MISUSE.test(sentence));
  if (current && quantified) return 'high';
  if (current || quantified) return 'medium';
  return 'low';
}

/** Substance named in the sentence, for generic terms (overdose, withdrawal, relapse, drug use). */
function sentenceSubstance(sentence: string, fallback: SubstanceClass): SubstanceClass {
  for (const t of TERMS) {
    if (t.kind !== 'substance' || t.substance === 'other') continue;
    if (t.needsMisuse && !MISUSE.test(sentence)) continue;
    if (t.re.test(sentence)) return t.substance;
  }
  return fallback;
}

const ACTION_RANK: Record<RoutedAction, number> = {
  'residential-referral': 3,
  sbirt: 2,
  'chart-documentation': 1,
  'tobacco-cessation': 0,
};
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Keyword hits in one note / document. At most one hit per (sentence, substance): the strongest. */
export function scanText(text: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const sentence of splitSentences(text)) {
    if (QUESTION_END.test(sentence) || EMPTY_LABEL.test(sentence)) continue;
    const historicalBase = HISTORICAL.test(sentence.replace(NOT_HISTORICAL_PHRASES, ' '));
    const historical = historicalBase && !/\b(?:relapsed|currently|recently|again)\b/i.test(sentence);
    const bySubstance = new Map<SubstanceClass, KeywordHit>();
    for (const term of TERMS) {
      const m = term.re.exec(sentence);
      if (!m) continue;
      const idx = m.index;
      const after = sentence.slice(idx + m[0].length, idx + m[0].length + 6);
      if (BLANK_CHECKBOX.test(after)) continue;
      if (isNegated(sentence, idx, m[0].length)) continue;
      if (isAboutOthers(sentence, idx)) continue;
      // Prescribed sedatives / stimulants / opioid pills count only with misuse wording
      if (term.needsMisuse && !MISUSE.test(sentence)) continue;
      if (term.needsContext && !term.needsContext.test(sentence)) continue;
      const confidence = hitConfidence(term, sentence, historical);
      if (term.dropIfLow && confidence === 'low') continue;
      const substance = term.substance === 'other' ? sentenceSubstance(sentence, 'other') : term.substance;
      const hit: KeywordHit = {
        termId: term.id,
        term: m[0],
        substance,
        kind: term.kind,
        sentence,
        quote: quoteSentence(sentence, idx, m[0].length),
        confidence,
        action: hitAction(term, sentence, historical),
        historical,
      };
      const prev = bySubstance.get(substance);
      if (
        !prev ||
        ACTION_RANK[hit.action] > ACTION_RANK[prev.action] ||
        (ACTION_RANK[hit.action] === ACTION_RANK[prev.action] && CONF_RANK[hit.confidence] > CONF_RANK[prev.confidence])
      ) {
        bySubstance.set(substance, hit);
      }
    }
    hits.push(...bySubstance.values());
  }
  return hits;
}
