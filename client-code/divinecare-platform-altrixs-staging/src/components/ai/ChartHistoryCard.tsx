'use client';

/**
 * "Chart history" card in the pre-visit brief: AI-extracted, cited facts from prior chart documents
 * (Valant imports, scans) and signed notes. Every bullet links to its source document at the cited
 * page. Data: GET /api/clients/[id]/chart-digest; "Regenerate" = POST (care-team clinicians).
 * variant="panel": the in-session "Chart history" side tab (note editor side panel, telehealth
 * in-call drawer), fetched only when the tab is opened, cached per client for the page session.
 * kind="medical": the primary-care "Medical history" digest (GET ?kind=medical): live record facts
 * plus AI document facts, audience-first (the medical assistant receives only allergies,
 * medications, vitals and preventive care due from the API).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileText, History, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { chartHistoryPanelSections, medicalHistoryPanelSections } from '@/lib/ai/chartDigest/panelOrder';
import { chartHistoryEmptyState } from '@/lib/ai/chartDigest/emptyState';

type Cite = { source: string; page: number | null; date: string; quote: string };
type Item = { text: string; date: string | null; kind: string | null; cites: Cite[]; part2?: boolean };
type Trial = { drug: string; doses: string[]; start: string | null; end: string | null; response: string | null; reasonStopped: string | null; sideEffects: string[]; cites: Cite[]; part2?: boolean };
type Digest = Record<string, unknown> & {
  medicationTrials: Trial[];
  lastRiskAssessment: Item | null;
  safetyPlan: Item | null;
  sources: Record<string, { date: string; label: string; part2: boolean; pageCount: number }>;
  hasPart2: boolean;
};
type PreventiveDue = { key: string; label: string; status: 'due' | 'overdue' | 'met'; lastDate: string | null; nextDue: string | null };
type View = {
  kind?: 'bh' | 'medical';
  audience?: 'provider' | 'ma';
  aiGenerated?: boolean;
  digest: (Digest & { preventiveDue?: PreventiveDue[] }) | null;
  version: number | null;
  status: string | null;
  generatedAt: string | null;
  stale: boolean;
  staleReason: string;
  canRegenerate: boolean;
  part2Withheld: boolean;
  /** Empty-state inputs (GET /chart-digest): a visit in the next 7 days, nightly prep job enabled */
  upcomingVisitWithin7Days?: boolean;
  nightlyPrepEnabled?: boolean;
};

/** "Will be prepared before the next visit" / "Not generated yet." (src/lib/ai/chartDigest/emptyState.ts) */
function emptyText(view: View): string {
  return chartHistoryEmptyState({ upcomingVisitWithin7Days: Boolean(view.upcomingVisitWithin7Days), nightlyPrepEnabled: Boolean(view.nightlyPrepEnabled), canGenerate: view.canRegenerate }).text;
}

const SECTIONS: Array<[string, string]> = [
  ['riskHistory', 'Risk history'],
  ['diagnoses', 'Diagnosis history'],
  ['hospitalizations', 'Hospitalizations / ER / residential'],
  ['substanceUse', 'Substance use'],
  ['therapy', 'Therapy: modalities, goals, progress'],
  ['socialFunctional', 'Legal / social / functional'],
  ['trauma', 'Trauma (summary)'],
  ['medical', 'Allergies / medical (prescribing)'],
  ['openItems', 'Open items from the last visit'],
];

const STALE_TEXT: Record<string, string> = {
  never_generated: 'Not generated yet.',
  sources_changed: 'New or changed chart documents since this was generated.',
  pending_text: 'Some scanned documents were still being read; regenerate to include them.',
  failed: 'The last generation failed.',
};

function trialText(t: Trial) {
  const p = [t.drug + (t.doses.length ? ` ${t.doses.join(' / ')}` : '')];
  if (t.start || t.end) p.push(`${t.start ?? '?'} – ${t.end ?? 'current / unknown'}`);
  if (t.response) p.push(`response: ${t.response}`);
  if (t.reasonStopped) p.push(`stopped: ${t.reasonStopped}`);
  if (t.sideEffects.length) p.push(`side effects: ${t.sideEffects.join(', ')}`);
  return p.join('; ');
}

function Citations({ cites, sources, links }: { cites: Cite[]; sources: Digest['sources']; links: Record<string, string | null> }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {cites.map((c, i) => {
        const src = sources[c.source];
        const label = `${src?.label ?? 'Source'} ${c.date}${c.page ? ` p.${c.page}` : ''}`;
        const base = links[c.source];
        const href = base ? (c.source.startsWith('doc:') && c.page ? `${base}#page=${c.page}` : base) : null;
        const cls = 'inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0 text-[10px] font-semibold text-slate-600';
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" title={`“${c.quote}”`} className={`${cls} hover:border-[#5C2D91] hover:text-[#5C2D91]`}>
            <FileText size={10} aria-hidden /> {label}
          </a>
        ) : (
          <span key={i} title={`“${c.quote}”`} className={cls}>
            <FileText size={10} aria-hidden /> {label}
          </span>
        );
      })}
    </span>
  );
}

function Bullet({ text, date, part2, children }: { text: string; date: string | null; part2?: boolean; children: ReactNode }) {
  return (
    <li className="text-xs leading-relaxed text-slate-700">
      {date ? <span className="mr-1 font-semibold text-slate-500">{date}</span> : null}
      {text}
      {part2 ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">Part 2</span> : null}
      {children}
    </li>
  );
}

/** Last GET / POST payload per client for one page session. The host owns it (never module-global, so never shared across users). */
export type ChartDigestPayload = { view: View; links: Record<string, string | null>; label: string | null; part2Notice: string | null; kinds?: string[] };
export type ChartDigestCache = Map<string, ChartDigestPayload>;
export function createChartDigestCache(): ChartDigestCache {
  return new Map();
}

/**
 * Loads the digest through the audited GET /api/clients/[id]/chart-digest (no other read path);
 * POST regenerates. A payload cached for this client in this page session is shown without refetching.
 * 403 on the GET calls onDenied so the host can hide the tab / card.
 */
function useChartDigest(clientId: string, opts: { kind: 'bh' | 'medical'; cache?: ChartDigestCache; onDenied?: () => void; onKinds?: (kinds: string[]) => void }) {
  const { cache, onDenied, kind, onKinds } = opts;
  const cacheKey = kind === 'medical' ? `medical:${clientId}` : clientId;
  const cached = cache?.get(cacheKey) ?? null;
  const [view, setView] = useState<View | null>(cached?.view ?? null);
  const [links, setLinks] = useState<Record<string, string | null>>(cached?.links ?? {});
  const [label, setLabel] = useState(cached?.label ?? 'AI-generated from chart documents — verify before relying on it');
  const [part2Notice, setPart2Notice] = useState<string | null>(cached?.part2Notice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);
  const onDeniedRef = useRef(onDenied);
  const onKindsRef = useRef(onKinds);
  useEffect(() => {
    onDeniedRef.current = onDenied;
    onKindsRef.current = onKinds;
  }, [onDenied, onKinds]);

  const load = useCallback(
    async (regenerate: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/chart-digest?kind=${kind}`, { method: regenerate ? 'POST' : 'GET', cache: 'no-store' });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.success) {
          // 403 (role / care team / protected record) or 404 (not a primary-care patient): hide the tab
          if ((res.status === 403 || (kind === 'medical' && res.status === 404)) && !regenerate) {
            setView(null);
            cache?.delete(cacheKey);
            onDeniedRef.current?.();
          }
          setError(j?.error ?? 'Could not load the chart history.');
          return;
        }
        const payload: ChartDigestPayload = { view: j.view, links: j.links ?? {}, label: j.label ?? null, part2Notice: j.part2Notice ?? null, kinds: Array.isArray(j.kinds) ? j.kinds : [] };
        onKindsRef.current?.(payload.kinds ?? []);
        cache?.set(cacheKey, payload);
        setView(payload.view);
        setLinks(payload.links);
        if (payload.label) setLabel(payload.label);
        setPart2Notice(payload.part2Notice);
      } catch {
        setError('Could not load the chart history.');
      } finally {
        setLoading(false);
      }
    },
    [clientId, cache, cacheKey, kind]
  );

  useEffect(() => {
    if (cache?.has(cacheKey)) return; // cached for this page session: no refetch on tab switch
    void load(false);
  }, [cache, cacheKey, load]);

  return { view, links, label, part2Notice, error, loading, load };
}

type DigestState = ReturnType<typeof useChartDigest>;

export type ChartHistoryCardProps = {
  clientId: string;
  /** 'card' (pre-visit brief, default) or 'panel' (in-session side tab: collapsible sections, audience-first order) */
  variant?: 'card' | 'panel';
  /** Viewer role: the panel's audience-first section order */
  role?: string | null;
  /** Per-page-session cache (createChartDigestCache) so reopening the tab does not refetch */
  cache?: ChartDigestCache;
  /** GET answered 403: the host hides the tab */
  onDenied?: () => void;
  /** 'bh' (default): behavioral health history; 'medical': primary-care medical history */
  kind?: 'bh' | 'medical';
  /** Digest kinds this viewer may open for this client (from the API), e.g. to add a "Medical history" tab */
  onKinds?: (kinds: string[]) => void;
};

export function ChartHistoryCard({ clientId, variant = 'card', role, cache, onDenied, kind = 'bh', onKinds }: ChartHistoryCardProps) {
  const state = useChartDigest(clientId, { kind, cache, onDenied, onKinds });
  if (kind === 'medical') return <MedicalHistoryBody state={state} role={role ?? null} framed={variant === 'card'} />;
  if (variant === 'panel') return <ChartHistoryPanelBody state={state} role={role ?? null} />;
  return <ChartHistoryCardBody state={state} />;
}

function ChartHistoryCardBody({ state }: { state: DigestState }) {
  const { view, links, label, part2Notice, error, loading, load } = state;
  const [open, setOpen] = useState(true);

  if (!view && !loading && error) return null; // role / access: the card is simply not shown
  const d = view?.digest ?? null;
  const sources = d?.sources ?? {};
  const itemList = (k: string) => ((d?.[k] as Item[] | undefined) ?? []);
  const total = d ? SECTIONS.reduce((n, [k]) => n + itemList(k).length, 0) + d.medicationTrials.length : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91]" aria-expanded={open}>
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          <History size={13} aria-hidden /> Chart history{d ? ` (${total})` : ''}
        </button>
        {view?.canRegenerate ? (
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} aria-hidden /> {d ? 'Regenerate' : 'Generate'}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] font-semibold text-amber-800">{label}</p>
          {loading && !view ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin" aria-hidden /> Loading chart history…
            </p>
          ) : null}
          {view && !d && view.staleReason === 'never_generated' ? <p className="text-[11px] text-slate-500">{emptyText(view)}</p> : null}
          {view && view.stale && !(view.staleReason === 'never_generated' && !d) ? <p className="text-[11px] text-slate-500">{STALE_TEXT[view.staleReason] ?? 'Out of date.'}</p> : null}
          {view?.part2Withheld ? <p className="text-[11px] text-slate-500">Part 2 information was withheld: the Part 2 consent is no longer active.</p> : null}
          {error ? (
            <p className="flex items-start gap-1 text-[11px] font-semibold text-rose-700">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          ) : null}
          {d ? (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {d.lastRiskAssessment || d.safetyPlan ? (
                <section>
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Last risk assessment / safety plan</h4>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                    {[d.lastRiskAssessment, d.safetyPlan].filter((x): x is Item => Boolean(x)).map((it, i) => (
                      <Bullet key={i} text={it.text} date={it.date} part2={it.part2}>
                        <Citations cites={it.cites} sources={sources} links={links} />
                      </Bullet>
                    ))}
                  </ul>
                </section>
              ) : null}
              {d.medicationTrials.length ? (
                <section>
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Medication trials</h4>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                    {d.medicationTrials.map((t, i) => (
                      <Bullet key={i} text={trialText(t)} date={null} part2={t.part2}>
                        <Citations cites={t.cites} sources={sources} links={links} />
                      </Bullet>
                    ))}
                  </ul>
                </section>
              ) : null}
              {SECTIONS.map(([k, title]) =>
                itemList(k).length ? (
                  <section key={k}>
                    <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h4>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                      {itemList(k).map((it, i) => (
                        <Bullet key={i} text={it.text} date={it.date} part2={it.part2}>
                          <Citations cites={it.cites} sources={sources} links={links} />
                        </Bullet>
                      ))}
                    </ul>
                  </section>
                ) : null
              )}
              {!total ? <p className="text-xs text-slate-500">No cited history was found in the chart documents.</p> : null}
            </div>
          ) : null}
          {part2Notice ? <p className="rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-900">{part2Notice}</p> : null}
          {view?.generatedAt ? (
            <p className="text-[10px] text-slate-400">
              Generated {new Date(view.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {view.status === 'partial' ? ' (partial)' : ''} from {Object.keys(sources).length} source(s).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-slate-100 p-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="h-2.5 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-2.5 w-4/5 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/**
 * In-session side tab body: compact, sections collapsible (native details / summary: keyboard
 * accessible), audience-first order (chartHistoryPanelSections). Citations open the source document
 * at the cited page in a new tab, so the session / note is never navigated away.
 */
function ChartHistoryPanelBody({ state, role }: { state: DigestState; role: string | null }) {
  const { view, links, label, part2Notice, error, loading, load } = state;
  const d = view?.digest ?? null;
  const sources = d?.sources ?? {};
  const sections = chartHistoryPanelSections(role);
  const itemsFor = (k: string): Item[] => {
    if (!d) return [];
    const list = ((d[k] as Item[] | undefined) ?? []).slice();
    if (k === 'riskHistory') {
      const top = [d.lastRiskAssessment, d.safetyPlan].filter((x): x is Item => Boolean(x));
      const seen = new Set(top.map((x) => x.text));
      return [...top, ...list.filter((x) => !seen.has(x.text))];
    }
    return list;
  };
  const countFor = (k: string) => (k === 'medicationTrials' ? d?.medicationTrials.length ?? 0 : itemsFor(k).length);
  const total = d ? sections.reduce((n, s) => n + countFor(s.key), 0) : 0;
  const regen = view?.canRegenerate ? (
    <button
      type="button"
      onClick={() => void load(true)}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      <RefreshCw size={11} className={loading ? 'animate-spin' : ''} aria-hidden /> {d ? 'Regenerate' : 'Generate'}
    </button>
  ) : null;

  return (
    <div className="min-w-0 space-y-2 text-slate-800" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91]">
          <History size={13} aria-hidden /> Chart history{d ? ` (${total})` : ''}
        </p>
        {d ? regen : null}
      </div>
      <p className="text-[11px] font-semibold text-amber-800">{label}</p>
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-[11px] font-semibold text-rose-700">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {loading && !view ? <PanelSkeleton /> : null}
      {loading && !view ? <span className="sr-only">Loading chart history…</span> : null}
      {view && !d ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center">
          <p className="text-xs font-semibold text-slate-600">{emptyText(view)}</p>
          {view.staleReason === 'failed' ? <p className="mt-0.5 text-[11px] text-slate-500">{STALE_TEXT.failed}</p> : null}
          {regen ? <div className="mt-2 flex justify-center">{regen}</div> : null}
        </div>
      ) : null}
      {view && d && view.stale ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900">
          Out of date: {STALE_TEXT[view.staleReason] ?? 'regenerate to include the latest chart documents.'}
        </p>
      ) : null}
      {view?.part2Withheld ? <p className="text-[11px] text-slate-500">Part 2 information was withheld: the Part 2 consent is no longer active.</p> : null}
      {d ? (
        <div className="space-y-1">
          {sections.map((s) => {
            const n = countFor(s.key);
            return (
              <details key={s.key} open={s.defaultOpen && n > 0} className="group rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">{n}</span>
                </summary>
                <div className="px-2 pb-2">
                  {n === 0 ? (
                    <p className="text-[11px] text-slate-400">Nothing cited in the chart documents.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-4 break-words">
                      {s.key === 'medicationTrials'
                        ? d.medicationTrials.map((t, i) => (
                            <Bullet key={i} text={trialText(t)} date={null} part2={t.part2}>
                              <Citations cites={t.cites} sources={sources} links={links} />
                            </Bullet>
                          ))
                        : itemsFor(s.key).map((it, i) => (
                            <Bullet key={i} text={it.text} date={it.date} part2={it.part2}>
                              <Citations cites={it.cites} sources={sources} links={links} />
                            </Bullet>
                          ))}
                    </ul>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
      {part2Notice ? <p className="rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-900">{part2Notice}</p> : null}
      {view?.generatedAt ? (
        <p className="text-[10px] text-slate-400">
          Generated {new Date(view.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          {view.status === 'partial' ? ' (partial)' : ''} from {Object.keys(sources).length} source(s).
        </p>
      ) : null}
    </div>
  );
}

const PREVENTIVE_TONE: Record<PreventiveDue['status'], string> = {
  overdue: 'bg-rose-100 text-rose-800',
  due: 'bg-amber-100 text-amber-800',
  met: 'bg-emerald-100 text-emerald-800',
};

/**
 * Medical (primary care) history: the same collapsible, cited sections as the BH panel, audience
 * first (medicalHistoryPanelSections). Record facts cite their own record (the chart tab that lists
 * it); document facts cite the document page. "Preventive care due" is computed from care-gap
 * records only. framed = the card look (rooming / pre-visit), otherwise the side-tab body.
 */
function MedicalHistoryBody({ state, role, framed }: { state: DigestState; role: string | null; framed: boolean }) {
  const { view, links, label, part2Notice, error, loading, load } = state;
  const d = view?.digest ?? null;
  const sources = d?.sources ?? {};
  const sections = medicalHistoryPanelSections(role);
  const ma = view?.audience === 'ma';
  const itemsFor = (k: string): Item[] => ((d?.[k] as Item[] | undefined) ?? []);
  const countFor = (k: string) => (k === 'medicationTrials' ? d?.medicationTrials.length ?? 0 : k === 'preventiveDue' ? d?.preventiveDue?.length ?? 0 : itemsFor(k).length);
  const total = d ? sections.reduce((n, s) => n + countFor(s.key), 0) : 0;
  if (!view && !loading && error && framed) return null; // role / access / not primary care: no card
  const regen = view?.canRegenerate ? (
    <button
      type="button"
      onClick={() => void load(true)}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      <RefreshCw size={11} className={loading ? 'animate-spin' : ''} aria-hidden /> {view.aiGenerated ? 'Regenerate' : 'Generate from documents'}
    </button>
  ) : null;

  return (
    <div className={`min-w-0 space-y-2 text-slate-800 ${framed ? 'rounded-lg border border-slate-200 bg-slate-50/60 p-2.5' : ''}`} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-[#5C2D91]">
          <History size={13} className="shrink-0" aria-hidden />
          <span className="truncate">
            {ma ? 'Medical history (rooming summary)' : 'Medical history'}
            {d ? ` (${total})` : ''}
          </span>
        </p>
        {regen}
      </div>
      <p className="text-[11px] font-semibold text-amber-800">{label}</p>
      {ma ? <p className="text-[11px] text-slate-500">Minimum necessary for rooming: allergies, current medications, vitals and preventive care due.</p> : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-[11px] font-semibold text-rose-700">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {loading && !view ? <PanelSkeleton /> : null}
      {loading && !view ? <span className="sr-only">Loading medical history…</span> : null}
      {view && !view.aiGenerated && !ma ? (
        <p className="rounded border border-dashed border-slate-200 px-1.5 py-1 text-[11px] text-slate-500">
          Showing chart records only. {view.staleReason === 'failed' ? STALE_TEXT.failed : 'No AI summary of the medical documents yet.'}
        </p>
      ) : null}
      {view && view.aiGenerated && view.stale ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900">
          Out of date: {STALE_TEXT[view.staleReason] ?? 'regenerate to include the latest medical documents.'}
        </p>
      ) : null}
      {view?.part2Withheld ? <p className="text-[11px] text-slate-500">Part 2 information was withheld: the Part 2 consent is no longer active.</p> : null}
      {d ? (
        <div className="space-y-1">
          {sections.map((s) => {
            const n = countFor(s.key);
            return (
              <details key={s.key} open={s.defaultOpen && n > 0} className="group rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">{n}</span>
                </summary>
                <div className="px-2 pb-2">
                  {n === 0 ? (
                    <p className="text-[11px] text-slate-400">{s.key === 'preventiveDue' ? 'No preventive-care records apply.' : 'Nothing on file or cited in the medical documents.'}</p>
                  ) : s.key === 'preventiveDue' ? (
                    <ul className="space-y-1 break-words">
                      {(d.preventiveDue ?? []).map((g) => (
                        <li key={g.key} className="flex flex-wrap items-center gap-1 text-xs text-slate-700">
                          <span className={`rounded px-1 text-[10px] font-bold uppercase ${PREVENTIVE_TONE[g.status]}`}>{g.status}</span>
                          <span className="min-w-0">{g.label}</span>
                          <span className="text-[11px] text-slate-500">
                            {g.lastDate ? `last ${g.lastDate}` : 'no record'}
                            {g.nextDue ? ` · next ${g.nextDue}` : ''}
                          </span>
                        </li>
                      ))}
                      <li className="text-[10px] text-slate-400">Computed from preventive-care records, not by AI.</li>
                    </ul>
                  ) : (
                    <ul className="list-disc space-y-1 pl-4 break-words">
                      {s.key === 'medicationTrials'
                        ? d.medicationTrials.map((t, i) => (
                            <Bullet key={i} text={trialText(t)} date={null} part2={t.part2}>
                              <Citations cites={t.cites} sources={sources} links={links} />
                            </Bullet>
                          ))
                        : itemsFor(s.key).map((it, i) => (
                            <Bullet key={i} text={it.text} date={it.date} part2={it.part2}>
                              <Citations cites={it.cites} sources={sources} links={links} />
                            </Bullet>
                          ))}
                    </ul>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
      {part2Notice ? <p className="rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-900">{part2Notice}</p> : null}
      {view?.generatedAt && view.aiGenerated ? (
        <p className="text-[10px] text-slate-400">
          Documents summarized {new Date(view.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          {view.status === 'partial' ? ' (partial)' : ''}. Record facts are live.
        </p>
      ) : null}
    </div>
  );
}
