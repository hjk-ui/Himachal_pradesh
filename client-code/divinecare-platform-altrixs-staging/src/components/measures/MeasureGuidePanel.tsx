'use client';

/**
 * How to read a measure: the guide entry (src/lib/measures/guide.ts, derived from the same scoring
 * the chart uses). Compact in the chart (next to a score, `compact`) and full on the Measure guide
 * page. Unverified cutoffs say "See the instrument manual".
 */
import Link from 'next/link';
import { AlertTriangle, Printer } from 'lucide-react';
import { cx } from '@/components/ui';
import { BLANK_PRINT_TEXT, guideBandFor, SEE_MANUAL, type GuideBand, type MeasureGuideEntry } from '@/lib/measures/guide';

function Bands({ bands, score }: { bands: GuideBand[]; score?: number | null }) {
  return (
    <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
      {bands.map((b) => {
        const here = score != null && score >= b.min && score <= b.max;
        return (
          <li key={`${b.min}-${b.label}`} className={cx('rounded border px-2 py-1 text-xs', here ? 'border-blue-300 bg-blue-50 font-semibold text-blue-900' : 'border-slate-200 text-slate-700')}>
            <span className="tabular-nums">{b.min === b.max ? b.min : `${b.min}–${b.max}`}</span> {b.label}
            {here ? ' (this score)' : ''}
          </li>
        );
      })}
    </ul>
  );
}

export function MeasureGuidePanel({ entry, score, compact = false }: { entry: MeasureGuideEntry; score?: number | null; compact?: boolean }) {
  const band = guideBandFor(entry, score ?? null);
  const change = entry.change;
  const changeLines = [
    change.response ? `Response: ${change.response}.` : null,
    change.remission ? `Remission: ${change.remission}.` : null,
    change.worseningPoints != null ? `Altrixs flags worsening at a rise of ${change.worseningPoints} points or more.` : null,
    change.note,
  ].filter(Boolean) as string[];
  return (
    <div className={cx('min-w-0 text-sm text-slate-700', compact ? 'space-y-2' : 'space-y-3')}>
      {!compact ? <p>{entry.whatItMeasures}</p> : null}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="inline font-semibold text-slate-600">Items: </dt>
          <dd className="inline">{entry.itemCount}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-600">Score range: </dt>
          <dd className="inline">{entry.scoreRange ? `${entry.scoreRange.min}–${entry.scoreRange.max}` : SEE_MANUAL}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-600">Given: </dt>
          <dd className="inline">{entry.adminType}</dd>
        </div>
      </dl>

      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Severity / cutoffs</h4>
        {entry.scoringNote ? <p className="mt-0.5 text-xs">{entry.scoringNote}</p> : null}
        {entry.bands ? (
          <>
            <Bands bands={entry.bands} score={score} />
            {entry.publishedCutoff ? <p className="mt-1 text-xs">{entry.publishedCutoff}</p> : null}
          </>
        ) : entry.verified ? (
          <>
            {entry.publishedCutoff ? <p className="mt-0.5 text-xs">{entry.publishedCutoff}</p> : null}
            {entry.subscaleBands?.map((sb) => (
              <div key={sb.name} className="mt-1">
                <p className="text-xs font-semibold text-slate-600">{sb.name}</p>
                <Bands bands={sb.bands} />
              </div>
            ))}
          </>
        ) : (
          <>
            <p className="mt-0.5 text-xs font-semibold">{SEE_MANUAL}.</p>
            {entry.publishedCutoff ? <p className="text-xs">Published cutoff: {entry.publishedCutoff}</p> : null}
            {entry.scoringLabels && !compact ? (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-slate-600">Labels Altrixs scoring shows (not verified against the manual)</summary>
                <Bands bands={entry.scoringLabels} score={score} />
              </details>
            ) : null}
            {entry.scoringLabels && compact && band ? <p className="text-xs text-slate-600">Altrixs label: {band.label} (not verified against the manual).</p> : null}
          </>
        )}
      </section>

      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Meaningful change</h4>
        {changeLines.length ? (
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs">
            {changeLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-0.5 text-xs">{SEE_MANUAL}.</p>
        )}
      </section>

      {entry.critical.length ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
          <h4 className="flex items-center gap-1 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Critical items
          </h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {entry.critical.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs">
        <span className="font-semibold text-slate-600">Frequency: </span>
        {entry.frequency}
      </p>
      <p className="text-xs text-slate-500">Source: {entry.citation}</p>

      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        {compact ? (
          <Link href={`/dashboard/mbc/guide#${entry.id}`} className="text-xs font-semibold text-blue-700 hover:underline">
            Open in Measure guide
          </Link>
        ) : null}
        {entry.blankPrint.ok ? (
          <Link
            href={`/dashboard/mbc/guide/${encodeURIComponent(entry.id)}/print`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden /> Print blank form
          </Link>
        ) : !compact ? (
          <span className="text-xs text-slate-500">Blank form: {entry.blankPrint.ok === false ? BLANK_PRINT_TEXT[entry.blankPrint.reason] : null}</span>
        ) : null}
      </div>
    </div>
  );
}
