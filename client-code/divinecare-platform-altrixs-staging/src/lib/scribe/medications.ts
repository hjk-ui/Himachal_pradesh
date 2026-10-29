/**
 * Medications in AI Scribe drafts. Pure, browser-safe.
 *
 *  - The client's active medication list (name, dose, sig; DrFirst-linked flag) is given to the
 *    model as chart facts (context.ts → draft.ts buildSources).
 *  - Grounding (grounding.ts): a drug name or dose in the draft that is on neither the med list nor
 *    the cited transcript is withheld; one heard in the transcript but not on the med list is kept
 *    and flagged "not on medication list — verify".
 *  - Misheard names: transcript words that sound like (Metaphone) or are spelled close to
 *    (Levenshtein ≤ 2 on normalized names) a medication on the list or the known name list get a
 *    "did you mean" suggestion in review. Suggestions only: nothing in the note is changed.
 */
import { MEDICATIONS } from './medicationNames';

export type ChartMedication = {
  name: string;
  dose: string | null;
  sig: string | null;
  /** On the DrFirst (Rcopia) medication list */
  drFirst: boolean;
};

export const NOT_ON_MED_LIST = 'not on medication list — verify';

export function normalizeDrugName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(er|xr|xl|sr|cr|dr|odt|hcl|hydrochloride|sodium|tablet|tablets|tab|capsule|capsules|cap|oral|solution|extended release)\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distinct name words on the med list ("sertraline", "zoloft"). */
export function medListNames(list: ChartMedication[]): string[] {
  const out = new Set<string>();
  for (const m of list) {
    const n = normalizeDrugName(m.name);
    if (!n) continue;
    out.add(n);
    const first = n.split(' ')[0];
    if (first.length >= 4) out.add(first);
  }
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** Drug names (known list ∪ med list) that occur in the text. */
export function drugNamesIn(text: string, medList: ChartMedication[] = []): string[] {
  const t = text.toLowerCase();
  const names = new Set([...MEDICATIONS, ...medListNames(medList)]);
  return [...names].filter((m) => new RegExp(`\\b${escape(m)}\\b`).test(t));
}

/** Doses in a text, normalized ("100 mg", "0.5 mg", "2 puffs" is not a dose). */
export const DOSE_RE = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|ml|mL|units?|iu|meq)\b/gi;
export function dosesIn(text: string): string[] {
  return [...text.matchAll(DOSE_RE)].map((m) => `${Number(m[1])} ${m[2].toLowerCase().replace(/^units?$/, 'unit').replace('µg', 'mcg')}`);
}

/** Med list as one text (for dose / name lookups). */
export function medListText(list: ChartMedication[]): string {
  return list.map((m) => [m.name, m.dose, m.sig].filter(Boolean).join(' ')).join('\n');
}

export function chartMedicationFact(m: ChartMedication): string {
  return `Active medication: ${m.name}${m.dose ? ` ${m.dose}` : ''}${m.sig ? ` — ${m.sig}` : ''}${m.drFirst ? ' (DrFirst list)' : ''}`;
}

// ─── Fuzzy matching ─────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Simplified Metaphone (English), enough to key drug names heard by speech recognition. */
export function metaphone(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  w = w.replace(/^(kn|gn|pn|wr|ps)/, (m) => m.slice(1)).replace(/^x/, 's').replace(/^wh/, 'w');
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const next = w[i + 1] ?? '';
    const prev = w[i - 1] ?? '';
    if (c === prev && c !== 'c') continue;
    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        if (i === 0) out += 'A';
        break;
      case 'b': if (!(prev === 'm' && i === w.length - 1)) out += 'B'; break;
      case 'c':
        if (next === 'h') { out += 'X'; i++; }
        else if ('iey'.includes(next)) out += 'S';
        else out += 'K';
        break;
      case 'd': out += next === 'g' && 'iey'.includes(w[i + 2] ?? '') ? 'J' : 'T'; break;
      case 'g':
        if (next === 'h') { i++; out += 'F'; }
        else if ('iey'.includes(next)) out += 'J';
        else out += 'K';
        break;
      case 'h': if ('aeiou'.includes(next) && !'csptg'.includes(prev)) out += 'H'; break;
      case 'k': if (prev !== 'c') out += 'K'; break;
      case 'p': if (next === 'h') { out += 'F'; i++; } else out += 'P'; break;
      case 'q': out += 'K'; break;
      case 's':
        if (next === 'h') { out += 'X'; i++; }
        else out += 'S';
        break;
      case 't':
        if (next === 'h') { out += '0'; i++; }
        else out += 'T';
        break;
      case 'v': out += 'F'; break;
      case 'w': case 'y': if ('aeiou'.includes(next)) out += c.toUpperCase(); break;
      case 'x': out += 'KS'; break;
      case 'z': out += 'S'; break;
      default: out += c.toUpperCase();
    }
  }
  return out;
}

export type MedSuggestion = {
  lineId: string;
  heard: string;
  likely: string;
  onMedList: boolean;
  basis: 'sounds_like' | 'spelling';
};

const COMMON = new Set(
  'about after again almost always another anything around because before better between bottle bought called coming could doctor doing dosage every everything feeling going having morning maybe medicine medication night nothing other people pharmacy really should something started stopped taking thing think three through tonight using while would'.split(' ')
);

/**
 * Transcript words that are probably a misheard medication: close to a name on the client's med
 * list (preferred) or the known name list, but not an exact name. One suggestion per heard word.
 */
export function suggestMisheardMeds(lines: { id: string; text: string }[], medList: ChartMedication[]): MedSuggestion[] {
  const listNames = medListNames(medList).filter((n) => !n.includes(' '));
  const known = new Set([...MEDICATIONS.filter((m) => !m.includes(' ')), ...listNames]);
  const candidates = [...listNames.map((n) => ({ n, onList: true })), ...MEDICATIONS.filter((m) => !m.includes(' ') && !listNames.includes(m)).map((n) => ({ n, onList: false }))];
  const keys = candidates.map((c) => ({ ...c, mp: metaphone(c.n) }));
  const out: MedSuggestion[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    for (const raw of l.text.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? []) {
      const w = raw.toLowerCase();
      if (known.has(w) || COMMON.has(w) || seen.has(w)) continue;
      const mp = metaphone(w);
      let best: { n: string; onList: boolean; basis: MedSuggestion['basis']; d: number } | null = null;
      for (const c of keys) {
        if (Math.abs(c.n.length - w.length) > 3) continue;
        const d = levenshtein(w, c.n);
        const sounds = mp.length >= 3 && mp === c.mp;
        if (d <= 2 || sounds) {
          const score = (c.onList ? 0 : 10) + (sounds ? 0 : 1) + d;
          if (!best || score < best.d) best = { n: c.n, onList: c.onList, basis: sounds ? 'sounds_like' : 'spelling', d: score };
        }
      }
      if (best) {
        seen.add(w);
        out.push({ lineId: l.id, heard: raw, likely: best.n, onMedList: best.onList, basis: best.basis });
      }
      if (out.length >= 10) return out;
    }
  }
  return out;
}

const UNIT_WORDS: Record<string, string> = { mg: 'milligrams?', mcg: 'micrograms?', g: 'grams?', ml: 'milliliters?|millilitres?', unit: 'units?', iu: 'international units?', meq: 'milliequivalents?' };

/**
 * Medication check of one draft sentence (grounding.ts). `cited` is all cited source text (transcript
 * lines and chart facts, incl. the med list facts), `citedTranscript` only the transcript part,
 * `citedNumbers` the numbers stated in the cited sources (number words included).
 *  withhold: a drug name not in the cited sources (being on the med list without being cited is not
 *            enough), or a dose whose amount and unit are not in the cited sources
 *  flag:     a name / dose that is grounded but not on the client's active med list
 */
export function checkMedications(
  sentence: string,
  input: { cited: string; citedTranscript: string; citedNumbers: Set<string>; medList: ChartMedication[] }
): { withhold: 'ungrounded_medication' | 'ungrounded_dose' | null; flags: string[] } {
  const listText = medListText(input.medList);
  const listNames = new Set(drugNamesIn(listText, input.medList));
  const citedNames = new Set(drugNamesIn(input.cited, input.medList));
  const flags: string[] = [];
  for (const n of drugNamesIn(sentence, input.medList)) {
    if (!citedNames.has(n)) return { withhold: 'ungrounded_medication', flags: [] };
    if (!listNames.has(n)) flags.push(`${n}: ${NOT_ON_MED_LIST}`);
  }
  const listDoses = new Set(dosesIn(listText));
  const citedDoses = new Set(dosesIn(input.cited));
  for (const d of dosesIn(sentence)) {
    const [amount, unit] = d.split(' ');
    const unitSaid = new RegExp(`\b(${unit}|${UNIT_WORDS[unit] ?? unit})\b`, 'i').test(input.cited);
    if (!citedDoses.has(d) && !(input.citedNumbers.has(amount) && unitSaid)) return { withhold: 'ungrounded_dose', flags: [] };
    if (!listDoses.has(d)) flags.push(`${d}: ${NOT_ON_MED_LIST}`);
  }
  return { withhold: null, flags: [...new Set(flags)] };
}
