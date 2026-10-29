'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth';

type Row = { code: string; description: string; rateCents: number | null };

export default function FeeSchedulePage() {
  const { user } = useAuth();
  const canImport = user?.role === 'ADMIN' || user?.role === 'DIRECTOR' || user?.role === 'PRACTICE_DIRECTOR';
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/billing/fee-schedule', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setRows(data.rows || []);
          setSource(data.source || '');
        } else setMessage(data.error || 'Could not open the fee schedule.');
      })
      .catch(() => setMessage('Could not open the fee schedule.'));
  }, []);

  async function onFile(file: File) {
    const text = await file.text();
    const parsed = text.split(/\r?\n/).slice(1).flatMap((line) => {
      const [code, description, rate] = line.split(',');
      const rateCents = Math.round(Number(rate) * 100);
      if (!code || !description || !Number.isFinite(rateCents) || rateCents <= 0) return [];
      return [{ code: code.trim(), description: description.trim(), rateCents }];
    });
    const response = await fetch('/api/billing/fee-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: parsed }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'Import was refused.');
      return;
    }
    setRows(parsed);
    setSource('import');
    setMessage(`Imported ${data.imported} prices.`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Fee schedule</h1>
      <p className="text-sm text-slate-600">This is the price source. {source === 'import' ? 'Showing the imported schedule.' : 'Showing the practice fee schedule.'}</p>
      {canImport ? (
        <label className="block text-sm font-semibold text-slate-700">
          Import CSV (code, description, rate)
          <input className="mt-1 block text-sm" type="file" accept=".csv,text/csv" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }} />
        </label>
      ) : null}
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-2">Code</th><th>Description</th><th>Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="border-t border-slate-100">
              <td className="py-2 font-mono">{row.code}</td>
              <td>{row.description}</td>
              <td>{row.rateCents == null ? 'No fee' : `$${(row.rateCents / 100).toFixed(2)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
