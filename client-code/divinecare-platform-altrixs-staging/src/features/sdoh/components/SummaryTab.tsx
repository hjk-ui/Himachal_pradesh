'use client';

import { useEffect, useState } from 'react';
import { DOMAIN_LABEL, SUPPLEMENTAL_DOMAINS } from '@/lib/sdoh/ahcHrsn';
import { sdohApi, type SdohSummary } from '../api';
import { DomainIcon, EmptyState, formatDate } from './ui';

const show = (v: number | null) => (v === null ? '—' : `${v}%`);

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function SummaryTab() {
  const [data, setData] = useState<SdohSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    sdohApi
      .summary()
      .then((r) => setData(r.summary))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <EmptyState title="Summary unavailable">{error}</EmptyState>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const r = data.referrals;
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Since {formatDate(data.since)} · clients you can see · latest screening per client
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Clients screened (12 months)" value={data.clientsScreened} sub={`${data.screenings} screenings`} />
        <Tile label="Active clients screened" value={show(data.coveragePercent)} sub={`of ${data.activeClients} active clients`} />
        <Tile label="At least one need" value={data.anyPositive} sub={data.clientsScreened ? `${Math.round((data.anyPositive / data.clientsScreened) * 100)}% of screened` : undefined} />
        <Tile label="Referral closure rate" value={show(r.closurePercent)} sub={`${r.closed} of ${r.total} closed · ${r.needMet} need met`} />
      </div>

      {data.clientsScreened === 0 ? (
        <EmptyState title="No screenings in the last 12 months">Results appear here as screenings are saved.</EmptyState>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Positive by domain</h3>
          <div className="space-y-2.5">
            {data.byDomain
              .filter((d) => d.screened > 0)
              .map((d) => (
                <div key={d.domain} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)_auto]">
                  <span className="inline-flex items-center gap-2 truncate text-slate-700">
                    <span className="text-[#5C2D91]">
                      <DomainIcon domain={d.domain} />
                    </span>
                    {DOMAIN_LABEL[d.domain]}
                    {SUPPLEMENTAL_DOMAINS.includes(d.domain) && <span className="text-[10px] text-slate-400">supp.</span>}
                  </span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#5C2D91]" style={{ width: `${d.percent ?? 0}%` }} />
                  </div>
                  <span className="w-28 text-right tabular-nums text-slate-700">
                    {show(d.percent)} <span className="text-xs text-slate-400">({d.positive}/{d.screened})</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Referrals opened (12 months)" value={r.total} />
        <Tile label="Still open" value={r.open} />
        <Tile label="Connected to a resource" value={r.connected} sub="ever marked connected" />
      </div>
    </div>
  );
}
