'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Info, Link2, Microscope, Search, TrendingUp, Users } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { ChartDiagnosis, DiagnosisSummary } from '@/lib/clients/diagnosisOverviewCore';
import { PageHeader, StatCard, StatGrid } from '@/components/ui';
import { DSM5TR_COMMON } from '@/lib/diagnoses/dsm5tr';

/**
 * Diagnoses (read-only practice view). Source of truth is each client's diagnosis list (chart ›
 * Diagnoses: ranked, with status and history); clients not moved to the list yet show the client
 * record. Counts are computed on the server over every client the viewer may see. Coding problems
 * (not coded, header code, not in the FY2027 set, unspecified) are flagged so they are fixed
 * before claims. Nothing is derived, defaulted or saved here.
 */
type OverviewClient = {
  clientId: string;
  name: string;
  clinician: string | null;
  diagnoses: ChartDiagnosis[];
  locked: boolean;
};

type Overview = { summary: DiagnosisSummary; clients: OverviewClient[]; activeClients: number };

// DSM-5-TR names for common ICD-10-CM codes (all billable FY2027 codes; tests/diagnosis-standard.test.ts).
// Old DSM-IV / ICD-9-CM numbers (296.32 ...) are not shown: not valid on claims since October 2015.
const COMMON_DSM5 = DSM5TR_COMMON.map((e) => ({ icd: e.code, name: e.name, group: e.group }));


export default function DiagnosesPage() {
  const [activeTab, setActiveTab] = useState('Client Diagnoses');
  const [search, setSearch] = useState('');
  const [dxSearch, setDxSearch] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ success: true } & Overview>('/api/ehr/diagnoses/overview')
      .then((res) => setData({ summary: res.summary, clients: res.clients, activeClients: res.activeClients }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load chart diagnoses'))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () =>
      (data?.clients ?? []).flatMap((c) =>
        c.diagnoses.map((d, i) => ({ key: `${c.clientId}-${i}`, client: c, dx: d }))
      ),
    [data]
  );

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.client.name.toLowerCase().includes(q) ||
      (r.dx.code || '').toLowerCase().includes(q) ||
      r.dx.label.toLowerCase().includes(q) ||
      (r.dx.flag || '').toLowerCase().includes(q)
    );
  });

  const filteredDsm = COMMON_DSM5.filter((item) => {
    const q = dxSearch.toLowerCase();
    return item.name.toLowerCase().includes(q) || item.icd.toLowerCase().includes(q);
  });
  const groupedDsm = filteredDsm.reduce<Record<string, typeof COMMON_DSM5>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const summary = data?.summary;
  const top = summary?.prevalence[0];
  const maxPrevalence = Math.max(1, ...(summary?.prevalence.map((p) => p.count) ?? [1]));

  const stats = [
    { label: 'Unique ICD-10 codes', value: summary ? String(summary.uniqueCodes) : '—', Icon: Microscope, tone: 'brand' as const },
    {
      label: 'Most prevalent (primary)',
      value: top ? top.key : '—',
      Icon: TrendingUp,
      tone: 'info' as const,
      sub: top ? `${top.count} client${top.count === 1 ? '' : 's'}` : 'No chart diagnoses',
    },
    {
      label: 'Clients with a diagnosis',
      value: summary ? String(summary.clientsWithDiagnosis) : '—',
      Icon: Users,
      tone: 'success' as const,
      sub: data ? `of ${data.activeClients} active clients` : undefined,
    },
    { label: 'Multi-Dx clients', value: summary ? String(summary.multiDxClients) : '—', Icon: Link2, tone: 'neutral' as const, sub: '2 or more chart diagnoses' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnoses"
        description={<>Each client&apos;s diagnosis list (ranked, with status). Read-only here — add, rank, resolve or review diagnoses on the client&apos;s chart (Diagnoses).</>}
        >
        {error ? <p className="mt-1 text-sm text-rose-600">{error}</p> : null}
      </PageHeader>
      <StatGrid columns={4}>
        {stats.map(({ label, value, tone, Icon, sub }) => (
          <StatCard key={label} label={label} value={value} hint={sub} tone={tone} icon={<Icon />} />
        ))}
      </StatGrid>

      <div className="flex w-fit gap-1 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xs">
        {['Client Diagnoses', 'Prevalence', 'DSM-5-TR Reference'].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              activeTab === tab ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Client Diagnoses' && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
          <div className="border-b border-slate-100 p-5">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, ICD-10, diagnosis, or a flag (e.g. unspecified)…"
                aria-label="Search diagnoses"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-500">
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Client</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Diagnosis</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">ICD-10</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Rank</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Needs attention</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Clinician</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-900">
                      <Link href={`/dashboard/clients/${r.client.clientId}`} className="hover:underline">
                        {r.client.name}
                      </Link>
                    </td>
                    <td className="max-w-xs px-5 py-3 text-sm text-slate-700">{r.dx.label}</td>
                    <td className="px-5 py-3">
                      {r.dx.code ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{r.dx.code}</span>
                      ) : (
                        <span className="text-xs text-amber-700">Not coded</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {r.dx.rank === 'primary' ? 'Primary' : 'Secondary'}
                      {r.dx.status === 'PROVISIONAL' ? <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">Provisional</span> : null}
                    </td>
                    <td className="px-5 py-3 text-xs">{r.dx.flag ? <span className="rounded bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{r.dx.flag}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{r.client.clinician || 'Not assigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <div className="py-12 text-center text-slate-500">
                {rows.length === 0 ? 'No chart diagnoses recorded.' : 'No diagnoses match the search.'}
              </div>
            )}
            {loading ? <div className="py-12 text-center text-slate-500">Loading…</div> : null}
          </div>
        </div>
      )}

      {activeTab === 'Prevalence' && (
        <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <h3 className="mb-6 font-semibold text-slate-900">Primary diagnosis prevalence — active clients</h3>
          <div className="space-y-4">
            {(summary?.prevalence ?? []).slice(0, 15).map((p) => (
              <div key={p.key} className="flex items-center gap-3 sm:gap-4">
                <span className="w-28 flex-shrink-0 truncate text-sm font-semibold text-slate-700" title={p.key}>{p.key}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="flex h-4 items-center justify-end rounded-full bg-blue-600 pr-2"
                    style={{ width: `${(p.count / maxPrevalence) * 100}%` }}
                  >
                    <span className="text-xs font-bold text-white">{p.count}</span>
                  </div>
                </div>
                <span className="w-12 shrink-0 text-right text-sm text-slate-500 sm:w-16">
                  {summary && summary.clientsWithDiagnosis ? `${Math.round((p.count / summary.clientsWithDiagnosis) * 100)}%` : '—'}
                </span>
              </div>
            ))}
            {summary && summary.prevalence.length === 0 && <p className="text-sm text-slate-500">No chart diagnoses recorded.</p>}
          </div>
          <p className="mt-6 text-xs text-slate-500">Share of clients with a chart diagnosis, by primary diagnosis.</p>
        </div>
      )}

      {activeTab === 'DSM-5-TR Reference' && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
          <div className="border-b border-slate-100 p-5">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={dxSearch}
                onChange={(e) => setDxSearch(e.target.value)}
                placeholder="Search by DSM-5-TR name or ICD-10-CM code…"
                aria-label="Search DSM-5-TR reference"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 sm:w-80"
              />
            </div>
          </div>
          <div className="space-y-5 p-5">
            {Object.entries(groupedDsm).map(([group, dxList]) => (
              <div key={group}>
                <p className="mb-2 text-xs font-bold uppercase text-slate-500">{group}</p>
                <div className="space-y-1.5">
                  {dxList.map((item) => (
                    <div key={item.icd} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-3">
                      <span className="w-20 shrink-0 rounded bg-blue-50 px-2 py-0.5 text-center text-xs font-bold text-blue-700">{item.icd}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{item.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 rounded-xl border border-slate-200/80 bg-blue-50 p-4 text-xs text-blue-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Each client&apos;s diagnosis list keeps rank (exactly one primary), status (active, provisional, ruled out,
          resolved, entered in error), onset and full history; nothing is deleted. Notes link the diagnoses the visit
          addressed, and claims take their diagnosis pointers from the note.
        </p>
      </div>
    </div>
  );
}
