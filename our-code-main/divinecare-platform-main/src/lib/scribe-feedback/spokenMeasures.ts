/**
 * Spoken measure names ("GAD seven", "PHQ nine") → catalog instrument keys.
 * Only measures actually named in the transcript are returned. No due date is ever invented.
 */

export type SpokenMeasure = { key: string; name: string };

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

const NUM = '(\\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)';

/** Numbered instruments by spoken prefix, then digit. Keys match ASSESSMENT_CATALOG ids. */
const NUMBERED: Record<string, Record<string, SpokenMeasure>> = {
  phq: { '9': { key: 'phq-9', name: 'PHQ-9' }, '2': { key: 'phq-2', name: 'PHQ-2' } },
  gad: { '7': { key: 'gad-7', name: 'GAD-7' }, '2': { key: 'gad-2', name: 'GAD-2' } },
  pcl: { '5': { key: 'pcl-5', name: 'PCL-5' } },
};

const NAMED: Array<SpokenMeasure & { re: RegExp }> = [
  { key: 'audit', name: 'AUDIT', re: /\baudit\b/gi },
  { key: 'aces', name: 'ACEs', re: /\baces\b/gi },
  { key: 'mdq', name: 'MDQ', re: /\bmdq\b/gi },
];

/** "GAD seven" → "GAD-7", "phq 9" → "PHQ-9". Unrecognized text is left untouched. */
export function normalizeSpokenMeasures(text: string): string {
  return text.replace(
    new RegExp(`\\b(phq|gad|pcl)\\s*[-\\s]?\\s*${NUM}\\b`, 'gi'),
    (whole, prefix: string, num: string) => {
      const digit = NUMBER_WORDS[num.toLowerCase()] ?? num;
      return NUMBERED[prefix.toLowerCase()]?.[digit]?.name ?? whole;
    }
  );
}

/** Distinct measures named in the transcript, in order of first mention. */
export function extractSpokenMeasures(transcript: string | string[]): SpokenMeasure[] {
  const text = normalizeSpokenMeasures(Array.isArray(transcript) ? transcript.join('\n') : transcript);
  const found: Array<SpokenMeasure & { at: number }> = [];
  const seen = new Set<string>();
  const add = (m: SpokenMeasure, at: number) => {
    if (seen.has(m.key)) return;
    seen.add(m.key);
    found.push({ ...m, at });
  };

  for (const m of text.matchAll(/\b(PHQ-9|PHQ-2|GAD-7|GAD-2|PCL-5)\b/gi)) {
    const name = m[1].toUpperCase();
    add({ key: name.toLowerCase(), name }, m.index ?? 0);
  }
  for (const { re, key, name } of NAMED) {
    for (const m of text.matchAll(re)) add({ key, name }, m.index ?? 0);
  }
  return found.sort((a, b) => a.at - b.at).map(({ key, name }) => ({ key, name }));
}

/** CTA label: `Assign these measures (N), due {date}`. The date comes from the clinician, never a default. */
export function assignMeasuresLabel(count: number, dueDate?: string | null): string {
  const base = `Assign these measures (${count})`;
  return dueDate && dueDate.trim() ? `${base}, due ${dueDate.trim()}` : base;
}
