'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Link2, Loader2, Trash2, ClipboardList, AlertTriangle, CalendarCheck, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { DrugCodeFixer } from '@/components/ui/DrugPicker';
import { DRFIRST_SYNCED_EVENT, dispatchDrFirstSynced, type DrFirstSyncedDetail } from '@/lib/drfirst/openRcopiaClient';

/**
 * DrFirst section of the client chart Medications tab:
 *  - DrFirstLinkButton: "Link to DrFirst" for prescribers / admins while the chart
 *    is not linked (POST /api/drfirst/patients/search, then staff confirm a
 *    candidate with POST /api/drfirst/patients/link).
 *  - DrFirstChartPanel: pending (unsigned) Rcopia prescriptions with a
 *    prescriber-only "Delete pending", the DrFirst problem list, open patient
 *    review items, recent office visits, and drug-code readiness: local medications and
 *    drug allergies DrFirst would receive as free text, each with "Not coded — code it"
 *    (RxNorm via /api/drugs/search; MUM2 / AUM2).
 * Both refresh on the window event `drfirst:changed`. The panel also reloads on 'altrixs:drfirst-synced'
 * for its patient (return from Rcopia, DrFirstReturnSync) and offers prescribers "Refresh from DrFirst"
 * (POST /api/drfirst/sync {clientId}; once per 5 minutes per patient, GM8 / DR2).
 */

type Candidate = {
  rcopiaId: string;
  externalId?: string;
  matchedBy: 'external_id' | 'name_dob';
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  sex?: string;
  city?: string;
  state?: string;
};

type ChartState = {
  configured: boolean;
  linked: boolean;
  canLink: boolean;
  problems: { id: string; icd10Code: string; name: string; status: string; onsetDate: string | null; notes: string | null }[];
  reviewItems: {
    id: string;
    createdAt: string;
    differences: { field: string; drfirst: string }[];
    linkConflict: { chartRcopiaId: string; drfirstRcopiaId: string } | null;
    deletedInDrFirst: boolean;
  }[];
  officeVisits: { id: string; visitDate: string | null; renderingProviderUsername: string | null; origin: string | null; deleted: boolean }[];
  codification?: {
    medicationsActive: number;
    medicationsUncoded: number;
    allergiesUncoded: number;
    uncodedMedications: { id: string; name: string }[];
    uncodedAllergies: { id: string; name: string; allergenType: string | null }[];
  };
  /** 42 CFR Part 2: SUD diagnoses withheld from DrFirst (no Part 2 consent on file); count only */
  part2Notice?: { withheld: number; message: string } | null;
};

async function patchJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type RcopiaRx = {
  id: string;
  rcopiaId: string;
  drugName: string;
  sig: string | null;
  quantity: string | null;
  refills: string | null;
  lifecycleStatus: string;
  createdDate: string | null;
  signedDate?: string | null;
  pharmacyName?: string | null;
};

/** DrFirst PDR1: prescriptions are listed apart from medications, signed / sent apart from pending */
const RX_STATUS_LABEL: Record<string, string> = {
  signed: 'Signed',
  completed: 'Signed and sent / printed',
  undeliverable: 'Not delivered to the pharmacy',
  cancelled: 'Cancelled / denied in DrFirst',
};

const CHANGED = 'drfirst:changed';
const announce = () => window.dispatchEvent(new Event(CHANGED));

const FIELD_LABEL: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
  sex: 'Sex',
  zip: 'ZIP',
};

function useChartState(clientId: string) {
  const [state, setState] = useState<ChartState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drfirst/patients/link?clientId=${encodeURIComponent(clientId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DrFirst status could not be loaded');
    }
  }, [clientId]);
  useEffect(() => {
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);
  return { state, error, reload: load };
}

function personLine(c: Candidate) {
  const name = [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');
  const where = [c.city, c.state].filter(Boolean).join(', ');
  return [name || 'Unnamed', c.dob && `DOB ${c.dob}`, c.sex && c.sex.toUpperCase(), where].filter(Boolean).join(' · ');
}

export function DrFirstLinkButton({ clientId }: { clientId: string }) {
  const { state } = useChartState(clientId);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  if (!state || !state.configured || state.linked || !state.canLink) return null;

  const search = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/drfirst/patients/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.linked) {
        toast.success('Chart linked to its DrFirst patient.');
        announce();
        return;
      }
      if (!data.candidates?.length) {
        toast(data.message || 'No matching DrFirst patient found. Register the patient through E-Prescribe.');
        return;
      }
      setCandidates(data.candidates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'DrFirst search failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmLink = async (c: Candidate) => {
    if (!window.confirm(`Link this chart to DrFirst patient ${personLine(c)} (DrFirst ID ${c.rcopiaId})?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/drfirst/patients/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, rcopiaPatientId: c.rcopiaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Chart linked to DrFirst.');
      setCandidates(null);
      announce();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={search}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-4 py-2 text-xs font-bold text-purple-800 shadow-xs hover:bg-purple-50 disabled:opacity-60"
        title="Find this chart's patient in DrFirst and link it"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link to DrFirst
      </button>
      {candidates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="DrFirst patient matches">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Possible DrFirst matches</h3>
              <button type="button" onClick={() => setCandidates(null)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-600">
              More than one DrFirst patient matches this chart. Confirm the right one; nothing is linked until you do.
            </p>
            <ul className="space-y-2">
              {candidates.map(c => (
                <li key={c.rcopiaId} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 text-xs">
                  <div>
                    <div className="font-semibold text-gray-900">{personLine(c)}</div>
                    <div className="text-[11px] text-gray-500">
                      DrFirst ID {c.rcopiaId} · matched by {c.matchedBy === 'external_id' ? 'chart id' : 'last name + date of birth'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirmLink(c)}
                    className="shrink-0 rounded-lg bg-purple-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                  >
                    Link
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export function DrFirstChartPanel({ clientId, isPrescriber }: { clientId: string; isPrescriber: boolean }) {
  const { state, error, reload } = useChartState(clientId);
  const [pending, setPending] = useState<RcopiaRx[]>([]);
  const [issued, setIssued] = useState<RcopiaRx[]>([]);
  const [toDelete, setToDelete] = useState<RcopiaRx | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadRx = useCallback(async () => {
    try {
      const res = await fetch(`/api/drfirst/medications?clientId=${encodeURIComponent(clientId)}`);
      const data = await res.json();
      if (!res.ok) return;
      const rows: RcopiaRx[] = Array.isArray(data.rcopiaPrescriptions) ? data.rcopiaPrescriptions : [];
      setPending(rows.filter(r => r.lifecycleStatus === 'pending' || r.lifecycleStatus === 'needs_review'));
      setIssued(rows.filter(r => r.lifecycleStatus !== 'pending' && r.lifecycleStatus !== 'needs_review').slice(0, 20));
    } catch {
      /* the panel still shows the rest */
    }
  }, [clientId]);
  useEffect(() => {
    loadRx();
    window.addEventListener(CHANGED, loadRx);
    return () => window.removeEventListener(CHANGED, loadRx);
  }, [loadRx]);
  // This patient was refreshed from DrFirst (return from Rcopia or the Refresh button)
  useEffect(() => {
    const onSynced = (e: Event) => {
      if ((e as CustomEvent<DrFirstSyncedDetail>).detail?.clientId !== clientId) return;
      void loadRx();
      void reload();
    };
    window.addEventListener(DRFIRST_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DRFIRST_SYNCED_EVENT, onSynced);
  }, [clientId, loadRx, reload]);

  const refreshFromDrFirst = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/drfirst/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.demo) {
        toast(data.message || 'DrFirst is not configured on this server; nothing was synced.');
        return;
      }
      const steps = Object.values((data.data?.[clientId] ?? {}) as Record<string, { ok: boolean; created: number; updated: number; throttled?: boolean; error?: string }>);
      const totals = { created: 0, updated: 0 };
      for (const s of steps) { totals.created += s.created || 0; totals.updated += s.updated || 0; }
      const throttled = steps.length > 0 && steps.every(s => s.throttled);
      const failed = steps.find(s => !s.ok);
      const changes = totals.created + totals.updated;
      if (failed) toast.error(`DrFirst refresh was incomplete (${failed.error || 'error'}). Try again in a few minutes.`);
      else if (changes > 0) toast.success(`Updated from DrFirst: ${plural(changes, 'change')}.`);
      else if (throttled) {
        const minutes = Math.max(1, Math.ceil((Number(data.retryAfterSeconds) || 0) / 60));
        toast(`DrFirst allows one refresh every 5 minutes for a patient; this chart updates again in about ${minutes} min.`);
      } else toast.success('Up to date with DrFirst.');
      dispatchDrFirstSynced({ clientId, totals, throttled });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'DrFirst refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const deletePending = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await fetch('/api/drfirst/prescriptions/delete-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, rcopiaId: toDelete.rcopiaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Pending prescription deleted in DrFirst.');
      setToDelete(null);
      announce();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (id: string) => {
    try {
      const res = await fetch('/api/drfirst/patients/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, acknowledgeReviewId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      announce();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark reviewed');
    }
  };

  if (error) return null;
  if (!state || !state.configured) return null;
  const codes = state.codification;
  const uncodedCount = (codes?.medicationsUncoded || 0) + (codes?.allergiesUncoded || 0);
  const nothing = !pending.length && !issued.length && !state.problems.length && !state.reviewItems.length && !state.officeVisits.length && !uncodedCount && !state.part2Notice;
  const codeMedication = async (id: string, rxcui: string) => {
    await patchJson(`/api/clients/${encodeURIComponent(clientId)}/medications/${encodeURIComponent(id)}`, { action: 'code', rxcui });
    toast.success('Medication coded. DrFirst gets the code on the next sync.');
    announce();
  };
  const codeAllergy = async (id: string, body: Record<string, string>) => {
    await patchJson(`/api/medical/patients/${encodeURIComponent(clientId)}/allergies/${encodeURIComponent(id)}`, body);
    toast.success(body.action === 'code' ? 'Allergy coded. DrFirst gets the code on the next sync.' : 'Allergy type saved.');
    announce();
  };

  return (
    <div className="clinic-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="clinic-section-title mb-0.5">DrFirst</h3>
          <p className="text-xs text-slate-500">
            {state.linked
              ? 'Linked to DrFirst. Updates when you come back from DrFirst, and with the practice-wide sync.'
              : 'This chart is not linked to a DrFirst patient yet.'}
          </p>
        </div>
        {isPrescriber && state.linked && (
          <button
            type="button"
            onClick={() => void refreshFromDrFirst()}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}
            {refreshing ? 'Refreshing…' : 'Refresh from DrFirst'}
          </button>
        )}
      </div>

      {nothing && <p className="text-xs text-slate-500">Nothing from DrFirst for this chart yet.</p>}

      {state.part2Notice && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3" aria-label="42 CFR Part 2 notice" data-testid="drfirst-part2-notice">
          <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <ShieldAlert size={14} aria-hidden /> {state.part2Notice.message}
          </h4>
          <p className="text-[11px] text-amber-900">
            {plural(state.part2Notice.withheld, 'substance use diagnosis', 'substance use diagnoses')} stay in this chart only (42 CFR Part 2).
            Other diagnoses are sent. A signed Part 2 consent for treatment / TPO or naming DrFirst or the prescriber lets them go.{' '}
            <Link href={`/dashboard/clients/${encodeURIComponent(clientId)}?tab=documents`} className="font-bold underline">Open consents</Link>
          </p>
        </section>
      )}

      {codes && uncodedCount > 0 && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3" aria-label="Drug code readiness">
          <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <AlertTriangle size={14} />
            {[
              codes.medicationsUncoded ? `${plural(codes.medicationsUncoded, 'medication')} not coded` : '',
              codes.allergiesUncoded ? `${plural(codes.allergiesUncoded, 'drug allergy', 'drug allergies')} not coded` : '',
            ].filter(Boolean).join(' · ')}
          </h4>
          <p className="mb-2 text-[11px] text-amber-900">
            DrFirst receives these as free text, without an RxNorm drug code. Code each one (drug, strength and form) so
            DrFirst can run interaction and allergy checks.
          </p>
          <ul className="space-y-1.5">
            {codes.uncodedMedications.map(m => (
              <li key={`m-${m.id}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-800">
                <span className="font-semibold">{m.name}</span>
                <DrugCodeFixer kind="medication" text={m.name} onCode={rxcui => codeMedication(m.id, rxcui)} />
              </li>
            ))}
            {codes.uncodedAllergies.map(a => (
              <li key={`a-${a.id}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-800">
                <span className="font-semibold">Allergy: {a.name}</span>
                {!a.allergenType && <span className="text-[11px] text-amber-800">(type not set)</span>}
                <DrugCodeFixer
                  kind="allergy"
                  text={a.name}
                  onCode={rxcui => codeAllergy(a.id, { action: 'code', rxcui })}
                  onClassify={type => codeAllergy(a.id, { action: 'classify', allergenType: type })}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.reviewItems.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <AlertTriangle size={14} /> Review: DrFirst differs from this chart
          </h4>
          <ul className="space-y-2">
            {state.reviewItems.map(item => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <div className="space-y-0.5">
                  {item.differences.map(d => (
                    <div key={d.field}>
                      {FIELD_LABEL[d.field] || d.field} in DrFirst: <span className="font-semibold">{d.drfirst || '(blank)'}</span>
                    </div>
                  ))}
                  {item.linkConflict && (
                    <div>Chart is linked to DrFirst ID {item.linkConflict.chartRcopiaId}, but DrFirst ID {item.linkConflict.drfirstRcopiaId} carries this chart&apos;s id.</div>
                  )}
                  {item.deletedInDrFirst && <div>This patient was deleted in DrFirst.</div>}
                  <div className="text-[11px] text-amber-800">The chart was not changed. {new Date(item.createdAt).toLocaleDateString()}</div>
                </div>
                {state.canLink && (
                  <button type="button" onClick={() => acknowledge(item.id)} className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100">
                    Mark reviewed
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 text-xs font-bold text-slate-700">Pending prescriptions in DrFirst (not signed)</h4>
          <ul className="space-y-2">
            {pending.map(rx => (
              <li key={rx.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 text-xs">
                <div>
                  <div className="font-semibold text-gray-900">{rx.drugName}</div>
                  <div className="text-[11px] text-gray-500">
                    {[rx.sig, rx.quantity && `Qty ${rx.quantity}`, rx.refills && `Refills ${rx.refills}`, rx.lifecycleStatus === 'needs_review' ? 'Needs review' : 'Pending']
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {isPrescriber && (
                  <button
                    type="button"
                    onClick={() => setToDelete(rx)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={12} /> Delete pending
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {issued.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 text-xs font-bold text-slate-700">Prescriptions from DrFirst (signed / sent)</h4>
          <ul className="space-y-2">
            {issued.map(rx => (
              <li key={rx.id} className="rounded-xl border border-gray-200 p-3 text-xs">
                <div className="font-semibold text-gray-900">{rx.drugName}</div>
                <div className="text-[11px] text-gray-500">
                  {[RX_STATUS_LABEL[rx.lifecycleStatus] || rx.lifecycleStatus, rx.signedDate && new Date(rx.signedDate).toLocaleDateString(), rx.pharmacyName, rx.sig, rx.quantity && `Qty ${rx.quantity}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.problems.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <ClipboardList size={14} /> DrFirst problem list
          </h4>
          <ul className="space-y-1">
            {state.problems.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 text-xs">
                <span>
                  {p.icd10Code && <span className="font-bold text-indigo-700">{p.icd10Code} </span>}
                  {p.name}
                  {p.notes && <span className="text-[11px] text-gray-500"> · {p.notes}</span>}
                </span>
                <span className={`text-[11px] font-semibold ${p.status === 'Active' ? 'text-emerald-700' : 'text-gray-500'}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.officeVisits.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <CalendarCheck size={14} /> Office visits in DrFirst
          </h4>
          <ul className="space-y-1 text-xs text-gray-700">
            {state.officeVisits.map(v => (
              <li key={v.id}>
                {v.visitDate || 'No date'}
                {v.renderingProviderUsername && <span className="text-gray-500"> · {v.renderingProviderUsername}</span>}
                {v.deleted && <span className="text-gray-500"> · removed</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Delete pending prescription">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Delete pending prescription?</h3>
            <p className="mb-4 text-xs text-gray-600">
              {toDelete.drugName} will be deleted in DrFirst. It was never signed or sent to a pharmacy. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setToDelete(null)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={deletePending} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60">
                {busy && <Loader2 size={12} className="animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
