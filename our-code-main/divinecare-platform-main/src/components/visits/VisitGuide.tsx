'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ExternalLink, AlertTriangle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  GUIDE_LEVEL_LABELS,
  GUIDE_PHASE_LABELS,
  GUIDE_TAB_LABELS,
  type GuidePhase,
  type GuideTab,
} from '@/lib/visits/guide-catalog';
import type { ChecklistItemState, VisitGuidePayload } from '@/lib/visits/resolve-guide';
import type { EnrichedBrief } from '@/lib/previsit/enrichedBrief';

type Props = {
  /** Legacy label or VisitKindId */
  visitType?: string;
  kind?: string;
  clientId?: string | null;
  appointmentId?: string | null;
  /** Local missing fields shown as sign-time warnings (non-blocking) */
  missing?: string[];
  antipsychotic?: boolean;
  telehealth?: boolean;
  className?: string;
};

const TABS: GuideTab[] = ['brief', 'checklist', 'due', 'requirements'];
const PHASES: GuidePhase[] = ['prepare', 'during', 'wrap_up'];

function levelChipClass(level: ChecklistItemState['level']): string {
  if (level === 'required') return 'bg-rose-50 text-rose-800 ring-rose-200';
  if (level === 'recommended') return 'bg-amber-50 text-amber-900 ring-amber-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

function OfflineGuide({ visitType, missing }: { visitType: string; missing: string[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Visit guide · {visitType || 'Visit'}</h2>
        <p className="text-xs text-slate-500">Checklist does not hard-block signing</p>
      </div>
      {missing.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {missing.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Sign-time warning: {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-emerald-800">No local sign-time warnings.</p>
      )}
    </section>
  );
}

export function VisitGuide({
  visitType = '',
  kind,
  clientId,
  appointmentId,
  missing = [],
  antipsychotic,
  telehealth,
  className = '',
}: Props) {
  const resolvedKind = kind || visitType;
  const [tab, setTab] = useState<GuideTab>('checklist');
  const [guide, setGuide] = useState<VisitGuidePayload | null>(null);
  const [enrichedBrief, setEnrichedBrief] = useState<EnrichedBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!resolvedKind && !clientId && !appointmentId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (clientId) qs.set('clientId', clientId);
      if (appointmentId) qs.set('appointmentId', appointmentId);
      if (resolvedKind) qs.set('kind', resolvedKind);
      if (antipsychotic) qs.set('antipsychotic', '1');
      if (telehealth !== undefined) qs.set('telehealth', telehealth ? '1' : '0');
      const res = await apiJson<{
        success: boolean;
        guide?: VisitGuidePayload;
        enrichedBrief?: EnrichedBrief | null;
        error?: string;
      }>(`/api/visits/guide?${qs.toString()}`);
      if (!res.success || !res.guide) {
        setError(res.error || 'Unable to load visit guide');
        setGuide(null);
        setEnrichedBrief(null);
        return;
      }
      setGuide(res.guide);
      setEnrichedBrief(res.enrichedBrief ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load visit guide');
      setGuide(null);
    } finally {
      setLoading(false);
    }
  }, [resolvedKind, clientId, appointmentId, antipsychotic, telehealth]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleStep = async (step: ChecklistItemState) => {
    if (!clientId || !guide) return;
    setSavingKey(step.key);
    try {
      const res = await apiJson<{ success: boolean; guide?: VisitGuidePayload; error?: string }>(
        '/api/visits/guide',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            appointmentId: appointmentId || null,
            kind: guide.kind,
            stepKey: step.key,
            done: !step.done,
          }),
        }
      );
      if (res.success && res.guide) setGuide(res.guide);
    } finally {
      setSavingKey(null);
    }
  };

  if (!resolvedKind && !clientId) {
    return <OfflineGuide visitType={visitType || 'Visit'} missing={missing} />;
  }

  if (error && !guide) {
    return <OfflineGuide visitType={visitType || resolvedKind || 'Visit'} missing={missing} />;
  }

  const signWarnings = [
    ...(guide?.signWarnings || []),
    ...missing.map((m) => `Sign-time warning: ${m}`),
  ];

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      data-testid="visit-guide"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Visit guide · {guide?.label || visitType || 'Visit'}
          </h2>
          <p className="text-xs text-slate-500">
            Non-blocking bedside checklist — incomplete required steps warn at sign time only
          </p>
        </div>
        {guide?.part2 ? (
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200">
            Part 2
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {GUIDE_TAB_LABELS[t]}
            {t === 'due' && guide?.due.length ? (
              <span className="ml-1 tabular-nums opacity-80">({guide.due.length})</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        {loading && !guide ? (
          <p className="text-sm text-slate-500">Loading visit guide…</p>
        ) : null}

        {tab === 'brief' && guide ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{guide.brief.summary}</p>
            {enrichedBrief ? (
              <div className="space-y-2" data-testid="enriched-brief">
                {enrichedBrief.emptyMessage ? (
                  <p className="text-sm text-slate-600">{enrichedBrief.emptyMessage}</p>
                ) : (
                  enrichedBrief.sections
                    .filter((s) => s.items.length > 0)
                    .map((s) => (
                      <div key={s.key}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</p>
                        <ul className="mt-1 space-y-0.5">
                          {s.items.map((item, i) => (
                            <li key={`${s.key}-${i}`} className="text-sm text-slate-800">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                )}
                <p className="text-xs text-slate-500">Chart history: {enrichedBrief.chartHistoryStatus}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Example CPT / HCPCS
              </p>
              {guide.brief.cpt.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">
                  {guide.kind === 'prp'
                    ? 'None on file until PRP billing model is confirmed'
                    : 'None on file'}
                </p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {guide.brief.cpt.map((code) => (
                    <li
                      key={code}
                      className="rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800 ring-1 ring-slate-200"
                    >
                      {code}
                      {code === '99212' ? (
                        <span className="ml-1 font-sans text-[10px] text-amber-700">no fee</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'checklist' && guide ? (
          <div className="space-y-4">
            {PHASES.map((phase) => {
              const items = guide.checklist.filter((c) => c.phase === phase);
              if (!items.length) return null;
              return (
                <div key={phase}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {GUIDE_PHASE_LABELS[phase]}
                  </p>
                  <ul className="space-y-2">
                    {items.map((step) => (
                      <li
                        key={step.key}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                      >
                        <button
                          type="button"
                          disabled={!clientId || savingKey === step.key}
                          onClick={() => void toggleStep(step)}
                          className="shrink-0 text-slate-700 disabled:opacity-40"
                          aria-label={step.done ? `Mark ${step.label} not done` : `Mark ${step.label} done`}
                        >
                          {step.done ? (
                            <CheckCircle2 size={18} className="text-emerald-600" />
                          ) : (
                            <Circle size={18} className="text-slate-400" />
                          )}
                        </button>
                        <span className={`text-sm ${step.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                          {step.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${levelChipClass(step.level)}`}
                        >
                          {GUIDE_LEVEL_LABELS[step.level]}
                        </span>
                        {step.href ? (
                          <Link
                            href={step.href}
                            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                          >
                            Open <ExternalLink size={12} />
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === 'due' && guide ? (
          <div>
            {guide.due.length === 0 ? (
              <p className="text-sm text-emerald-800">Nothing due for this visit.</p>
            ) : (
              <ul className="space-y-2">
                {guide.due.map((step) => (
                  <li key={step.key} className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {step.label}{' '}
                      <span className="text-xs text-amber-700">({GUIDE_LEVEL_LABELS[step.level]})</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'requirements' && guide ? (
          <ul className="space-y-2">
            {guide.requirements.map((req) => (
              <li key={req.id} className="rounded-xl border border-slate-100 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{req.label}</p>
                  {req.badge ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                        req.status === 'confirmed'
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : 'bg-amber-50 text-amber-900 ring-amber-200'
                      }`}
                    >
                      {req.badge}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                      Open — none on file
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{req.detail}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {signWarnings.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2">
            <p className="text-xs font-semibold text-amber-900">Sign-time warnings (not blocking)</p>
            <ul className="mt-1 space-y-0.5">
              {signWarnings.map((w) => (
                <li key={w} className="text-xs text-amber-800">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : guide ? (
          <p className="mt-4 text-xs text-emerald-700">No sign-time warnings for required steps.</p>
        ) : null}
      </div>
    </section>
  );
}
