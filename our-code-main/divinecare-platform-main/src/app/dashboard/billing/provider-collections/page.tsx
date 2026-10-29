'use client';

import { useState } from 'react';

export default function ProviderCollectionsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('Choose a date range.');
  const [sections, setSections] = useState<Array<{ category: string; amountCents: number }>>([]);

  async function load() {
    const response = await fetch(`/api/billing/provider-collections?from=${from}&to=${to}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'Provider collections are not available.');
      setSections([]);
      return;
    }
    setSections((data.sections || []).map((row: { category: string; amountCents: number }) => row));
    setMessage(data.summary?.rowCount ? `${data.summary.rowCount} dated rows.` : 'No dated transactions in this range.');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Provider collections</h1>
      <p className="text-sm text-slate-500">Valant transactions by provider, code, and category. This is not the aging collections page.</p>
      <div className="flex flex-wrap gap-2">
        <input className="rounded-lg border px-2 py-1.5" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className="rounded-lg border px-2 py-1.5" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <button type="button" onClick={() => void load()} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white">Load</button>
        {from && to ? <a className="rounded-lg border px-3 py-1.5 text-sm font-semibold" href={`/api/billing/provider-collections?from=${from}&to=${to}&format=csv`}>CSV</a> : null}
      </div>
      <p className="text-sm text-slate-700">{message}</p>
      <ul className="divide-y rounded-xl border bg-white text-sm">
        {sections.map((row) => (
          <li key={row.category} className="flex justify-between px-4 py-2">
            <span>{row.category || 'Uncategorized'}</span>
            <span>${(row.amountCents / 100).toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
