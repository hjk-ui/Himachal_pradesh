/** Mid-visit note type change — carried-over sections (Oct 23). */

export const TYPE_CHANGE_TITLE = 'Change note type';
export const TYPE_CHANGE_CTA = 'Change type';

export function typeChangeBody(fromLabel: string, toLabel: string) {
  return `Change ${fromLabel} to ${toLabel}? Text in sections the new template doesn't have is kept under 'Carried over'.`;
}

export function carriedOverHeading(oldTypeLabel: string) {
  return `Carried over from ${oldTypeLabel}`;
}

export const CARRIED_OVER_HELP =
  "Text from sections the new note type doesn't have. Move what belongs into the sections above and delete the rest; it is saved with the note as written.";

const SECTION_KEYS: Record<string, string[]> = {
  SOAP: ['Subjective', 'Objective', 'Assessment', 'Plan'],
  DAP: ['Data', 'Assessment', 'Plan'],
  BIRP: ['Behavior', 'Intervention', 'Response', 'Plan'],
  PSYCH_MED_MGMT: ['Chief complaint', 'Interval history', 'MSE', 'Assessment', 'Plan'],
  MED_MGMT: ['Interval history', 'Meds', 'Assessment', 'Plan'],
  PSYCH_EVAL: ['HPI', 'MSE', 'Assessment', 'Plan'],
  PRIMARY_CARE_SOAP: ['Subjective', 'Objective', 'Assessment', 'Plan'],
};

export function remapNoteSections(
  fromType: string,
  toType: string,
  sections: Record<string, string>
): { sections: Record<string, string>; carriedOver: Record<string, string>; cptCleared: string[] } {
  const fromKeys = SECTION_KEYS[fromType] || Object.keys(sections);
  const toKeys = new Set(SECTION_KEYS[toType] || []);
  const next: Record<string, string> = {};
  const carried: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) {
    if (!value?.trim()) continue;
    if (toKeys.has(key) || (toKeys.size === 0 && fromKeys.includes(key))) {
      next[key] = value;
    } else {
      carried[key] = value;
    }
  }
  // CPT: clear 90791/90792 off non-intake; never invent bare 992*
  const cptCleared: string[] = [];
  const intake = /eval|intake|90792|90791/i.test(toType);
  if (!intake) {
    cptCleared.push('90791', '90792');
  }
  console.info('[NOTE_TYPE_CHANGE]', { fromType, toType });
  return { sections: next, carriedOver: carried, cptCleared };
}
