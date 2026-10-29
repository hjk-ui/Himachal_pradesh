'use client';

import { useState } from 'react';

const RUNS = [
  { id: 'prior-auth-utilization', label: 'Prior-auth utilization' },
  { id: 'appointment-volume', label: 'Appointment volume' },
  { id: 'no-show-late-cancel', label: 'No-show and late cancel' },
  { id: 'waitlist', label: 'Waitlist' },
];

const ALLOWED = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'OFFICE_MANAGER']);

export function OperationalReports({ role }: { role?: string | null }) {
  const [text, setText] = useState('');
  if (!role || !ALLOWED.has(role)) return null;
  async function run(id: string) {
    setText('');
    const response = await fetch(`/api/reports/library/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 0, pageSize: 25 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setText(data.error || 'This report is not available for your role.');
      return;
    }
    setText(`${id}: ${data.total ?? data.rows?.length ?? 0} rows`);
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Operational reports</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {RUNS.map((item) => (
          <button key={item.id} type="button" onClick={() => void run(item.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold">
            {item.label}
          </button>
        ))}
      </div>
      {text ? <p className="mt-2 text-sm text-slate-700">{text}</p> : null}
    </section>
  );
}
