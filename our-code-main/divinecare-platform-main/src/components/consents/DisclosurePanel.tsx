'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';

const RECORD_ROLES = new Set(['OFFICE_MANAGER', 'BILLING', 'ADMIN', 'PRACTICE_DIRECTOR']);
const READ_ROLES = new Set(['ADMIN', 'PRACTICE_DIRECTOR', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER']);

export function DisclosurePanel() {
  const { user } = useAuth();
  const { clients } = useClients();
  const role = user?.role || '';
  const canRecord = RECORD_ROLES.has(role);
  const canRead = READ_ROLES.has(role);
  const canExport = role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
  const [clientId, setClientId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [purpose, setPurpose] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; recipient: string; purpose: string; disclosedAt: string }>>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!canRead || !clientId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/clients/${clientId}/disclosures`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!cancelled) setRows(response.ok ? data.disclosures || [] : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, clientId]);

  if (!canRecord && !canRead) return null;

  async function record(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    const response = await fetch(`/api/clients/${clientId}/disclosures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, purpose }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? 'Disclosure recorded.' : data.error || 'Could not record the disclosure.');
    if (response.ok) {
      setRecipient('');
      setPurpose('');
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Disclosure accounting</h2>
      <p className="mt-1 text-xs text-slate-500">A record is for one client. History and the export follow the role rules.</p>
      <label className="mt-3 block text-xs font-semibold text-slate-600">
        Client
        <select className="mt-1 block w-full max-w-md rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={clientId} onChange={(event) => setClientId(event.target.value)}>
          <option value="">Select</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </label>
      {canRecord ? (
        <form onSubmit={(event) => void record(event)} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="Recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          <input className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="Purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
          <button type="submit" className="w-fit rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Record disclosure</button>
        </form>
      ) : null}
      {canRead ? (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {rows.length === 0 ? <li className="py-2 text-slate-500">No disclosure history for this client.</li> : rows.map((row) => (
            <li key={row.id} className="py-2">
              <span className="font-semibold">{row.recipient}</span>
              <span className="text-slate-500"> · {row.purpose} · {new Date(row.disclosedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">You can record a disclosure. The history stays closed for this role.</p>
      )}
      {canExport ? (
        <a className="mt-3 inline-block text-sm font-semibold text-[#5C2D91]" href="/api/disclosures/export">Export accounting</a>
      ) : null}
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
