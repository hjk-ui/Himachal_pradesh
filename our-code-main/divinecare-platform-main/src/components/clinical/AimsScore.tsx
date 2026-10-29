'use client';

import { useState } from 'react';
import { useClients } from '@/features/clients';

export function AimsScore() {
  const { clients } = useClients();
  const [clientId, setClientId] = useState('');
  const [score, setScore] = useState('');
  const [message, setMessage] = useState('');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    const totalScore = Number(score);
    if (!clientId || !Number.isFinite(totalScore)) {
      setMessage('Choose a client and enter the AIMS score.');
      return;
    }
    const response = await fetch(`/api/clients/${clientId}/aims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalScore }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `AIMS score ${totalScore} is saved on the chart.` : data.error || 'Could not save the AIMS score.');
  }

  return (
    <form onSubmit={(event) => void save(event)} className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">AIMS score</h2>
      <p className="mt-1 text-xs text-slate-500">Stored on the selected chart for staff who can open assessments.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate-600">
          Client
          <select className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Select</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Score
          <input className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" inputMode="decimal" value={score} onChange={(event) => setScore(event.target.value)} />
        </label>
        <button type="submit" className="rounded-lg bg-[#5C2D91] px-3 py-2 text-sm font-semibold text-white">Save on chart</button>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </form>
  );
}
