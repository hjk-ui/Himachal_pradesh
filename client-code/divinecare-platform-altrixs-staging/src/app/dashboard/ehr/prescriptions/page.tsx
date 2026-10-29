'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSignature,
  History,
  Info,
  Lock,
  Pill,
  RefreshCw,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';
import { RcopiaQuickLaunch } from '@/components/drfirst/RcopiaQuickLaunch';
import { getPrescribingUiState } from '@/lib/drfirst/uiState';
import { openRcopia, DRFIRST_SYNCED_EVENT } from '@/lib/drfirst/openRcopiaClient';
import { NOTIFICATION_SCREENS, type NotificationScreen } from '@/lib/drfirst/notificationScreens';
import { buttonClasses, PageHeader } from '@/components/ui';

/** Kept for the legacy seed scripts (scripts/seed-ehr-modules.ts); no demo prescriptions exist. */
export const PRESCRIPTIONS_SEED: any[] = [];
export const REFILL_REQUESTS_SEED: any[] = [];


interface RcopiaRx {
  id: string;
  rcopiaId: string;
  clientId: string;
  patientName: string;
  mrn: string | null;
  providerName: string | null;
  providerNpi: string | null;
  supervisorName: string | null;
  drugName: string;
  schedule: string | null;
  sig: string | null;
  quantity: string | null;
  refills: string | null;
  pharmacyName: string | null;
  lifecycleStatus: string;
  createdDate: string | null;
  signedDate: string | null;
  stopDate: string | null;
  fill: { status: string; date: string } | null;
}

interface Renewal {
  id: string;
  clientId: string;
  patientName: string;
  mrn: string | null;
  providerUsername: string;
  drugPrescribed: string;
  drugDispensed: string;
  pharmacyName: string | null;
  actionTaken: string;
  createdAt: string;
}

interface ChangeRequest {
  id: string;
  clientId: string;
  patientName: string;
  mrn: string | null;
  orderedDrugName: string;
  requestedDrugName: string;
  requestType: string;
  changeReason: string;
  priorAuthNumber: string | null;
  status: string;
  createdAt: string;
}

interface Worklist {
  connected: boolean;
  syncedAt: string | null;
  recentErrors: { command: string; errorCode: string | null; createdAt: string }[];
  truncated: boolean;
  prescriptions: RcopiaRx[];
  renewals: Renewal[];
  changes: ChangeRequest[];
}

interface LegacyRx {
  id: string;
  rxNumber: string;
  clientId: string;
  clientName: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  prescriberName?: string;
  pharmacyName: string;
  createdAt: string;
}

type Tab = 'prescriptions' | 'renewals' | 'changes' | 'legacy';
type StatusFilter = 'current' | 'pending' | 'sent' | 'stopped' | 'all';

/** Rcopia lifecycle (update_prescription) → label + tone. PDR1: pending is never shown as sent. */
const LIFECYCLE: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pending, not sent', tone: 'bg-amber-100 text-amber-900' },
  needs_review: { label: 'Needs review', tone: 'bg-amber-100 text-amber-900' },
  signed: { label: 'Signed', tone: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', tone: 'bg-emerald-100 text-emerald-800' },
  undeliverable: { label: 'Undeliverable', tone: 'bg-rose-100 text-rose-800' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600' },
};

const FILL: Record<string, { label: string; tone: string }> = {
  dispensed: { label: 'Picked up', tone: 'text-emerald-700' },
  partially_dispensed: { label: 'Partially filled', tone: 'text-amber-700' },
  not_dispensed: { label: 'Not picked up', tone: 'text-rose-700' },
  transferred: { label: 'Transferred', tone: 'text-slate-600' },
  unknown: { label: 'Fill status unknown', tone: 'text-slate-500' },
};

const isControlled = (schedule: string | null) => Boolean(schedule && /^(2|3|4|5|ii|iii|iv|v|c-?i{1,3}|c-?iv|c-?v)$/i.test(schedule.trim()));
const scheduleLabel = (schedule: string | null) => {
  const s = (schedule || '').trim().toUpperCase().replace(/^C-?/, '');
  const roman: Record<string, string> = { '2': 'II', '3': 'III', '4': 'IV', '5': 'V' };
  return `C-${roman[s] || s}`;
};
const isStopped = (rx: RcopiaRx) => Boolean(rx.stopDate && new Date(rx.stopDate).getTime() < Date.now());
const isSent = (rx: RcopiaRx) => rx.lifecycleStatus === 'signed' || rx.lifecycleStatus === 'completed';
const isPending = (rx: RcopiaRx) => rx.lifecycleStatus === 'pending' || rx.lifecycleStatus === 'needs_review';
const isOpenRenewal = (r: Renewal) => !r.actionTaken || r.actionTaken === 'pending';
const isOpenChange = (c: ChangeRequest) => c.status === 'pending';

const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString() : '—');
function ago(v: string | null): string {
  if (!v) return 'never';
  const mins = Math.round((Date.now() - new Date(v).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : new Date(v).toLocaleDateString();
}

function PrescriptionsContent() {
  const searchParams = useSearchParams();
  const initialClientId = searchParams.get('clientId') || '';

  const { user } = useAuth();
  const { clients } = useClients();
  const { canPrescribe, canLaunchGateway, isRolePreview } = getPrescribingUiState(user);
  const isAdmin = user?.role === 'ADMIN';
  const canSeeCounts = canLaunchGateway || isAdmin;

  const [tab, setTab] = useState<Tab>('prescriptions');
  const [worklist, setWorklist] = useState<Worklist | null>(null);
  const [legacy, setLegacy] = useState<LegacyRx[]>([]);
  const [counts, setCounts] = useState<{ counts: Record<string, number>; source: string; asOf: string } | null>(null);
  const [countsNote, setCountsNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [patientId, setPatientId] = useState(initialClientId);
  const [patientQuery, setPatientQuery] = useState('');
  const [launching, setLaunching] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current');
  const [controlledOnly, setControlledOnly] = useState(false);
  const [prescriber, setPrescriber] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [wl, old] = await Promise.all([
        fetch('/api/drfirst/prescriptions', { cache: 'no-store' }).then(async r => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'Could not load prescriptions.');
          return d.data as Worklist;
        }),
        fetch('/api/prescriptions', { cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => (d?.success && Array.isArray(d.data) ? (d.data as LegacyRx[]) : []))
          .catch(() => [] as LegacyRx[]),
      ]);
      setWorklist(wl);
      setLegacy(old);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load prescriptions.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCounts = useCallback(async () => {
    if (!canSeeCounts) return;
    try {
      const res = await fetch('/api/drfirst/notifications', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCountsNote(data.error || 'DrFirst counts are unavailable.');
        return;
      }
      setCounts(data.data);
      setCountsNote(data.data?.demo ? 'DrFirst is not connected on this server, so there are no live counts.' : null);
    } catch {
      setCountsNote('DrFirst counts are unavailable.');
    }
  }, [canSeeCounts]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  // A patient was refreshed from DrFirst (return from Rcopia or Refresh from DrFirst on a chart)
  useEffect(() => {
    const onSynced = () => { void load(); };
    window.addEventListener(DRFIRST_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DRFIRST_SYNCED_EVENT, onSynced);
  }, [load]);

  const rxs = useMemo(() => worklist?.prescriptions ?? [], [worklist]);
  const renewals = useMemo(() => worklist?.renewals ?? [], [worklist]);
  const changes = useMemo(() => worklist?.changes ?? [], [worklist]);
  const openRenewals = renewals.filter(isOpenRenewal);
  const openChanges = changes.filter(isOpenChange);

  const prescribers = useMemo(
    () => Array.from(new Set(rxs.map(r => r.providerName).filter((n): n is string => Boolean(n)))).sort(),
    [rxs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rxs.filter(rx => {
      if (q && ![rx.patientName, rx.drugName, rx.mrn || '', rx.pharmacyName || ''].some(v => v.toLowerCase().includes(q))) return false;
      if (controlledOnly && !isControlled(rx.schedule)) return false;
      if (prescriber !== 'all' && rx.providerName !== prescriber) return false;
      switch (statusFilter) {
        case 'current': return (isSent(rx) || isPending(rx)) && !isStopped(rx);
        case 'pending': return isPending(rx);
        case 'sent': return isSent(rx);
        case 'stopped': return isStopped(rx) || rx.lifecycleStatus === 'cancelled' || rx.lifecycleStatus === 'undeliverable';
        default: return true;
      }
    });
  }, [rxs, search, controlledOnly, prescriber, statusFilter]);

  const patientOptions = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    const list = q
      ? clients.filter(c => c.name.toLowerCase().includes(q) || (c.mrn || '').toLowerCase().includes(q))
      : clients;
    return list.slice(0, 200);
  }, [clients, patientQuery]);

  const launchPatient = async () => {
    if (!patientId) return;
    setLaunching(true);
    setNotice({ type: 'info', text: 'Updating the patient in DrFirst, then opening…' });
    const r = await openRcopia({ patient: patientId, screen: 'patient' });
    setLaunching(false);
    setNotice(r.message ? { type: r.ok ? 'info' : 'error', text: r.message } : { type: 'success', text: 'DrFirst opened in a new tab. Changes you make in DrFirst appear here when you come back to this tab (or within 5 minutes).' });
  };

  /** Opens a DrFirst screen without patient context (message / report: Limited Multi Patient Mode, NCDM3). */
  const openScreen = async (screen: NotificationScreen) => {
    const r = await openRcopia({ screen });
    if (!r.ok) setNotice({ type: 'error', text: r.message || 'DrFirst could not be opened.' });
  };
  const openMessages = () => openScreen('message');

  const c = counts?.counts ?? {};
  const actionCards = [
    { key: 'need_signing', label: 'Needs signing', icon: FileSignature, value: c.need_signing, screen: NOTIFICATION_SCREENS.need_signing },
    { key: 'pending_prescription', label: 'Pending prescriptions', icon: Clock, value: c.pending_prescription, screen: NOTIFICATION_SCREENS.pending_prescription },
    { key: 'refill', label: 'Renewal requests', icon: RefreshCw, value: c.refill, screen: NOTIFICATION_SCREENS.refill },
    { key: 'rx_change', label: 'Change requests', icon: ArrowLeftRight, value: c.rx_change, screen: NOTIFICATION_SCREENS.rx_change },
  ];

  const tabs: { key: Tab; label: string; icon: typeof Pill; count?: number; hidden?: boolean }[] = [
    { key: 'prescriptions', label: 'Prescriptions', icon: Pill, count: rxs.length },
    { key: 'renewals', label: 'Renewal requests', icon: RefreshCw, count: openRenewals.length },
    { key: 'changes', label: 'Change requests', icon: ArrowLeftRight, count: openChanges.length },
    { key: 'legacy', label: 'Recorded in Altrixs (not sent)', icon: History, count: legacy.length, hidden: legacy.length === 0 },
  ];

  const errors = worklist?.recentErrors ?? [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className={buttonClasses({ variant: 'primary' })}>
            <Pill size={22} aria-hidden />
          </div>
          <PageHeader
        title="E-Prescribing"
        description="Prescriptions, controlled substances (EPCS), PDMP checks and pharmacy messages are handled in DrFirst Rcopia."
      />
        </div>
        {canLaunchGateway ? <RcopiaQuickLaunch /> : null}
      </div>

      {/* Connection + sync status */}
      {worklist && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-2.5 text-xs ${
            !worklist.connected
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : errors.length
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
          role="status"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {worklist.connected ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
            {worklist.connected ? 'DrFirst connected' : 'DrFirst is not connected on this server'}
          </span>
          <span>Last download from DrFirst: {ago(worklist.syncedAt)} (every 5 minutes, and when you come back from DrFirst)</span>
          {errors.length > 0 && (
            <span className="font-semibold">
              {errors.length} DrFirst call{errors.length === 1 ? '' : 's'} failed in the last 24 hours
              {isAdmin
                ? `: ${errors.map(e => `${e.command}${e.errorCode ? ` (${e.errorCode})` : ''}`).join(', ')}`
                : '. Tell an administrator if prescriptions look out of date.'}
            </span>
          )}
          <button
            type="button"
            onClick={() => { void load(); void loadCounts(); }}
            className="ml-auto inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
          >
            <RefreshCw size={12} aria-hidden /> Refresh
          </button>
        </div>
      )}

      {notice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : notice.type === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          <span className="flex items-start gap-2">
            {notice.type === 'error' ? <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> : <Info size={16} className="mt-0.5 shrink-0" aria-hidden />}
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs opacity-70 hover:opacity-100" aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Prescribe for a patient */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs min-w-0 lg:col-span-1">
          <h2 className="text-sm font-bold text-slate-900">Prescribe for a patient</h2>
          {canLaunchGateway ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Opens the patient in DrFirst after sending their demographics, diagnoses, allergies and medications.
                Write, sign and send the prescription there; controlled substances use DrFirst EPCS two-factor signing.
              </p>
              <label htmlFor="rx-patient-search" className="mt-3 block text-xs font-semibold text-slate-700">Patient</label>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
                <input
                  id="rx-patient-search"
                  type="search"
                  value={patientQuery}
                  onChange={e => setPatientQuery(e.target.value)}
                  placeholder="Search name or MRN"
                  className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-2 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <select
                aria-label="Select patient"
                value={patientId}
                onChange={e => setPatientId(e.target.value)}
                size={5}
                className="mt-2 w-full rounded-lg border border-slate-300 p-1 text-xs focus:border-blue-600 focus:outline-none"
              >
                {patientOptions.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.mrn ? ` · MRN ${p.mrn}` : ''}
                  </option>
                ))}
              </select>
              {patientOptions.length === 0 && <p className="mt-1 text-xs text-slate-500">No patients on your caseload match.</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!patientId || launching}
                  onClick={() => void launchPatient()}
                  className={buttonClasses({ variant: 'primary', size: 'sm', className: 'inline-flex' })}
                >
                  <ExternalLink size={14} aria-hidden /> {launching ? 'Opening DrFirst…' : 'Open in DrFirst'}
                </button>
                {patientId && (
                  <Link href={`/dashboard/clients/${patientId}`} className="text-xs font-semibold text-blue-700 hover:underline">
                    Open chart
                  </Link>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              {isRolePreview && canPrescribe
                ? 'Role preview: DrFirst opens only for a signed-in prescriber with their own DrFirst account.'
                : 'Only prescribers with a DrFirst account write prescriptions. You can view the prescription list below.'}
            </p>
          )}
        </section>

        {/* DrFirst action queue (NCDM2) */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">Waiting in DrFirst</h2>
            {counts?.asOf && (
              <span className="text-[11px] text-slate-500">
                {counts.source === 'live' ? 'From DrFirst' : 'From the last sync'}, {ago(counts.asOf)}
              </span>
            )}
          </div>
          {canSeeCounts ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {actionCards.map(card => {
                  const Icon = card.icon;
                  const n = card.value ?? 0;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => void openScreen(card.screen)}
                      disabled={!canLaunchGateway}
                      aria-label={`${card.label}: ${counts ? n : 'unknown'}. Open in DrFirst ${card.screen === 'report' ? 'reports' : 'messages'}`}
                      className={`rounded-xl border p-3 text-left transition hover:shadow-sm disabled:cursor-default ${
                        n > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {card.label} <Icon size={14} aria-hidden />
                      </span>
                      <span className="mt-1 block text-2xl font-bold text-slate-900">{counts ? n : '—'}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {countsNote || (isAdmin ? 'Practice totals across this organization’s prescribers.' : 'Your own items. Select a count to open it in DrFirst (pending and to-sign in Reports, renewals and changes in Messages).')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Counts are shown to prescribers and administrators.</p>
          )}
        </section>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.filter(t => !t.hidden).map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${
                active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={15} aria-hidden /> {t.label}
              {t.count ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{t.count}</span> : null}
            </button>
          );
        })}
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert">{loadError}</div>
      )}

      {tab === 'prescriptions' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search patient, MRN, drug or pharmacy"
                aria-label="Search prescriptions"
                className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-2.5 md:h-8">
                <option value="current">Current (sent or pending)</option>
                <option value="pending">Pending, not sent</option>
                <option value="sent">Signed / completed</option>
                <option value="stopped">Stopped, cancelled or undeliverable</option>
                <option value="all">All</option>
              </select>
              <select aria-label="Prescriber" value={prescriber} onChange={e => setPrescriber(e.target.value)} className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-2.5 md:h-8">
                <option value="all">All prescribers</option>
                {prescribers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 md:min-h-8">
                <input type="checkbox" checked={controlledOnly} onChange={e => setControlledOnly(e.target.checked)} />
                Controlled only
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">Written</th>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Drug &amp; directions</th>
                  <th scope="col" className="px-4 py-3">Qty / refills</th>
                  <th scope="col" className="px-4 py-3">Prescriber</th>
                  <th scope="col" className="px-4 py-3">Pharmacy</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-slate-500">Loading prescriptions…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      {rxs.length === 0
                        ? 'No prescriptions have been downloaded from DrFirst yet. Prescriptions written in DrFirst appear here within 5 minutes, or as soon as you come back to this tab.'
                        : 'No prescriptions match these filters.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(rx => {
                    const life = LIFECYCLE[rx.lifecycleStatus] || { label: rx.lifecycleStatus, tone: 'bg-slate-100 text-slate-700' };
                    const fill = rx.fill ? FILL[rx.fill.status] || FILL.unknown : null;
                    return (
                      <tr key={rx.id} className="align-top hover:bg-blue-50/30">
                        <td className="px-4 py-3 text-slate-600">
                          {fmtDate(rx.createdDate)}
                          {rx.signedDate && <div className="text-[11px] text-slate-500">Signed {fmtDate(rx.signedDate)}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/clients/${rx.clientId}`} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">
                            {rx.patientName}
                          </Link>
                          {rx.mrn && <div className="text-[11px] text-slate-500">MRN {rx.mrn}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                            {rx.drugName}
                            {isControlled(rx.schedule) && (
                              <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                                <Lock size={9} aria-hidden /> {scheduleLabel(rx.schedule)}
                              </span>
                            )}
                          </div>
                          {rx.sig && <div className="text-[11px] text-slate-600">{rx.sig}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {rx.quantity || '—'}
                          <div className="text-[11px] text-slate-500">{rx.refills ? `${rx.refills} refill${rx.refills === '1' ? '' : 's'}` : 'No refills listed'}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {rx.providerName || '—'}
                          {rx.supervisorName && <div className="text-[11px] text-slate-500">Supervisor: {rx.supervisorName}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{rx.pharmacyName || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${isStopped(rx) ? 'bg-slate-100 text-slate-600' : life.tone}`}>
                            {isStopped(rx) ? `Stopped ${fmtDate(rx.stopDate)}` : life.label}
                          </span>
                          {fill && rx.fill && (
                            <div className={`mt-1 text-[11px] font-semibold ${fill.tone}`}>{fill.label} · {fmtDate(rx.fill.date)}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {worklist?.truncated && (
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
              Showing the 500 most recent prescriptions. Use DrFirst reports for older history.
            </p>
          )}
        </section>
      )}

      {tab === 'renewals' && (
        <QueueSection
          title="Pharmacy renewal requests"
          description="Renewal requests come from pharmacies through DrFirst. Approve or deny them in DrFirst so the pharmacy receives the answer."
          emptyText="No renewal requests downloaded from DrFirst."
          canRespond={canLaunchGateway}
          onRespond={() => void openMessages()}
          rows={renewals.map(r => ({
            id: r.id,
            clientId: r.clientId,
            patientName: r.patientName,
            mrn: r.mrn,
            open: isOpenRenewal(r),
            status: isOpenRenewal(r) ? 'Waiting' : r.actionTaken,
            title: r.drugPrescribed,
            detail: [
              r.drugDispensed && r.drugDispensed !== r.drugPrescribed ? `Dispensed: ${r.drugDispensed}` : null,
              r.pharmacyName ? `Pharmacy: ${r.pharmacyName}` : null,
              `Received ${fmtDate(r.createdAt)}`,
            ].filter(Boolean).join(' · '),
          }))}
        />
      )}

      {tab === 'changes' && (
        <QueueSection
          title="Pharmacy change requests"
          description="Requests from pharmacies to change a prescription (generic substitution, prior authorization, therapeutic change). Respond in DrFirst."
          emptyText="No change requests downloaded from DrFirst."
          canRespond={canLaunchGateway}
          onRespond={() => void openMessages()}
          rows={changes.map(r => ({
            id: r.id,
            clientId: r.clientId,
            patientName: r.patientName,
            mrn: r.mrn,
            open: isOpenChange(r),
            status: isOpenChange(r) ? 'Waiting' : r.status,
            title: `${r.orderedDrugName} → ${r.requestedDrugName}`,
            detail: [
              r.requestType || null,
              r.changeReason || null,
              r.priorAuthNumber ? `Prior auth ${r.priorAuthNumber}` : null,
              `Received ${fmtDate(r.createdAt)}`,
            ].filter(Boolean).join(' · '),
          }))}
        />
      )}

      {tab === 'legacy' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <p>
              These entries were recorded in Altrixs before e-prescribing moved to DrFirst. They were <strong>not sent to any
              pharmacy</strong>. If a patient still takes one of these medications, add it to the medication list or prescribe it in DrFirst.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">Recorded</th>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Medication</th>
                  <th scope="col" className="px-4 py-3">Directions</th>
                  <th scope="col" className="px-4 py-3">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {legacy.map(rx => (
                  <tr key={rx.id}>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(rx.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/clients/${rx.clientId}`} className="font-semibold text-slate-900 hover:underline">{rx.clientName}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{rx.medicationName} {rx.dosage}</td>
                    <td className="px-4 py-3 text-slate-600">{rx.frequency}</td>
                    <td className="px-4 py-3 text-slate-600">{rx.prescriberName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

interface QueueRow {
  id: string;
  clientId: string;
  patientName: string;
  mrn: string | null;
  open: boolean;
  status: string;
  title: string;
  detail: string;
}

function QueueSection({
  title, description, emptyText, rows, canRespond, onRespond,
}: {
  title: string;
  description: string;
  emptyText: string;
  rows: QueueRow[];
  canRespond: boolean;
  onRespond: () => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const open = rows.filter(r => r.open);
  const visible = showClosed ? rows : open;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show answered
          </label>
          {canRespond && (
            <button
              type="button"
              onClick={onRespond}
              className={buttonClasses({ variant: 'primary', size: 'sm', className: 'inline-flex' })}
            >
              <Send size={13} aria-hidden /> Respond in DrFirst
            </button>
          )}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-700" aria-hidden />
          {rows.length === 0 ? emptyText : 'Nothing is waiting.'}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {visible.map(r => (
            <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/clients/${r.clientId}`} className="text-sm font-bold text-slate-900 hover:underline">{r.patientName}</Link>
                  {r.mrn && <span className="text-[11px] text-slate-500">MRN {r.mrn}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${r.open ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
                    {r.status}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-blue-900">{r.title}</p>
                <p className="text-xs text-slate-500">{r.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PrescriptionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Loading e-prescribing…</div>}>
      <PrescriptionsContent />
    </Suspense>
  );
}
