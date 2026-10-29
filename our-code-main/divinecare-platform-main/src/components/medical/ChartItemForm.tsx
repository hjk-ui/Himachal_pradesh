'use client';

import { useEffect, useState } from 'react';

export function ChartItemForm({
  kind,
  title,
  detail,
}: {
  kind: 'order' | 'standing-lab' | 'care-gap';
  title: string;
  detail: string;
}) {
  const [clientId, setClientId] = useState('');
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ limit: '50' });
      if (query.trim()) params.set('search', query.trim());
      fetch(`/api/clients?${params}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((data) => {
          if (cancelled || !Array.isArray(data.clients)) return;
          setClients(data.clients.map((client: { id: string; name: string }) => ({ id: client.id, name: client.name })));
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  async function save() {
    const response = await fetch('/api/medical/chart-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, clientId, text }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'Not saved.');
      return;
    }
    const placed = data.item?.placesLab === true ? 'The lab was placed.' : 'The lab was not placed.';
    setMessage(`${data.message || 'Saved on the chart.'} ${kind === 'standing-lab' ? placed : ''}`.trim());
  }

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="rounded-lg border px-2 py-1.5 text-sm" placeholder="Find a client" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="rounded-lg border px-2 py-1.5 text-sm" value={clientId} onChange={(event) => setClientId(event.target.value)}>
          <option value="">Choose a client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
        <input className="min-w-64 flex-1 rounded-lg border px-2 py-1.5 text-sm" placeholder="What to save" value={text} onChange={(event) => setText(event.target.value)} />
        <button type="button" onClick={() => void save()} className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white">Save</button>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
