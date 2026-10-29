'use client';

import { useEffect, useState } from 'react';

type Row = { id: string; name: string; ediPayerId: string; active: boolean; payerRegistry?: { name: string } | null };

export default function InsuranceCompaniesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState('Loading insurance companies…');

  useEffect(() => {
    fetch('/api/billing/insurance-companies', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(data.error || 'Insurance companies are not available.');
          return;
        }
        setRows(data.rows || []);
        setCanEdit(Boolean(data.canEdit));
        setMessage(data.rows?.length ? '' : 'No insurance companies are on file.');
      })
      .catch(() => setMessage('Insurance companies are not available.'));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Insurance companies</h1>
      <p className="text-sm text-slate-500">Valant payer directory. This screen reads companies{canEdit ? ' and billing core is allowed to maintain them' : ''}. Payer settings stay separate.</p>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <ul className="divide-y rounded-xl border bg-white text-sm">
        {rows.map((row) => (
          <li key={row.id} className="px-4 py-2">
            {row.name} · {row.ediPayerId || 'no EDI id'}{row.payerRegistry ? ` · linked ${row.payerRegistry.name}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
