'use client';

import { useState } from 'react';

type Charge = {
  id: string;
  programName: string;
  clientName: string;
  serviceDate: string;
  code: string;
  status: string;
  part2: boolean;
};

export default function IntensiveBillingPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [programId, setProgramId] = useState('mh-iop');
  const [rows, setRows] = useState<Charge[]>([]);
  const [message, setMessage] = useState('Choose a date range.');

  async function load() {
    const response = await fetch(`/api/intensive/charges?from=${from}&to=${to}&programId=${programId}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'Intensive charges are not available.');
      setRows([]);
      return;
    }
    setRows(data.charges || []);
    setMessage(data.charges?.length ? '' : 'No drafts in this range.');
  }

  async function generate() {
    const response = await fetch('/api/intensive/charges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programId, from, to }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `Created ${data.created || 0} drafts.` : data.error || 'Drafts were not created.');
    if (response.ok) await load();
  }

  async function update(id: string, action: 'void' | 'restore') {
    const response = await fetch('/api/intensive/charges', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    if (response.ok) await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Intensive program charges</h1>
      <p className="text-sm text-slate-500">Drafts from saved intensive attendance. This screen does not submit a claim.</p>
      <div className="flex flex-wrap gap-2">
        <select className="rounded-lg border px-2 py-1.5" value={programId} onChange={(event) => setProgramId(event.target.value)}>
          <option value="mh-iop">Mental-health IOP</option>
          <option value="sud-iop">SUD IOP</option>
          <option value="php">PHP</option>
        </select>
        <input className="rounded-lg border px-2 py-1.5" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className="rounded-lg border px-2 py-1.5" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-1.5 text-sm font-semibold">Load</button>
        <button type="button" onClick={() => void generate()} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white">Generate drafts</button>
      </div>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <ul className="divide-y rounded-xl border bg-white text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span>{row.serviceDate} · {row.clientName} · {row.programName} · {row.code} · {row.status}{row.part2 ? ' · Part 2' : ''}</span>
            {row.status === 'void' ? (
              <button type="button" onClick={() => void update(row.id, 'restore')} className="text-sm font-semibold">Restore</button>
            ) : (
              <button type="button" onClick={() => void update(row.id, 'void')} className="text-sm font-semibold">Void</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
