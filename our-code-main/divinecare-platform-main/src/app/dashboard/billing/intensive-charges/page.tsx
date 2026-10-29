'use client';

import { useEffect, useState } from 'react';

type Charge = {
  id: string;
  clientId: string;
  track: string;
  amountCents: number;
  status: string;
};

export default function IntensiveChargesPage() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [canSubmit, setCanSubmit] = useState(false);
  const [message, setMessage] = useState('');
  const [track, setTrack] = useState('mh-iop');
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('0');

  function load() {
    fetch('/api/billing/intensive-charges', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          setMessage(data.error || 'Could not read charge drafts.');
          return;
        }
        setCharges(data.charges || []);
        setCanSubmit(Boolean(data.canSubmit));
      })
      .catch(() => setMessage('Could not read charge drafts.'));
  }

  useEffect(() => { load(); }, []);

  async function submit(id: string) {
    const response = await fetch('/api/billing/intensive-charges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submitId: id }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? 'Submitted in test mode.' : data.error || 'Not submitted.');
    if (response.ok) load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Intensive charge drafts</h1>
      <p className="text-sm text-slate-500">Test mode. Office manager can read these drafts and cannot submit them.</p>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {canSubmit ? (
        <form
          className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void fetch('/api/billing/intensive-charges', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                enrollmentId: 'manual',
                clientId,
                track,
                amountCents: Math.round(Number(amount) * 100),
              }),
            }).then(() => load());
          }}
        >
          <input className="rounded-lg border px-2 py-1.5 text-sm" placeholder="Client id" value={clientId} onChange={(event) => setClientId(event.target.value)} required />
          <input className="rounded-lg border px-2 py-1.5 text-sm" value={track} onChange={(event) => setTrack(event.target.value)} />
          <input className="w-28 rounded-lg border px-2 py-1.5 text-sm" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <button className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white" type="submit">Save draft</button>
        </form>
      ) : null}
      <ul className="divide-y rounded-xl border border-slate-200 bg-white">
        {charges.length === 0 ? <li className="p-4 text-sm text-slate-500">No charge drafts.</li> : charges.map((charge) => (
          <li key={charge.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>{charge.track} · ${(charge.amountCents / 100).toFixed(2)} · {charge.status}</span>
            {canSubmit && charge.status === 'draft' ? (
              <button type="button" onClick={() => void submit(charge.id)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Submit</button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
