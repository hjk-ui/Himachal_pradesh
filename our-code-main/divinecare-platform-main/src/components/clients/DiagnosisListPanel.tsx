'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMMON_ICD10_CATALOG } from '@/components/clinical/DiagnosisAutocomplete';
import { DIAGNOSIS_COPY, DIAGNOSIS_PILLS, DIAGNOSIS_STATUS_LABELS } from '@/lib/diagnoses/copy';
import { isCurrentStatus, type DiagnosisDto, type DiagnosisHistoryDto, type DiagnosisStatus, type DiagnosisSuggestion } from '@/lib/diagnoses/types';

type Props = {
  clientId: string;
  /** False for roles that can read but not edit the chart. */
  canEdit?: boolean;
};

type ApiResult = { success: boolean; error?: string } & Record<string, unknown>;

async function call(url: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = (await res.json().catch(() => ({}))) as ApiResult;
  if (!res.ok || data.success === false) throw new Error(data.error || 'Something went wrong');
  return data;
}

const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export function DiagnosisListPanel({ clientId, canEdit = true }: Props) {
  const base = `/api/clients/${clientId}/diagnoses`;
  const [rows, setRows] = useState<DiagnosisDto[]>([]);
  const [reviewDue, setReviewDue] = useState(false);
  const [suggestions, setSuggestions] = useState<DiagnosisSuggestion[]>([]);
  const [history, setHistory] = useState<DiagnosisHistoryDto[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [typedDescription, setTypedDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, sug] = await Promise.all([
        call(base),
        call(`${base}/suggestions`).catch(() => ({ success: true, suggestions: [] }) as ApiResult),
      ]);
      setRows((list.diagnoses as DiagnosisDto[]) || []);
      setReviewDue(Boolean(list.reviewDue));
      setSuggestions((sug.suggestions as DiagnosisSuggestion[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the diagnosis list');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(() => rows.filter((r) => isCurrentStatus(r.status)), [rows]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (history) setHistory(((await call(`${base}/history`)).history as DiagnosisHistoryDto[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return COMMON_ICD10_CATALOG.filter(
      (c) => c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query]);

  const add = (code: string, description: string) =>
    run(async () => {
      await call(base, { method: 'POST', body: JSON.stringify({ action: 'add', code, description }) });
      setQuery('');
      setTypedDescription('');
      setAdding(false);
    });

  const patch = (dxId: string, body: Record<string, unknown>) =>
    run(() => call(`${base}/${dxId}`, { method: 'PATCH', body: JSON.stringify(body) }));

  const move = (index: number, delta: number) => {
    const ids = current.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => call(base, { method: 'POST', body: JSON.stringify({ action: 'reorder', ids }) }));
  };

  const toggleHistory = async () => {
    if (history) return setHistory(null);
    try {
      setHistory(((await call(`${base}/history`)).history as DiagnosisHistoryDto[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    }
  };

  return (
    <section aria-label={DIAGNOSIS_COPY.title} className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{DIAGNOSIS_COPY.title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {reviewDue && <span className={`${pill} bg-amber-100 text-amber-800`}>{DIAGNOSIS_PILLS.reviewDue}</span>}
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => call(base, { method: 'POST', body: JSON.stringify({ action: 'review' }) }))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {DIAGNOSIS_COPY.reviewedNoChange}
            </button>
          )}
          <button
            type="button"
            onClick={toggleHistory}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {DIAGNOSIS_COPY.history}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
            >
              {DIAGNOSIS_COPY.addDiagnosis}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {suggestions.length > 0 && canEdit && (
        <ul className="mt-3 space-y-1 rounded-lg bg-blue-50 p-2 text-sm">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span>
                <strong>{s.code}</strong> {s.description}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-blue-300 px-2 py-0.5 hover:bg-white"
                  onClick={() =>
                    run(() => call(`${base}/suggestions`, { method: 'PATCH', body: JSON.stringify({ suggestionId: s.id, action: 'accept' }) }))
                  }
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-slate-300 px-2 py-0.5 hover:bg-white"
                  onClick={() =>
                    run(() => call(`${base}/suggestions`, { method: 'PATCH', body: JSON.stringify({ suggestionId: s.id, action: 'dismiss' }) }))
                  }
                >
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding && canEdit && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={DIAGNOSIS_COPY.searchPlaceholder}
            aria-label={DIAGNOSIS_COPY.searchPlaceholder}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {matches.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {matches.map((m) => (
                <li key={m.code}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => add(m.code, m.description)}
                    className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <strong>{m.code}</strong>
                    <span>{m.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && matches.length === 0 && (
            <div className="mt-2 flex gap-2">
              <input
                value={typedDescription}
                onChange={(e) => setTypedDescription(e.target.value)}
                placeholder="Description"
                aria-label="Description"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || !typedDescription.trim()}
                onClick={() => add(query, typedDescription)}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {DIAGNOSIS_COPY.addDiagnosis}
              </button>
            </div>
          )}
        </div>
      )}

      {current.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{DIAGNOSIS_COPY.empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {current.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <strong className="w-20">{r.code}</strong>
              <span className="min-w-0 flex-1">{r.description}</span>
              {r.isPrimary && <span className={`${pill} bg-emerald-100 text-emerald-800`}>{DIAGNOSIS_PILLS.primary}</span>}
              <span className={`${pill} bg-slate-100 text-slate-700`}>{DIAGNOSIS_STATUS_LABELS[r.status]}</span>
              {r.needsCoding && <span className={`${pill} bg-amber-100 text-amber-800`}>{DIAGNOSIS_PILLS.needsCoding}</span>}
              {canEdit && (
                <span className="flex items-center gap-1">
                  <button type="button" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} className="px-1 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Move down" disabled={busy || i === current.length - 1} onClick={() => move(i, 1)} className="px-1 disabled:opacity-30">↓</button>
                  {!r.isPrimary && (
                    <button type="button" disabled={busy} onClick={() => patch(r.id, { isPrimary: true })} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50">
                      Make primary
                    </button>
                  )}
                  <select
                    aria-label={`Change status for ${r.code}`}
                    disabled={busy}
                    value={r.status}
                    onChange={(e) => patch(r.id, { status: e.target.value as DiagnosisStatus })}
                    className="rounded border border-slate-300 px-1 py-0.5"
                  >
                    {(Object.keys(DIAGNOSIS_STATUS_LABELS) as DiagnosisStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {DIAGNOSIS_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {history && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h4 className="text-sm font-semibold text-slate-800">{DIAGNOSIS_COPY.history}</h4>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString()} · {h.action.replace(/_/g, ' ').toLowerCase()}
                {h.code ? ` · ${h.code}` : ''}
                {h.fromStatus || h.toStatus ? ` · ${h.fromStatus ?? '—'} → ${h.toStatus ?? '—'}` : ''}
                {h.actorName ? ` · ${h.actorName}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default DiagnosisListPanel;
