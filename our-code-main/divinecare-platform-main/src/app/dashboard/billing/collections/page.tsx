'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Aging = {
  shown: Record<string, number>;
  storedBuckets: Record<string, number>;
  legacyCents: number;
  newChargeCents: number;
  collections: Array<{ id: string; clientName: string; cptCode: string; balanceCents: number; legacy: boolean }>;
};

const money = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;

export default function CollectionsPage() {
  const [data, setData] = useState<Aging | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/billing/aging', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => {
        if (!body.success) setMessage(body.error || 'Could not open collections.');
        else setData(body);
      })
      .catch(() => setMessage('Could not open collections.'));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Provider collections</h1>
      <p className="text-sm text-slate-600">Test mode. Waystar claim status stays on the billing screen. This worklist does not submit a claim. Old-system balances show the whole total in Over 120. Original buckets stay stored.</p>
      <p className="text-sm"><Link className="font-semibold text-[#5C2D91]" href="/dashboard/billing/fee-schedule">Fee schedule</Link></p>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <p className="rounded-xl border p-3 text-sm">New charges {money(data.newChargeCents)}</p>
            <p className="rounded-xl border p-3 text-sm">Old-system balances {money(data.legacyCents)}</p>
            <p className="rounded-xl border p-3 text-sm">Over 120 on screen {money(data.shown['Over 120'] || 0)}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                {Object.keys(data.shown).map((column) => <th key={column} className="py-2">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                {Object.entries(data.shown).map(([column, cents]) => <td key={column} className="py-2">{money(cents)}</td>)}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500">Original buckets stay stored: {Object.entries(data.storedBuckets).map(([column, cents]) => `${column} ${money(cents)}`).join(' · ')}</p>
          <ul className="divide-y divide-slate-100 rounded-xl border bg-white">
            {data.collections.length === 0 ? <li className="px-4 py-3 text-sm text-slate-500">No balances need collection.</li> : data.collections.map((row) => (
              <li key={row.id} className="flex justify-between px-4 py-3 text-sm">
                <span>{row.clientName} · {row.cptCode}{row.legacy ? ' · old system' : ''}</span>
                <span>{money(row.balanceCents)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
