/**
 * MSE heading aliases (Oct 25 scribe field feedback).
 * Labels only: this maps heading variants to one canonical domain. It never supplies clinical content.
 */

export const MSE_DOMAINS = [
  'Appearance',
  'Behavior',
  'Speech',
  'Mood',
  'Affect',
  'Thought Process',
  'Thought Content',
  'Perception',
  'Cognition',
  'Insight/Judgment',
] as const;

export type MseDomain = (typeof MSE_DOMAINS)[number];

/** Normalized (lowercase, letters/digits/space) alias → canonical domain. */
const ALIASES: Record<string, MseDomain> = {
  'thought content': 'Thought Content',
  'thought contents': 'Thought Content',
  'content of thought': 'Thought Content',
  insight: 'Insight/Judgment',
  judgment: 'Insight/Judgment',
  judgement: 'Insight/Judgment',
  'insight judgment': 'Insight/Judgment',
  'insight and judgment': 'Insight/Judgment',
  'insight judgement': 'Insight/Judgment',
  'insight and judgement': 'Insight/Judgment',
  // Orientation is documented under Cognition.
  orientation: 'Cognition',
  cognition: 'Cognition',
};

function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Canonical MSE domain for a heading, or null when it is not an MSE domain. */
export function canonicalMseDomain(heading: string | null | undefined): MseDomain | null {
  if (!heading) return null;
  const key = normalizeHeading(heading);
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  const direct = MSE_DOMAINS.find((d) => normalizeHeading(d) === key);
  return direct ?? null;
}

/**
 * Fold alias headings into canonical MSE domains. Two headings that map to the same domain
 * (e.g. Orientation + Cognition) are joined, in order, on separate lines.
 * Non-MSE headings pass through unchanged and keep their position.
 */
export function applyMseAliases(sections: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [heading, text] of Object.entries(sections)) {
    const domain = canonicalMseDomain(heading);
    const key = domain ?? heading;
    const value = typeof text === 'string' ? text : '';
    if (key in out) {
      out[key] = [out[key], value].filter((s) => s.trim().length > 0).join('\n');
    } else {
      out[key] = value;
    }
  }
  return out;
}
