/**
 * Withheld AI sentences offered back as one-click suggestions in their own section. Pure, browser-safe.
 *
 * A withheld sentence is never placed in the note by the AI. The clinician sees it under the section
 * it was drafted for, with the reason, and can insert it with one click after checking the transcript
 * (a clinician action, so it carries no AI DRAFT marker). Not offered: risk screens (si / hi /
 * self-harm / abuse: the C-SSRS and risk sections are the clinician's), chips that failed the client /
 * polarity check, a sentence that says the opposite of its cited line, clinician-only medication
 * sections, and the client summary.
 */
import { RISK_FIELDS } from './draft';
import { NOT_SUGGESTED_REASONS } from './grounding';
import { MSE_DOMAINS, NOT_ASSESSED } from './templateFields';
import type { ProvenanceItem } from './draft';

export type DraftSuggestion = {
  heading: string;
  /** MSE domain when the suggestion is a mental status line */
  domain: string | null;
  /** Text inserted on click ("Insight: fair (observed)" for MSE) */
  insert: string;
  /** The drafted sentence as the model wrote it */
  text: string;
  cites: string[];
  reason: ProvenanceItem['reason'];
  detail?: string;
};


export function suggestionsFromWithheld(withheld: ProvenanceItem[]): DraftSuggestion[] {
  const out: DraftSuggestion[] = [];
  const seen = new Set<string>();
  for (const w of withheld) {
    if (!w.heading || !w.text.trim()) continue;
    if (RISK_FIELDS.has(w.target) || w.target === 'summary' || w.target === 'medChanges') continue;
    if (w.reason && NOT_SUGGESTED_REASONS.has(w.reason)) continue;
    const domain = w.target.startsWith('mse.') ? w.target.slice(4) : null;
    if (domain && !(MSE_DOMAINS as readonly string[]).includes(domain)) continue;
    const insert = domain ? `${domain}: ${w.text.trim().replace(new RegExp(`^${domain}:\\s*`, 'i'), '')}` : w.text.trim();
    const key = `${w.heading}|${insert}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ heading: w.heading, domain, insert, text: w.text, cites: w.cites, reason: w.reason, ...(w.detail ? { detail: w.detail } : {}) });
  }
  return out;
}

/**
 * Put an accepted suggestion into a section's text: an MSE line replaces that domain's blank or
 * "Not assessed" line; anything else is appended.
 */
export function applySuggestion(sectionText: string, s: Pick<DraftSuggestion, 'domain' | 'insert'>): string {
  const cur = sectionText || '';
  if (s.domain) {
    const line = new RegExp(`^${s.domain}:[ \\t]*(?:${NOT_ASSESSED})?[ \\t]*$`, 'im');
    if (line.test(cur)) return cur.replace(line, s.insert);
  }
  return cur.trim() ? `${cur.trimEnd()}\n${s.insert}` : s.insert;
}
