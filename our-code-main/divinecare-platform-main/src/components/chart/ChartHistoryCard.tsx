'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import {
  CHART_DIGEST_DISCLAIMER,
  CHART_DIGEST_EMPTY,
  CHART_HISTORY_TITLE,
  GENERATE_LABEL,
  REGENERATE_LABEL,
} from '@/lib/chart-digest/copy';
import type { ChartDigestKind, DigestContent } from '@/lib/chart-digest/kinds';

type DigestPayload = {
  success: boolean;
  error?: string;
  digest: { generatedAt: string; content: DigestContent } | null;
  empty: boolean;
  canRegenerate: boolean;
};

type Props = {
  clientId: string;
  kind?: ChartDigestKind;
  /** Overrides the card title, e.g. "Medical history" */
  title?: string;
  className?: string;
};

function formatGenerated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ChartHistoryCard({ clientId, kind = 'bh', title, className = '' }: Props) {
  const [data, setData] = useState<DigestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/clients/${encodeURIComponent(clientId)}/chart-digest?kind=${kind}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<DigestPayload>(url, { cache: 'no-store' }));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Unable to load chart history');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await apiJson<DigestPayload>(url, { method: 'POST' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to generate chart history');
    } finally {
      setBusy(false);
    }
  };

  const content = data?.digest?.content ?? null;
  const sourceById = new Map((content?.sources ?? []).map((s) => [s.id, s]));
  const hasDigest = Boolean(data?.digest);

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      data-testid="chart-history-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title || CHART_HISTORY_TITLE}</h2>
          {data?.digest ? (
            <p className="text-xs text-slate-500">Generated {formatGenerated(data.digest.generatedAt)}</p>
          ) : null}
        </div>
        {data?.canRegenerate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? 'Working…' : hasDigest ? REGENERATE_LABEL : GENERATE_LABEL}
          </button>
        ) : null}
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          {CHART_DIGEST_DISCLAIMER}
        </p>

        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        {!loading && !error && (data?.empty ?? true) ? (
          <p className="text-sm text-slate-600">{CHART_DIGEST_EMPTY}</p>
        ) : null}

        {content && !data?.empty
          ? content.sections
              .filter((s) => s.items.length > 0)
              .map((section) => (
                <div key={section.key}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</h3>
                  <ul className="mt-1 space-y-1.5">
                    {section.items.map((item, i) => (
                      <li key={`${section.key}-${i}`} className="text-sm text-slate-800">
                        {item.text}{' '}
                        {item.citations.map((c) => (
                          <span
                            key={c}
                            title={sourceById.get(c)?.label ?? c}
                            className="ml-0.5 rounded bg-slate-100 px-1 py-0.5 align-middle text-[10px] font-semibold text-slate-600"
                          >
                            {sourceById.get(c)?.date ? `${sourceById.get(c)?.type} ${sourceById.get(c)?.date}` : c}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          : null}
      </div>
    </section>
  );
}
