/**
 * DrFirst MUM5: no Latin abbreviations in sig text sent to Rcopia. Expands the common prescription
 * abbreviations (with or without periods, any case) to plain English. Pure; tested in
 * tests/drfirst-certification.test.ts. Ambiguous or ophthalmic / otic abbreviations (OD, OS, AU, ...)
 * are not guessed: they are left for the prescriber to correct in Rcopia.
 */

const ABBREVIATIONS: [string, string][] = [
  ['q.i.d', 'four times a day'],
  ['t.i.d', 'three times a day'],
  ['b.i.d', 'twice a day'],
  ['q.o.d', 'every other day'],
  ['q.d', 'once a day'],
  ['q.h.s', 'at bedtime'],
  ['h.s', 'at bedtime'],
  ['q.a.m', 'every morning'],
  ['q.p.m', 'every evening'],
  ['p.r.n', 'as needed'],
  ['p.o', 'by mouth'],
  ['s.l', 'under the tongue'],
  ['s.u.b.q', 'under the skin'],
  ['s.u.b.c.u.t', 'under the skin'],
  ['s.q', 'under the skin'],
  ['i.m', 'into the muscle'],
  ['a.c', 'before meals'],
  ['p.c', 'after meals'],
  ['u.d', 'as directed'],
  ['u.t.d', 'as directed'],
  ['stat', 'immediately'],
  ['gtts', 'drops'],
  ['gtt', 'drop'],
];

// "b.i.d" -> /\bb\.?i\.?d\.?(?![A-Za-z0-9])/gi
const PATTERNS = ABBREVIATIONS.map(([abbr, plain]) => {
  const letters = abbr.replace(/\./g, '').split('');
  return [new RegExp(`(?<![A-Za-z0-9])${letters.join('\\.?')}\\.?(?![A-Za-z0-9])`, 'gi'), plain] as const;
});

/** "q6h" / "q.6.h." / "q 6 h" -> "every 6 hours" */
const EVERY_N_HOURS = /(?<![A-Za-z0-9])q\.?\s?(\d{1,2})\.?\s?h(?:rs?|ours?)?\.?(?![A-Za-z0-9])/gi;

export function expandLatinSig(text: string | null | undefined): string {
  let out = String(text ?? '');
  if (!out.trim()) return out;
  out = out.replace(EVERY_N_HOURS, (_m, n: string) => `every ${n} hours`);
  for (const [re, plain] of PATTERNS) out = out.replace(re, plain);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** True when the text still contains one of the abbreviations above (for tests / warnings). */
export function hasLatinAbbreviation(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  EVERY_N_HOURS.lastIndex = 0;
  return EVERY_N_HOURS.test(s) || PATTERNS.some(([re]) => { re.lastIndex = 0; return re.test(s); });
}
