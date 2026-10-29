'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  ListChecks,
  Lock,
  Quote,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { buttonClasses, cardClasses, cx } from '@/components/ui';
import { SUD_MEASURES, type SudMeasureKey } from '@/lib/clinical/sudRadar/measures';

type Evidence = {
  quote: string;
  sourceType: 'diagnosis' | 'problem-list' | 'progress-note' | 'document';
  sourceLabel: string;
  date: string | null;
  href: string;
  aiVerdict?: 'confirmed' | 'historical' | 'uncertain';
};

type Signal = {
  id: string;
  clientId: string;
  detectionSource: 'diagnosis' | 'note-keyword';
  detectedCondition: string;
  quotedEvidence: string;
  confidencePercent: number;
  recommendation: string;
  actionHref: string;
  fingerprint: string | null;
  substanceClasses: string[];
  codes: string[];
  evidence: Evidence[] | null;
  confidence: 'high' | 'medium' | 'low' | null;
  routedAction: 'residential-referral' | 'sbirt' | 'chart-documentation' | 'tobacco-cessation' | null;
  priority: 'urgent' | 'high' | 'routine' | 'low' | null;
  needsScreening: boolean;
  status: 'new' | 'reviewed' | 'referred' | 'dismissed' | 'resolved';
  statusReason: string | null;
  scannedAt: string;
  lastSeenAt: string | null;
  client: { id: string; name: string; mrn: string | null; assignedToId: string | null; assignedTo: { id: string; name: string | null } | null };
};

type ScanCounts = {
  clientsScanned: number;
  notesScanned: number;
  documentsScanned: number;
  findings: number;
  bySource: Record<string, number>;
  byConfidence: Record<string, number>;
  byAction: Record<string, number>;
  needsScreening: number;
  created: number;
  updated: number;
  reopened: number;
  resolved: number;
  ai: { enabled: boolean; clientsReviewed: number; failed: number; skippedConsent: number; dropped: number };
  measures?: { autoAssign: boolean; clients: number; assigned: number; skipped: number; failed: boolean };
};

type AssignDialog = { clientIds: string[]; label: string; ticked: SudMeasureKey[] };

const PRIORITIES = [
  { id: 'urgent', label: 'Urgent — level-of-care review', cls: 'text-rose-700' },
  { id: 'high', label: 'High — brief intervention', cls: 'text-amber-800' },
  { id: 'routine', label: 'Routine — documentation', cls: 'text-sky-800' },
  { id: 'low', label: 'Low — remission / tobacco', cls: 'text-slate-600' },
] as const;

const ACTION_LABEL: Record<string, string> = {
  'residential-referral': 'Residential / IOP referral',
  sbirt: 'SBIRT',
  'chart-documentation': 'Chart documentation',
  'tobacco-cessation': 'Tobacco cessation',
};

const SUBSTANCE_LABEL: Record<string, string> = {
  alcohol: 'Alcohol',
  opioids: 'Opioids',
  cannabis: 'Cannabis',
  sedatives: 'Sedatives',
  cocaine: 'Cocaine',
  stimulants: 'Stimulants',
  hallucinogens: 'Hallucinogens',
  nicotine: 'Nicotine',
  inhalants: 'Inhalants',
  other: 'Other / multiple',
};

const STATUS_STYLE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  referred: 'bg-sky-100 text-sky-700',
  dismissed: 'bg-slate-100 text-slate-600',
  resolved: 'bg-slate-100 text-slate-500',
};

const CONF_STYLE: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

function priorityOf(s: Signal): Signal['priority'] {
  if (s.priority) return s.priority;
  return s.confidencePercent >= 90 ? 'high' : 'routine';
}

function evidenceOf(s: Signal): Evidence[] {
  if (Array.isArray(s.evidence) && s.evidence.length) return s.evidence;
  if (!s.quotedEvidence) return [];
  return [{ quote: s.quotedEvidence, sourceType: 'diagnosis', sourceLabel: 'Saved signal', date: null, href: `/dashboard/clients/${s.clientId}` }];
}

const CONF_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default function SudReferralRadar() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [hidden, setHidden] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ScanCounts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<{ id: string; reason: string } | null>(null);
  const [f, setF] = useState({ source: 'all', confidence: 'all', action: 'all', substance: 'all', status: 'open', provider: 'all' });
  const [openMeasures, setOpenMeasures] = useState<Record<string, string[]>>({});
  const [autoAssign, setAutoAssign] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<AssignDialog | null>(null);
  const [assigning, setAssigning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/ehr/scanner/sud-radar?status=all');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not load SUD signals');
    setSignals(Array.isArray(data.signals) ? data.signals : []);
    setHidden(Number(data.stats?.sensitiveHidden) || 0);
    setLastScanAt(data.stats?.lastScanAt ?? null);
    setOpenMeasures(data.openMeasures && typeof data.openMeasures === 'object' ? data.openMeasures : {});
    setAutoAssign(data.autoAssignMeasures === true);
  }, []);

  const openAssign = (clientIds: string[], label: string) =>
    setAssign({ clientIds, label, ticked: SUD_MEASURES.map((m) => m.key) });

  const confirmAssign = async () => {
    if (!assign || !assign.ticked.length) return;
    setAssigning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/ehr/scanner/sud-radar/measures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: assign.clientIds, measures: assign.ticked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not assign the measures');
      setNotice(data.message || 'Measures assigned.');
      setAssign(null);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign the measures');
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load SUD signals'))
      .finally(() => setLoading(false));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setNotice(null);
    setResult(null);
    setElapsed(0);
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const res = await fetch('/api/ehr/scanner/run-ai-scan', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The scan failed');
      setResult(data.counts as ScanCounts);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed');
    } finally {
      if (timer.current) clearInterval(timer.current);
      setScanning(false);
    }
  };

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/ehr/scanner/sud-radar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not update the signal');
      if (body.action === 'refer') {
        setNotice(
          data.alreadyReferred
            ? 'A referral alert for this signal is already open.'
            : data.recipient
              ? `SUD Referral alert routed to ${data.recipient.name} (${data.recipient.roleLabel}) — it appears on their To-Do list.`
              : 'SUD Referral alert created in the general Alerts queue (no prescriber or assigned clinician on file).'
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the signal');
    } finally {
      setBusy(null);
      setDismissing(null);
    }
  };

  const providers = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of signals) {
      if (s.client.assignedTo) m.set(s.client.assignedTo.id, s.client.assignedTo.name || 'Unnamed clinician');
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [signals]);

  const filtered = useMemo(
    () =>
      signals
        .filter((s) => f.source === 'all' || s.detectionSource === f.source)
        .filter((s) => f.confidence === 'all' || s.confidence === f.confidence)
        .filter((s) => f.action === 'all' || s.routedAction === f.action)
        .filter((s) => f.substance === 'all' || s.substanceClasses.includes(f.substance))
        .filter((s) =>
          f.status === 'all' ? true : f.status === 'open' ? ['new', 'reviewed', 'referred'].includes(s.status) : s.status === f.status
        )
        .filter((s) => f.provider === 'all' || (f.provider === 'unassigned' ? !s.client.assignedToId : s.client.assignedToId === f.provider))
        .sort(
          (a, b) =>
            (CONF_ORDER[a.confidence ?? 'low'] ?? 2) - (CONF_ORDER[b.confidence ?? 'low'] ?? 2) ||
            a.client.name.localeCompare(b.client.name)
        ),
    [signals, f]
  );

  const open = signals.filter((s) => ['new', 'reviewed', 'referred'].includes(s.status));
  const selectable = [...new Set(filtered.filter(canAssignMeasures).map((s) => s.clientId))];
  const selectedNames = signals.filter((s) => selected.has(s.clientId)).map((s) => s.client.name);
  const toggleSelected = (clientId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  const select = (key: keyof typeof f, options: [string, string][]) => (
    <select
      value={f[key]}
      onChange={(e) => setF((prev) => ({ ...prev, [key]: e.target.value }))}
      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className={cx(cardClasses, 'overflow-hidden')}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div aria-hidden className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200">
          <ScanSearch size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">SUD Referral Radar — {open.length} open signal{open.length === 1 ? '' : 's'}</p>
          <p className="text-xs text-slate-500">
            {open.filter((s) => s.detectionSource === 'diagnosis').length} from F10–F19 diagnosis codes ·{' '}
            {open.filter((s) => s.detectionSource === 'note-keyword').length} from note language with{' '}
            <strong>no SUD diagnosis charted</strong>
            {lastScanAt ? ` · last scan ${new Date(lastScanAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' · not scanned yet'}
          </p>
        </div>
        <button
          onClick={() => void runScan()}
          disabled={scanning}
          className={buttonClasses({ variant: 'primary', className: 'ml-auto shrink-0' })}
        >
          <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} />
          {scanning ? `Scanning charts… ${elapsed}s` : 'Run AI Scan'}
        </button>
      </div>

      {scanning && (
        <div className="px-5 py-2.5 bg-sky-50 border-b border-sky-100 text-xs text-sky-800">
          Reading diagnoses, the problem list, signed notes and filed documents from the last 12 months. Large caseloads take a minute or two.
        </div>
      )}
      {result && (
        <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-800 space-y-0.5">
          <p className="font-semibold flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Scan complete — {result.clientsScanned} clients, {result.notesScanned} signed notes, {result.documentsScanned} filed documents
          </p>
          <p>
            {result.findings} signals: {result.bySource.diagnosis ?? 0} diagnosis · {result.bySource['note-keyword'] ?? 0} note keyword ·
            confidence {result.byConfidence.high ?? 0} high / {result.byConfidence.medium ?? 0} medium / {result.byConfidence.low ?? 0} low ·
            {' '}{result.byAction['residential-referral'] ?? 0} residential/IOP, {result.byAction.sbirt ?? 0} SBIRT, {result.byAction['chart-documentation'] ?? 0} documentation,{' '}
            {result.byAction['tobacco-cessation'] ?? 0} tobacco · {result.needsScreening} {result.needsScreening === 1 ? 'needs' : 'need'} a screen
          </p>
          <p>
            {result.created} new · {result.updated} refreshed · {result.reopened} reopened · {result.resolved} resolved (evidence gone)
            {result.ai.enabled
              ? ` · AI checked ${result.ai.clientsReviewed} clients' snippets${result.ai.failed ? `, ${result.ai.failed} failed (rules kept)` : ''}${result.ai.skippedConsent ? `, ${result.ai.skippedConsent} skipped (AI consent declined)` : ''}`
              : ' · rule-based only (AI confirmation not configured)'}
          </p>
          {result.measures?.autoAssign && (
            <p>
              Substance-use measures (auto-assign is on): {result.measures.assigned} assigned to {result.measures.clients} client
              {result.measures.clients === 1 ? '' : 's'}
              {result.measures.skipped ? ` · ${result.measures.skipped} already open, skipped` : ''}
              {result.measures.failed ? ' · could not be assigned this time (tried again on the next scan)' : ''}
            </p>
          )}
        </div>
      )}
      {error && <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">{error}</div>}
      {notice && <div className="px-5 py-2.5 bg-sky-50 border-b border-sky-100 text-xs text-sky-800">{notice}</div>}

      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        {select('source', [['all', 'All sources'], ['diagnosis', 'Diagnosis code'], ['note-keyword', 'Note keyword']])}
        {select('confidence', [['all', 'Any confidence'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])}
        {select('action', [['all', 'Any action'], ['residential-referral', 'Residential / IOP'], ['sbirt', 'SBIRT'], ['chart-documentation', 'Chart documentation'], ['tobacco-cessation', 'Tobacco cessation']])}
        {select('substance', [['all', 'Any substance'], ...Object.entries(SUBSTANCE_LABEL)])}
        {select('status', [['open', 'Open (new / reviewed / referred)'], ['new', 'New'], ['reviewed', 'Reviewed'], ['referred', 'Referred'], ['dismissed', 'Dismissed'], ['resolved', 'Resolved'], ['all', 'All statuses']])}
        {select('provider', [['all', 'All providers'], ['unassigned', 'Unassigned'], ...providers])}
        <span className="ml-auto text-xs text-slate-500">{filtered.length} shown</span>
      </div>
      <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <ListChecks size={13} className="text-slate-500" aria-hidden />
        <span>{selected.size} selected</span>
        <button
          type="button"
          onClick={() => setSelected(new Set(selectable))}
          disabled={!selectable.length}
          className="font-semibold text-sky-700 hover:underline disabled:opacity-40"
        >
          Select all shown
        </button>
        {selected.size > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-slate-500 hover:underline">
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => openAssign([...selected], `${selected.size} selected client${selected.size === 1 ? '' : 's'}`)}
          disabled={!selected.size}
          className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'ml-auto' })}
        >
          <ClipboardCheck size={12} /> Assign substance-use measures{selected.size ? ` (${selected.size})` : ''}
        </button>
        <span className="w-full text-[11px] text-slate-500">
          {autoAssign
            ? 'Auto-assign is on (Practice settings): each scan assigns AUDIT, CAGE-AID, NIDA-Modified ASSIST and BAM to clients with an open signal; measures already open are skipped.'
            : 'Measures go on the MBC outcome schedule (BAM repeats every 30 days). Measures already open for a client are skipped.'}
        </span>
      </div>
      {hidden > 0 && (
        <div className="px-5 py-2 border-b border-slate-100 text-[11px] text-slate-500 flex items-center gap-1.5">
          <Lock size={11} /> {hidden} signal{hidden === 1 ? '' : 's'} hidden — protected (42 CFR Part 2) records you are not authorized to open.
        </div>
      )}

      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">Loading signals…</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          {signals.length === 0 ? 'No SUD signals yet. Run AI Scan to check the charts.' : 'No signals match these filters.'}
        </p>
      ) : (
        PRIORITIES.map((p) => {
          const group = filtered.filter((s) => priorityOf(s) === p.id);
          if (!group.length) return null;
          return (
            <div key={p.id}>
              <div className={`px-5 py-2 bg-slate-50 border-y border-slate-100 text-[11px] font-semibold uppercase tracking-wider ${p.cls}`}>
                {p.label} · {group.length}
              </div>
              <div className="divide-y divide-slate-100">
                {group.map((s) => (
                  <SignalCard
                    key={s.id}
                    s={s}
                    busy={busy === s.id}
                    dismissing={dismissing?.id === s.id ? dismissing.reason : null}
                    onDismissStart={() => setDismissing({ id: s.id, reason: '' })}
                    onDismissChange={(reason) => setDismissing({ id: s.id, reason })}
                    onDismissCancel={() => setDismissing(null)}
                    onAct={(body) => void act(s.id, body)}
                    openMeasures={openMeasures[s.clientId] ?? []}
                    selected={selected.has(s.clientId)}
                    onToggleSelected={() => toggleSelected(s.clientId)}
                    onAssign={() => openAssign([s.clientId], s.client.name)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      {assign && (
        <AssignMeasuresDialog
          dialog={assign}
          names={assign.clientIds.length === 1 ? [assign.label] : selectedNames}
          alreadyOpen={assign.clientIds.length === 1 ? openMeasures[assign.clientIds[0]] ?? [] : []}
          busy={assigning}
          onChange={(ticked) => setAssign((prev) => (prev ? { ...prev, ticked } : prev))}
          onCancel={() => setAssign(null)}
          onConfirm={() => void confirmAssign()}
        />
      )}

      <div className="px-5 py-3 bg-sky-50 border-t border-sky-100 text-[11px] text-sky-800 flex items-start gap-2">
        <FileText size={12} className="shrink-0 mt-0.5" />
        <span>
          Screening suggestions only — a licensed clinician must assess the client before any referral or treatment. The scan never
          assigns a diagnosis code; note-keyword signals mean SUD language is documented but no F10–F19 diagnosis is charted.
          Tobacco (F17) is never routed for SUD referral.
        </span>
      </div>
    </div>
  );
}

/** Tobacco-only signals and closed signals do not take SUD measures */
function canAssignMeasures(s: Signal) {
  return s.routedAction !== 'tobacco-cessation' && ['new', 'reviewed', 'referred'].includes(s.status);
}

function AssignMeasuresDialog({
  dialog,
  names,
  alreadyOpen,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  dialog: AssignDialog;
  names: string[];
  alreadyOpen: string[];
  busy: boolean;
  onChange: (ticked: SudMeasureKey[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const uniqueNames = [...new Set(names)];
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="assign-measures-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <p id="assign-measures-title" className="text-sm font-bold text-slate-900">Assign substance-use measures</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {uniqueNames.length <= 3 ? uniqueNames.join(', ') : `${uniqueNames.slice(0, 3).join(', ')} and ${uniqueNames.length - 3} more`}
          </p>
        </div>
        <fieldset className="space-y-2 px-5 py-4">
          <legend className="sr-only">Measures</legend>
          {SUD_MEASURES.map((m) => {
            const isOpen = alreadyOpen.includes(m.key);
            const checked = dialog.ticked.includes(m.key);
            return (
              <label key={m.key} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  onChange={() => onChange(checked ? dialog.ticked.filter((k) => k !== m.key) : [...dialog.ticked, m.key])}
                />
                <span>
                  {m.label}
                  {isOpen && <span className="ml-1 text-[11px] text-slate-500">(already assigned, will be skipped)</span>}
                </span>
              </label>
            );
          })}
          <p className="pt-1 text-[11px] text-slate-500">
            Added to the MBC outcome schedule (Measurement-based care &gt; Outcomes) and given in session or from EHR &gt; Assessments.
            A measure already open for a client is never assigned twice.
          </p>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onCancel} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !dialog.ticked.length} className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            <ClipboardCheck size={12} /> {busy ? 'Assigning…' : 'Assign measures'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignalCard({
  s,
  busy,
  dismissing,
  onDismissStart,
  onDismissChange,
  onDismissCancel,
  onAct,
  openMeasures,
  selected,
  onToggleSelected,
  onAssign,
}: {
  s: Signal;
  busy: boolean;
  dismissing: string | null;
  onDismissStart: () => void;
  onDismissChange: (reason: string) => void;
  onDismissCancel: () => void;
  onAct: (body: Record<string, unknown>) => void;
  openMeasures: string[];
  selected: boolean;
  onToggleSelected: () => void;
  onAssign: () => void;
}) {
  const evidence = evidenceOf(s);
  const routed = s.routedAction;
  const closed = s.status === 'dismissed' || s.status === 'resolved';
  const btn = (primary: boolean) => buttonClasses({ variant: primary ? 'primary' : 'secondary', size: 'sm' });
  const sbirtHref = `/dashboard/ehr/assessments/sud?clientId=${encodeURIComponent(s.clientId)}`;
  const chartHref = `/dashboard/clients/${encodeURIComponent(s.clientId)}`;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {canAssignMeasures(s) && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${s.client.name} for substance-use measures`}
          />
        )}
        <a href={chartHref} className="text-sm font-bold text-slate-900 hover:underline">
          {s.client.name}
        </a>
        {s.client.mrn && <span className="text-[11px] text-slate-500">{s.client.mrn}</span>}
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.detectionSource === 'diagnosis' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
          {s.detectionSource === 'diagnosis' ? 'Diagnosis code' : 'Note keyword — not on problem list'}
        </span>
        {s.confidence && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${CONF_STYLE[s.confidence]}`}>{s.confidence} confidence</span>
        )}
        {routed && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{ACTION_LABEL[routed]}</span>}
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[s.status] ?? STATUS_STYLE.new}`}>{s.status}</span>
        {s.client.assignedTo?.name && <span className="text-[11px] text-slate-500">· {s.client.assignedTo.name}</span>}
      </div>
      <p className="text-xs font-semibold text-slate-700 mt-1">{s.detectedCondition}</p>
      {s.substanceClasses.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-0.5">{s.substanceClasses.map((c) => SUBSTANCE_LABEL[c] ?? c).join(' · ')}</p>
      )}

      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {evidence.map((e, i) => (
            <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
              <Quote size={10} className="shrink-0 mt-0.5 text-slate-500" />
              <span>
                &ldquo;{e.quote}&rdquo;{' '}
                <a href={e.href} className="text-sky-700 font-semibold hover:underline whitespace-nowrap">
                  {e.sourceLabel}
                  {e.date ? ` · ${e.date}` : ''}
                </a>
                {e.aiVerdict && <span className="ml-1 text-slate-500">(AI: {e.aiVerdict})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-sky-800 mt-2">
        <strong>Recommended:</strong> {s.recommendation}
      </p>
      {s.statusReason && <p className="text-[11px] text-slate-500 mt-0.5">Status note: {s.statusReason}</p>}
      {openMeasures.length > 0 && (
        <p className="text-[11px] text-emerald-800 mt-0.5">Measures assigned: {openMeasures.join(' · ')}</p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {routed === 'tobacco-cessation' ? (
          <a href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(s.clientId)}`} className={btn(true)}>
            <FileText size={12} /> Document cessation note
          </a>
        ) : (
          <>
            <a href={sbirtHref} className={btn(routed === 'sbirt' || s.needsScreening)}>
              <ClipboardCheck size={12} /> Start SBIRT
            </a>
            <button
              onClick={() => onAct({ action: 'refer' })}
              disabled={busy || s.status === 'referred'}
              className={btn(routed === 'residential-referral')}
             
              title="Creates the SUD Referral alert routed to the treatment-team prescriber (assigned clinician fallback)"
            >
              <BedDouble size={12} /> {s.status === 'referred' ? 'Referred' : 'Refer — residential/IOP'}
            </button>
            <a href={chartHref} className={btn(routed === 'chart-documentation')}>
              <Stethoscope size={12} /> Document diagnosis
            </a>
            {canAssignMeasures(s) && (
              <button onClick={onAssign} disabled={busy} className={btn(false)}>
                <ListChecks size={12} /> Assign substance-use measures
              </button>
            )}
          </>
        )}
        {!closed && s.status !== 'reviewed' && (
          <button onClick={() => onAct({ action: 'review' })} disabled={busy} className={btn(false)}>
            <CheckCircle2 size={12} /> Mark reviewed
          </button>
        )}
        {!closed && dismissing === null && (
          <button onClick={onDismissStart} disabled={busy} className={btn(false)}>
            <XCircle size={12} /> Dismiss
          </button>
        )}
        {closed && (
          <button onClick={() => onAct({ action: 'reopen' })} disabled={busy} className={btn(false)}>
            <RotateCcw size={12} /> Reopen
          </button>
        )}
      </div>
      {dismissing !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={dismissing}
            onChange={(e) => onDismissChange(e.target.value)}
            placeholder="Reason (e.g. negated in context, family member, already in treatment)"
            className="flex-1 min-w-[240px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <button
            onClick={() => onAct({ action: 'dismiss', reason: dismissing.trim() })}
            disabled={busy || dismissing.trim().length < 3}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <AlertTriangle size={12} /> Dismiss
          </button>
          <button onClick={onDismissCancel} className={btn(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
