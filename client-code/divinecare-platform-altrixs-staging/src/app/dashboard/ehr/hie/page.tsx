'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSearch,
  Loader2,
  Pill,
  Search,
  Stethoscope,
} from 'lucide-react';
import { markClientHieQueried, useClients } from '@/features/clients';
import { MISSING_DOB_MESSAGE, normalizeLaunchDob } from '@/lib/fhir/launchDob';
import { PageHeader, buttonClasses } from '@/components/ui';

type HiePatient = {
  id: string;
  name: string;
  mrn: string;
  dob: string;
  gender: string;
  payer: string;
  lastQuery: string | null;
};

type LaunchState = 'idle' | 'launching' | 'launched';

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: 'Unknown', last: 'Patient' };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function formatGender(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const g = raw.trim().toLowerCase();
  if (g === 'm' || g === 'male') return 'Male';
  if (g === 'f' || g === 'female') return 'Female';
  return raw;
}

export default function CrispHiePage() {
  const { clients, loading } = useClients();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchState, setLaunchState] = useState<LaunchState>('idle');
  const [liveMode, setLiveMode] = useState(false);
  const [showDemoSummary, setShowDemoSummary] = useState(false);
  const [queriedIds, setQueriedIds] = useState<Set<string>>(new Set());
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const patients: HiePatient[] = useMemo(() => {
    if (loading) return [];
    if (clients.length > 0) {
      return clients.map((c) => ({
        id: c.id,
        name: c.name,
        mrn: c.mrn || c.insuranceMemberId || c.id.slice(-8).toUpperCase(),
        dob: c.dateOfBirth?.slice(0, 10) || '—',
        gender: formatGender(c.gender),
        payer: c.insurancePayer || c.insuranceType || '—',
        lastQuery: c.hieLastQueryAt?.slice(0, 10) ?? null,
      }));
    }
    // Empty clinic = empty list (no static DEMO patients — DB is source of truth)
    return [];
  }, [clients, loading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [patients, query]);

  const selected = patients.find((p) => p.id === selectedId) ?? null;

  // Same-origin cookie staff auth (NextAuth session). Relative /fhir/launch is correct here.
  // Do NOT send CRISP SMART access_token — that is issued later to CRISP by /auth/smart/token.
  // Clinician page only does POST /fhir/launch → window.open(launchUrl).
  async function launchCrisp() {
    if (!selected) return;
    if (!normalizeLaunchDob(selected.dob)) {
      setErrorNote(MISSING_DOB_MESSAGE);
      setLaunchState('idle');
      setShowDemoSummary(false);
      return;
    }
    setLaunchState('launching');
    setErrorNote(null);
    setShowDemoSummary(false);

    const { first, last } = splitName(selected.name);
    const encounterDate = new Date().toISOString().slice(0, 10);

    try {
      const res = await fetch('/fhir/launch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selected.id,
          patientFirstName: first,
          patientLastName: last,
          patientDob: selected.dob,
          encounterDate,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { launchUrl?: string; demoMode?: boolean };
        error?: string;
      };

      if (res.ok && json.success && json.data?.launchUrl) {
        const isDemo = json.data.demoMode === true;
        if (json.data.demoMode === false) setLiveMode(true);
        else if (isDemo) setLiveMode(false);

        // Live only: open CRISP portal. Demo token pe CRISP 403 deta hai — tab mat kholo.
        if (!isDemo) {
          window.open(json.data.launchUrl, '_blank', 'noopener,noreferrer');
        }

        setLaunchState('launched');
        if (json.data.demoMode === false) setQueriedIds((prev) => new Set(prev).add(selected.id));
        // Only a live CRISP launch counts as an HIE query on the chart
        if (json.data.demoMode === false && !selected.id.startsWith('demo-')) {
          void markClientHieQueried(selected.id).catch(() => undefined);
        }
        if (isDemo) {
          setShowDemoSummary(true);
          setErrorNote(
            'Demo Mode: SMART token generated and saved. Live CRISP portal is not opened (would show 403). Set SMART_SIGNING_SECRET + CRISP_EQP_URL for live launch.'
          );
        }
        return;
      }

      if (res.status === 401 || res.status === 403) {
        setErrorNote(
          json.error || 'Not authorized to launch CRISP HIE. Sign in with a clinical role.'
        );
        setLaunchState('idle');
        setShowDemoSummary(false);
        return;
      }

      setErrorNote(json.error || 'Launch failed — live CRISP did not connect.');
      setLaunchState('idle');
      setShowDemoSummary(false);
    } catch {
      setErrorNote('Network error — CRISP launch did not connect. Nothing was queried; try again.');
      setLaunchState('idle');
      setShowDemoSummary(false);
    }
  }

  function selectPatient(id: string) {
    setSelectedId(id);
    setLaunchState('idle');
    setShowDemoSummary(false);
    setErrorNote(null);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-6">
      <PageHeader
        title="Health Information Exchange"
        description="CRISP HIE · ADT Alerts · Medication History · Care Summary"
        actions={<>
          <span
          className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-bold ${
            liveMode
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
              : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              liveMode ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'
            }`}
          />
          {liveMode
            ? 'LIVE — CRISP connected'
            : 'Demo Mode — Set SMART_SIGNING_SECRET + CRISP_EQP_URL to connect'}
        </span>
        </>}
      />
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
        Your organization already has CRISP access through DrFirst. This page lets you query CRISP
        directly via SMART on FHIR, bypassing the Rcopia login step. Contact CRISP at{' '}
        <a href="mailto:crisp@crisphealth.org" className="font-semibold underline">
          crisp@crisphealth.org
        </a>{' '}
        to activate direct embedding and receive your EQP URL.
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-1">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patient name or MRN…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none ring-blue-600/40 focus:bg-white focus:ring-2"
              />
            </div>
          </div>
          <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
            {loading && clients.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">Loading patients…</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">No patients found</li>
            )}
            {filtered.map((p) => {
              const queried = queriedIds.has(p.id) || Boolean(p.lastQuery);
              const active = selectedId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectPatient(p.id)}
                    className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition ${
                      active ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {p.mrn} · {p.dob}
                      </p>
                    </div>
                    {queried ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                        <CheckCircle2 size={12} />
                        Queried
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                        <Clock size={12} />
                        Not queried
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-2">
          {!selected ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-slate-500">
                <FileSearch size={24} />
              </span>
              <p className="mt-4 text-base font-semibold text-slate-700">
                Select a patient to query CRISP HIE
              </p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Choose a patient from the list to generate a SMART launch into the CRISP Embedded
                Query Portal.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selected.mrn} · {selected.dob} · {selected.gender} · {selected.payer}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'ADT Alerts', icon: Activity, iconCls: 'text-rose-700' },
                  { label: 'Medications', icon: Pill, iconCls: 'text-emerald-700' },
                  { label: 'Care Summary', icon: Stethoscope, iconCls: 'text-sky-700' },
                ].map((tile) => {
                  const Icon = tile.icon;
                  return (
                    <div
                      key={tile.label}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <Icon size={16} aria-hidden className={tile.iconCls} />
                      <p className="mt-2 text-sm font-semibold text-slate-800">{tile.label}</p>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={launchCrisp}
                disabled={launchState === 'launching'}
                className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
              >
                {launchState === 'idle' && (
                  <>
                    <ExternalLink size={16} />
                    Query CRISP HIE
                  </>
                )}
                {launchState === 'launching' && (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating SMART launch token…
                  </>
                )}
                {launchState === 'launched' && (
                  <>
                    <CheckCircle2 size={16} />
                    {liveMode
                      ? 'CRISP Launched — View in new tab'
                      : 'Demo launch OK — summary below'}
                  </>
                )}
              </button>

              {launchState === 'launched' && liveMode && (
                <p className="text-xs text-slate-500">
                  A SMART launch token was generated and CRISP opened in a new tab. Keep this window
                  open if you need to relaunch.
                </p>
              )}
              {launchState === 'launched' && !liveMode && showDemoSummary && (
                <p className="text-xs text-slate-500">
                  Demo mode: the launch token was generated and this query was recorded. The summary below is
                  sample data, not live CRISP results.
                </p>
              )}
              {errorNote && <p className="text-xs font-medium text-amber-700">{errorNote}</p>}

              {showDemoSummary && (
                <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">HIE Summary</h3>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                      Demo Data
                    </span>
                  </div>

                  <p className="text-sm text-slate-600">
                    No HIE records returned. ADT alerts, medications, and care summary appear here
                    after a live CRISP query.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
