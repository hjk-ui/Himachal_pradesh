/**
 * Plain-language client session summary. Pure, browser-safe.
 *
 * Drafted by the model from cited transcript lines only (same grounding as the note), written for
 * a 6th-8th grade reader, with homework. The clinician edits and approves it; it is shared to the
 * patient portal (secure message) only after approval and only when the practice allows sharing.
 *
 * 42 CFR Part 2: for a SUD-flagged session, sentences about substance use (or citing lines that
 * mention it) are removed unless the client has a signed Part 2 consent that covers the portal.
 */
import type { CheckedSentence } from './grounding';

export const SUMMARY_TARGET_GRADE = { min: 6, max: 8 } as const;

export const SUD_TERMS =
  /\b(alcohol|drink(s|ing)?|drunk|beers?|wines?|liquor|shots?|vodka|whiskey|sober|sobriety|relapse[ds]?|craving[s]?|substance|drug[s]?|opioid[s]?|heroin|fentanyl|oxy(contin|codone)?|percocet|cocaine|crack|meth(amphetamine)?|cannabis|marijuana|weed|high|pills?|using|use disorder|overdose|od'?d|detox|rehab|recovery meeting|aa|na|12[- ]step|sponsor|methadone|buprenorphine|suboxone|sublocade|vivitrol|naltrexone|narcan|naloxone|mat|moud)\b/i;

export type SummaryInput = {
  sentences: CheckedSentence[];
  homework: CheckedSentence[];
  lineText: Map<string, string>;
  part2Session: boolean;
  part2ConsentAllowsPortal: boolean;
};

export type SummaryResult = {
  text: string;
  removedForPart2: number;
  withheld: number;
  grade: number | null;
};

function mentionsSud(s: CheckedSentence, lineText: Map<string, string>): boolean {
  if (SUD_TERMS.test(s.text)) return true;
  return s.cites.some((c) => SUD_TERMS.test(lineText.get(c) || ''));
}

/** Drop Part 2 content when consent does not allow it; drop withheld sentences. */
export function filterSummary(input: SummaryInput): { keep: CheckedSentence[]; homework: CheckedSentence[]; removedForPart2: number; withheld: number } {
  let removed = 0;
  let withheld = 0;
  const pass = (list: CheckedSentence[]) =>
    list.filter((s) => {
      if (s.status === 'withheld') {
        withheld++;
        return false;
      }
      if (input.part2Session && !input.part2ConsentAllowsPortal && mentionsSud(s, input.lineText)) {
        removed++;
        return false;
      }
      return true;
    });
  return { keep: pass(input.sentences), homework: pass(input.homework), removedForPart2: removed, withheld };
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level (null for empty text). */
export function fleschKincaidGrade(text: string): number | null {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words: string[] = text.match(/[A-Za-z']+/g) ?? [];
  if (!sentences.length || !words.length) return null;
  const syl = words.reduce((t, w) => t + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

export function composeSummary(input: SummaryInput): SummaryResult {
  const f = filterSummary(input);
  const parts: string[] = [];
  if (f.keep.length) parts.push(f.keep.map((s) => s.text.trim()).join(' '));
  if (f.homework.length) parts.push(`Your practice for this week:\n${f.homework.map((s) => `- ${s.text.trim()}`).join('\n')}`);
  parts.push('If you are in crisis, call or text 988 any time, or call 911 in an emergency.');
  const text = parts.join('\n\n');
  return { text, removedForPart2: f.removedForPart2, withheld: f.withheld, grade: fleschKincaidGrade(f.keep.map((s) => s.text).join(' ')) };
}
