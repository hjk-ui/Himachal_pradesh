/**
 * Negation / polarity checks for AI Scribe grounding. Pure, browser-safe.
 *
 *  - Sentences: a sentence that negates something its cited lines state ("denies nausea" citing
 *    "I have nausea"), or asserts something its cited lines negate ("reports suicidal thoughts"
 *    citing "No, I'm not suicidal"), is a polarity mismatch (withheld). A sentence with a negation
 *    when none of its cited lines has one ("denies SI" citing only the clinician's question) is weak
 *    and goes to the entailment pass (entailment.ts).
 *  - Option chips / tri fields: a "Denies" / "No" / "None" value needs a negation in a cited client
 *    line that answers a clinician question on the topic (or names the topic itself); an
 *    affirmation value needs no negation of the topic in the cited line.
 * English and Spanish negators (es-US captures).
 */

const NEGATOR_WORDS = [
  'no', 'not', 'never', 'none', 'nope', 'nah', 'nothing', 'neither', 'nor', 'nobody', 'without', 'deny', 'denies', 'denied', 'denying',
  'negative', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'havent', 'hasnt', 'hadnt', 'wont', 'wouldnt', 'isnt', 'wasnt', 'arent', 'werent', 'aint',
  // Spanish
  'nunca', 'nada', 'ningun', 'ninguno', 'ninguna', 'tampoco', 'jamas', 'niega', 'niego', 'sin',
];
const NEGATORS = new Set(NEGATOR_WORDS);
/** Words that end a negation's scope ("no nausea, but my sleep is bad") */
const SCOPE_BREAK = new Set(['but', 'though', 'although', 'however', 'except', 'yet', 'pero', 'aunque', 'sino']);
const SCOPE_WORDS = 5;

function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/n['’]t\b/g, 'nt')
      .replace(/['’]/g, '')
      .match(/[a-z]+|[.,;:!?]/g) ?? []
  );
}

export function hasNegation(text: string): boolean {
  return tokens(text).some((t) => NEGATORS.has(t));
}

const stem = (w: string) => w.slice(0, 5);
const CONTENT = (w: string) => w.length >= 4 && !NEGATORS.has(w);

/** Content-word stems inside a negation's scope ("I'm not suicidal" → suici). */
export function negatedStems(text: string): Set<string> {
  const out = new Set<string>();
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    if (!NEGATORS.has(t[i])) continue;
    for (let j = i + 1, n = 0; j < t.length && n < SCOPE_WORDS; j++) {
      if (/^[.,;:!?]$/.test(t[j]) || SCOPE_BREAK.has(t[j])) break;
      if (NEGATORS.has(t[j])) continue;
      n++;
      if (CONTENT(t[j])) out.add(stem(t[j]));
    }
  }
  return out;
}

/** Content-word stems NOT inside any negation scope. */
export function assertedStems(text: string): Set<string> {
  const neg = negatedStems(text);
  const out = new Set<string>();
  for (const w of tokens(text)) if (/^[a-z]+$/.test(w) && CONTENT(w) && !neg.has(stem(w))) out.add(stem(w));
  return out;
}

export type PolarityResult = { status: 'ok' } | { status: 'mismatch'; detail: string } | { status: 'unsupported_negation' };

/** Generic words that appear on both sides without carrying the claim. */
const NEUTRAL = new Set(['client', 'patient', 'report', 'repor', 'state', 'state', 'said', 'feels', 'feeli', 'thing', 'think', 'thoug', 'today', 'week', 'about', 'there', 'their', 'these', 'those', 'which', 'would', 'could', 'should', 'cliente', 'pacie']);

/**
 * Compare a draft sentence with the text of its cited lines.
 *  mismatch              the sentence negates what a source asserts, or asserts what a source negates
 *  unsupported_negation  the sentence negates something, but no cited line contains a negation
 */
export function sentencePolarity(sentence: string, citedTexts: string[]): PolarityResult {
  const sNeg = negatedStems(sentence);
  const sPos = assertedStems(sentence);
  const srcNeg = new Set<string>();
  const srcPos = new Set<string>();
  // A question asserts nothing when an answer is cited with it ("Any thoughts of suicide?" + "No."):
  // then the answer's polarity is the one that counts. A question cited alone still counts.
  const answered = citedTexts.some((t) => !isQuestion(t) && hasNegation(t));
  for (const t of citedTexts) {
    for (const s of negatedStems(t)) srcNeg.add(s);
    if (answered && isQuestion(t)) continue;
    for (const s of assertedStems(t)) srcPos.add(s);
  }
  // A word negated in one source and asserted in another is ambiguous: do not judge it
  const contradicts = (mine: Set<string>, theirs: Set<string>, other: Set<string>) =>
    [...mine].find((w) => !NEUTRAL.has(w) && theirs.has(w) && !other.has(w));
  const negatedButStated = contradicts(sNeg, srcPos, srcNeg);
  if (negatedButStated) return { status: 'mismatch', detail: `the sentence negates "${negatedButStated}…", which the cited line states` };
  const statedButNegated = contradicts(sPos, srcNeg, srcPos);
  if (statedButNegated) return { status: 'mismatch', detail: `the sentence states "${statedButNegated}…", which the cited line negates` };
  if (hasNegation(sentence) && !citedTexts.some(hasNegation)) return { status: 'unsupported_negation' };
  return { status: 'ok' };
}

// ─── Option chips / tri fields ──────────────────────────────────────────────

/** Topic words per field id (clinician question or the client's own words must touch the topic). */
export const OPTION_TOPICS: Record<string, RegExp> = {
  si: /suicid|kill(ing)? (your|my)self|end (your|my) life|take (your|my) (own )?life|want(ed)? to die|better off dead|hurt(ing)? (your|my)self|matarme|suicid/i,
  hi: /homicid|hurt(ing)? (someone|anyone|somebody|others|other people|him|her|them)|kill(ing)? (someone|anyone|somebody|him|her|them)|harm(ing)? (someone|anyone|others)|violent|hacer da[nñ]o a (alguien|otros)/i,
  selfHarm: /self[- ]?harm|hurt(ing)? (your|my)self|harm(ing)? (your|my)self|cut(ting)?|burn(ing)? (your|my)self|lastimarme|cortarme/i,
  selfHarmHx: /self[- ]?harm|hurt(ing)? (your|my)self|suicid|attempt|overdos|cut(ting)?/i,
  currentAbuse: /abus|hit(s|ting)?|hurt(s|ing)? you|safe at home|neglect|threaten|maltrat/i,
  traumaHx: /trauma|abus|assault|violence|traum/i,
  priorInpatient: /hospital|inpatient|admitted|psych (ward|unit)/i,
  priorOutpatient: /therap|counsel|outpatient|psychiatr|treatment/i,
  overdoseHx: /overdos|od\b|narcan|naloxone/i,
  withdrawalHx: /withdraw|detox|shakes|dts?\b|seiz/i,
  legalHx: /legal|arrest|court|probation|parole|charge|jail/i,
  birthHx: /pregnan|birth|deliver|born|premature/i,
  alcohol: /alcohol|drink|beer|wine|liquor|alcohol/i,
  cannabis: /cannabis|marijuana|weed|pot\b|thc|smok/i,
  tobacco: /tobacco|nicotine|cigarette|smok|vape|vaping/i,
  otherDrugs: /drug|pill|opioid|cocaine|meth|heroin|fentanyl|prescription|benzo/i,
};

const NEGATIVE_VALUE = /^(denies|no|none|never|not|negative|n\/a|nunca)\b/i;
export function isNegativeOptionValue(v: string): boolean {
  return NEGATIVE_VALUE.test(v.trim());
}

const QUESTION = /\?|^(do|does|did|are|is|have|has|any|how|what|when|where|tell me|can you|could you|would you)\b/i;
/** A clinician question ("Any thoughts of suicide?"), never a finding. */
export function isQuestion(text: string): boolean {
  return QUESTION.test(text.trim());
}

/** Clinical shorthand a clinician dictates (case-sensitive: "si" is Spanish "yes"). */
export const ABBREVIATION_TOPICS: Record<string, RegExp> = {
  si: /\b(SI|S\/I)\b/,
  hi: /\b(HI|H\/I)\b/,
  selfHarm: /\b(NSSI|SIB)\b/,
};

/**
 * A clinician's stated finding, dictated or said in a recap: a declarative sentence (not a
 * question) about the client ("Patient denies SI, HI.", "She endorses passive SI.", "No AH/VH.").
 * Industry standard: the clinician documents the assessment, so this can set a chip, marked
 * clinician-attested. A question ("Any thoughts of suicide?") never can.
 */
const ATTEST_SUBJECT = /\b(patient|client|pt|he|she|they|denies|denied|endorses|endorsed|reports|reported|no evidence of|negative for|positive for)\b/i;
export function isClinicianAttestation(text: string): boolean {
  const t = text.trim();
  if (!t || isQuestion(t)) return false;
  if (/\b(i('| a)?m going to ask|let me ask|i want to ask|can i ask|i('| wi)ll ask)\b/i.test(t)) return false;
  return ATTEST_SUBJECT.test(t) || /^(no|denies|negative)\b/i.test(t);
}

export type OptionLine = { id: string; role: string; text: string };

export type OptionCheck =
  | { ok: true; support: number; lines: string[]; attested?: boolean; reason?: undefined; detail?: undefined }
  | { ok: false; reason: 'option_role' | 'option_polarity'; detail: string; support?: undefined; lines?: undefined; attested?: undefined };

/** Speakers whose words can set a client-reported chip (risk fields: the client only). */
export const PARTICIPANT_VOICES: ReadonlySet<string> = new Set(['CLIENT', 'GUARDIAN', 'FAMILY', 'INTERPRETER']);

/**
 * Check an option value against the transcript lines it cites.
 *  - cited lines must come from the client (risk fields) or a participant (other fields)
 *  - Denies / No / None: a negation in a cited client line that answers a clinician question on the
 *    topic (one of the 3 lines before it) or names the topic itself
 *  - an affirmation: the cited line does not negate the topic (tri fields: no negation at all)
 */
export function checkOptionValue(input: {
  fieldId: string;
  label: string;
  kind: 'single' | 'multi' | 'tri';
  value: string | string[];
  cites: string[];
  /** All transcript lines in order (for the clinician question before the answer) */
  lines: OptionLine[];
  risk: boolean;
}): OptionCheck {
  const index = new Map(input.lines.map((l, i) => [l.id.toLowerCase(), i]));
  const allowed = input.risk ? new Set(['CLIENT']) : PARTICIPANT_VOICES;
  const cited = input.cites.map((c) => index.get(c.toLowerCase())).filter((i): i is number => i != null);
  const voiced = cited.filter((i) => allowed.has(input.lines[i].role));
  const values = (Array.isArray(input.value) ? input.value : [input.value]).map(String);
  const topic = OPTION_TOPICS[input.fieldId] ?? labelTopic(input.label);
  const negative = values.every(isNegativeOptionValue);
  if (!voiced.length) {
    const attested = attestedByClinician({ fieldId: input.fieldId, kind: input.kind, lines: input.lines, cited, topic, negative, values });
    if (attested) return attested;
    return {
      ok: false,
      reason: 'option_role',
      detail: input.risk
        ? 'risk screens are set from the client\'s answer or the clinician\'s stated finding ("patient denies SI"), never a question'
        : 'chips are set from what the client or another participant said, or a finding the clinician stated',
    };
  }
  if (negative) {
    const answered = voiced.find((i) => {
      if (!hasNegation(input.lines[i].text)) return false;
      if (topic.test(input.lines[i].text)) return true;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prev = input.lines[j];
        if (prev.role === 'CLINICIAN' && QUESTION.test(prev.text.trim()) && topic.test(prev.text)) return true;
      }
      return false;
    });
    if (answered == null) {
      const a = attestedByClinician({ fieldId: input.fieldId, kind: input.kind, lines: input.lines, cited, topic, negative, values });
      if (a) return a;
      return { ok: false, reason: 'option_polarity', detail: `"${values.join(', ')}" needs the client's "no" to a question about ${input.label.toLowerCase()}` };
    }
    return { ok: true, support: 1, lines: [input.lines[answered].id] };
  }
  // Affirmation
  const optionStems = new Set(values.flatMap((v) => tokens(v)).filter(CONTENT).map(stem));
  const affirmed = voiced.filter((i) => {
    const text = input.lines[i].text;
    if (input.kind === 'tri') return !hasNegation(text);
    const neg = negatedStems(text);
    return ![...optionStems].some((s) => neg.has(s)) && !(hasNegation(text) && topic.test(text) && !optionStems.size);
  });
  if (!affirmed.length) {
    const a = attestedByClinician({ fieldId: input.fieldId, kind: input.kind, lines: input.lines, cited, topic, negative, values });
    if (a) return a;
    return { ok: false, reason: 'option_polarity', detail: `the cited line negates "${values.join(', ')}"` };
  }
  // Support: option / topic words found in the affirming lines (topic counts as one hit)
  const text = affirmed.map((i) => input.lines[i].text).join(' ');
  const src = new Set(tokens(text).filter(CONTENT).map(stem));
  const hits = [...optionStems].filter((s) => src.has(s)).length + (topic.test(text) ? 1 : 0);
  const support = Math.min(1, (hits || 0) / Math.max(1, Math.min(optionStems.size, 2)));
  return { ok: true, support: Math.round(support * 100) / 100, lines: affirmed.map((i) => input.lines[i].id) };
}

/** "denies SI", "no current HI", "negative for self-harm": the finding itself is negated */
const NEGATED_FINDING = /\b(denies|denied|deny|no|not|negative for|without)\s+(any\s+)?(current\s+|recent\s+)?(passive\s+|active\s+)?(SI|HI|S\/I|H\/I|NSSI|suicid\w*|homicid\w*|self[- ]?harm\w*|thoughts? of)/i;
/** "endorses passive SI", "reports thoughts of self-harm", "positive for HI" */
const AFFIRMED_FINDING = /\b(endorses|endorsed|reports|reported|positive for|admits|admitted|acknowledges|acknowledged|has|having|with)\b/i;

/** Clinician-attested chip: a cited CLINICIAN statement (not a question) on the topic, with the value's polarity. */
function attestedByClinician(input: {
  fieldId: string;
  kind: 'single' | 'multi' | 'tri';
  lines: OptionLine[];
  cited: number[];
  topic: RegExp;
  negative: boolean;
  values: string[];
}): OptionCheck | null {
  const abbr = ABBREVIATION_TOPICS[input.fieldId];
  const optionStems = [...new Set(input.values.flatMap((v) => tokens(v)).filter(CONTENT).map(stem))];
  const hit = input.cited.find((i) => {
    const l = input.lines[i];
    if (l.role !== 'CLINICIAN' || !isClinicianAttestation(l.text)) return false;
    const words = new Set(tokens(l.text).filter(CONTENT).map(stem));
    const onTopic = input.topic.test(l.text) || Boolean(abbr?.test(l.text)) || (input.kind !== 'tri' && optionStems.some((s) => words.has(s)));
    if (!onTopic) return false;
    if (input.negative) return hasNegation(l.text);
    if (input.kind === 'tri') return !NEGATED_FINDING.test(l.text) && AFFIRMED_FINDING.test(l.text);
    const neg = negatedStems(l.text);
    return !optionStems.some((s) => neg.has(s));
  });
  if (hit == null) return null;
  return { ok: true, support: 1, lines: [input.lines[hit].id], attested: true };
}

function labelTopic(label: string): RegExp {
  const words = tokens(label).filter(CONTENT).map(stem);
  if (!words.length) return /$^/;
  return new RegExp(words.map((w) => w.replace(/[^a-z]/g, '')).join('|'), 'i');
}
