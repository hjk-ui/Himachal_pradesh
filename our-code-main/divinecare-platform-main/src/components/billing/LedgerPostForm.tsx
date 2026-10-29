'use client';

import { useState } from 'react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { recordPayment } from '@/features/billing/ledgerApi';

export function LedgerPostForm() {
  const { user } = useAuth();
  const patientSide = user?.role === 'OFFICE_MANAGER' || user?.role === 'FRONT_DESK';
  const [query, setQuery] = useState('');
  const { clients } = useClients({ search: query, limit: 50 });
  const [clientId, setClientId] = useState('');
  const [message, setMessage] = useState('');

  async function post(kind: 'copay' | 'chargeback' | 'legacy') {
    setMessage('');
    if (!clientId) {
      setMessage('Choose a client first.');
      return;
    }
    try {
      const payment = await recordPayment({
        clientId,
        amountCents: kind === 'copay' ? 2000 : kind === 'legacy' ? 4500 : -1500,
        method: kind === 'copay' ? 'CASH' : 'INSURANCE',
        kind,
        note: kind === 'legacy' ? 'Legacy balance' : kind,
      });
      setMessage(`${payment.note || kind} posted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The ledger post was refused.');
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Ledger post</h2>
      <p className="mt-1 text-xs text-slate-500">Front desk and the office manager can post a copay. Insurance chargeback and an old-system balance stay with billing.</p>
      <label className="mt-3 block text-sm">
        Client
        <input className="mt-1 block w-full max-w-md rounded-lg border px-2 py-1.5" placeholder="Find a client" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="mt-1 block w-full max-w-md rounded-lg border px-2 py-1.5" value={clientId} onChange={(event) => setClientId(event.target.value)}>
          <option value="">Choose a client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void post('copay')} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Take copay</button>
        {patientSide ? null : (
          <>
            <button type="button" onClick={() => void post('chargeback')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Ins Chg Back</button>
            <button type="button" onClick={() => void post('legacy')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Old-system balance</button>
          </>
        )}
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
