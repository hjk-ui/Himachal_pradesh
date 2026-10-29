/**
 * Minimum necessary (45 CFR 164.502(b)) for AI Scribe drafts. Pure, browser-safe.
 *
 * The draft prompt tells the model to summarize clinically; this check flags what still slipped
 * into a progress-note sentence, for the clinician to edit or move to psychotherapy notes
 * (45 CFR 164.501: the author's private process notes, kept apart from the record):
 *   long_quote          quoted speech longer than 15 words
 *   third_party_name    a person's proper name (use the relationship: "her mother", "a coworker")
 *   sensitive_detail    sexual or trauma detail (summarize: "discussed trauma history")
 */

export type MinimumNecessaryKind = 'long_quote' | 'third_party_name' | 'sensitive_detail';
export type MinimumNecessaryFlag = { heading: string; text: string; kinds: MinimumNecessaryKind[]; detail: string[] };

export const MAX_QUOTE_WORDS = 15;

export const MINIMUM_NECESSARY_LABEL: Record<MinimumNecessaryKind, string> = {
  long_quote: 'Long direct quote (over 15 words)',
  third_party_name: 'Names another person (use the relationship)',
  sensitive_detail: 'Sexual or trauma detail (summarize clinically)',
};

export const MINIMUM_NECESSARY_PROMPT_RULES = [
  'Summarize clinically; do not transcribe. Short client quotes only when clinically necessary (for example the client\'s exact words about risk), never longer than 15 words.',
  'No verbatim trauma or sexual detail: summarize it ("described a history of sexual trauma", "discussed the assault").',
  'Minimal third-party detail: name people by relationship ("her mother", "a coworker", "his partner"), never by name, and only what the client\'s care needs.',
  'No psychotherapy-note material (the clinician\'s process impressions, hypotheses, dream or fantasy content, intimate detail) in the progress note.',
];

const QUOTE_RE = /[“"]([^”"]+)[”"]/g;
const SENSITIVE_RE =
  /\b(rap(e|ed|ing)|sexual(ly)? (abus|assault|molest)\w*|molest\w*|incest|sodom\w*|penetrat\w*|intercourse|oral sex|genital\w*|orgasm\w*|masturbat\w*|fondl\w*|ejaculat\w*|naked|nude|porn\w*|strangl\w*|chok(ed|ing) (her|him|me)|beat (her|him|me) with|stabb(ed|ing)|bled|blood everywhere)\b/i;

/** Capitalized words that are not people (titles, months, days, programs, drug brands, places of care). */
const NOT_A_NAME = new Set(
  'Client Clinician Patient Therapist Provider Doctor Dr Mr Mrs Ms Miss Mom Mother Dad Father Grandma Grandpa Grandmother Grandfather Sister Brother Aunt Uncle Son Daughter Wife Husband Partner Boyfriend Girlfriend Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December God Jesus Christmas Thanksgiving Easter English Spanish CBT DBT EMDR ACT AA NA SMART PHQ GAD ADHD PTSD OCD MDD GAD SI HI MSE ER ED ICU IOP PHP PRP DSS CPS DSM ICD Medicaid Medicare Maryland Baltimore Bowie Silver Spring Zoloft Prozac Lexapro Celexa Paxil Effexor Pristiq Cymbalta Wellbutrin Remeron Abilify Seroquel Risperdal Zyprexa Latuda Vraylar Lamictal Depakote Ativan Xanax Klonopin Valium Ambien Adderall Ritalin Concerta Vyvanse Strattera Suboxone Sublocade Vivitrol Narcan Antabuse Chantix Ozempic The A An In On At For With And But Or If When During After Before Plan Assessment Subjective Objective Goals Intervention Response Data Behavior Problem Evaluation Safety Risk Stanley Brown Columbia I'
    .split(' ')
);

/** Proper names in a sentence (capitalized, not sentence-initial, not a known non-name). */
export function properNames(sentence: string, ignore: readonly string[] = []): string[] {
  const skip = new Set([...NOT_A_NAME, ...ignore.flatMap((n) => n.split(/\s+/))]);
  const out: string[] = [];
  const words = sentence.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.replace(/^[“"'(]+|[”"'),.;:!?]+$/g, '').replace(/['’]s$/, '');
    if (!/^[A-Z][a-z]{1,}$/.test(w)) continue;
    const startOfSentence = i === 0 || /[.!?:]["”]?$/.test(words[i - 1] ?? '');
    if (startOfSentence || skip.has(w)) continue;
    out.push(w);
  }
  return [...new Set(out)];
}

export function longQuotes(sentence: string): string[] {
  return [...sentence.matchAll(QUOTE_RE)].map((m) => m[1].trim()).filter((q) => q.split(/\s+/).filter(Boolean).length > MAX_QUOTE_WORDS);
}

export function minimumNecessaryCheck(sentence: string, opts: { clientNames?: readonly string[] } = {}): { kinds: MinimumNecessaryKind[]; detail: string[] } {
  const kinds: MinimumNecessaryKind[] = [];
  const detail: string[] = [];
  const quotes = longQuotes(sentence);
  if (quotes.length) {
    kinds.push('long_quote');
    detail.push(`${quotes[0].split(/\s+/).length}-word quote`);
  }
  const names = properNames(sentence, opts.clientNames ?? []);
  if (names.length) {
    kinds.push('third_party_name');
    detail.push(`names: ${names.join(', ')}`);
  }
  const s = sentence.match(SENSITIVE_RE);
  if (s) {
    kinds.push('sensitive_detail');
    detail.push(`"${s[0]}"`);
  }
  return { kinds, detail };
}

/** Flags for every drafted sentence, by section. */
export function minimumNecessaryFlags(items: { heading: string | null; text: string; status: string }[], opts: { clientNames?: readonly string[] } = {}): MinimumNecessaryFlag[] {
  const out: MinimumNecessaryFlag[] = [];
  for (const it of items) {
    if (it.status === 'withheld' || !it.heading) continue;
    const r = minimumNecessaryCheck(it.text, opts);
    if (r.kinds.length) out.push({ heading: it.heading, text: it.text, kinds: r.kinds, detail: r.detail });
  }
  return out;
}

/** Remove one drafted sentence from a section text (the "Move to psychotherapy notes" action). */
export function removeSentence(sectionText: string, sentence: string): string {
  const s = sentence.trim().replace(/([^.!?])$/, '$1.');
  const idx = sectionText.indexOf(s);
  const plain = idx >= 0 ? s : sentence.trim();
  const at = idx >= 0 ? idx : sectionText.indexOf(plain);
  if (at < 0) return sectionText;
  return (sectionText.slice(0, at) + sectionText.slice(at + plain.length)).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

/** Append moved text to the clinician's existing psychotherapy note (dated block). */
export function appendPsychotherapyNote(existing: string, moved: string[], dateLabel: string): string {
  const block = `${dateLabel} (moved from the AI Scribe draft):\n${moved.map((m) => `- ${m.trim()}`).join('\n')}`;
  return [existing.trim(), block].filter(Boolean).join('\n\n');
}
