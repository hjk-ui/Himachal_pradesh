/**
 * Risk language watch: deterministic keyword + context engine. Pure (no database, no network),
 * browser-safe. Runs first on every source; the AI step (ai.ts) only ever reviews what this
 * flags and may only downgrade ambiguous low/medium hits.
 *
 * Per sentence: phrase match → blank checkbox / idiom / negation / someone-else / history checks
 * → context escalation (plan, means or timing in the sentence or a neighbour, recent behavior,
 * a patient writing in their own words). Negation is NegEx-style (Chapman et al. 2001), the same
 * approach as the SUD radar (src/lib/clinical/sudRadar/keywords.ts), with risk-specific cues.
 */
import {
  HISTORICAL_CUE,
  IDIOM,
  MEANS_CUE,
  PHRASES,
  PLAN_CUE,
  RECENT_CUE,
  type PhraseDef,
  type RiskCategory,
  type RiskConcept,
  type RiskSeverity,
} from './phrases';

export type RiskChannel = 'patient_message' | 'note' | 'intake';

export type RiskHit = {
  /** Stable within one scan: `${sentenceIndex}:${phraseId}` */
  key: string;
  phraseId: string;
  category: RiskCategory;
  concept: RiskConcept;
  severity: RiskSeverity;
  baseSeverity: RiskSeverity;
  ambiguous: boolean;
  /** Patient-message mention of someone else's risk (kept low for review, never dropped) */
  thirdParty: boolean;
  sentenceIndex: number;
  sentence: string;
  quote: string;
  term: string;
  reasons: string[];
};

export type ExcludeReason = 'negated' | 'about-others' | 'historical' | 'idiom' | 'question' | 'blank-checkbox';

export type ExcludedHit = { phraseId: string; sentenceIndex: number; reason: ExcludeReason };

export type RiskScan = {
  channel: RiskChannel;
  sentences: string[];
  hits: RiskHit[];
  excluded: ExcludedHit[];
  /** Highest severity across hits; null when nothing was flagged */
  severity: RiskSeverity | null;
};

export const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1 };
export const QUOTE_MAX = 240;

export function maxSeverity(list: (RiskSeverity | null | undefined)[]): RiskSeverity | null {
  let best: RiskSeverity | null = null;
  for (const s of list) if (s && (!best || SEVERITY_RANK[s] > SEVERITY_RANK[best])) best = s;
  return best;
}

// ── Text preparation ──────────────────────────────────────────────────────────

export function cleanText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ');
}

/** Sentences: lines, then sentence punctuation (any case: portal messages are often lowercase). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of cleanText(text).split('\n')) {
    for (const part of line.split(/(?<=[.!?;])\s+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

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

// ── Negation (NegEx-style) ────────────────────────────────────────────────────

const NEGATION_PRE =
  /\b(?:denies|denied|denying|deny|no|not|never|without|negative\s+for|free\s+of|absence\s+of|rule[sd]?\s+out|r\/o|nor|neither|none|don['’]?t|do\s+not|doesn['’]?t|does\s+not|didn['’]?t|did\s+not|won['’]?t|wouldn['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t)\b/gi;
/** Words that end a negation cue's scope before the term */
const NEGATION_TERMINATOR =
  /\b(?:but|however|although|though|except|yet|reports?|reported|endorses?|endorsed|admits?|admitted|states?|stated|says|said|why|because|if|that|currently|now|still|and\s+(?:i|she|he|they)|so\s+(?:i|she|he|they))\b|[;.:!?]|,\s*(?:i|she|he|they|but)\b/i;
const NEGATION_POST =
  /^\s*(?:\/\s*(?:hi|si|sib)\b)?\s*(?:[:=–-]|is|was)?\s*(?:none\b|no\b|denie[sd]\b|deny\b|neg(?:ative)?\b|absent\b|not\s+(?:present|endorsed|reported)|n\/a\b|\(-\)|0\b)/i;
const NEGATION_MAX_WORDS = 6;

export function isNegated(sentence: string, termIndex: number, termLength: number): boolean {
  const before = sentence.slice(Math.max(0, termIndex - 70), termIndex);
  NEGATION_PRE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastCueEnd = -1;
  while ((m = NEGATION_PRE.exec(before))) lastCueEnd = m.index + m[0].length;
  if (lastCueEnd >= 0) {
    const between = before.slice(lastCueEnd);
    if (!NEGATION_TERMINATOR.test(between) && between.split(/\s+/).filter(Boolean).length <= NEGATION_MAX_WORDS) return true;
  }
  return NEGATION_POST.test(sentence.slice(termIndex + termLength, termIndex + termLength + 30));
}

// ── Someone else / history ────────────────────────────────────────────────────

const OTHERS =
  /\b(?:mother|mom|father|dad|stepfather|stepmother|stepdad|stepmom|parents?|brother|sister|siblings?|uncle|aunt|grand(?:father|mother|parents?|pa|ma)|husband|wife|spouse|boyfriend|girlfriend|partner|fianc[ée]e?|son|daughter|cousin|roommates?|friends?|neighbou?rs?|coworkers?|co-workers?|classmates?|peers?|someone|somebody|celebrity|character|movie|show|song|book|documentary|news)\b/gi;
const PATIENT_SUBJECT_MESSAGE = /\b(?:i|i['’]m|im|me|my|myself)\b/i;
const PATIENT_SUBJECT_NOTE = /\b(?:pt|patient|client|consumer|member|individual|writer)\b/i;
const FAMILY_HISTORY = /\b(?:family\s+(?:history|hx)|fhx|f\/h)\b/i;
const OTHER_REFLEXIVE = /\b(?:him|her|them)sel(?:f|ves)\b/i;

/** True when the risk belongs to someone else (a relative, friend, a character), not the patient. */
export function isAboutOthers(sentence: string, termIndex: number, term: string, channel: RiskChannel): boolean {
  const before = sentence.slice(0, termIndex);
  if (FAMILY_HISTORY.test(before)) return true;
  // A patient writes in the first person: "kill himself" is someone else (in notes it is the client)
  if (channel === 'patient_message' && OTHER_REFLEXIVE.test(term)) return true;
  const window = before.slice(-70);
  let last: RegExpExecArray | null = null;
  OTHERS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OTHERS.exec(window))) {
    // "with friends" / "to my partner" — the other person is company, not the subject
    if (!/\b(?:with|to|from|at|about)\s+(?:(?:his|her|their|my|a)\s+)?$/i.test(window.slice(0, m.index))) last = m;
  }
  if (!last) return false;
  const afterOther = window.slice(last.index + last[0].length);
  const subject = channel === 'patient_message' ? PATIENT_SUBJECT_MESSAGE : PATIENT_SUBJECT_NOTE;
  return !subject.test(afterOther);
}

const CURRENT_WORDS = /\b(?:current(?:ly)?|now|today|tonight|ongoing|continues?|still|again|this\s+week)\b/i;

function isHistorical(sentence: string, idx: number, len: number): boolean {
  const window = sentence.slice(Math.max(0, idx - 60), Math.min(sentence.length, idx + len + 40));
  return HISTORICAL_CUE.test(window) && !RECENT_CUE.test(window) && !CURRENT_WORDS.test(window);
}

const BLANK_BEFORE = /(?:\[\s?\]|☐|□|\(\s\))\s*$/;
const BLANK_AFTER = /^\s*[:\-–]?\s*(?:\[\s?\]|☐|□|\(\s\)|_{2,})/;
const QUESTION_END = /\?\s*$/;
const EMPTY_LABEL = /^[^:]{1,60}:\s*$/;

/** A context cue that is present and not itself negated ("denies plan or access to firearms"). */
function cueAffirmed(re: RegExp, text: string): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    if (!isNegated(text, m.index, m[0].length)) return true;
  }
  return false;
}

const ESCALATABLE: RiskConcept[] = ['passive_ideation', 'active_ideation', 'nssi', 'homicidal_ideation'];

function firstAcceptedMatch(
  phrase: PhraseDef,
  sentence: string,
  channel: RiskChannel
): { m: RegExpExecArray; thirdParty: boolean } | { reason: ExcludeReason } | null {
  const g = new RegExp(phrase.re.source, phrase.re.flags.includes('g') ? phrase.re.flags : `${phrase.re.flags}g`);
  let m: RegExpExecArray | null;
  let firstReason: ExcludeReason | null = null;
  while ((m = g.exec(sentence))) {
    if (m[0].length === 0) {
      g.lastIndex += 1;
      continue;
    }
    const idx = m.index;
    let reason: ExcludeReason | null = null;
    if (BLANK_BEFORE.test(sentence.slice(0, idx)) || BLANK_AFTER.test(sentence.slice(idx + m[0].length))) reason = 'blank-checkbox';
    else if (phrase.ambiguous && IDIOM.test(sentence)) reason = 'idiom';
    else if (isNegated(sentence, idx, m[0].length)) reason = 'negated';
    else if (isHistorical(sentence, idx, m[0].length)) reason = 'historical';
    else {
      // Abuse phrases name the patient as the target ("he hits me"): the other person is the actor
      const targetsPatient = phrase.category === 'abuse_danger' && /\b(?:me|us)\b/i.test(m[0]);
      if (!targetsPatient && isAboutOthers(sentence, idx, m[0], channel)) {
        if (channel !== 'patient_message') reason = 'about-others';
        else return { m, thirdParty: true };
      }
    }
    if (!reason) return { m, thirdParty: false };
    firstReason ??= reason;
  }
  return firstReason ? { reason: firstReason } : null;
}

/**
 * Severity by rule:
 * - explicit plan / intent / method / preparatory behavior → HIGH (same-day)
 * - any ideation or self-harm with a plan, means or timing cue in the sentence or a neighbour → HIGH
 * - attempt: recent, or disclosed by the patient in a message → HIGH; otherwise MEDIUM
 * - non-ambiguous active ideation written by the patient in a portal message → HIGH (not yet assessed)
 * - passive ideation, active ideation in a note, self-harm, homicidal ideation, abuse → MEDIUM
 * - abuse with lethality markers (threats to kill, weapon, strangulation) → HIGH
 * - hopelessness, third-party mentions in a patient message → LOW
 */
function applyContext(hit: RiskHit, sentences: string[], channel: RiskChannel): RiskHit {
  if (hit.thirdParty) return { ...hit, severity: 'low', ambiguous: true, reasons: [...hit.reasons, 'third-party'] };
  let severity = hit.severity;
  const reasons = [...hit.reasons];
  if (ESCALATABLE.includes(hit.concept) && hit.category !== 'hopelessness') {
    const ctx = sentences.slice(Math.max(0, hit.sentenceIndex - 1), hit.sentenceIndex + 2).join(' ');
    if (cueAffirmed(MEANS_CUE, ctx)) {
      severity = 'high';
      reasons.push('means-in-context');
    }
    if (cueAffirmed(PLAN_CUE, ctx)) {
      severity = 'high';
      reasons.push('plan-or-timing-in-context');
    }
  }
  if (hit.concept === 'attempt') {
    if (RECENT_CUE.test(hit.sentence)) {
      severity = 'high';
      reasons.push('recent-behavior');
    } else if (channel === 'patient_message') {
      severity = 'high';
      reasons.push('patient-disclosure');
    }
  }
  if (channel === 'patient_message' && hit.concept === 'active_ideation' && !hit.ambiguous && severity !== 'high') {
    severity = 'high';
    reasons.push('patient-own-words');
  }
  return { ...hit, severity, ambiguous: severity === 'high' ? false : hit.ambiguous, reasons };
}

const CONCEPT_RANK: Partial<Record<RiskConcept, number>> = {
  intent_plan: 9,
  method: 8,
  preparatory: 8,
  attempt: 7,
  abuse_lethal: 7,
  homicidal_plan: 7,
  active_ideation: 5,
  homicidal_ideation: 5,
  passive_ideation: 4,
  nssi: 4,
  abuse: 4,
  hopelessness: 1,
};

function stronger(a: RiskHit, b: RiskHit): boolean {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] > SEVERITY_RANK[b.severity];
  if (a.ambiguous !== b.ambiguous) return !a.ambiguous;
  return (CONCEPT_RANK[a.concept] ?? 0) > (CONCEPT_RANK[b.concept] ?? 0);
}

/** All risk-language hits in one text. At most one hit per (sentence, category): the strongest. */
export function scanRiskText(text: string, channel: RiskChannel): RiskScan {
  const sentences = splitSentences(text || '');
  const hits: RiskHit[] = [];
  const excluded: ExcludedHit[] = [];
  sentences.forEach((sentence, sentenceIndex) => {
    if (EMPTY_LABEL.test(sentence)) return;
    // Screening questions in a note template are not answers; a patient's own question still counts
    const questionInNote = channel !== 'patient_message' && QUESTION_END.test(sentence);
    const byCategory = new Map<RiskCategory, RiskHit>();
    for (const phrase of PHRASES) {
      const res = firstAcceptedMatch(phrase, sentence, channel);
      if (!res) continue;
      if ('reason' in res) {
        excluded.push({ phraseId: phrase.id, sentenceIndex, reason: res.reason });
        continue;
      }
      if (questionInNote) {
        excluded.push({ phraseId: phrase.id, sentenceIndex, reason: 'question' });
        continue;
      }
      const raw: RiskHit = {
        key: `${sentenceIndex}:${phrase.id}`,
        phraseId: phrase.id,
        category: phrase.category,
        concept: phrase.concept,
        severity: phrase.severity,
        baseSeverity: phrase.severity,
        ambiguous: Boolean(phrase.ambiguous),
        thirdParty: res.thirdParty,
        sentenceIndex,
        sentence,
        quote: quoteSentence(sentence, res.m.index, res.m[0].length),
        term: res.m[0],
        reasons: [],
      };
      const hit = applyContext(raw, sentences, channel);
      const prev = byCategory.get(hit.category);
      if (!prev || stronger(hit, prev)) byCategory.set(hit.category, hit);
    }
    hits.push(...byCategory.values());
  });
  return { channel, sentences, hits, excluded, severity: maxSeverity(hits.map((h) => h.severity)) };
}
