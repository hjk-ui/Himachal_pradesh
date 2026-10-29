/**
 * "No medication changes" checkbox (Oct 25). Adds or removes NO_MED_CHANGES_SENTENCE in the note.
 * The sentence goes into the Medication plan section when the format has one, else the Plan section.
 */
import { NO_MED_CHANGES_SENTENCE } from '@/lib/scribe/formats';

export const NO_MED_CHANGES_LABEL = 'No medication changes this visit';

/** Formats that carry a medication plan. */
export const NO_MED_CHANGES_FORMATS = ['PSYCH_MED_MGMT', 'MED_MGMT'] as const;

export function showsNoMedChanges(format: string): boolean {
  return (NO_MED_CHANGES_FORMATS as readonly string[]).includes(format);
}

function targetHeading(sections: Record<string, string>): string {
  if ('Medication plan' in sections) return 'Medication plan';
  if ('Plan' in sections) return 'Plan';
  return 'Medication plan';
}

export function hasNoMedChanges(sections: Record<string, string>): boolean {
  return Object.values(sections).some((v) => v.includes(NO_MED_CHANGES_SENTENCE));
}

export function applyNoMedChanges(
  sections: Record<string, string>,
  checked: boolean
): Record<string, string> {
  if (!checked) {
    const out: Record<string, string> = {};
    for (const [heading, text] of Object.entries(sections)) {
      out[heading] = text
        .replace(NO_MED_CHANGES_SENTENCE, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    }
    return out;
  }
  if (hasNoMedChanges(sections)) return sections;
  const heading = targetHeading(sections);
  const existing = (sections[heading] ?? '').trim();
  return {
    ...sections,
    [heading]: existing ? `${existing}\n${NO_MED_CHANGES_SENTENCE}` : NO_MED_CHANGES_SENTENCE,
  };
}
