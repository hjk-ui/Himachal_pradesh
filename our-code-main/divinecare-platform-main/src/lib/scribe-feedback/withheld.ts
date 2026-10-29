/**
 * Clinician-only headings (NEVER_AI_HEADINGS): AI text for these is withheld from the note.
 * The section is left blank; the suggestion is offered separately behind "Insert suggestion".
 */
import { NEVER_AI_HEADINGS } from '@/lib/scribe/formats';

export const INSERT_SUGGESTION_LABEL = 'Insert suggestion';
export const INSERTED_LABEL = 'Inserted';

/** Header shown above withheld AI suggestions. */
export function withheldHeader(count: number): string {
  return `AI suggestions withheld from the note (${count})`;
}

export type WithheldSuggestion = {
  /** Stable id: the heading as it appears in the note */
  id: string;
  heading: string;
  /** The AI text, never placed in the note until the clinician inserts it */
  text: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NEVER_SET = new Set<string>(NEVER_AI_HEADINGS.map((h) => norm(h)));
// Headings the prompt names as "Risk / safety" are commonly written as "Risk" or "Safety".
const NEVER_SET_LOOSE = new Set<string>([...NEVER_SET, 'risk safety', 'risk and safety']);

export function isWithheldHeading(heading: string): boolean {
  return NEVER_SET_LOOSE.has(norm(heading));
}

/**
 * Split an AI draft into the note sections (withheld headings blanked) and the withheld suggestions.
 * Withheld headings with no AI text produce no suggestion but stay blank.
 */
export function withholdDraftSections(sections: Record<string, string>): {
  sections: Record<string, string>;
  withheld: WithheldSuggestion[];
} {
  const out: Record<string, string> = {};
  const withheld: WithheldSuggestion[] = [];
  for (const [heading, raw] of Object.entries(sections)) {
    const text = typeof raw === 'string' ? raw : '';
    if (isWithheldHeading(heading)) {
      out[heading] = '';
      if (text.trim()) withheld.push({ id: heading, heading, text: text.trim() });
    } else {
      out[heading] = text;
    }
  }
  return { sections: out, withheld };
}

/** Insert a withheld suggestion into its (blank) section. Never overwrites clinician text. */
export function insertWithheld(
  sections: Record<string, string>,
  suggestion: WithheldSuggestion
): Record<string, string> {
  const existing = (sections[suggestion.heading] ?? '').trim();
  return {
    ...sections,
    [suggestion.heading]: existing ? `${existing}\n${suggestion.text}` : suggestion.text,
  };
}
