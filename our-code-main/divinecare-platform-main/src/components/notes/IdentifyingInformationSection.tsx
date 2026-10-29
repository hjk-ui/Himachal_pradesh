'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { clinicDate } from '@/lib/workflows/dates';
import { requiredNoteSectionsNotice } from '@/lib/notes/notes-policy';
import {
  changedSinceLastEvaluation,
  IDENTIFYING_INFORMATION_HEADING,
  IDENTIFYING_LOADING,
  IDENTIFYING_LOAD_FAILED,
  ROLE_CANNOT_EDIT_CHART,
  SOURCE_TAGS,
  UPDATE_CHART_BODY,
  UPDATE_CHART_BUTTON,
  UPDATE_CHART_DONE,
  UPDATE_CHART_FAILED,
  UPDATE_CHART_SAVING,
  UPDATE_CHART_TITLE,
} from '@/lib/identifying-info/copy';
import {
  ageInYears,
  formatIdentifyingSection,
  hasIdentifyingInformation,
  IDENTIFYING_FIELDS,
  isBlank,
  isReEvalNoteType,
  isTelehealthModality,
} from '@/lib/identifying-info/fields';
import {
  chartUpdateCandidates,
  diffSinceLastEvaluation,
  resolvePrefill,
} from '@/lib/identifying-info/prefill';
import { identifyingSignIssues } from '@/lib/identifying-info/signIssues';
import type {
  IdentifyingFieldKey,
  IdentifyingInfoPayload,
  IdentifyingState,
  IdentifyingValues,
  SignIssue,
} from '@/lib/identifying-info/types';

export type IdentifyingInformationChange = IdentifyingState & {
  /** Note-body section text (blank fields omitted; '' when nothing is filled in). */
  text: string;
  issues: SignIssue[];
};

export type IdentifyingInformationSectionProps = {
  clientId: string;
  noteType: string | null | undefined;
  /** The visit this note is for — supplies the booked modality. */
  appointmentId?: string | null;
  /** Values already saved on this note (win over every other source). */
  draft?: IdentifyingValues | null;
  /** AI Scribe suggestions the clinician has reviewed. Note-only; never written to the chart. */
  scribe?: IdentifyingValues | null;
  onChange?: (change: IdentifyingInformationChange) => void;
};

function formatDisplayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CONTROL =
  'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-500';

export function IdentifyingInformationSection({
  clientId,
  noteType,
  appointmentId,
  draft,
  scribe,
  onChange,
}: IdentifyingInformationSectionProps) {
  const applies = hasIdentifyingInformation(noteType);
  const idBase = useId();
  const today = useMemo(() => clinicDate(), []);

  const [payload, setPayload] = useState<IdentifyingInfoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [state, setState] = useState<IdentifyingState>({ values: {}, sources: {} });
  const [chartBusy, setChartBusy] = useState(false);
  const [chartMessage, setChartMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Latest draft / scribe without re-running the load effect when parents re-render.
  const draftRef = useRef(draft);
  const scribeRef = useRef(scribe);
  useEffect(() => {
    draftRef.current = draft;
    scribeRef.current = scribe;
  }, [draft, scribe]);

  useEffect(() => {
    if (!applies) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    const qs = appointmentId ? `?appointmentId=${encodeURIComponent(appointmentId)}` : '';
    fetch(`/api/clients/${encodeURIComponent(clientId)}/identifying-info${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.success === false) throw new Error('load failed');
        return data as IdentifyingInfoPayload & { success: true };
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setState(
          resolvePrefill({
            chart: data.chart,
            vitals: data.vitals,
            prior: data.prior,
            visit: data.visit,
            draft: draftRef.current,
            scribe: scribeRef.current,
            today,
          })
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPayload(null);
        setLoadFailed(true);
        // Nothing to prefill from the chart — still honour the draft the clinician saved.
        setState(resolvePrefill({ draft: draftRef.current, scribe: scribeRef.current, today }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applies, clientId, appointmentId, today]);

  // Newly reviewed AI Scribe suggestions fill blanks only.
  useEffect(() => {
    if (!applies || !scribe) return;
    setState((prev) => {
      const values = { ...prev.values };
      const sources = { ...prev.sources };
      let changed = false;
      for (const [key, raw] of Object.entries(scribe) as [IdentifyingFieldKey, string][]) {
        if (key === 'age' || isBlank(raw) || !isBlank(values[key])) continue;
        values[key] = raw.trim();
        sources[key] = 'scribe';
        changed = true;
      }
      return changed ? { values, sources } : prev;
    });
  }, [applies, scribe]);

  const ageYears = useMemo(
    () => ageInYears(payload?.chart.dateOfBirth ?? null, today),
    [payload?.chart.dateOfBirth, today]
  );

  const issues = useMemo(
    () => identifyingSignIssues({ noteType, values: state.values, ageYears, today }),
    [noteType, state.values, ageYears, today]
  );

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!applies || loading) return;
    onChangeRef.current?.({
      ...state,
      text: formatIdentifyingSection(state.values),
      issues,
    });
  }, [applies, loading, state, issues]);

  const setValue = useCallback((key: IdentifyingFieldKey, value: string) => {
    setState((prev) => {
      const values = { ...prev.values };
      const sources = { ...prev.sources };
      if (isBlank(value)) delete values[key];
      else values[key] = value;
      // Once the clinician edits a value it is theirs — the source tag goes away.
      delete sources[key];
      return { values, sources };
    });
  }, []);

  const reEval = isReEvalNoteType(noteType);
  const changes = useMemo(
    () => (reEval ? diffSinceLastEvaluation(state.values, payload?.prior) : []),
    [reEval, state.values, payload?.prior]
  );

  const chartCandidates = useMemo(
    () => (payload ? chartUpdateCandidates(state, payload.chart) : {}),
    [payload, state]
  );
  const hasChartCandidates = Object.keys(chartCandidates).length > 0;

  const updateChart = async () => {
    if (!payload || chartBusy) return;
    setChartBusy(true);
    setChartMessage(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/identifying-info`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: chartCandidates, sources: state.sources }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        throw new Error(typeof data?.error === 'string' ? data.error : UPDATE_CHART_FAILED);
      }
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              chart: {
                ...prev.chart,
                namePrefix: chartCandidates.title ?? prev.chart.namePrefix,
                gender: chartCandidates.genderIdentity ?? prev.chart.gender,
              },
            }
          : prev
      );
      setChartMessage({ tone: 'ok', text: UPDATE_CHART_DONE });
    } catch (err) {
      setChartMessage({ tone: 'error', text: err instanceof Error ? err.message : UPDATE_CHART_FAILED });
    } finally {
      setChartBusy(false);
    }
  };

  if (!applies) return null;

  const telehealth = isTelehealthModality(state.values.visitModality);
  const issueByField = new Map(issues.map((i) => [i.fieldKey, i]));

  return (
    <section
      aria-labelledby={`${idBase}-heading`}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <h3 id={`${idBase}-heading`} className="text-sm font-semibold text-slate-900">
        {IDENTIFYING_INFORMATION_HEADING}
      </h3>

      {loading ? (
        <p className="mt-2 text-[12px] text-slate-500" role="status">
          {IDENTIFYING_LOADING}
        </p>
      ) : null}
      {loadFailed ? <p className="mt-2 text-[12px] text-amber-700">{IDENTIFYING_LOAD_FAILED}</p> : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {IDENTIFYING_FIELDS.map((field) => {
          if (field.telehealthOnly && !telehealth) return null;
          const id = `${idBase}-${field.key}`;
          const value = state.values[field.key] ?? '';
          const source = state.sources[field.key];
          const issue = issueByField.get(field.key);
          const change = changes.find((c) => c.key === field.key);
          const wide = field.input === 'textarea';

          return (
            <div key={field.key} className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
              <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-[12px] font-medium text-slate-700">
                <span>{field.label}</span>
                {source ? <span className="text-[11px] font-normal text-slate-500">{SOURCE_TAGS[source]}</span> : null}
              </label>

              {field.input === 'select' ? (
                <select
                  id={id}
                  value={value}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  aria-invalid={issue ? true : undefined}
                  className={`${CONTROL} mt-1`}
                >
                  <option value=""> </option>
                  {field.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {value && !field.options!.some((o) => o.value === value) ? (
                    <option value={value}>{value}</option>
                  ) : null}
                </select>
              ) : field.input === 'textarea' ? (
                <textarea
                  id={id}
                  rows={3}
                  value={value}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  aria-invalid={issue ? true : undefined}
                  className={`${CONTROL} mt-1 h-auto min-h-20 py-2`}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  value={value}
                  readOnly={field.input === 'readonly'}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  aria-invalid={issue ? true : undefined}
                  className={`${CONTROL} mt-1 ${field.input === 'readonly' ? 'bg-slate-50' : ''}`}
                />
              )}

              {change ? (
                <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
                  {changedSinceLastEvaluation(formatDisplayDate(change.date), change.was)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {issues.length > 0 ? (
        <div className="mt-3 space-y-1.5" role="status">
          {issues.map((issue) => (
            <p
              key={issue.code}
              className={`rounded-lg px-3 py-2 text-[12px] ${
                issue.severity === 'block' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {issue.message}
            </p>
          ))}
          <p className="text-[11px] text-slate-500">{requiredNoteSectionsNotice()}</p>
        </div>
      ) : null}

      {payload && (hasChartCandidates || chartMessage) ? (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-[13px] font-semibold text-violet-900">{UPDATE_CHART_TITLE}</p>
          {hasChartCandidates ? (
            <>
              <p className="mt-1 text-[12px] text-violet-900/80">{UPDATE_CHART_BODY}</p>
              {payload.canUpdateChart ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-2"
                  loading={chartBusy}
                  onClick={() => void updateChart()}
                >
                  {chartBusy ? UPDATE_CHART_SAVING : UPDATE_CHART_BUTTON}
                </Button>
              ) : (
                <p className="mt-2 text-[12px] font-medium text-violet-900">{ROLE_CANNOT_EDIT_CHART}</p>
              )}
            </>
          ) : null}
          {chartMessage ? (
            <p
              role="status"
              className={`mt-2 text-[12px] ${chartMessage.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
            >
              {chartMessage.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
