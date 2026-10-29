'use client';

import { useEffect, useState } from 'react';

type ArchiveRow = { id: string; fileName: string | null; fileSize: number | null; createdAt: string };

export default function ValantBalancesPage() {
  const [tab, setTab] = useState<'balances' | 'archive'>('balances');
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (tab !== 'archive') return;
    fetch('/api/billing/valant-archive', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(data.error || 'The archive is not available.');
          return;
        }
        setRows(data.rows || []);
        setMessage(data.total ? `${data.total} archived billing files.` : 'No archived billing files.');
      })
      .catch(() => setMessage('The archive is not available.'));
  }, [tab]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Valant balances</h1>
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('balances')} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === 'balances' ? 'bg-indigo-700 text-white' : 'border'}`}>Balances</button>
        <button type="button" onClick={() => setTab('archive')} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === 'archive' ? 'bg-indigo-700 text-white' : 'border'}`}>Archive</button>
      </div>
      {tab === 'balances' ? <p className="text-sm text-slate-600">Opening balances and prepayments stay on the patient ledger. This list does not post them.</p> : null}
      {tab === 'archive' ? (
        <section className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-600">{message}</p>
          <ul className="mt-2 divide-y text-sm">
            {rows.map((row) => (
              <li key={row.id} className="py-2">{row.fileName || row.id} · {row.createdAt.slice(0, 10)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
