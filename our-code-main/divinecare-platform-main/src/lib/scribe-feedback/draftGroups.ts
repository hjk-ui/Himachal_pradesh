/**
 * Draft suggestion groups shown under the scribe note: withheld AI text and spoken measures.
 */
import { extractSpokenMeasures, type SpokenMeasure } from './spokenMeasures';
import { withheldHeader, type WithheldSuggestion } from './withheld';

export type DraftGroups = {
  withheld: WithheldSuggestion[];
  /** Header text, e.g. `AI suggestions withheld from the note (2)`; null when none are withheld */
  withheldHeader: string | null;
  measures: SpokenMeasure[];
  /** Number of items the clinician still has to act on */
  total: number;
};

export function buildDraftGroups(input: {
  withheld: WithheldSuggestion[];
  transcript: string | string[];
  /** Instrument keys already assigned, so they are not offered twice */
  assignedKeys?: string[];
}): DraftGroups {
  const assigned = new Set(input.assignedKeys ?? []);
  const measures = extractSpokenMeasures(input.transcript).filter((m) => !assigned.has(m.key));
  return {
    withheld: input.withheld,
    withheldHeader: input.withheld.length > 0 ? withheldHeader(input.withheld.length) : null,
    measures,
    total: input.withheld.length + measures.length,
  };
}
