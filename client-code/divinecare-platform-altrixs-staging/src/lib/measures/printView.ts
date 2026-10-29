/**
 * Printable measure views (pure). Results summary: minimum PHI header (name, date of birth, MRN),
 * every score with severity and how it was given, change from baseline, the latest item responses,
 * and the guide entry (same source as the scoring). Blank form: only instruments in
 * BLANK_PRINT_FREE with their items in the catalog (guide.ts blankPrintCheck).
 */
import { instrumentById } from './instruments';
import { blankPrintCheck, measureGuideEntry, type MeasureGuideEntry } from './guide';

export type PrintPoint = {
  id: string;
  date: string;
  score: number | null;
  severity: string | null;
  source: string | null;
  administrationType: string | null;
  notes: string | null;
  safetyFlagged: boolean;
};

/** How the score was obtained, for the print and the chart */
export function howGiven(p: Pick<PrintPoint, 'source' | 'administrationType' | 'notes'>): string {
  if (p.source === 'paper' || p.administrationType === 'Paper') {
    const m = /Paper — entered by [^.]+/.exec(p.notes ?? '');
    return m ? m[0] : 'Paper';
  }
  if (p.source === 'patient_portal') return 'Patient link';
  return 'In clinic';
}

export type SeriesSummary = { baseline: PrintPoint | null; latest: PrintPoint | null; change: number | null; percentChange: number | null };

/** Baseline = first score on file; percent change from baseline (negative = improvement on symptom scales) */
export function summarizeSeries(points: PrintPoint[]): SeriesSummary {
  const scored = points.filter((p) => p.score != null).sort((a, b) => a.date.localeCompare(b.date));
  const baseline = scored[0] ?? null;
  const latest = scored[scored.length - 1] ?? null;
  if (!baseline || !latest || baseline === latest) return { baseline, latest, change: null, percentChange: null };
  const change = Math.round((latest.score! - baseline.score!) * 100) / 100;
  const percentChange = baseline.score ? Math.round((change / baseline.score) * 100) : null;
  return { baseline, latest, change, percentChange };
}

export type MeasurePrint = {
  title: string;
  header: { label: string; value: string }[];
  guide: MeasureGuideEntry | null;
  points: (PrintPoint & { how: string })[];
  summary: SeriesSummary;
  latestItems: { itemId: string; questionText: string; selectedText: string | null; scoreValue: number; flagged: boolean }[];
  footer: string[];
};

export function buildMeasurePrint(input: {
  instrumentId: string;
  client: { name: string; dateOfBirth: string | null; mrn: string | null };
  practiceName: string | null;
  printedBy: string | null;
  printedAt: Date;
  points: PrintPoint[];
  latestItems: MeasurePrint['latestItems'];
}): MeasurePrint {
  const i = instrumentById(input.instrumentId);
  const name = i?.name ?? input.instrumentId.toUpperCase();
  return {
    title: `${name} results${i ? ` — ${i.fullName}` : ''}`,
    // Minimum necessary: who the results belong to, nothing else from the chart
    header: [
      { label: 'Client', value: input.client.name },
      { label: 'Date of birth', value: input.client.dateOfBirth ?? '—' },
      ...(input.client.mrn ? [{ label: 'MRN', value: input.client.mrn }] : []),
      ...(input.practiceName ? [{ label: 'Practice', value: input.practiceName }] : []),
    ],
    guide: measureGuideEntry(input.instrumentId),
    points: [...input.points].sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ ...p, how: howGiven(p) })),
    summary: summarizeSeries(input.points),
    latestItems: input.latestItems,
    footer: [
      `Printed ${input.printedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${input.printedBy ? ` by ${input.printedBy}` : ''}.`,
      'Confidential health information. Scores support, and do not replace, clinical judgement.',
    ],
  };
}

export type BlankForm = {
  id: string;
  name: string;
  fullName: string;
  instructions: string | null;
  items: { n: number; text: string; note: string | null; options: { label: string; score: number }[] }[];
  citation: string;
};

/** Null when the form may not be printed blank (licensed / permission-only / no items stored) */
export function buildBlankForm(instrumentId: string): BlankForm | null {
  if (!blankPrintCheck(instrumentId).ok) return null;
  const i = instrumentById(instrumentId)!;
  const g = measureGuideEntry(instrumentId)!;
  return {
    id: i.id,
    name: i.name,
    fullName: i.fullName,
    instructions: g.instructions,
    items: (i.questions ?? []).map((q, idx) => ({ n: idx + 1, text: q.text, note: q.note ?? null, options: q.options.map((o) => ({ label: o.label, score: o.score })) })),
    citation: g.citation,
  };
}
