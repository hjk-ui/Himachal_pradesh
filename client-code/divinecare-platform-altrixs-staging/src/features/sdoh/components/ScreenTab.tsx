'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, ClipboardList, Search, UserRound } from 'lucide-react';
import { fetchClientPage } from '@/features/clients/api/clientsApi';
import type { Client } from '@/features/clients';
import { DOMAIN_LABEL } from '@/lib/sdoh/ahcHrsn';
import { REFERRAL_STATUS_LABEL } from '@/lib/sdoh/workflow';
import { sdohApi, type ClientSdoh, type SdohResourceDto } from '../api';
import { ScreeningResults } from './ScreeningResults';
import { ScreeningWizard, type WizardResult } from './ScreeningWizard';
import { EmptyState, Pill, formatDate, inputCls, primaryBtn, secondaryBtn } from './ui';

function ClientPicker({ onPick }: { onPick: (c: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancel = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetchClientPage({ page: 0, pageSize: 12, search: q, status: q.trim() ? undefined : 'ACTIVE' })
        .then((r) => !cancel && setRows(r.clients))
        .catch(() => !cancel && setRows([]))
        .finally(() => !cancel && setLoading(false));
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a client by name or MRN"
          className={`${inputCls} py-3.5 pl-11 text-base`}
          aria-label="Search clients"
        />
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {loading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">Searching…</p>}
        {!loading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">No clients found in your caseload.</p>}
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick({ id: c.id, name: c.name })}
            className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#5C2D91]/10 text-[#5C2D91]">
              <UserRound size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-slate-900">{c.name}</span>
              <span className="block text-xs text-slate-500">
                {[c.mrn ? `MRN ${c.mrn}` : null, c.dateOfBirth ? `DOB ${formatDate(c.dateOfBirth)}` : null].filter(Boolean).join(' · ') || ' '}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScreenTab({
  initialClient,
  resources,
  onClientChange,
}: {
  initialClient: { id: string; name?: string } | null;
  resources: SdohResourceDto[];
  onClientChange: (id: string | null) => void;
}) {
  const [client, setClient] = useState<{ id: string; name: string } | null>(initialClient ? { id: initialClient.id, name: initialClient.name ?? '' } : null);
  const [data, setData] = useState<ClientSdoh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'overview' | 'screening'>('overview');
  const [justDone, setJustDone] = useState<WizardResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const d = await sdohApi.clientSdoh(id);
      setData(d);
      setClient(d.client);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Could not load this client');
    }
  }, []);

  useEffect(() => {
    if (initialClient?.id) void load(initialClient.id);
  }, [initialClient?.id, load]);

  function pick(c: { id: string; name: string }) {
    setClient(c);
    setJustDone(null);
    setMode('overview');
    onClientChange(c.id);
    void load(c.id);
  }

  if (!client) return <ClientPicker onPick={pick} />;

  if (mode === 'screening') {
    return (
      <ScreeningWizard
        client={client}
        onCancel={() => setMode('overview')}
        onDone={(r) => {
          setJustDone(r);
          setExpanded(r.screening.id);
          setMode('overview');
          void load(client.id);
        }}
      />
    );
  }

  const latest = data?.screenings[0];
  const openReferrals = data?.referrals.filter((r) => r.status !== 'closed') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client</p>
          <Link href={`/dashboard/clients/${encodeURIComponent(client.id)}`} className="text-lg font-bold text-slate-900 hover:underline">
            {client.name || 'Client'}
          </Link>
          {data && (
            <p className="mt-0.5 text-sm text-slate-500">
              {latest ? `Last screened ${formatDate(latest.completedAt)}` : 'Not screened yet'}
              {data.rescreen && data.rescreen.state !== 'current' && (
                <>
                  {' · '}
                  <span className={data.rescreen.state === 'overdue' ? 'font-semibold text-rose-700' : 'font-semibold text-amber-700'}>
                    Rescreen {data.rescreen.state === 'overdue' ? 'overdue' : 'due'} {formatDate(data.rescreen.dueAt)}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => {
              setClient(null);
              setData(null);
              setJustDone(null);
              onClientChange(null);
            }}
          >
            Change client
          </button>
          <button type="button" className={`${primaryBtn} px-5 py-3 text-base`} disabled={!data} onClick={() => setMode('screening')}>
            <ClipboardList size={18} /> {latest ? 'New screening' : 'Start screening'}
          </button>
        </div>
      </div>

      {error && <EmptyState title="This client can't be opened">{error}</EmptyState>}

      {data && openReferrals.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Open referrals</h3>
          <ul className="space-y-1.5 text-sm">
            {openReferrals.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Pill tone={r.status === 'connected' ? 'sky' : 'amber'}>{REFERRAL_STATUS_LABEL[r.status]}</Pill>
                <span className="font-medium text-slate-800">{DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] ?? r.domain}</span>
                {r.resourceName && <span className="text-slate-500">→ {r.resourceName}</span>}
                <span className="text-slate-400">· opened {formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.screenings.length === 0 && (
        <EmptyState title="No screenings yet">Start the 10-question screening with the client. It takes about 3 minutes.</EmptyState>
      )}

      {data?.screenings.map((s) => {
        const open = expanded === s.id;
        return (
          <div key={s.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setExpanded(open ? null : s.id)}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">
                  {formatDate(s.completedAt)}
                  <span className="ml-2 text-sm font-normal text-slate-500">{s.completedByName || 'Staff'}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.positiveDomains.length === 0 ? (
                    <Pill tone="emerald">No needs identified</Pill>
                  ) : (
                    s.positiveDomains.map((d) => (
                      <Pill key={d} tone={d === 'safety' ? 'rose' : 'amber'}>
                        {DOMAIN_LABEL[d]}
                      </Pill>
                    ))
                  )}
                </div>
              </div>
              {open ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
            </button>
            {open && (
              <div className="border-t border-slate-100 p-4">
                <ScreeningResults
                  screening={s}
                  clientId={client.id}
                  canConfirm={data.canConfirmZCodes}
                  resources={resources}
                  referrals={data.referrals}
                  riskAlertCreated={justDone?.screening.id === s.id ? justDone.riskAlertCreated : undefined}
                  safetyItemEndorsed={justDone?.screening.id === s.id ? justDone.safetyItemEndorsed : undefined}
                  onScreeningChange={(next) => setData((d) => (d ? { ...d, screenings: d.screenings.map((x) => (x.id === next.id ? next : x)) } : d))}
                  onReferralCreated={(r) => setData((d) => (d ? { ...d, referrals: [r, ...d.referrals] } : d))}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
