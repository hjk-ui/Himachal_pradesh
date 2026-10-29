'use client';

/**
 * Pre-visit brief panel: bullets + source label + the chart facts it used (expandable) + Refresh.
 * Data: GET /api/clients/[id]/previsit-brief (cached per day), POST to rebuild.
 * Decision support only — the label always tells the clinician to verify against the chart.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ClipboardList, FileText, Loader2, RefreshCw, ScanSearch, ShieldAlert, Sparkles } from 'lucide-react';
import { PROGRAM_META } from '@/lib/clinical/serviceEligibility/criteria';
import { PROGRAMS, type EligibilityStatus } from '@/lib/clinical/serviceEligibility/types';
import { activeDecision, inTier, type DecisionState } from '@/lib/clinical/serviceEligibility/view';
import { ChartHistoryCard } from '@/components/ai/ChartHistoryCard';

export type PreVisitBriefData = {
  clientId: string;
  forDate: string;
  audience: 'therapist' | 'prescriber' | 'primary_care';
  source: 'ai' | 'rules';
  bullets: string[];
  /** Each fact with its source label (chart section / record) */
  factLines: { section: string; text: string; source?: string }[];
  /** Signed notes / imported note documents cited by the brief */
  links?: { label: string; href: string }[];
  generatedAt: string;
  model: string | null;
  fallbackReason: string | null;
  droppedCount: number;
  aiConsent: 'signed' | 'missing' | 'declined';
  cached: boolean;
};

const FALLBACK_TEXT: Record<string, string> = {
  ai_not_configured: 'AI is not configured on this server.',
  ai_consent_declined: 'The client declined AI Note Drafting consent, so nothing was sent to AI.',
  protected_record: 'Protected record (42 CFR Part 2): nothing was sent to AI.',
  ai_failed: 'The AI service did not respond.',
  ai_output_rejected: 'The AI summary did not match the chart facts and was discarded.',
};

export function usePreVisitBrief(clientId: string | null | undefined, autoLoad: boolean) {
  const [brief, setBrief] = useState<PreVisitBriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!clientId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/previsit-brief`, { method: refresh ? 'POST' : 'GET', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.brief) {
          setError(data.error || `Could not load the pre-visit brief (${res.status})`);
          return;
        }
        setBrief(data.brief as PreVisitBriefData);
      } catch {
        setError('Could not reach the pre-visit brief service.');
      } finally {
        setLoading(false);
      }
    },
    [clientId]
  );

  useEffect(() => {
    if (autoLoad) void load(false);
  }, [autoLoad, load]);

  return { brief, error, loading, load };
}

export function PreVisitBriefSourceLabel({ brief }: { brief: PreVisitBriefData }) {
  if (brief.source === 'ai') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold text-[#5C2D91]">
        <Sparkles size={11} aria-hidden /> AI-generated from chart facts — verify
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
      <ClipboardList size={11} aria-hidden /> Rule-based summary from chart facts (no AI)
    </span>
  );
}

/**
 * Service Eligibility Scanner suggestions for this client (stored nightly / on-demand snapshot),
 * open items only (dismissed / snoozed hidden). Renders nothing when the viewer cannot use the
 * scanner, the record is protected, or there is nothing to suggest.
 */
export function ScannerSuggestions({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<{ label: string; status: EligibilityStatus }[] | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/ehr/scanner/service-eligibility/${encodeURIComponent(clientId)}?summary=1`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.success || !j.statuses) return;
        const now = new Date();
        const row = { decisions: (j.decisions ?? {}) as Record<string, DecisionState> };
        // Actionable tier only (diagnosis-only / needs-data suggestions stay on the scanner page)
        const out = PROGRAMS.filter((p) => ['candidate', 'potential', 'review'].includes(j.statuses[p]) && inTier(j.statuses[p], (j.gaps?.[p] ?? []).length, 'actionable'))
          .filter((p) => {
            const d = activeDecision(row, p, now);
            return !d || d.action === 'accepted';
          })
          .map((p) => ({ label: PROGRAM_META[p].label, status: j.statuses[p] as EligibilityStatus }));
        setItems(out);
        setScannedAt(j.scannedAt);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clientId]);
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-purple-100 bg-purple-50/60 px-2.5 py-1.5 text-[11px] text-slate-700">
      <ScanSearch size={12} className="text-[#5C2D91]" aria-hidden />
      <span className="font-semibold text-[#5C2D91]">Program screening:</span>
      {items.map((i) => (
        <span key={i.label} className="rounded-full border border-purple-200 bg-white px-2 py-0.5 font-semibold">
          {i.label} · {i.status === 'review' ? 'review' : i.status}
        </span>
      ))}
      <Link href={`/dashboard/ehr/scanner?clientId=${encodeURIComponent(clientId)}`} className="font-semibold text-[#5C2D91] hover:underline">
        Criteria &amp; evidence
      </Link>
      {scannedAt ? <span className="text-slate-400">scanned {scannedAt.slice(0, 10)}</span> : null}
    </div>
  );
}

export function PreVisitBriefBody({
  brief,
  loading,
  error,
  onRefresh,
}: {
  brief: PreVisitBriefData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [showFacts, setShowFacts] = useState(false);
  if (error && !brief) {
    return (
      <p className="flex items-start gap-1.5 text-xs font-semibold text-rose-700">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> {error}
      </p>
    );
  }
  if (!brief) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
        {loading ? 'Building the brief from chart facts…' : 'No brief loaded.'}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PreVisitBriefSourceLabel brief={brief} />
        {brief.audience === 'prescriber' ? <span className="text-[11px] font-medium text-slate-500">Prescriber view (medications and labs first)</span> : null}
        {brief.audience === 'primary_care' ? <span className="text-[11px] font-medium text-slate-500">Primary care view (labs included)</span> : null}
      </div>
      <ul className="space-y-1.5">
        {brief.bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-800">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5C2D91]" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {brief.links?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-slate-500">Notes cited:</span>
          {brief.links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0 font-semibold text-slate-600 hover:border-[#5C2D91] hover:text-[#5C2D91]">
              <FileText size={10} aria-hidden /> {l.label}
            </a>
          ))}
        </div>
      ) : null}
      <ScannerSuggestions clientId={brief.clientId} />
      {/* Hidden for roles without BH chart-note access (the API answers 403 and the card renders nothing) */}
      <ChartHistoryCard clientId={brief.clientId} />
      {brief.fallbackReason && FALLBACK_TEXT[brief.fallbackReason] ? (
        <p className="text-[11px] text-slate-500">{FALLBACK_TEXT[brief.fallbackReason]}</p>
      ) : null}
      {brief.source === 'ai' && brief.droppedCount > 0 ? (
        <p className="text-[11px] text-slate-500">{brief.droppedCount} AI sentence(s) not backed by chart facts were removed.</p>
      ) : null}
      {error ? <p className="text-[11px] font-semibold text-rose-700">{error}</p> : null}
      <div>
        <button
          type="button"
          onClick={() => setShowFacts((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:underline"
          aria-expanded={showFacts}
        >
          {showFacts ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          Chart facts used ({brief.factLines.length})
        </button>
        {showFacts ? (
          <dl className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
            {brief.factLines.map((f, i) => (
              <div key={i} className="grid grid-cols-[8.5rem_1fr] gap-2">
                <dt className="font-semibold text-slate-500">{f.section}</dt>
                <dd className="text-slate-700">
                  {f.text}
                  {f.source ? <span className="ml-1 text-[10px] text-slate-400">[{f.source}]</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <span className="text-[11px] text-slate-500">
          For {brief.forDate} · built {new Date(brief.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {brief.cached ? ' (cached)' : ''}. Decision support only — confirm in the chart.
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden /> Refresh
        </button>
      </div>
    </div>
  );
}
