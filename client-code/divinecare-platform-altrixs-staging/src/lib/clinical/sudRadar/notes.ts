/**
 * Note-text path: turns keyword hits from a client's signed notes and filed documents into one
 * SUD Radar finding. Pure module. The finding never carries a diagnosis code.
 */
import { fingerprintOf, mostUrgentAction } from './codes';
import { scanText, type KeywordHit } from './keywords';
import {
  CONFIDENCE_RANK,
  SUBSTANCE_LABEL,
  type Confidence,
  type Evidence,
  type Finding,
  type Priority,
  type RoutedAction,
  type SubstanceClass,
} from './types';

export type NoteSource = {
  sourceType: 'progress-note' | 'document';
  sourceId: string;
  sourceLabel: string;
  /** YYYY-MM-DD */
  date: string | null;
  href: string;
  text: string;
};

export type SourcedHit = KeywordHit & {
  /** Stable id of this evidence sentence (source + quote) */
  key: string;
  source: Omit<NoteSource, 'text'>;
  aiVerdict?: 'confirmed' | 'historical' | 'uncertain';
};

export const MAX_EVIDENCE = 6;

export function collectNoteHits(sources: NoteSource[]): SourcedHit[] {
  const out: SourcedHit[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    if (!src.text?.trim()) continue;
    const { text, ...source } = src;
    for (const hit of scanText(text)) {
      // The same sentence copied forward into several notes counts once (latest source wins below)
      const dedupe = `${hit.substance}|${hit.quote.toLowerCase()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ ...hit, key: fingerprintOf([source.sourceId, hit.quote]), source });
    }
  }
  return out;
}

const ACTION_ORDER: Record<RoutedAction, number> = {
  'residential-referral': 0,
  sbirt: 1,
  'chart-documentation': 2,
  'tobacco-cessation': 3,
};

const CONFIDENCE_PERCENT: Record<Confidence, number> = { high: 85, medium: 65, low: 40 };

function bestConfidence(hits: { confidence: Confidence }[]): Confidence {
  return hits.reduce<Confidence>(
    (best, h) => (CONFIDENCE_RANK[h.confidence] < CONFIDENCE_RANK[best] ? h.confidence : best),
    'low'
  );
}

const NO_DX = 'No SUD diagnosis is charted — the clinician confirms and documents any diagnosis (the scan never assigns codes).';

function recommendationFor(action: RoutedAction): string {
  if (action === 'residential-referral') {
    return `Note language suggests high-risk use (overdose, withdrawal, IV use, or heavy daily use). Consider ASAM level-of-care assessment; residential/IOP referral if indicated. ${NO_DX}`;
  }
  if (action === 'sbirt') {
    return `Note language suggests current substance use. Start SBIRT: a validated screen (AUDIT, DAST-10 or CAGE-AID) and a brief intervention. ${NO_DX}`;
  }
  return 'Notes suggest a substance use history or treatment (e.g. MAT, recovery meetings) but no SUD diagnosis is charted. Clinician to confirm and document the diagnosis, including remission status if applicable — the scan never assigns codes.';
}

function priorityFor(action: RoutedAction, confidence: Confidence): Priority {
  if (action === 'residential-referral') return confidence === 'low' ? 'high' : 'urgent';
  if (action === 'sbirt') return confidence === 'low' ? 'routine' : 'high';
  return 'routine';
}

export function hitToEvidence(h: SourcedHit): Evidence {
  return {
    quote: h.quote,
    sourceType: h.source.sourceType,
    sourceId: h.source.sourceId,
    sourceLabel: h.source.sourceLabel,
    date: h.source.date,
    href: h.source.href,
    term: h.term,
    confidence: h.confidence,
    key: h.key,
    ...(h.aiVerdict ? { aiVerdict: h.aiVerdict } : {}),
  };
}

/** One note-keyword finding per client (all substances grouped), or null when nothing is left. */
export function buildNoteFinding(clientId: string, hits: SourcedHit[]): Finding | null {
  if (!hits.length) return null;
  const sorted = [...hits].sort(
    (a, b) =>
      ACTION_ORDER[a.action] - ACTION_ORDER[b.action] ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      (b.source.date ?? '').localeCompare(a.source.date ?? '')
  );
  // Overall action comes from hits that are at least medium confidence when any exist
  const strong = sorted.filter((h) => h.confidence !== 'low');
  const action = mostUrgentAction((strong.length ? strong : sorted).map((h) => h.action));
  const confidence = bestConfidence(sorted);
  const substances = [...new Set(sorted.map((h) => h.substance))] as SubstanceClass[];
  const named = substances.filter((s) => s !== 'other');
  const label = (named.length ? named : substances).map((s) => SUBSTANCE_LABEL[s].toLowerCase()).join(', ');
  return {
    clientId,
    detectionSource: 'note-keyword',
    fingerprint: fingerprintOf(['note-keyword']),
    substanceClasses: substances,
    codes: [],
    evidence: sorted.slice(0, MAX_EVIDENCE).map(hitToEvidence),
    evidenceKeys: [...new Set(sorted.map((h) => h.key))].slice(0, 500),
    confidence,
    confidencePercent: CONFIDENCE_PERCENT[confidence],
    detectedCondition: `Possible ${label} use in note text — no SUD diagnosis charted`.slice(0, 500),
    recommendation: recommendationFor(action),
    routedAction: action,
    priority: priorityFor(action, confidence),
    needsScreening: false,
  };
}
